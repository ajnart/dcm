package homarr

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

type tdarrVerificationFixture struct {
	stats     *statsFixture
	native    map[string]any
	nodes     map[string]any
	rejectKey bool
}

func newTdarrVerificationFixture() *tdarrVerificationFixture {
	stats := newStatsFixture()
	stats.timestamp = float64(time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC).UnixMilli())
	stats.values = map[string]any{"totalFileCount": 0, "totalTranscodeCount": 0, "failedTranscodeCount": 0}
	stats.metrics = []any{}
	for _, key := range []string{"totalFileCount", "totalTranscodeCount", "failedTranscodeCount"} {
		stats.metrics = append(stats.metrics, map[string]any{"key": key, "unit": "count"})
	}
	statistics := map[string]any{"libraryName": "All", "totalSavedSpace": 0}
	for _, key := range []string{"totalFileCount", "totalTranscodeCount", "totalHealthCheckCount", "failedTranscodeCount", "failedHealthCheckCount", "stagedTranscodeCount", "stagedHealthCheckCount"} {
		statistics[key] = 0
	}
	for _, key := range []string{"transcodeStatus", "healthCheckStatus", "videoCodecs", "videoContainers", "videoResolutions", "audioCodecs", "audioContainers"} {
		statistics[key] = []any{}
	}
	return &tdarrVerificationFixture{
		stats: stats,
		native: map[string]any{"integrationId": "tdarr-owned", "data": map[string]any{
			"statistics": statistics, "queue": map[string]any{"array": []any{}, "totalCount": 0, "startIndex": 0, "endIndex": -1}, "workers": []any{},
		}},
		nodes: map[string]any{"fixture-node": map[string]any{"_id": "fixture-node", "nodeName": "Fixture", "nodePaused": false, "workers": map[string]any{}}},
	}
}

