package homarr

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

type sabnzbdFixture struct {
	stats             *statsFixture
	identity          map[string]any
	downloadIdentity  map[string]any
	status            map[string]any
	items             any
	nativeReads       int
	downloads         int
	statsBeforeNative bool
}

func newSABnzbdFixture() *sabnzbdFixture {
	return &sabnzbdFixture{
		stats:            newStatsFixture(),
		identity:         map[string]any{"id": "owned", "kind": "sabNzbd", "url": "http://sabnzbd:8080", "secrets": []any{map[string]any{"kind": "apiKey", "value": nil}}},
		downloadIdentity: map[string]any{"id": "owned", "kind": "sabNzbd"},
		status:           map[string]any{"rates": map[string]any{"down": float64(1024)}, "paused": true, "types": []any{"usenet"}},
		items:            []any{},
	}
}

func (f *sabnzbdFixture) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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
	if r.URL.Path != "/api" {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	r.ParseForm()
	mode := r.Form.Get("mode")
	if mode == "auth" && r.Form.Get("key") != "fixture-sab" || mode != "auth" && r.Form.Get("apikey") != "fixture-sab" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	f.nativeReads++
	var result any
	switch mode {
	case "auth":
		result = map[string]any{"auth": "apikey"}
	case "queue":
		result = map[string]any{"queue": map[string]any{"version": "5.1.3", "paused": false, "kbpersec": "1", "slots": []any{}}}
	case "history":
		result = map[string]any{"history": map[string]any{"slots": []any{}}}
	default:
		w.WriteHeader(http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(result)
}

func (f *sabnzbdFixture) helpers(t *testing.T, descriptor target) (*helpers.H, *helpers.H) {
	t.Helper()
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	secrets := statsSecrets{"HOMARR_API_KEY": "fixture-key", "SABNZBD_API_KEY": "fixture-sab"}
	from := helpers.New(helpers.Config{App: "homarr", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(), Secrets: secrets})
	to := helpers.New(helpers.Config{App: "sabnzbd", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(), Secrets: secrets})
	secrets[from.Key("linked_sabnzbd")] = "owned"
	secrets[integrationFingerprintKey(from, "owned")] = integrationFingerprint(descriptor, from, to)
	f.stats.values = map[string]any{"download": float64(0), "paused": false}
	f.stats.metrics = []any{map[string]any{"key": "download", "unit": "bytesPerSecond"}, map[string]any{"key": "paused", "unit": "text"}}
	return from, to
}

func TestSABnzbdVerificationUsesOneSemanticStatsSample(t *testing.T) {
	for _, scenario := range []struct {
		name      string
		change    func(*sabnzbdFixture)
		fail      bool
		refreshes int
	}{
		{"independent native rate and paused state", func(*sabnzbdFixture) {}, false, 1},
		{"first invalid sample", func(f *sabnzbdFixture) { f.stats.values["download"] = float64(-1) }, true, 1},
		{"null selected value", func(f *sabnzbdFixture) { f.stats.values["download"] = nil }, true, 1},
		{"wrong rate type", func(f *sabnzbdFixture) { f.stats.values["download"] = "0" }, true, 1},
		{"wrong paused type", func(f *sabnzbdFixture) { f.stats.values["paused"] = "false" }, true, 1},
		{"wrong rate unit", func(f *sabnzbdFixture) { f.stats.metrics[0].(map[string]any)["unit"] = "bytes" }, true, 1},
		{"wrong paused unit", func(f *sabnzbdFixture) { f.stats.metrics[len(f.stats.metrics)-1].(map[string]any)["unit"] = "count" }, true, 1},
		{"no-op", func(f *sabnzbdFixture) { f.stats.advance = false }, true, 1},
		{"foreign Downloads identity", func(f *sabnzbdFixture) { f.downloadIdentity["id"] = "foreign" }, true, 0},
		{"foreign Downloads kind", func(f *sabnzbdFixture) { f.downloadIdentity["kind"] = "foreign" }, true, 0},
		{"null queue", func(f *sabnzbdFixture) { f.items = nil }, true, 0},
		{"finite signed completion time", func(f *sabnzbdFixture) {
			f.items = []any{map[string]any{"id": "fixture", "name": "owned fixture", "type": "usenet", "state": "completed", "index": float64(0), "size": float64(10), "progress": float64(1), "time": float64(-1000)}}
		}, false, 1},
		{"null optional speed", func(f *sabnzbdFixture) {
			f.items = []any{map[string]any{"id": "fixture", "name": "owned fixture", "type": "usenet", "state": "completed", "index": float64(0), "size": float64(10), "progress": float64(1), "time": float64(-1000), "downSpeed": nil}}
		}, true, 0},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			descriptor := sabnzbdTarget()
			if descriptor.stats == nil {
				t.Fatal("descriptor must validate the central Stats sample")
			}
			f := newSABnzbdFixture()
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
