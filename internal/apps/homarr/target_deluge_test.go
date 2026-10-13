package homarr

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

func TestDelugeVerificationUsesDownloadsAndOneStatsSample(t *testing.T) {
	for _, scenario := range []struct {
		name          string
		change        func(map[string]any, map[string]any, map[string]string)
		empty         bool
		disconnected  bool
		rejected      bool
		noAdvance     bool
		wrongIdentity bool
		tooMany       bool
		beforeStats   bool
		wantError     bool
	}{
		{name: "populated queue with finite negative time"},
		{name: "explicit empty queue", empty: true},
		{name: "completed torrent without downSpeed", change: func(item, _ map[string]any, _ map[string]string) {
			item["progress"] = 1
			item["downSpeed"] = nil
			item["state"] = "seeding"
		}},
		{name: "completed torrent with omitted downSpeed", change: func(item, _ map[string]any, _ map[string]string) { item["progress"] = 1; delete(item, "downSpeed") }},
		{name: "Deluge unknown state", change: func(item, _ map[string]any, _ map[string]string) { item["state"] = "unknown" }},
		{name: "volatile Stats differ from native rates", change: func(_, stats map[string]any, _ map[string]string) { stats["download"] = 42; stats["paused"] = true }},
		{name: "incomplete torrent needs downSpeed", wantError: true, beforeStats: true, change: func(item, _ map[string]any, _ map[string]string) { item["downSpeed"] = nil }},
		{name: "completed negative speed is rejected", wantError: true, beforeStats: true, change: func(item, _ map[string]any, _ map[string]string) { item["progress"] = 1; item["downSpeed"] = -1 }},
		{name: "Transmission stalled state is not Deluge", wantError: true, beforeStats: true, change: func(item, _ map[string]any, _ map[string]string) { item["state"] = "stalled" }},
		{name: "missing time is not zero", wantError: true, beforeStats: true, change: func(item, _ map[string]any, _ map[string]string) { delete(item, "time") }},
		{name: "negative upload speed", wantError: true, beforeStats: true, change: func(item, _ map[string]any, _ map[string]string) { item["upSpeed"] = -1 }},
		{name: "progress exceeds one", wantError: true, beforeStats: true, change: func(item, _ map[string]any, _ map[string]string) { item["progress"] = 1.1 }},
		{name: "bounded Deluge result", tooMany: true, wantError: true, beforeStats: true},
		{name: "wrong native identity", wrongIdentity: true, wantError: true, beforeStats: true},
		{name: "disconnected daemon", disconnected: true, wantError: true, beforeStats: true},
		{name: "rejected Web login", rejected: true, wantError: true, beforeStats: true},
		{name: "first Stats sample is invalid", wantError: true, change: func(_, stats map[string]any, _ map[string]string) { stats["download"] = -1 }},
		{name: "null paused Stats", wantError: true, change: func(_, stats map[string]any, _ map[string]string) { stats["paused"] = nil }},
		{name: "paused Stats remain boolean", wantError: true, change: func(_, stats map[string]any, _ map[string]string) { stats["paused"] = "false" }},
		{name: "wrong rate unit", wantError: true, change: func(_, _ map[string]any, units map[string]string) { units["download"] = "bytes" }},
		{name: "no-op Stats refresh", noAdvance: true, wantError: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			item := map[string]any{"id": "torrent-1", "name": "authorized-fixture", "type": "torrent", "state": "leeching", "progress": 0.5, "time": -1, "downSpeed": 0, "upSpeed": 0}
			stats := map[string]any{"download": 0, "upload": 0, "paused": false}
			units := map[string]string{"download": "bytesPerSecond", "upload": "bytesPerSecond", "paused": "text"}
			if scenario.change != nil {
				scenario.change(item, stats, units)
			}
			items := []any{item}
			if scenario.empty {
				items = []any{}
			}
			if scenario.tooMany {
				items = make([]any, 51)
			}
			peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost || r.URL.Path != "/json" {
					t.Error("unexpected Deluge request")
					w.WriteHeader(http.StatusNotFound)
					return
				}
				var input struct {
					Method string            `json:"method"`
					Params []json.RawMessage `json:"params"`
				}
				if json.NewDecoder(r.Body).Decode(&input) != nil {
					t.Error("invalid Deluge request")
				}
				var result any = true
				if input.Method == "auth.login" {
					var password string
					if len(input.Params) != 1 || json.Unmarshal(input.Params[0], &password) != nil || password != "fixture-password" {
						t.Error("Deluge verifier did not use its saved Web password")
					}
					result = !scenario.rejected
					if !scenario.rejected {
						http.SetCookie(w, &http.Cookie{Name: "_session_id", Value: "fixture-session"})
					}
				} else {
					if r.Header.Get("Cookie") != "_session_id=fixture-session" {
						t.Error("Deluge verifier lost its authenticated session")
					}
					switch input.Method {
					case "auth.check_session", "auth.delete_session":
					case "web.connected":
						result = !scenario.disconnected
					case "web.update_ui":
						result = map[string]any{"connected": true, "torrents": map[string]any{}, "stats": map[string]any{"download_rate": 0, "upload_rate": 0}}
					default:
						t.Errorf("unexpected Deluge method %s", input.Method)
					}
				}
				json.NewEncoder(w).Encode(map[string]any{"id": 1, "error": nil, "result": result})
			}))
			t.Cleanup(peer.Close)
			downloads, catalogs, refreshes := 0, 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("ApiKey") != "fixture-key" {
					t.Error("missing Homarr API credential")
				}
				var value any
				switch r.URL.Path {
				case "/api/trpc/widget.downloads.getJobsAndStatuses":
					downloads++
					id := "deluge-owned"
					if scenario.wrongIdentity {
						id = "other"
					}
					value = []any{map[string]any{"integrationId": id, "integration": map[string]any{"id": id, "kind": "deluge"}, "data": map[string]any{"status": map[string]any{"rates": map[string]any{"down": 0, "up": 0}, "paused": false, "types": []string{"torrent"}}, "items": items}}}
				case "/api/trpc/widget.stats.catalog":
					catalogs++
					metrics := []any{}
					for key, unit := range units {
						metrics = append(metrics, map[string]any{"key": key, "unit": unit})
					}
					value = map[string]any{"metrics": metrics}
				case "/api/trpc/widget.stats.snapshot":
					value = map[string]any{"updatedAt": 1000}
				case "/api/trpc/widget.stats.refresh":
					refreshes++
					var input struct {
						JSON struct {
							IntegrationID string `json:"integrationId"`
							Force         bool   `json:"force"`
						} `json:"json"`
					}
					if json.NewDecoder(r.Body).Decode(&input) != nil || !input.JSON.Force || input.JSON.IntegrationID != "deluge-owned" {
						t.Error("refresh lost its force flag or owned identity")
					}
					updated := 2000
					if scenario.noAdvance {
						updated = 1000
					}
					values := stats
					if refreshes > 1 {
						values = map[string]any{"download": 0, "upload": 0, "paused": false}
					}
					value = map[string]any{"updatedAt": updated, "error": false, "stale": false, "values": values}
				default:
					t.Errorf("unexpected Homarr request %s", r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
			}))
			t.Cleanup(server.Close)
			from := helpers.New(helpers.Config{App: "homarr", BaseURL: server.URL, HTTP: server.Client(), Log: events.Discard(), Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key"}})
			to := helpers.New(helpers.Config{App: "deluge", BaseURL: peer.URL, HTTP: peer.Client(), Log: events.Discard(), Secrets: statsSecrets{"DELUGE_WEB_PASSWORD": "fixture-password"}})
			err := delugeTarget().verifyData(t.Context(), from, to, "deluge-owned")
			if (err != nil) != scenario.wantError {
				t.Fatalf("error = %v, want failure %v", err, scenario.wantError)
			}
			wantStats := 1
			if scenario.beforeStats {
				wantStats = 0
			}
			if catalogs != wantStats || refreshes != wantStats {
				t.Fatalf("catalogs=%d refreshes=%d, want %d of each", catalogs, refreshes, wantStats)
			}
			wantDownloads := 1
			if scenario.rejected || scenario.disconnected {
				wantDownloads = 0
			}
			if downloads != wantDownloads {
				t.Fatalf("Downloads calls=%d, want %d", downloads, wantDownloads)
			}
		})
	}
}
