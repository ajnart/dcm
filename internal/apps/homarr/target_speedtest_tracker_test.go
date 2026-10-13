package homarr

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
)

type speedtestVerificationFixture struct {
	stats           *statsFixture
	result          map[string]any
	dashboard       map[string]any
	history         []any
	total           int
	latestStatus    int
	rejectKey       bool
	runtimeMetadata string
}

func newSpeedtestVerificationFixture() *speedtestVerificationFixture {
	stats := newStatsFixture()
	stats.values = map[string]any{"ping": 0, "download": 100.125, "upload": 50}
	stats.metrics = []any{map[string]any{"key": "ping", "unit": "milliseconds"}, map[string]any{"key": "download", "unit": "bytesPerSecond"}, map[string]any{"key": "upload", "unit": "bytesPerSecond"}}
	result := map[string]any{"id": 1, "ping": 10, "download": 100, "upload": 50, "download_bits": 800, "upload_bits": 400, "healthy": true, "status": "completed", "created_at": "2026-10-13 12:00:00"}
	native := map[string]any{"id": 1, "ping": 10, "download_bits": 800, "upload_bits": 400, "healthy": true, "created_at": "2026-10-13T12:00:00Z"}
	return &speedtestVerificationFixture{
		stats: stats, result: result, history: []any{result}, total: 1, latestStatus: 200,
		dashboard:       map[string]any{"integrationId": "speedtest-owned", "updatedAt": "2026-10-13T12:00:00Z", "dashboard": map[string]any{"latestResult": native, "recentResults": []any{native}, "stats": speedtestFixtureStatistics()}},
		runtimeMetadata: `{"id":"1","adminId":"1","name":"self-host Homarr results","abilities":["results:read"]}`,
	}
}

func speedtestFixtureStatistics() map[string]any {
	return map[string]any{"total_results": 1, "ping": map[string]any{"avg": 10, "min": 10, "max": 10}, "download": map[string]any{"avg": 100, "avg_bits": 800, "min": 100, "max": 100}, "upload": map[string]any{"avg": 50, "avg_bits": 400, "min": 50, "max": 50}}
}

func (f *speedtestVerificationFixture) Exec(_ context.Context, service string, _ map[string]string, command ...string) (system.Result, error) {
	if service != "speedtest-tracker" || !strings.Contains(strings.Join(command, " "), "PersonalAccessToken::findToken") {
		return system.Result{}, errors.New("only read-only owned token verification is allowed")
	}
	return system.Result{Stdout: []byte(f.runtimeMetadata)}, nil
}
func (*speedtestVerificationFixture) LogText(context.Context, int, ...string) (string, error) {
	return "", errors.New("logs outside fixture")
}
func (*speedtestVerificationFixture) Restart(context.Context, ...string) error {
	return errors.New("restart outside fixture")
}
func (*speedtestVerificationFixture) Up(context.Context, ...string) error {
	return errors.New("Up outside fixture")
}

