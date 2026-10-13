package homarr

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

func uptimeKumaVerifyFixture(t *testing.T, stats *statsFixture, dashboard map[string]any, slug string, private bool) (*helpers.H, *helpers.H) {
	t.Helper()
	from := stats.helpers(t)
	statsURL, err := url.Parse(from.BaseURL)
	if err != nil {
		t.Fatal(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(statsURL)
	homarr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/trpc/widget.uptimeKuma.getDashboard" {
			proxy.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("ApiKey") != "fixture-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": []any{map[string]any{"integrationId": "kuma-owned", "error": nil, "dashboard": dashboard}}}}})
	}))
	t.Cleanup(homarr.Close)
	from.BaseURL = homarr.URL
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Error("status page probe mutated peer")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if private {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api/status-page/chosen-page":
			w.Write([]byte(`{"config":{"slug":"chosen-page"},"publicGroupList":[{"id":7,"name":"Chosen group","monitorList":[{"id":1,"name":"Chosen first"},{"id":2,"name":"Chosen second"}]}]}`))
		case "/api/status-page/heartbeat/chosen-page":
			w.Write([]byte(`{"heartbeatList":{"1":[{"status":1,"time":"2026-10-13 12:00:00"}],"2":[]},"uptimeList":{"1_24":0.99}}`))
		default:
			t.Errorf("unexpected page probe %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(peer.Close)
	to := helpers.New(helpers.Config{App: "uptime-kuma", BaseURL: peer.URL, HTTP: peer.Client(), Log: events.Discard(), Inputs: map[string]string{"homarr_status_page": slug}})
	return from, to
}

func uptimeKumaStatsFixture() *statsFixture {
	stats := newStatsFixture()
	stats.values = map[string]any{"totalMonitors": float64(2), "upCount": float64(1), "downCount": float64(0), "averageUptimePercent": float64(99)}
	stats.metrics = []any{}
	for _, key := range []string{"totalMonitors", "upCount", "downCount"} {
		stats.metrics = append(stats.metrics, map[string]any{"key": key, "unit": "count"})
	}
	stats.metrics = append(stats.metrics, map[string]any{"key": "averageUptimePercent", "unit": "percent"})
	return stats
}

func uptimeKumaDashboard() map[string]any {
	return map[string]any{"totalMonitors": 2, "upCount": 1, "downCount": 0, "pausedCount": 1, "averageUptimePercent": 99, "monitors": []any{
		map[string]any{"id": 1, "name": "Chosen first", "status": "up", "uptimePercent24h": 99},
		map[string]any{"id": 2, "name": "Chosen second", "status": "paused", "uptimePercent24h": nil},
	}}
}

func TestUptimeKumaVerifyDataUsesOneFreshSemanticSample(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		change func(*statsFixture)
		fail   bool
	}{
		{"nullable monitor uptime", func(*statsFixture) {}, false},
		{"changed independent volatile sample", func(f *statsFixture) {
			f.values["upCount"] = float64(0)
			f.values["downCount"] = float64(1)
			f.values["averageUptimePercent"] = float64(98)
		}, false},
		{"explicit zero sample", func(f *statsFixture) {
			for key := range f.values {
				f.values[key] = float64(0)
			}
		}, false},
		{"negative first sample", func(f *statsFixture) { f.values["upCount"] = float64(-1) }, true},
		{"fractional count", func(f *statsFixture) { f.values["totalMonitors"] = float64(2.5) }, true},
		{"counts exceed total", func(f *statsFixture) { f.values["downCount"] = float64(2) }, true},
		{"percentage out of range", func(f *statsFixture) { f.values["averageUptimePercent"] = float64(101) }, true},
		{"empty uptime inconsistent", func(f *statsFixture) { f.values["totalMonitors"] = float64(0); f.values["upCount"] = float64(0) }, true},
		{"missing field", func(f *statsFixture) { delete(f.values, "downCount") }, true},
		{"null percentage", func(f *statsFixture) { f.values["averageUptimePercent"] = nil }, true},
		{"wrong count unit", func(f *statsFixture) { f.metrics[0].(map[string]any)["unit"] = "percent" }, true},
		{"wrong percent unit", func(f *statsFixture) { f.metrics[3].(map[string]any)["unit"] = "count" }, true},
		{"no-op refresh", func(f *statsFixture) { f.advance = false }, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			stats := uptimeKumaStatsFixture()
			scenario.change(stats)
			from, to := uptimeKumaVerifyFixture(t, stats, uptimeKumaDashboard(), "chosen-page", false)
			err := uptimeKumaTarget().verifyData(t.Context(), from, to, "kuma-owned")
			if (err != nil) != scenario.fail {
				t.Fatalf("verifyData = %v, failure wanted %v", err, scenario.fail)
			}
			if stats.catalogs != 1 || stats.refreshes != 1 || !stats.force {
				t.Fatalf("Stats requests: catalog=%d refresh=%d force=%v", stats.catalogs, stats.refreshes, stats.force)
			}
		})
	}
}

func TestUptimeKumaVerifyDataKeepsSelectionPrivacyAndNativeSemantics(t *testing.T) {
	for _, scenario := range []struct {
		name    string
		slug    string
		private bool
		change  func(map[string]any)
		manual  bool
	}{
		{"missing explicit selection", "", false, func(map[string]any) {}, true},
		{"private page", "chosen-page", true, func(map[string]any) {}, true},
		{"different native identity", "chosen-page", false, func(d map[string]any) { d["monitors"].([]any)[0].(map[string]any)["id"] = 3 }, false},
		{"different native name", "chosen-page", false, func(d map[string]any) { d["monitors"].([]any)[0].(map[string]any)["name"] = "Unselected" }, false},
		{"missing nullable uptime field", "chosen-page", false, func(d map[string]any) { delete(d["monitors"].([]any)[1].(map[string]any), "uptimePercent24h") }, false},
		{"native counts inconsistent", "chosen-page", false, func(d map[string]any) { d["upCount"] = 0 }, false},
		{"native average inconsistent", "chosen-page", false, func(d map[string]any) { d["averageUptimePercent"] = 49.5 }, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			stats := uptimeKumaStatsFixture()
			dashboard := uptimeKumaDashboard()
			scenario.change(dashboard)
			from, to := uptimeKumaVerifyFixture(t, stats, dashboard, scenario.slug, scenario.private)
			err := uptimeKumaTarget().verifyData(t.Context(), from, to, "kuma-owned")
			if err == nil {
				t.Fatal("unselected, unavailable or invalid native data accepted")
			}
			if scenario.manual && !errors.Is(err, helpers.ErrManual) {
				t.Fatalf("person prerequisite must stay Manual: %v", err)
			}
			if stats.catalogs != 0 || stats.refreshes != 0 {
				t.Fatal("native prerequisite failure acquired Stats")
			}
		})
	}
}
