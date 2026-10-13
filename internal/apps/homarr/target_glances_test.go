package homarr

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

func glancesFixture(t *testing.T, f *statsFixture, health map[string]any, integrationID string, status int) (*helpers.H, *helpers.H) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var value any
		switch r.URL.Path {
		case "/api/4/version":
			if status != http.StatusOK {
				w.WriteHeader(status)
				return
			}
			json.NewEncoder(w).Encode("4.5.6")
			return
		case "/api/4/all":
			w.Write([]byte(`{"cpu":{"total":0},"mem":{"total":8192,"used":0,"free":8192},"network":[],"fs":[],"uptime":"0:00:00"}`))
			return
		case "/api/trpc/widget.healthMonitoring.getSystemHealthStatus":
			var input struct {
				JSON struct {
					IDs []string `json:"integrationIds"`
				} `json:"json"`
			}
			json.Unmarshal([]byte(r.URL.Query().Get("input")), &input)
			if len(input.JSON.IDs) != 1 || input.JSON.IDs[0] != "owned-glances" {
				t.Error("native query did not select only the owned integration")
			}
			value = []any{map[string]any{"integrationId": integrationID, "healthInfo": health}}
		case "/api/trpc/widget.stats.catalog", "/api/trpc/widget.stats.snapshot", "/api/trpc/widget.stats.refresh":
			var input struct {
				JSON struct {
					IntegrationID string `json:"integrationId"`
					Force         bool   `json:"force"`
				} `json:"json"`
			}
			if r.Method == http.MethodPost {
				json.NewDecoder(r.Body).Decode(&input)
			} else {
				json.Unmarshal([]byte(r.URL.Query().Get("input")), &input)
			}
			if input.JSON.IntegrationID != "owned-glances" {
				t.Error("Stats query selected an unowned integration")
			}
			switch r.URL.Path {
			case "/api/trpc/widget.stats.catalog":
				f.catalogs++
				value = map[string]any{"metrics": f.metrics}
			case "/api/trpc/widget.stats.snapshot":
				value = map[string]any{"updatedAt": f.timestamp}
			case "/api/trpc/widget.stats.refresh":
				f.refreshes++
				f.force = input.JSON.Force
				if f.advance {
					f.timestamp++
				}
				value = map[string]any{"updatedAt": f.timestamp, "error": false, "stale": false, "values": f.values}
			}
		default:
			t.Errorf("unexpected endpoint: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.Header.Get("ApiKey") != "fixture-key" {
			t.Error("Homarr query was not authenticated")
		}
		json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
	}))
	t.Cleanup(srv.Close)
	from := helpers.New(helpers.Config{App: "homarr", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(), Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key"}})
	to := helpers.New(helpers.Config{App: "glances", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard()})
	return from, to
}

func TestGlancesStatsUseOneFreshOwnedSample(t *testing.T) {
	for _, tc := range []struct {
		name          string
		change        func(*statsFixture, map[string]any)
		integrationID string
		status        int
		valid         bool
	}{
		{"valid zeros", func(*statsFixture, map[string]any) {}, "owned-glances", 200, true},
		{"volatile samples may differ", func(f *statsFixture, _ map[string]any) {
			f.values["cpu"] = float64(30)
			f.values["memoryUsed"] = float64(50)
		}, "owned-glances", 200, true},
		{"wrong owned identity", func(*statsFixture, map[string]any) {}, "user-glances", 200, false},
		{"wrong native version", func(_ *statsFixture, h map[string]any) { h["version"] = `"4.5.5"` }, "owned-glances", 200, false},
		{"null native memory", func(_ *statsFixture, h map[string]any) { h["memAvailableInBytes"] = nil }, "owned-glances", 200, false},
		{"negative network", func(_ *statsFixture, h map[string]any) { h["network"] = map[string]any{"up": -1, "down": 0} }, "owned-glances", 200, false},
		{"authentication prerequisite", func(*statsFixture, map[string]any) {}, "owned-glances", 401, false},
		{"wrong unit", func(f *statsFixture, _ map[string]any) { f.metrics[0].(map[string]any)["unit"] = "bytes" }, "owned-glances", 200, false},
		{"missing catalog metric", func(f *statsFixture, _ map[string]any) { f.metrics = f.metrics[:3] }, "owned-glances", 200, false},
		{"null Stats", func(f *statsFixture, _ map[string]any) { f.values["uptime"] = nil }, "owned-glances", 200, false},
		{"negative Stats bytes", func(f *statsFixture, _ map[string]any) { f.values["memoryUsed"] = float64(-1) }, "owned-glances", 200, false},
		{"fractional Stats bytes", func(f *statsFixture, _ map[string]any) { f.values["memoryUsed"] = 0.5 }, "owned-glances", 200, false},
		{"CPU over 100", func(f *statsFixture, _ map[string]any) { f.values["cpu"] = float64(101) }, "owned-glances", 200, false},
		{"cached refresh", func(f *statsFixture, _ map[string]any) { f.advance = false }, "owned-glances", 200, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := &statsFixture{
				timestamp: 1000, advance: true,
				values: map[string]any{"cpu": float64(0), "memoryUsed": float64(0), "memoryAvailable": float64(8192), "uptime": float64(0)},
				metrics: []any{
					map[string]any{"key": "cpu", "unit": "percent"},
					map[string]any{"key": "memoryUsed", "unit": "bytes"},
					map[string]any{"key": "memoryAvailable", "unit": "bytes"},
					map[string]any{"key": "uptime", "unit": "seconds"},
				},
			}
			health := map[string]any{"version": `"4.5.6"`, "cpuUtilization": 0, "memUsedInBytes": 0, "memAvailableInBytes": 8192, "uptime": 0, "network": map[string]any{"up": 0, "down": 0}}
			tc.change(f, health)
			from, to := glancesFixture(t, f, health, tc.integrationID, tc.status)
			err := glancesTarget().verifyData(context.Background(), from, to, "owned-glances")
			if (err == nil) != tc.valid {
				t.Fatalf("unexpected verification result: %v", err)
			}
			if f.refreshes > 1 || f.refreshes == 1 && !f.force || tc.valid && (f.refreshes != 1 || f.catalogs != 1) {
				t.Fatalf("Stats acquisition duplicated or did not force refresh: %+v", f)
			}
		})
	}
}

func TestGlancesStatsRejectNonfiniteValues(t *testing.T) {
	for _, bad := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		for _, key := range []string{"cpu", "memoryUsed", "memoryAvailable", "uptime"} {
			sample := statsSample{
				values: map[string]any{"cpu": float64(0), "memoryUsed": float64(0), "memoryAvailable": float64(8192), "uptime": float64(0)},
				units:  map[string]string{"cpu": "percent", "memoryUsed": "bytes", "memoryAvailable": "bytes", "uptime": "seconds"},
			}
			sample.values[key] = bad
			if verifyGlancesStats(sample) == nil {
				t.Fatalf("accepted nonfinite %s Stats", key)
			}
		}
	}
}
