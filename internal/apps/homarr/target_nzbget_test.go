package homarr

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

type nzbgetFixture struct {
	stats             *statsFixture
	identity          map[string]any
	downloadIdentity  map[string]any
	status            map[string]any
	items             any
	nativeReads       int
	downloads         int
	statsBeforeNative bool
	requests          int
	infoReads         int
	infoFails         bool
	version           any
	nativeAttempts    int
	rejectNative      bool
	otherHomarr       int
	mutations         int
}

func newNZBGetFixture() *nzbgetFixture {
	return &nzbgetFixture{
		stats:            newStatsFixture(),
		version:          "2.5.2",
		identity:         map[string]any{"id": "owned", "kind": "nzbGet", "url": "http://nzbget:6789", "secrets": []any{map[string]any{"kind": "username", "value": "self-host-homarr"}, map[string]any{"kind": "password", "value": nil}}},
		downloadIdentity: map[string]any{"id": "owned", "kind": "nzbGet"},
		status:           map[string]any{"rates": map[string]any{"down": float64(1024)}, "paused": true, "types": []any{"usenet"}},
		items:            []any{},
	}
}

func (f *nzbgetFixture) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.requests++
	if r.Method != http.MethodGet && r.URL.Path != "/jsonrpc" && r.URL.Path != "/api" {
		f.mutations++
	}
	if r.URL.Path == "/api/trpc/info.getInfo" {
		f.infoReads++
		if f.infoFails || r.Header.Get("ApiKey") != "fixture-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": map[string]any{"version": f.version}}}})
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api" {
		f.otherHomarr++
	}
	if strings.HasPrefix(r.URL.Path, "/api/trpc/widget.stats.") {
		if f.nativeReads == 0 || f.downloads != 1 {
			f.statsBeforeNative = true
		}
		f.stats.ServeHTTP(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/trpc/") {
		if r.Header.Get("ApiKey") != "fixture-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var value any
		switch r.URL.Path {
		case "/api/trpc/integration.byId":
			value = f.identity
		case "/api/trpc/widget.downloads.getJobsAndStatuses":
			f.downloads++
			var input struct {
				JSON struct {
					IntegrationIDs []string `json:"integrationIds"`
					Limit          int      `json:"limitPerIntegration"`
				} `json:"json"`
			}
			if json.Unmarshal([]byte(r.URL.Query().Get("input")), &input) != nil || len(input.JSON.IntegrationIDs) != 1 || input.JSON.IntegrationIDs[0] != "owned" || input.JSON.Limit != 50 {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			value = []any{map[string]any{"integrationId": "owned", "integration": f.downloadIdentity, "data": map[string]any{"status": f.status, "items": f.items}}}

		default:
			w.WriteHeader(http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
		return
	}
	if r.URL.Path != "/jsonrpc" {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	f.nativeAttempts++
	if f.rejectNative {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	user, pass, ok := r.BasicAuth()
	if !ok || user != "fixture-admin" && user != "self-host-homarr" || user == "fixture-admin" && pass != "fixture-admin-pass" || user == "self-host-homarr" && pass != "fixture-restricted" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	var input struct {
		Method string `json:"method"`
		ID     string `json:"id"`
	}
	json.NewDecoder(r.Body).Decode(&input)
	f.nativeReads++
	var result any = []any{}
	switch input.Method {
	case "version":
		result = "26.3"
	case "config", "loadconfig":
		result = []any{map[string]any{"Name": "RestrictedUsername", "Value": "self-host-homarr"}, map[string]any{"Name": "RestrictedPassword", "Value": "fixture-restricted"}}
	case "status":
		result = map[string]any{"DownloadRate": 1024, "DownloadPaused": false}
	}
	json.NewEncoder(w).Encode(map[string]any{"id": input.ID, "result": result})
}

func (f *nzbgetFixture) helpers(t *testing.T, descriptor target) (*helpers.H, *helpers.H) {
	t.Helper()
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	secrets := statsSecrets{"HOMARR_API_KEY": "fixture-key", "ADMIN_USER": "fixture-admin", "ADMIN_PASSWORD": "fixture-admin-pass", "NZBGET_HOMARR_USERNAME": "self-host-homarr", "NZBGET_HOMARR_PASSWORD": "fixture-restricted"}
	from := helpers.New(helpers.Config{App: "homarr", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(), Secrets: secrets})
	to := helpers.New(helpers.Config{App: "nzbget", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(), Secrets: secrets})
	secrets[from.Key("linked_nzbget")] = "owned"
	secrets[integrationFingerprintKey(from, "owned")] = integrationFingerprint(descriptor, from, to)
	f.stats.values = map[string]any{"download": float64(0), "paused": false}
	f.stats.metrics = []any{map[string]any{"key": "download", "unit": "bytesPerSecond"}, map[string]any{"key": "paused", "unit": "text"}}
	return from, to
}

func TestNZBGetVerificationUsesOneSemanticStatsSample(t *testing.T) {
	for _, scenario := range []struct {
		name      string
		change    func(*nzbgetFixture)
		fail      bool
		refreshes int
	}{
		{"independent native rate and paused state", func(*nzbgetFixture) {}, false, 1},
		{"first invalid sample", func(f *nzbgetFixture) { f.stats.values["download"] = float64(-1) }, true, 1},
		{"null selected value", func(f *nzbgetFixture) { f.stats.values["download"] = nil }, true, 1},
		{"wrong rate type", func(f *nzbgetFixture) { f.stats.values["download"] = "0" }, true, 1},
		{"wrong paused type", func(f *nzbgetFixture) { f.stats.values["paused"] = "false" }, true, 1},
		{"wrong rate unit", func(f *nzbgetFixture) { f.stats.metrics[0].(map[string]any)["unit"] = "bytes" }, true, 1},
		{"wrong paused unit", func(f *nzbgetFixture) { f.stats.metrics[len(f.stats.metrics)-1].(map[string]any)["unit"] = "count" }, true, 1},
		{"no-op", func(f *nzbgetFixture) { f.stats.advance = false }, true, 1},
		{"foreign Downloads identity", func(f *nzbgetFixture) { f.downloadIdentity["id"] = "foreign" }, true, 0},
		{"foreign Downloads kind", func(f *nzbgetFixture) { f.downloadIdentity["kind"] = "foreign" }, true, 0},
		{"null queue", func(f *nzbgetFixture) { f.items = nil }, true, 0},
		{"foreign saved identity", func(f *nzbgetFixture) { f.identity["kind"] = "foreign" }, true, 0},
		{"exposed saved password", func(f *nzbgetFixture) { f.identity["secrets"].([]any)[1].(map[string]any)["value"] = "exposed-fixture" }, true, 0},
		{"over limit", func(f *nzbgetFixture) { f.items = make([]any, 51) }, true, 0},
		{"finite signed completion time", func(f *nzbgetFixture) {
			f.items = []any{map[string]any{"id": "fixture", "name": "owned fixture", "type": "usenet", "state": "completed", "index": float64(-1), "size": float64(10), "progress": float64(1), "time": float64(-1000)}}
		}, false, 1},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			descriptor := nzbgetTarget()
			if descriptor.stats == nil {
				t.Fatal("descriptor must validate the central Stats sample")
			}
			f := newNZBGetFixture()
			from, to := f.helpers(t, descriptor)
			scenario.change(f)
			err := descriptor.verifyData(t.Context(), from, to, "owned")
			if (err != nil) != scenario.fail {
				t.Fatalf("unexpected verification result: %v", err)
			}
			if f.stats.refreshes != scenario.refreshes {
				t.Fatalf("refreshes=%d, want %d", f.stats.refreshes, scenario.refreshes)
			}
			if f.stats.refreshes > 0 && (f.stats.catalogs != 1 || !f.stats.force || f.stats.integrationID != "owned" || f.nativeReads == 0 || f.downloads != 1 || f.statsBeforeNative) {
				t.Fatalf("verification did not use one forced sample after native data: catalogs=%d refreshes=%d native=%d downloads=%d", f.stats.catalogs, f.stats.refreshes, f.nativeReads, f.downloads)
			}
			if scenario.refreshes == 0 && f.stats.catalogs != 0 {
				t.Fatal("native failure acquired Stats catalog")
			}
		})
	}
}

func TestNZBGetPrivacyVersionHoldPrecedesProviderAndMutation(t *testing.T) {
	for _, scenario := range []struct {
		name       string
		version    any
		unreadable bool
	}{
		{"old", "2.4.1", false}, {"before fix", "2.5.0", false},
		{"unknown", "future", false}, {"missing", nil, false}, {"malformed", float64(2.5), false}, {"unreadable", "2.5.2", true},
	} {
		for _, path := range []string{"apply", "Check"} {
			t.Run(scenario.name+"/"+path, func(t *testing.T) {
				descriptor := nzbgetTarget()
				f := newNZBGetFixture()
				from, to := f.helpers(t, descriptor)
				f.version, f.infoFails = scenario.version, scenario.unreadable
				var err error
				if path == "apply" {
					err = descriptor.add(t.Context(), from, to)
				} else {
					_, err = descriptor.linked(t.Context(), from, to)
				}
				if !errors.Is(err, helpers.ErrManual) || f.infoReads != 1 || f.requests != 1 || f.nativeAttempts != 0 || f.otherHomarr != 0 || f.mutations != 0 {
					t.Fatalf("unsafe version must stop after info.getInfo: err=%v info=%d requests=%d native=%d otherHomarr=%d mutations=%d", err, f.infoReads, f.requests, f.nativeAttempts, f.otherHomarr, f.mutations)
				}
			})
		}
	}
}

func TestNZBGetFixedVersionsReachNativeReadiness(t *testing.T) {
	for _, version := range []string{"2.5.1", "2.5.2"} {
		t.Run(version, func(t *testing.T) {
			descriptor := nzbgetTarget()
			f := newNZBGetFixture()
			from, to := f.helpers(t, descriptor)
			f.version = version
			if err := descriptor.preflight(t.Context(), from, to); err != nil {
				t.Fatalf("fixed version failed native readiness: %v", err)
			}
			if f.infoReads != 1 || f.nativeReads == 0 || f.otherHomarr != 0 || f.downloads != 0 || f.stats.catalogs != 0 || f.stats.refreshes != 0 || f.mutations != 0 {
				t.Fatalf("preflight must verify native credentials before Homarr acquisition/mutation: info=%d native=%d otherHomarr=%d mutations=%d", f.infoReads, f.nativeReads, f.otherHomarr, f.mutations)
			}
		})
	}
}

func TestNZBGetRejectedNativeCredentialsPrecedeHomarrMutation(t *testing.T) {
	for _, version := range []string{"2.5.1", "2.5.2"} {
		for _, path := range []string{"apply", "Check"} {
			t.Run(version+"/"+path, func(t *testing.T) {
				descriptor := nzbgetTarget()
				f := newNZBGetFixture()
				from, to := f.helpers(t, descriptor)
				f.version, f.rejectNative = version, true
				var err error
				if path == "apply" {
					err = descriptor.add(t.Context(), from, to)
				} else {
					_, err = descriptor.linked(t.Context(), from, to)
				}
				if err == nil || errors.Is(err, helpers.ErrManual) || f.infoReads != 1 || f.nativeAttempts == 0 || f.otherHomarr != 0 || f.mutations != 0 {
					t.Fatalf("rejected native credentials must fail before Homarr mutation: err=%v info=%d native=%d otherHomarr=%d mutations=%d", err, f.infoReads, f.nativeAttempts, f.otherHomarr, f.mutations)
				}
			})
		}
	}
}
