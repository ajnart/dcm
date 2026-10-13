package homarr

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
)

type nextcloudVerificationExec struct {
	helpers.Executor
	wrongToken bool
}

func (e nextcloudVerificationExec) Exec(_ context.Context, _ string, env map[string]string, command ...string) (system.Result, error) {
	line := strings.Join(command, " ")
	if strings.Contains(line, "config:system:get trusted_domains") {
		return system.Result{Stdout: []byte("127.0.0.1\nnextcloud\n")}, nil
	}
	if strings.Contains(line, "user:auth-tokens:list") && env["SELF_HOST_NEXTCLOUD_USER"] == "admin" {
		id := 7
		if e.wrongToken {
			id = 8
		}
		body, err := json.Marshal([]any{map[string]any{"id": id, "name": "self-host Homarr", "type": 1, "scope": map[string]bool{"filesystem": true}}})
		return system.Result{Stdout: body}, err
	}
	return system.Result{}, errors.New("unexpected Nextcloud mutation")
}

func TestNextcloudDescriptorStatsVerification(t *testing.T) {
	for _, scenario := range []struct {
		name       string
		change     func(*statsFixture)
		native     string
		wrongToken bool
		wantOK     bool
		catalogs   int
		refreshes  int
	}{
		{name: "independent notification samples", wantOK: true, catalogs: 1, refreshes: 1},
		{name: "explicit zero", change: func(f *statsFixture) { f.values["messages"] = 0 }, wantOK: true, catalogs: 1, refreshes: 1},
		{name: "slow response", change: func(f *statsFixture) { f.timestamp = 45000 }, wantOK: true, catalogs: 1, refreshes: 1},
		{name: "no additional future limit", change: func(f *statsFixture) { f.timestamp = 60000 }, wantOK: true, catalogs: 1, refreshes: 1},
		{name: "wrong token ownership", wrongToken: true},
		{name: "wrong peer identity", native: "peer identity"},
		{name: "rejected app password", native: "authentication"},
		{name: "wrong saved identity", native: "saved identity"},
		{name: "unredacted saved password", native: "password metadata"},
		{name: "wrong notification integration", native: "notification integration"},
		{name: "notification error", native: "notification error"},
		{name: "null notification list", native: "notification list"},
		{name: "wrong calendar integration", native: "calendar integration"},
		{name: "calendar error", native: "calendar error"},
		{name: "null event list", native: "calendar list"},
		{name: "first sample remains invalid", change: func(f *statsFixture) { f.values["messages"] = -1 }, catalogs: 1, refreshes: 1},
		{name: "fractional count", change: func(f *statsFixture) { f.values["messages"] = 0.5 }, catalogs: 1, refreshes: 1},
		{name: "outside original int64 range", change: func(f *statsFixture) { f.values["messages"] = 1e20 }, catalogs: 1, refreshes: 1},
		{name: "text count", change: func(f *statsFixture) { f.values["messages"] = "0" }, catalogs: 1, refreshes: 1},
		{name: "null count", change: func(f *statsFixture) { f.values["messages"] = nil }, catalogs: 1, refreshes: 1},
		{name: "missing count", change: func(f *statsFixture) { delete(f.values, "messages") }, catalogs: 1, refreshes: 1},
		{name: "wrong unit", change: func(f *statsFixture) { f.metrics[0].(map[string]any)["unit"] = "bytes" }, catalogs: 1, refreshes: 1},
		{name: "missing catalog metric", change: func(f *statsFixture) { f.metrics = []any{} }, catalogs: 1},
		{name: "advancing before request start", change: func(f *statsFixture) { f.timestamp = 1000 }, catalogs: 1, refreshes: 1},
		{name: "no-op refresh", change: func(f *statsFixture) { f.advance = false }, catalogs: 1, refreshes: 1},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			fixture.values = map[string]any{"messages": 3}
			fixture.metrics = []any{map[string]any{"key": "messages", "unit": "count"}}
			fixture.timestamp = 1999
			if scenario.change != nil {
				scenario.change(fixture)
			}
			from := fixture.helpers(t)
			from.Now = func() time.Time {
				if fixture.refreshes == 0 {
					return time.UnixMilli(2000)
				}
				return time.UnixMilli(47000)
			}
			statsURL, err := url.Parse(from.BaseURL)
			if err != nil {
				t.Fatal(err)
			}
			proxy := httputil.NewSingleHostReverseProxy(statsURL)
			nativeQueries := map[string]int{}
			homarrServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasPrefix(r.URL.Path, "/api/trpc/widget.stats.") {
					proxy.ServeHTTP(w, r)
					return
				}
				if r.Header.Get("ApiKey") != "fixture-key" || r.Method != "GET" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				var input struct {
					JSON struct {
						ID             string
						IntegrationIDs []string
						Year, Month    int
					} `json:"json"`
				}
				if json.Unmarshal([]byte(r.URL.Query().Get("input")), &input) != nil {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				nativeQueries[r.URL.Path]++
				var value any
				integration := map[string]any{"id": "nextcloud-owned", "kind": "nextcloud"}
				switch r.URL.Path {
				case "/api/trpc/integration.byId":
					if input.JSON.ID != "nextcloud-owned" {
						w.WriteHeader(http.StatusBadRequest)
						return
					}
					username := "admin"
					if scenario.native == "saved identity" {
						username = "other"
					}
					var password any
					if scenario.native == "password metadata" {
						password = "unexpected"
					}
					integration["secrets"] = []any{map[string]any{"kind": "username", "value": username}, map[string]any{"kind": "password", "value": password}}
					value = integration
				case "/api/trpc/widget.notifications.getNotifications", "/api/trpc/widget.calendar.findAllEvents":
					if len(input.JSON.IntegrationIDs) != 1 || input.JSON.IntegrationIDs[0] != "nextcloud-owned" {
						w.WriteHeader(http.StatusBadRequest)
						return
					}
					kind, dataKey := "notification", "data"
					if strings.Contains(r.URL.Path, "calendar") {
						kind, dataKey = "calendar", "events"
						if input.JSON.Year != 1970 || input.JSON.Month != 1 {
							w.WriteHeader(http.StatusBadRequest)
							return
						}
					}
					result := map[string]any{"integration": integration, dataKey: []any{}}
					if scenario.native == kind+" integration" {
						integration["id"] = "another-integration"
					}
					if scenario.native == kind+" error" {
						result["error"] = map[string]any{"message": "fixture failure"}
					}
					if scenario.native == kind+" list" {
						result[dataKey] = nil
					}
					value = []any{result}
				default:
					w.WriteHeader(http.StatusNotFound)
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
			}))
			t.Cleanup(homarrServer.Close)
			from.BaseURL, from.Config.HTTP = homarrServer.URL, homarrServer.Client()
			peerQueries := 0
			peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				peerQueries++
				if r.URL.Path == "/status.php" {
					w.Write([]byte(`{"installed":true,"maintenance":false,"needsDbUpgrade":false,"versionstring":"35.0.1"}`))
					return
				}
				user, password, ok := r.BasicAuth()
				if !ok || user != "admin" || password != "fixture-app-password" || scenario.native == "authentication" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				if r.Method == "PROPFIND" && r.URL.Path == "/remote.php/dav/principals/users/admin/" && r.Header.Get("Depth") == "0" {
					w.WriteHeader(http.StatusMultiStatus)
					w.Write([]byte(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><c:calendar-home-set><d:href>/remote.php/dav/calendars/admin/</d:href></c:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`))
					return
				}
				if r.Header.Get("OCS-APIRequest") != "true" {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				var data any
				switch r.URL.Path {
				case "/ocs/v2.php/cloud/user":
					id := "admin"
					if scenario.native == "peer identity" {
						id = "other"
					}
					data = map[string]any{"id": id, "groups": []string{"admin"}}
				case "/ocs/v2.php/apps/notifications/api/v2/notifications":
					data = []any{}
				default:
					w.WriteHeader(http.StatusNotFound)
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"ocs": map[string]any{"meta": map[string]any{"status": "ok", "statuscode": 200}, "data": data}})
			}))
			t.Cleanup(peer.Close)
			to := helpers.New(helpers.Config{
				App: "nextcloud", BaseURL: peer.URL, HTTP: peer.Client(), Log: events.Discard(),
				Exec:    nextcloudVerificationExec{wrongToken: scenario.wrongToken},
				Secrets: statsSecrets{"ADMIN_USER": "admin", "NEXTCLOUD_HOMARR_APP_PASSWORD": "fixture-app-password", "NEXTCLOUD_HOMARR_APP_PASSWORD_ID": "7"},
			})
			err = nextcloudTarget().verifyData(t.Context(), from, to, "nextcloud-owned")
			if (err == nil) != scenario.wantOK {
				t.Fatalf("verification: %v, want success %v", err, scenario.wantOK)
			}
			if peerQueries == 0 || fixture.catalogs != scenario.catalogs || fixture.refreshes != scenario.refreshes || fixture.refreshes > 0 && !fixture.force {
				t.Fatalf("peer=%d native=%v catalogs=%d refreshes=%d force=%v", peerQueries, nativeQueries, fixture.catalogs, fixture.refreshes, fixture.force)
			}
			if scenario.catalogs > 0 {
				for _, path := range []string{"/api/trpc/integration.byId", "/api/trpc/widget.notifications.getNotifications", "/api/trpc/widget.calendar.findAllEvents"} {
					if nativeQueries[path] != 1 {
						t.Fatalf("native query %s ran %d times", path, nativeQueries[path])
					}
				}
			}
		})
	}
}
