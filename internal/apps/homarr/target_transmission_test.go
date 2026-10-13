package homarr

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

func TestTransmissionVerificationUsesDownloadsAndOneStatsSample(t *testing.T) {
	for _, scenario := range []struct {
		name          string
		change        func(map[string]any, map[string]any, map[string]string)
		empty         bool
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
		{name: "completed downSpeed stays unchecked", change: func(item, _ map[string]any, _ map[string]string) { item["progress"] = 1; item["downSpeed"] = -1 }},
		{name: "Transmission stalled state", change: func(item, _ map[string]any, _ map[string]string) { item["state"] = "stalled" }},
		{name: "volatile Stats differ from native rates", change: func(_, stats map[string]any, _ map[string]string) { stats["download"] = 42; stats["paused"] = true }},
		{name: "incomplete torrent needs downSpeed", wantError: true, beforeStats: true, change: func(item, _ map[string]any, _ map[string]string) { item["downSpeed"] = nil }},
		{name: "Deluge unknown state is not Transmission", wantError: true, beforeStats: true, change: func(item, _ map[string]any, _ map[string]string) { item["state"] = "unknown" }},
		{name: "missing time is not zero", wantError: true, beforeStats: true, change: func(item, _ map[string]any, _ map[string]string) { delete(item, "time") }},
		{name: "negative upload speed", wantError: true, beforeStats: true, change: func(item, _ map[string]any, _ map[string]string) { item["upSpeed"] = -1 }},
		{name: "nonintegral item index", wantError: true, beforeStats: true, change: func(item, _ map[string]any, _ map[string]string) { item["index"] = 0.5 }},
		{name: "missing size", wantError: true, beforeStats: true, change: func(item, _ map[string]any, _ map[string]string) { delete(item, "size") }},
		{name: "progress exceeds one", wantError: true, beforeStats: true, change: func(item, _ map[string]any, _ map[string]string) { item["progress"] = 1.1 }},
		{name: "no new Transmission response-count rule", tooMany: true},
		{name: "wrong native identity", wrongIdentity: true, wantError: true, beforeStats: true},
		{name: "rejected RPC login", rejected: true, wantError: true, beforeStats: true},
		{name: "first Stats sample is invalid", wantError: true, change: func(_, stats map[string]any, _ map[string]string) { stats["download"] = -1 }},
		{name: "null paused Stats", wantError: true, change: func(_, stats map[string]any, _ map[string]string) { stats["paused"] = nil }},
		{name: "paused Stats remain boolean", wantError: true, change: func(_, stats map[string]any, _ map[string]string) { stats["paused"] = "false" }},
		{name: "wrong rate unit", wantError: true, change: func(_, _ map[string]any, units map[string]string) { units["download"] = "bytes" }},
		{name: "no-op Stats refresh", noAdvance: true, wantError: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			item := map[string]any{"id": "torrent-1", "name": "authorized-fixture", "type": "torrent", "state": "leeching", "progress": 0.5, "time": -1, "downSpeed": 0, "upSpeed": 0, "index": 0, "size": 1, "sent": 0, "received": 0}
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
				for index := range items {
					items[index] = item
				}
			}
			peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodGet && r.URL.Path == "/transmission/web/" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				if r.Method != http.MethodPost || r.URL.Path != "/transmission/rpc" {
					t.Error("unexpected Transmission request")
					w.WriteHeader(http.StatusNotFound)
					return
				}
				user, password, ok := r.BasicAuth()
				if !ok || user != "fixture-user" || password != "fixture-password" {
					t.Error("Transmission verifier did not use the saved Admin login")
				}
				if scenario.rejected {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				if r.Header.Get("X-Transmission-Session-Id") == "" {
					w.Header().Set("X-Transmission-Session-Id", "fixture-session")
					w.WriteHeader(http.StatusConflict)
					return
				}
				var input struct {
					Method string `json:"method"`
				}
				if json.NewDecoder(r.Body).Decode(&input) != nil {
					t.Error("invalid Transmission request")
				}
				var arguments any
				switch input.Method {
				case "session-get":
					arguments = map[string]any{"version": "4.1.3", "rpc-version-semver": "6.0.1"}
				case "session-stats":
					arguments = map[string]any{"downloadSpeed": 0, "uploadSpeed": 0, "torrentCount": 0, "activeTorrentCount": 0, "pausedTorrentCount": 0}
				case "torrent-get":
					arguments = map[string]any{"torrents": []any{}}
				default:
					t.Errorf("unexpected Transmission method %s", input.Method)
				}
				json.NewEncoder(w).Encode(map[string]any{"result": "success", "arguments": arguments})
			}))
			t.Cleanup(peer.Close)
			downloads := 0
			fixture := newStatsFixture()
			fixture.values = stats
			fixture.advance = !scenario.noAdvance
			fixture.metrics = []any{}
			for key, unit := range units {
				fixture.metrics = append(fixture.metrics, map[string]any{"key": key, "unit": unit})
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/trpc/widget.downloads.getJobsAndStatuses" {
					fixture.ServeHTTP(w, r)
					return
				}
				if r.Header.Get("ApiKey") != "fixture-key" {
					t.Error("missing Homarr API credential")
				}
				downloads++
				id := "transmission-owned"
				if scenario.wrongIdentity {
					id = "other"
				}
				value := []any{map[string]any{"integrationId": id, "integration": map[string]any{"id": id, "kind": "transmission"}, "data": map[string]any{"status": map[string]any{"rates": map[string]any{"down": 0, "up": 0}, "paused": false, "types": []string{"torrent"}}, "items": items}}}
				json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
			}))
			t.Cleanup(server.Close)
			from := helpers.New(helpers.Config{App: "homarr", BaseURL: server.URL, HTTP: server.Client(), Log: events.Discard(), Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key"}})
			to := helpers.New(helpers.Config{App: "transmission", BaseURL: peer.URL, HTTP: peer.Client(), Log: events.Discard(), Secrets: statsSecrets{"ADMIN_USER": "fixture-user", "ADMIN_PASSWORD": "fixture-password"}})
			err := transmissionTarget().verifyData(t.Context(), from, to, "transmission-owned")
			if (err != nil) != scenario.wantError {
				t.Fatalf("error = %v, want failure %v", err, scenario.wantError)
			}
			wantStats := 1
			if scenario.beforeStats {
				wantStats = 0
			}
			if fixture.catalogs != wantStats || fixture.refreshes != wantStats {
				t.Fatalf("catalogs=%d refreshes=%d, want %d of each", fixture.catalogs, fixture.refreshes, wantStats)
			}
			if wantStats > 0 && (!fixture.force || fixture.integrationID != "transmission-owned") {
				t.Fatal("refresh lost its force flag or owned identity")
			}
			wantDownloads := 1
			if scenario.rejected {
				wantDownloads = 0
			}
			if downloads != wantDownloads {
				t.Fatalf("Downloads calls=%d, want %d", downloads, wantDownloads)
			}
		})
	}
}
