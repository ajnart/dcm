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

type aria2Fixture struct {
	stats             *statsFixture
	identity          map[string]any
	downloadIdentity  map[string]any
	status            map[string]any
	items             any
	nativeReads       int
	downloads         int
	statsBeforeNative bool
}

func newAria2Fixture() *aria2Fixture {
	return &aria2Fixture{
		stats:            newStatsFixture(),
		identity:         map[string]any{"id": "owned", "kind": "aria2", "url": "http://aria2:6800", "secrets": []any{map[string]any{"kind": "apiKey", "value": nil}}},
		downloadIdentity: map[string]any{"id": "owned", "kind": "aria2"},
		status:           map[string]any{"rates": map[string]any{"down": float64(1024), "up": float64(512)}, "paused": true, "types": []any{"torrent", "miscellaneous"}},
		items:            []any{},
	}
}

func (f *aria2Fixture) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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
		case "/api/trpc/integration.request":
			var input struct {
				JSON struct {
					Body struct {
						Method string `json:"method"`
					} `json:"body"`
				} `json:"json"`
			}
			json.NewDecoder(r.Body).Decode(&input)
			result := map[string]any{"version": "1.37.0"}
			if input.JSON.Body.Method == "aria2.getGlobalOption" {
				result = map[string]any{"dir": "/var/lib/aria2/downloads"}
			}
			value = map[string]any{"ok": true, "status": 200, "integration": map[string]any{"id": "owned", "kind": "aria2"}, "data": map[string]any{"jsonrpc": "2.0", "id": 1, "result": result}}

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
	var input struct {
		Method string `json:"method"`
		Params []any  `json:"params"`
	}
	json.NewDecoder(r.Body).Decode(&input)
	if len(input.Params) == 0 || input.Params[0] != "token:fixture-rpc" {
		json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "error": map[string]any{"code": 1, "message": "Unauthorized"}})
		return
	}
	f.nativeReads++
	var result any = []any{}
	switch input.Method {
	case "aria2.getVersion":
		result = map[string]any{"version": "1.37.0"}
	case "aria2.getGlobalOption":
		result = map[string]any{"dir": "/var/lib/aria2/downloads"}
	case "aria2.getGlobalStat":
		result = map[string]any{"downloadSpeed": "1024", "uploadSpeed": "512", "numActive": "0", "numWaiting": "0", "numStopped": "0", "numStoppedTotal": "0"}
	}
	json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": result})
}

func (f *aria2Fixture) helpers(t *testing.T, descriptor target) (*helpers.H, *helpers.H) {
	t.Helper()
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	secrets := statsSecrets{"HOMARR_API_KEY": "fixture-key", "ARIA2_RPC_TOKEN": "fixture-rpc"}
	from := helpers.New(helpers.Config{App: "homarr", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(), Secrets: secrets})
	to := helpers.New(helpers.Config{App: "aria2", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(), Secrets: secrets})
	secrets[from.Key("linked_aria2")] = "owned"
	secrets[integrationFingerprintKey(from, "owned")] = integrationFingerprint(descriptor, from, to)
	f.stats.values = map[string]any{"download": float64(0), "upload": float64(0), "paused": false}
	f.stats.metrics = []any{map[string]any{"key": "download", "unit": "bytesPerSecond"}, map[string]any{"key": "upload", "unit": "bytesPerSecond"}, map[string]any{"key": "paused", "unit": "text"}}
	return from, to
}

func TestAria2VerificationUsesOneSemanticStatsSample(t *testing.T) {
	for _, scenario := range []struct {
		name      string
		change    func(*aria2Fixture)
		fail      bool
		refreshes int
	}{
		{"independent native rate and paused state", func(*aria2Fixture) {}, false, 1},
		{"first invalid sample", func(f *aria2Fixture) { f.stats.values["download"] = float64(-1) }, true, 1},
		{"null selected value", func(f *aria2Fixture) { f.stats.values["download"] = nil }, true, 1},
		{"wrong rate type", func(f *aria2Fixture) { f.stats.values["download"] = "0" }, true, 1},
		{"wrong paused type", func(f *aria2Fixture) { f.stats.values["paused"] = "false" }, true, 1},
		{"wrong rate unit", func(f *aria2Fixture) { f.stats.metrics[0].(map[string]any)["unit"] = "bytes" }, true, 1},
		{"wrong paused unit", func(f *aria2Fixture) { f.stats.metrics[len(f.stats.metrics)-1].(map[string]any)["unit"] = "count" }, true, 1},
		{"no-op", func(f *aria2Fixture) { f.stats.advance = false }, true, 1},
		{"foreign Downloads identity", func(f *aria2Fixture) { f.downloadIdentity["id"] = "foreign" }, true, 0},
		{"foreign Downloads kind", func(f *aria2Fixture) { f.downloadIdentity["kind"] = "foreign" }, true, 0},
		{"null queue", func(f *aria2Fixture) { f.items = nil }, true, 0},
		{"invalid upload", func(f *aria2Fixture) { f.stats.values["upload"] = float64(-1) }, true, 1},
		{"wrong saved identity", func(f *aria2Fixture) { f.identity["kind"] = "foreign" }, true, 0},
		{"completed item zero ETA", func(f *aria2Fixture) { f.items = []any{aria2CompletedFixtureItem()}; f.status["paused"] = false }, false, 1},
		{"bad completed ETA", func(f *aria2Fixture) {
			item := aria2CompletedFixtureItem()
			item["time"] = float64(1)
			f.items = []any{item}
		}, true, 0},
		{"negative ETA", func(f *aria2Fixture) {
			item := aria2CompletedFixtureItem()
			item["time"] = float64(-1)
			f.items = []any{item}
		}, true, 0},
		{"mismatched bounded paused state", func(f *aria2Fixture) { f.status["paused"] = false }, true, 0},
		{"over limit", func(f *aria2Fixture) { f.items = make([]any, 51) }, true, 0},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			descriptor := aria2Target()
			if descriptor.stats == nil {
				t.Fatal("descriptor must validate the central Stats sample")
			}
			f := newAria2Fixture()
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

func aria2CompletedFixtureItem() map[string]any {
	return map[string]any{"id": "fixture", "name": "owned fixture", "type": "miscellaneous", "state": "completed", "index": float64(0), "size": float64(10), "sent": float64(0), "downSpeed": float64(0), "upSpeed": float64(0), "progress": float64(1), "time": float64(0)}
}
