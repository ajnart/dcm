package homarr

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

func TestTracearrDescriptorUsesOneStatsSample(t *testing.T) {
	for _, scenario := range []struct {
		name       string
		change     func(map[string]any, map[string]any, map[string]any, *bool, *string)
		fail       bool
		manual     bool
		statsPhase bool
		slow       bool
	}{
		{name: "attached idle media server and explicit zero"},
		{name: "actual stream identities and independent Stats", change: func(dashboard, stats, _ map[string]any, _ *bool, _ *string) {
			streams := dashboard["dashboard"].(map[string]any)["streams"].(map[string]any)
			streams["data"] = []any{map[string]any{"id": "fixture-session", "serverId": "fixture-jellyfin", "username": "fixture-person", "mediaTitle": "Synthetic movie", "progressMs": 50, "state": "playing", "bitrate": nil, "durationMs": nil}}
			streams["summary"] = map[string]any{"total": 1, "transcodes": 0, "directStreams": 0, "directPlays": 1, "totalBitrate": "—"}
			stats["values"].(map[string]any)["activeStreams"] = 2
		}},
		{name: "missing media server", fail: true, manual: true, change: func(_, _, health map[string]any, _ *bool, _ *string) { health["servers"] = []any{} }},
		{name: "offline media server", fail: true, manual: true, change: func(_, _, health map[string]any, _ *bool, _ *string) {
			health["servers"].([]any)[0].(map[string]any)["online"] = false
		}},
		{name: "slow refresh uses completion clock", slow: true},
		{name: "wrong integration", fail: true, change: func(dashboard, _, _ map[string]any, _ *bool, _ *string) { dashboard["integrationId"] = "user-owned" }},
		{name: "stale dashboard", fail: true, change: func(dashboard, _, _ map[string]any, _ *bool, _ *string) {
			dashboard["updatedAt"] = "2000-01-01T00:00:00Z"
		}},
		{name: "missing streams dataset", fail: true, change: func(dashboard, _, _ map[string]any, _ *bool, _ *string) {
			delete(dashboard["dashboard"].(map[string]any)["streams"].(map[string]any), "data")
		}},
		{name: "fractional timestamp", fail: true, statsPhase: true, change: func(_, stats, _ map[string]any, _ *bool, _ *string) { stats["updatedAt"] = 1700000000000.5 }},
		{name: "invalid first sample", fail: true, statsPhase: true, change: func(_, stats, _ map[string]any, _ *bool, _ *string) {
			stats["values"].(map[string]any)["totalUsers"] = 0.5
		}},
		{name: "null Stats count", fail: true, statsPhase: true, change: func(_, stats, _ map[string]any, _ *bool, _ *string) {
			stats["values"].(map[string]any)["totalSessions"] = nil
		}},
		{name: "missing Stats count", fail: true, statsPhase: true, change: func(_, stats, _ map[string]any, _ *bool, _ *string) {
			delete(stats["values"].(map[string]any), "recentViolations")
		}},
		{name: "wrong units", fail: true, statsPhase: true, change: func(_, _, _ map[string]any, _ *bool, unit *string) { *unit = "bytes" }},
		{name: "no-op refresh", fail: true, statsPhase: true, change: func(_, _, _ map[string]any, advance *bool, _ *string) { *advance = false }},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			now := time.UnixMilli(1700000000000)
			health := map[string]any{"status": "ok", "version": "v2.6.0", "timestamp": now.Format(time.RFC3339Nano), "servers": []any{map[string]any{"id": "fixture-jellyfin", "type": "jellyfin", "online": true, "historical": false, "activeStreams": 0}}}
			dashboard := map[string]any{"integrationId": "tracearr-owned", "updatedAt": now.Format(time.RFC3339Nano), "dashboard": map[string]any{"stats": map[string]any{"timestamp": now.Format(time.RFC3339Nano), "activeStreams": 0, "totalUsers": 0, "totalSessions": 0, "recentViolations": 0}, "streams": map[string]any{"data": []any{}, "summary": map[string]any{"total": 0, "transcodes": 0, "directStreams": 0, "directPlays": 0, "totalBitrate": "—"}}}}
			stats := map[string]any{"error": false, "stale": false, "updatedAt": now.UnixMilli(), "values": map[string]any{"activeStreams": 0, "totalUsers": 0, "totalSessions": 0, "recentViolations": 0}}
			advance, unit := true, "count"
			if scenario.change != nil {
				scenario.change(dashboard, stats, health, &advance, &unit)
			}
			catalogs, refreshes, dashboards := 0, 0, 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var value any
				if r.URL.Path == "/health" {
					json.NewEncoder(w).Encode(map[string]any{"status": "ok", "mode": "ready", "db": true, "redis": true})
					return
				}
				if r.URL.Path == "/api/v1/public/health" {
					if r.Header.Get("Authorization") != "Bearer trr_pub_synthetic_fixture" {
						w.WriteHeader(http.StatusUnauthorized)
						return
					}
					json.NewEncoder(w).Encode(health)
					return
				}
				if r.Header.Get("ApiKey") != "fixture-key" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				switch r.URL.Path {
				case "/api/trpc/widget.tracearr.getDashboard":
					dashboards++
					var input struct {
						JSON struct {
							IDs []string `json:"integrationIds"`
						} `json:"json"`
					}
					if r.Method != http.MethodGet || json.Unmarshal([]byte(r.URL.Query().Get("input")), &input) != nil || len(input.JSON.IDs) != 1 || input.JSON.IDs[0] != "tracearr-owned" {
						t.Error("native dashboard identity changed")
					}
					value = []any{dashboard}
				case "/api/trpc/widget.stats.catalog":
					catalogs++
					metrics := []any{}
					for _, key := range tracearrMetrics() {
						metrics = append(metrics, map[string]any{"key": key, "unit": unit})
					}
					value = map[string]any{"metrics": metrics}
				case "/api/trpc/widget.stats.snapshot":
					value = map[string]any{"updatedAt": now.UnixMilli() - 1}
				case "/api/trpc/widget.stats.refresh":
					refreshes++
					var input struct {
						JSON struct {
							ID    string `json:"integrationId"`
							Force bool   `json:"force"`
						} `json:"json"`
					}
					if r.Method != http.MethodPost || json.NewDecoder(r.Body).Decode(&input) != nil || input.JSON.ID != "tracearr-owned" || !input.JSON.Force {
						t.Error("refresh was not forced for owned integration")
					}
					if scenario.slow {
						now = now.Add(45 * time.Second)
						stats["updatedAt"] = now.UnixMilli() - 2000
					}
					if !advance {
						stats["updatedAt"] = now.UnixMilli() - 1
					}
					if refreshes > 1 {
						stats["values"] = map[string]any{"activeStreams": 0, "totalUsers": 0, "totalSessions": 0, "recentViolations": 0}
					}
					value = stats
				default:
					t.Errorf("unexpected request %s", r.URL.Path)
				}
				json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
			}))
			t.Cleanup(srv.Close)
			hash := sha256.Sum256([]byte("trr_pub_synthetic_fixture"))
			config := helpers.Config{App: "homarr", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(), Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key", "TRACEARR_HOMARR_API_KEY": "trr_pub_synthetic_fixture", "TRACEARR_HOMARR_API_KEY_OWNER": "fixture-owner", "TRACEARR_HOMARR_API_KEY_HASH": hex.EncodeToString(hash[:])}, Now: func() time.Time { return now }}
			from := helpers.New(config)
			config.App = "tracearr"
			to := helpers.New(config)
			err := tracearrTarget().verifyData(t.Context(), from, to, "tracearr-owned")
			if (err != nil) != scenario.fail || errors.Is(err, helpers.ErrManual) != scenario.manual {
				t.Fatalf("verification = %v", err)
			}
			if catalogs > 1 || refreshes > 1 || !scenario.fail && (catalogs != 1 || refreshes != 1 || dashboards != 1) {
				t.Fatalf("catalogs=%d refreshes=%d dashboards=%d", catalogs, refreshes, dashboards)
			}
			if scenario.statsPhase && (catalogs != 1 || refreshes != 1) {
				t.Fatalf("Stats failure bypassed central sample: catalogs=%d refreshes=%d", catalogs, refreshes)
			}
			if scenario.manual && (dashboards != 0 || catalogs != 0 || refreshes != 0) {
				t.Fatal("media-server Manual acquired Homarr data")
			}
		})
	}
}

func TestTracearrStatsRetainsClockAndCountPolicy(t *testing.T) {
	for _, test := range []struct {
		name  string
		age   float64
		value any
		fail  bool
	}{
		{"zero", 0, float64(0), false}, {"30 seconds old", 30000, float64(1), false}, {"five seconds future", -5000, float64(1), false},
		{"old", 30001, float64(1), true}, {"future", -5001, float64(1), true}, {"fraction", 0, float64(0.5), true}, {"negative", 0, float64(-1), true}, {"nonfinite", 0, math.Inf(1), true},
	} {
		t.Run(test.name, func(t *testing.T) {
			sample := statsSample{units: map[string]string{}, values: map[string]any{}, completedAt: 1700000000000, startedAt: 1699999900000, updatedAt: 1700000000000 - test.age}
			for _, key := range tracearrMetrics() {
				sample.units[key] = "count"
				sample.values[key] = test.value
			}
			if err := verifyTracearrStats(sample); (err != nil) != test.fail {
				t.Fatalf("verification = %v", err)
			}
		})
	}
}