func (f *speedtestVerificationFixture) helpers(t *testing.T) (*helpers.H, *helpers.H) {
	t.Helper()
	native := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/trpc/widget.speedtestTracker.getDashboard" {
			f.stats.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("ApiKey") != "fixture-key" {
			w.WriteHeader(401)
			return
		}
		ids, ok := speedtestTrackerFixtureInput(r)["integrationIds"].([]any)
		if !ok || len(ids) != 1 || ids[0] != "speedtest-owned" {
			t.Error("native query did not preserve owned integration identity")
		}
		speedtestTrackerFixtureResponse(w, []any{f.dashboard})
	}))
	t.Cleanup(native.Close)
	from := helpers.New(helpers.Config{App: "homarr", BaseURL: native.URL, HTTP: native.Client(), Log: events.Discard(), Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key"}})
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if f.rejectKey || r.Header.Get("Authorization") != "Bearer synthetic-results-token" {
			w.WriteHeader(401)
			return
		}
		if r.Method != "GET" {
			t.Error("result verification mutated the peer")
			w.WriteHeader(405)
			return
		}
		switch r.URL.Path {
		case "/api/v1/results":
			if r.URL.Query().Get("result_count") != "30" || r.URL.Query().Get("sort") != "-created_at" {
				t.Error("history must match native request")
			}
			json.NewEncoder(w).Encode(map[string]any{"data": f.history, "meta": map[string]any{"total": f.total, "current_page": 1, "last_page": 1}})
		case "/api/v1/results/latest":
			w.WriteHeader(f.latestStatus)
			json.NewEncoder(w).Encode(map[string]any{"data": f.result})
		case "/api/v1/stats":
			json.NewEncoder(w).Encode(map[string]any{"data": speedtestFixtureStatistics()})
		default:
			t.Error("unexpected peer endpoint")
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(peer.Close)
	to := helpers.New(helpers.Config{App: "speedtest-tracker", Service: "speedtest-tracker", BaseURL: peer.URL, HTTP: peer.Client(), Log: events.Discard(), Exec: f, Secrets: statsSecrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "synthetic-admin-password", "SPEEDTEST_TRACKER_HOMARR_API_KEY": "synthetic-results-token", "SPEEDTEST_TRACKER_HOMARR_API_KEY_ID": "1", "SPEEDTEST_TRACKER_HOMARR_ADMIN_ID": "1"}})
	return from, to
}

func TestSpeedtestTrackerDescriptorVerifiesOneFreshStatsSample(t *testing.T) {
	fixture := newSpeedtestVerificationFixture()
	from, to := fixture.helpers(t)
	if err := speedtestTrackerTarget().verifyData(t.Context(), from, to, "speedtest-owned"); err != nil {
		t.Fatal(err)
	}
	if fixture.stats.refreshes != 1 || fixture.stats.catalogs != 1 || !fixture.stats.force || fixture.stats.integrationID != "speedtest-owned" {
		t.Fatal("descriptor must validate one forced owned Stats sample")
	}
}

func TestSpeedtestTrackerDescriptorRejectsInvalidData(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		change func(*speedtestVerificationFixture)
		manual bool
	}{
		{"empty history", func(f *speedtestVerificationFixture) { f.history = []any{}; f.total = 0; f.latestStatus = 404 }, true},
		{"pending result", func(f *speedtestVerificationFixture) { f.result["status"] = "pending" }, true},
		{"null completed history ping", func(f *speedtestVerificationFixture) { f.result["ping"] = nil }, false},
		{"missing completed history bit rate", func(f *speedtestVerificationFixture) { delete(f.result, "download_bits") }, false},
		{"inconsistent completed rates", func(f *speedtestVerificationFixture) { f.result["download_bits"] = 801 }, false},
		{"rejected API key", func(f *speedtestVerificationFixture) { f.rejectKey = true }, true},
		{"wrong token owner", func(f *speedtestVerificationFixture) {
			f.runtimeMetadata = `{"id":"1","adminId":"2","name":"self-host Homarr results","abilities":["results:read"]}`
		}, true},
		{"wrong token scope", func(f *speedtestVerificationFixture) {
			f.runtimeMetadata = `{"id":"1","adminId":"1","name":"self-host Homarr results","abilities":["*"]}`
		}, true},
		{"wrong integration", func(f *speedtestVerificationFixture) { f.dashboard["integrationId"] = "another" }, false},
		{"native error", func(f *speedtestVerificationFixture) { f.dashboard["error"] = map[string]any{"message": "unavailable"} }, false},
		{"wrong result identity", func(f *speedtestVerificationFixture) {
			f.dashboard["dashboard"].(map[string]any)["latestResult"].(map[string]any)["id"] = 2
		}, false},
		{"fractional bit rate", func(f *speedtestVerificationFixture) { f.stats.values["download"] = 100.1 }, false},
		{"negative ping", func(f *speedtestVerificationFixture) { f.stats.values["ping"] = -1 }, false},
		{"missing metric", func(f *speedtestVerificationFixture) { delete(f.stats.values, "upload") }, false},
		{"null metric", func(f *speedtestVerificationFixture) { f.stats.values["upload"] = nil }, false},
		{"wrong unit", func(f *speedtestVerificationFixture) { f.stats.metrics[1].(map[string]any)["unit"] = "bitsPerSecond" }, false},
		{"no-op refresh", func(f *speedtestVerificationFixture) { f.stats.advance = false }, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newSpeedtestVerificationFixture()
			scenario.change(fixture)
			from, to := fixture.helpers(t)
			err := speedtestTrackerTarget().verifyData(t.Context(), from, to, "speedtest-owned")
			if err == nil || errors.Is(err, helpers.ErrManual) != scenario.manual {
				t.Fatalf("unexpected verification result: %v", err)
			}
			if fixture.stats.refreshes > 1 {
				t.Fatal("semantic failure retried a different sample")
			}
		})
	}
}

func speedtestTrackerFixtureInput(r *http.Request) map[string]any {
	var input struct {
		JSON map[string]any `json:"json"`
	}
	json.Unmarshal([]byte(r.URL.Query().Get("input")), &input)
	return input.JSON
}
func speedtestTrackerFixtureResponse(w http.ResponseWriter, value any) {
	json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
}

func TestSpeedtestTrackerCompletedHistoryRequiresMeasurements(t *testing.T) {
	fixture := newSpeedtestVerificationFixture()
	fixture.total = 2
	fixture.history = append(fixture.history, map[string]any{"id": 2, "ping": 10, "download": 100, "upload": 50, "upload_bits": 400, "healthy": nil, "status": "completed", "created_at": "2026-10-13 11:00:00"})
	from, to := fixture.helpers(t)
	err := speedtestTrackerTarget().verifyData(t.Context(), from, to, "speedtest-owned")
	if err == nil || !strings.Contains(err.Error(), "completed history is missing measurement fields") || fixture.stats.catalogs != 0 || fixture.stats.refreshes != 0 {
		t.Fatalf("incomplete older completed measurement must stop before native/Stats verification: %v", err)
	}
}

func TestSpeedtestTrackerDescriptorAcceptsZeroStatsAndNullableHealth(t *testing.T) {
	fixture := newSpeedtestVerificationFixture()
	fixture.stats.values = map[string]any{"ping": 0, "download": 0, "upload": 0}
	fixture.result["healthy"] = nil
	fixture.dashboard["dashboard"].(map[string]any)["latestResult"].(map[string]any)["healthy"] = nil
	from, to := fixture.helpers(t)
	if err := speedtestTrackerTarget().verifyData(t.Context(), from, to, "speedtest-owned"); err != nil {
		t.Fatal(err)
	}
	if fixture.stats.refreshes != 1 {
		t.Fatal("valid zero Stats must require one sample")
	}
}