func (f *tdarrVerificationFixture) helpers(t *testing.T) (*helpers.H, *helpers.H) {
	t.Helper()
	native := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/trpc/widget.mediaTranscoding.getDataAsync" {
			f.stats.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("ApiKey") != "fixture-key" {
			w.WriteHeader(401)
			return
		}
		input := tdarrFixtureInput(r)
		if input["integrationId"] != "tdarr-owned" || input["page"] != float64(1) || input["pageSize"] != float64(10) {
			t.Error("native query did not preserve owned identity and pagination")
		}
		tdarrFixtureResponse(w, f.native)
	}))
	t.Cleanup(native.Close)
	from := helpers.New(helpers.Config{App: "homarr", BaseURL: native.URL, HTTP: native.Client(), Log: events.Discard(), Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key"}, Now: func() time.Time { return time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC) }})
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v2/status" {
			json.NewEncoder(w).Encode(map[string]any{"status": "good", "version": "2.92.01"})
			return
		}
		if f.rejectKey || r.Header.Get("X-Api-Key") != "tapi_fixture_tdarr_key_seed" {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/api/v2/is-server-alive":
			json.NewEncoder(w).Encode(map[string]any{"isAlive": true})
		case "/api/v2/stats/get-pies":
			json.NewEncoder(w).Encode(map[string]any{"pieStats": map[string]any{"totalFiles": 0, "totalTranscodeCount": 0, "totalHealthCheckCount": 0, "sizeDiff": 0, "status": map[string]any{}, "video": map[string]any{}, "audio": map[string]any{}}})
		case "/api/v2/client/status-tables":
			json.NewEncoder(w).Encode(map[string]any{"array": []any{}, "totalCount": 0})
		case "/api/v2/get-nodes":
			json.NewEncoder(w).Encode(f.nodes)
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(peer.Close)
	to := helpers.New(helpers.Config{App: "tdarr", BaseURL: peer.URL, HTTP: peer.Client(), Log: events.Discard(), Secrets: statsSecrets{"TDARR_API_KEY_SEED": "fixture_tdarr_key_seed", "TDARR_HOMARR_API_KEY": "tapi_fixture_tdarr_key_seed"}})
	return from, to
}

func TestTdarrDescriptorVerifiesOneFreshStatsSample(t *testing.T) {
	fixture := newTdarrVerificationFixture()
	// The native cache and forced Stats refresh need not have identical counts.
	fixture.stats.values["totalFileCount"] = 3
	from, to := fixture.helpers(t)
	if err := tdarrTarget().verifyData(t.Context(), from, to, "tdarr-owned"); err != nil {
		t.Fatal(err)
	}
	if fixture.stats.refreshes != 1 || fixture.stats.catalogs != 1 || !fixture.stats.force || fixture.stats.integrationID != "tdarr-owned" {
		t.Fatal("descriptor must validate one forced owned Stats sample")
	}
	if got := tdarrTarget().internal(to); got != "http://tdarr:8266" {
		t.Fatalf("API address changed: %s", got)
	}
}

func TestTdarrDescriptorRejectsInvalidData(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		change func(*tdarrVerificationFixture)
		manual bool
	}{
		{"no node", func(f *tdarrVerificationFixture) { f.nodes = map[string]any{} }, true},
		{"paused node", func(f *tdarrVerificationFixture) { f.nodes["fixture-node"].(map[string]any)["nodePaused"] = true }, true},
		{"rejected API key", func(f *tdarrVerificationFixture) { f.rejectKey = true }, false},
		{"wrong integration", func(f *tdarrVerificationFixture) { f.native["integrationId"] = "another" }, false},
		{"missing native count", func(f *tdarrVerificationFixture) {
			delete(f.native["data"].(map[string]any)["statistics"].(map[string]any), "totalFileCount")
		}, false},
		{"fractional count", func(f *tdarrVerificationFixture) { f.stats.values["totalFileCount"] = 0.5 }, false},
		{"negative count", func(f *tdarrVerificationFixture) { f.stats.values["failedTranscodeCount"] = -1 }, false},
		{"missing metric", func(f *tdarrVerificationFixture) { delete(f.stats.values, "totalFileCount") }, false},
		{"null metric", func(f *tdarrVerificationFixture) { f.stats.values["totalFileCount"] = nil }, false},
		{"wrong unit", func(f *tdarrVerificationFixture) { f.stats.metrics[0].(map[string]any)["unit"] = "bytes" }, false},
		{"no-op refresh", func(f *tdarrVerificationFixture) { f.stats.advance = false }, false},
		{"stale timestamp", func(f *tdarrVerificationFixture) { f.stats.timestamp -= 300_002 }, false},
		{"future timestamp", func(f *tdarrVerificationFixture) { f.stats.timestamp += 60_000 }, false},
		{"fractional timestamp", func(f *tdarrVerificationFixture) { f.stats.timestamp += 0.5 }, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newTdarrVerificationFixture()
			scenario.change(fixture)
			from, to := fixture.helpers(t)
			err := tdarrTarget().verifyData(t.Context(), from, to, "tdarr-owned")
			if err == nil || errors.Is(err, helpers.ErrManual) != scenario.manual {
				t.Fatalf("unexpected verification result: %v", err)
			}
			if fixture.stats.refreshes > 1 {
				t.Fatal("semantic failure retried a different sample")
			}
		})
	}
}

func TestTdarrStatsClockUsesRefreshCompletion(t *testing.T) {
	fixture := newTdarrVerificationFixture()
	from, to := fixture.helpers(t)
	started := fixture.stats.timestamp
	from.Now = func() time.Time {
		if fixture.stats.refreshes == 0 {
			return time.UnixMilli(int64(started))
		}
		return time.UnixMilli(int64(started + 120_000))
	}
	// Use a refresh near completion even after a request lasting two minutes.
	fixture.stats.timestamp += 119_000
	if err := tdarrTarget().verifyData(t.Context(), from, to, "tdarr-owned"); err != nil {
		t.Fatal(err)
	}
}

func tdarrFixtureInput(r *http.Request) map[string]any {
	var input struct {
		JSON map[string]any `json:"json"`
	}
	json.Unmarshal([]byte(r.URL.Query().Get("input")), &input)
	return input.JSON
}
func tdarrFixtureResponse(w http.ResponseWriter, value any) {
	json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
}
