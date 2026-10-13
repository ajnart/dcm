package homarr

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

func TestGotifyLinkUsesOneStatsSampleAfterNativeChecks(t *testing.T) {
	for _, scenario := range []struct {
		name    string
		count   float64
		unit    string
		advance bool
		old     bool
		wrongID bool
		wantErr bool
	}{
		{name: "explicit zero", unit: "count", advance: true},
		{name: "invalid first sample", count: -1, unit: "count", advance: true, wantErr: true},
		{name: "fractional count", count: 0.5, unit: "count", advance: true, wantErr: true},
		{name: "page limit", count: 101, unit: "count", advance: true, wantErr: true},
		{name: "wrong unit", unit: "bytes", advance: true, wantErr: true},
		{name: "no-op refresh", unit: "count", wantErr: true},
		{name: "advancing before attempt", unit: "count", advance: true, old: true, wantErr: true},
		{name: "wrong saved account", unit: "count", advance: true, wrongID: true, wantErr: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			now := time.UnixMilli(2000)
			catalogs, refreshes, notifications := 0, 0, 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/current/user" || r.URL.Path == "/message" {
					user, password, ok := r.BasicAuth()
					if !ok || user != "self-host-homarr" || password != "fixture-password" {
						w.WriteHeader(http.StatusUnauthorized)
						return
					}
					if r.URL.Path == "/current/user" {
						w.Write([]byte(`{"id":2,"name":"self-host-homarr","admin":false}`))
						return
					}
					if r.URL.Query().Get("limit") != "100" {
						t.Error("native notification page did not use its limit")
					}
					w.Write([]byte(`{"paging":{"size":0,"limit":100},"messages":[]}`))
					return
				}
				if r.Header.Get("ApiKey") != "fixture-key" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				var value any
				switch r.URL.Path {
				case "/api/trpc/integration.request":
					var input struct{ JSON map[string]any }
					json.NewDecoder(r.Body).Decode(&input)
					if input.JSON["integrationId"] != "gotify-owned" || input.JSON["path"] != "/current/user" || input.JSON["method"] != "GET" {
						t.Error("wrong saved identity request")
					}
					id := 2
					if scenario.wrongID {
						id = 3
					}
					value = map[string]any{"ok": true, "status": 200, "integration": map[string]any{"id": "gotify-owned", "kind": "gotify"}, "data": map[string]any{"id": id, "name": "self-host-homarr", "admin": false}}
				case "/api/trpc/widget.notifications.getNotifications":
					notifications++
					value = []any{map[string]any{"integration": map[string]any{"id": "gotify-owned", "kind": "gotify", "updatedAt": now.Format(time.RFC3339Nano)}, "data": []any{map[string]any{"id": "7", "time": now.Format(time.RFC3339Nano), "title": "Fixture", "body": "Message"}}}}
				case "/api/trpc/widget.stats.catalog":
					catalogs++
					value = map[string]any{"metrics": []any{map[string]any{"key": "messages", "unit": scenario.unit}}}
				case "/api/trpc/widget.stats.snapshot":
					value = map[string]any{"updatedAt": 1000}
				case "/api/trpc/widget.stats.refresh":
					refreshes++
					var input struct{ JSON map[string]any }
					json.NewDecoder(r.Body).Decode(&input)
					if input.JSON["force"] != true || input.JSON["integrationId"] != "gotify-owned" {
						t.Error("Stats refresh did not target the owned integration with force")
					}
					updated := 1000
					if scenario.advance {
						updated = 2000
					}
					if scenario.old {
						updated = 1500
					}
					count := scenario.count
					if refreshes > 1 {
						count = 0
					}
					value = map[string]any{"updatedAt": updated, "error": false, "stale": false, "values": map[string]any{"messages": count}}
				default:
					t.Errorf("unexpected path %s", r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
			}))
			t.Cleanup(srv.Close)
			secrets := statsSecrets{"HOMARR_API_KEY": "fixture-key", "GOTIFY_HOMARR_USERNAME": "self-host-homarr", "GOTIFY_HOMARR_PASSWORD": "fixture-password", "GOTIFY_HOMARR_USER_ID": "2"}
			newH := func(id string) *helpers.H {
				return helpers.New(helpers.Config{App: id, BaseURL: srv.URL, HTTP: srv.Client(), Secrets: secrets, Log: events.Discard(), Now: func() time.Time { return now }})
			}
			err := gotifyTarget().verifyData(t.Context(), newH("homarr"), newH("gotify"), "gotify-owned")
			if (err != nil) != scenario.wantErr {
				t.Fatalf("verification error = %v, want error %v", err, scenario.wantErr)
			}
			if scenario.wrongID {
				if catalogs != 0 || refreshes != 0 || notifications != 0 {
					t.Fatalf("identity failure reached notifications/Stats: %d/%d/%d", notifications, catalogs, refreshes)
				}
			} else if catalogs != 1 || refreshes != 1 || notifications != 1 {
				t.Fatalf("native notifications and semantics must share one Stats acquisition: %d/%d/%d", notifications, catalogs, refreshes)
			}
		})
	}
}
