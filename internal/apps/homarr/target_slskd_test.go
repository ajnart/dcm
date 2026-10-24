package homarr

import (
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

func TestSlskdDescriptorUsesOneStatsSample(t *testing.T) {
	for _, scenario := range []struct {
		name       string
		change     func(map[string]any, map[string]any, map[string]any, *bool, *string)
		manual     bool
		statsPhase bool
		slow       bool
		fail       bool
	}{
		{name: "provider ready empty queue and explicit zero"},
		{name: "populated queue and independent Stats", change: func(queue, stats, provider map[string]any, advance *bool, unit *string) {
			queue["data"].(map[string]any)["items"] = []any{map[string]any{"id": "fixture-file", "name": "owned.flac", "state": "downloading", "type": "miscellaneous", "size": 100, "time": 1200, "progress": 0.4, "added": 1700000000000, "index": 0}}
			queue["data"].(map[string]any)["status"].(map[string]any)["rates"].(map[string]any)["down"] = 10
			stats["values"].(map[string]any)["download"] = 20
		}},
		{name: "disconnected provider", fail: true, manual: true, change: func(_, _, provider map[string]any, _ *bool, _ *string) { provider["isConnected"] = false }},
		{name: "slow refresh uses completion clock", slow: true},
		{name: "wrong integration", fail: true, change: func(queue, _, _ map[string]any, _ *bool, _ *string) { queue["integrationId"] = "user-owned" }},
		{name: "stale queue", fail: true, change: func(queue, _, _ map[string]any, _ *bool, _ *string) {
			queue["integration"].(map[string]any)["updatedAt"] = "2000-01-01T00:00:00Z"
		}},
		{name: "missing items", fail: true, change: func(queue, _, _ map[string]any, _ *bool, _ *string) { delete(queue["data"].(map[string]any), "items") }},
		{name: "unsupported queue type", fail: true, change: func(queue, _, _ map[string]any, _ *bool, _ *string) {
			queue["data"].(map[string]any)["status"].(map[string]any)["types"] = []any{"torrent"}
		}},
		{name: "response exceeds requested limit", fail: true, change: func(queue, _, _ map[string]any, _ *bool, _ *string) {
			queue["data"].(map[string]any)["items"] = make([]any, 51)
		}},
		{name: "invalid progress", fail: true, change: func(queue, _, _ map[string]any, _ *bool, _ *string) {
			queue["data"].(map[string]any)["items"] = []any{map[string]any{"id": "fixture-file", "name": "owned.flac", "state": "downloading", "type": "miscellaneous", "size": 100, "time": 1200, "progress": 1.1, "added": 1700000000000, "index": 0}}
		}},
		{name: "negative item time", fail: true, change: func(queue, _, _ map[string]any, _ *bool, _ *string) {
			queue["data"].(map[string]any)["items"] = []any{map[string]any{"id": "fixture-file", "name": "owned.flac", "state": "downloading", "type": "miscellaneous", "size": 100, "time": -1, "progress": 0.5, "added": 1700000000000, "index": 0}}
		}},
		{name: "invalid first sample", fail: true, statsPhase: true, change: func(_, stats, _ map[string]any, _ *bool, _ *string) {
			stats["values"].(map[string]any)["download"] = -1
		}},
		{name: "null statistic", fail: true, statsPhase: true, change: func(_, stats, _ map[string]any, _ *bool, _ *string) {
			stats["values"].(map[string]any)["download"] = nil
		}},
		{name: "wrong units", fail: true, statsPhase: true, change: func(_, _, _ map[string]any, _ *bool, unit *string) { *unit = "count" }},
		{name: "missing retry metadata", fail: true, statsPhase: true, change: func(_, stats, _ map[string]any, _ *bool, _ *string) { delete(stats, "retryAt") }},
		{name: "null retry metadata", fail: true, statsPhase: true, change: func(_, stats, _ map[string]any, _ *bool, _ *string) { stats["retryAt"] = nil }},
		{name: "queued retry", fail: true, statsPhase: true, change: func(_, stats, _ map[string]any, _ *bool, _ *string) { stats["retryAt"] = 1 }},
		{name: "no-op refresh", fail: true, statsPhase: true, change: func(_, _, _ map[string]any, advance *bool, _ *string) { *advance = false }},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			now := time.UnixMilli(1700000000000)
			provider := map[string]any{"isConnected": true, "isLoggedIn": true}
			queue := map[string]any{"integrationId": "slskd-owned", "integration": map[string]any{"id": "slskd-owned", "kind": "slskd", "updatedAt": now.Format(time.RFC3339Nano)}, "data": map[string]any{"status": map[string]any{"paused": false, "rates": map[string]any{"down": 0, "up": 0}, "types": []any{"miscellaneous"}}, "items": []any{}}}
			stats := map[string]any{"error": false, "stale": false, "retryAt": 0, "updatedAt": now.UnixMilli(), "values": map[string]any{"download": 0}}
			advance, unit := true, "bytesPerSecond"
			if scenario.change != nil {
				scenario.change(queue, stats, provider, &advance, &unit)
			}
			catalogs, refreshes, downloads := 0, 0, 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var value any
				if r.URL.Path == "/api/v0/session/enabled" {
					json.NewEncoder(w).Encode(true)
					return
				}
				if len(r.URL.Path) >= 8 && r.URL.Path[:8] == "/api/v0/" {
					if r.Header.Get("X-API-Key") != "synthetic-slskd-key" {
						w.WriteHeader(http.StatusUnauthorized)
						return
					}
					switch r.URL.Path {
					case "/api/v0/application/version":
						value = "0.26.1.0"
					case "/api/v0/application":
						value = map[string]any{"server": provider}
					case "/api/v0/transfers/downloads":
						value = []any{}
					default:
						t.Errorf("unexpected provider request %s", r.URL.Path)
					}
					json.NewEncoder(w).Encode(value)
					return
				}
				if r.Header.Get("ApiKey") != "fixture-key" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				switch r.URL.Path {
				case "/api/trpc/widget.downloads.getJobsAndStatuses":
					downloads++
					var input struct {
						JSON struct {
							IDs   []string `json:"integrationIds"`
							Limit int      `json:"limitPerIntegration"`
						} `json:"json"`
					}
					if json.Unmarshal([]byte(r.URL.Query().Get("input")), &input) != nil || len(input.JSON.IDs) != 1 || input.JSON.IDs[0] != "slskd-owned" || input.JSON.Limit != 50 {
						t.Error("Downloads identity or limit changed")
					}
					value = []any{queue}
				case "/api/trpc/widget.stats.catalog":
					catalogs++
					value = map[string]any{"metrics": []any{map[string]any{"key": "download", "unit": unit}}}
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
					if r.Method != http.MethodPost || json.NewDecoder(r.Body).Decode(&input) != nil || input.JSON.ID != "slskd-owned" || !input.JSON.Force {
						t.Error("refresh was not forced for the owned integration")
					}
					if scenario.slow {
						now = now.Add(120 * time.Second)
						stats["updatedAt"] = now.UnixMilli() - 2000
					}
					if !advance {
						stats["updatedAt"] = now.UnixMilli() - 1
					}
					if refreshes > 1 {
						stats["values"] = map[string]any{"download": 0}
					}
					value = stats
				default:
					t.Errorf("unexpected Homarr request %s", r.URL.Path)
				}
				json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
			}))
			t.Cleanup(srv.Close)
			config := helpers.Config{App: "homarr", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(), Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key", "SLSKD_API_KEY": "synthetic-slskd-key"}, Now: func() time.Time { return now }}
			from := helpers.New(config)
			config.App = "slskd"
			to := helpers.New(config)
			err := slskdTarget().verifyData(t.Context(), from, to, "slskd-owned")
			if (err != nil) != scenario.fail || errors.Is(err, helpers.ErrManual) != scenario.manual {
				t.Fatalf("verification = %v", err)
			}
			if catalogs > 1 || refreshes > 1 || !scenario.fail && (catalogs != 1 || refreshes != 1 || downloads != 1) {
				t.Fatalf("catalogs=%d refreshes=%d downloads=%d", catalogs, refreshes, downloads)
			}
			if scenario.statsPhase && (catalogs != 1 || refreshes != 1) {
				t.Fatalf("Stats failure bypassed central sample: catalogs=%d refreshes=%d", catalogs, refreshes)
			}
			if scenario.manual && (downloads != 0 || catalogs != 0 || refreshes != 0) {
				t.Fatal("provider Manual acquired Homarr data")
			}
		})
	}
}

func TestSlskdStatsRetainsClockAndNumberPolicy(t *testing.T) {
	for _, test := range []struct {
		name  string
		age   float64
		value any
		fail  bool
	}{
		{"zero", 0, float64(0), false}, {"minute old", 60000, float64(1), false}, {"minute future", -60000, float64(1), false}, {"fractional millisecond rounded", -60000.5, float64(1), false},
		{"old", 60001, float64(1), true}, {"future", -60001, float64(1), true}, {"negative", 0, float64(-1), true}, {"nonfinite", 0, math.Inf(1), true},
	} {
		t.Run(test.name, func(t *testing.T) {
			sample := statsSample{units: map[string]string{"download": "bytesPerSecond"}, values: map[string]any{"download": test.value}, retryAt: float64(0), completedAt: 1700000000000, updatedAt: 1700000000000 - test.age}
			if err := verifySlskdStats(sample); (err != nil) != test.fail {
				t.Fatalf("verification = %v", err)
			}
		})
	}
}
