package homarr

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

func TestLinkwardenDescriptorStatsVerification(t *testing.T) {
	for _, scenario := range []struct {
		name      string
		change    func(*statsFixture)
		peerID    int
		savedID   int
		wantOK    bool
		catalogs  int
		refreshes int
	}{
		{name: "populated counts", wantOK: true, catalogs: 1, refreshes: 1},
		{name: "explicit zeros", change: func(f *statsFixture) { f.values = map[string]any{"links": 0, "collections": 0, "tags": 0} }, wantOK: true, catalogs: 1, refreshes: 1},
		{name: "large integral count", change: func(f *statsFixture) { f.values["links"] = 1e20 }, wantOK: true, catalogs: 1, refreshes: 1},
		{name: "wrong peer account", peerID: 7},
		{name: "wrong saved account", savedID: 7},
		{name: "first sample remains invalid", change: func(f *statsFixture) { f.values["links"] = -1 }, catalogs: 1, refreshes: 1},
		{name: "fractional collections", change: func(f *statsFixture) { f.values["collections"] = 0.5 }, catalogs: 1, refreshes: 1},
		{name: "text tags", change: func(f *statsFixture) { f.values["tags"] = "0" }, catalogs: 1, refreshes: 1},
		{name: "null links", change: func(f *statsFixture) { f.values["links"] = nil }, catalogs: 1, refreshes: 1},
		{name: "missing tags", change: func(f *statsFixture) { delete(f.values, "tags") }, catalogs: 1, refreshes: 1},
		{name: "wrong collection unit", change: func(f *statsFixture) { f.metrics[1].(map[string]any)["unit"] = "bytes" }, catalogs: 1, refreshes: 1},
		{name: "missing tag catalog", change: func(f *statsFixture) { f.metrics = f.metrics[:2] }, catalogs: 1},
		{name: "no-op refresh", change: func(f *statsFixture) { f.advance = false }, catalogs: 1, refreshes: 1},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			fixture.values = map[string]any{"links": 3, "collections": 2, "tags": 4}
			fixture.metrics = []any{}
			for _, key := range []string{"links", "collections", "tags"} {
				fixture.metrics = append(fixture.metrics, map[string]any{"key": key, "unit": "count"})
			}
			if scenario.change != nil {
				scenario.change(fixture)
			}
			peerID, savedID := scenario.peerID, scenario.savedID
			if peerID == 0 {
				peerID = 1
			}
			if savedID == 0 {
				savedID = 1
			}
			from := fixture.helpers(t)
			statsURL, err := url.Parse(from.BaseURL)
			if err != nil {
				t.Fatal(err)
			}
			proxy := httputil.NewSingleHostReverseProxy(statsURL)
			savedQueries := 0
			homarrServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/trpc/integration.request" {
					proxy.ServeHTTP(w, r)
					return
				}
				var input struct {
					JSON struct{ IntegrationID, Method, Path string } `json:"json"`
				}
				if r.Method != "POST" || r.Header.Get("ApiKey") != "fixture-key" || json.NewDecoder(r.Body).Decode(&input) != nil || input.JSON.IntegrationID != "linkwarden-owned" || input.JSON.Method != "GET" || input.JSON.Path != "/api/v1/users/me" {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				savedQueries++
				json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": map[string]any{
					"ok": true, "status": 200, "integration": map[string]any{"id": "linkwarden-owned", "kind": "linkwarden"},
					"data": map[string]any{"response": map[string]any{"id": savedID}},
				}}}})
			}))
			t.Cleanup(homarrServer.Close)
			from.BaseURL, from.Config.HTTP = homarrServer.URL, homarrServer.Client()
			peerQueries := 0
			peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer fixture-token" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				peerQueries++
				switch r.URL.Path {
				case "/api/v1/users/me":
					json.NewEncoder(w).Encode(map[string]any{"response": map[string]any{"id": peerID, "username": "admin"}})
				case "/api/v1/tokens":
					w.Write([]byte(`{"response":[{"id":2,"name":"self-host Homarr statistics","isSession":false,"expires":"2026-12-31T12:00:00Z"}]}`))
				default:
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			t.Cleanup(peer.Close)
			fingerprint := sha256.Sum256([]byte("fixture-token"))
			ownership, err := json.Marshal(map[string]any{"id": 2, "accountId": 1, "expires": "2026-12-31T12:00:00Z", "fingerprint": hex.EncodeToString(fingerprint[:])})
			if err != nil {
				t.Fatal(err)
			}
			to := helpers.New(helpers.Config{
				App: "linkwarden", BaseURL: peer.URL, HTTP: peer.Client(), Log: events.Discard(),
				Now:     func() time.Time { return time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC) },
				Secrets: statsSecrets{"ADMIN_USER": "admin", "LINKWARDEN_HOMARR_API_KEY": "fixture-token", "LINKWARDEN_HOMARR_TOKEN_OWNERSHIP": string(ownership)},
			})
			err = linkwardenTarget().verifyData(t.Context(), from, to, "linkwarden-owned")
			if (err == nil) != scenario.wantOK {
				t.Fatalf("verification: %v, want success %v", err, scenario.wantOK)
			}
			if peerQueries == 0 || fixture.catalogs != scenario.catalogs || fixture.refreshes != scenario.refreshes || fixture.refreshes > 0 && !fixture.force {
				t.Fatalf("peer=%d saved=%d catalogs=%d refreshes=%d force=%v", peerQueries, savedQueries, fixture.catalogs, fixture.refreshes, fixture.force)
			}
			if peerID == 1 && savedQueries != 1 || peerID != 1 && savedQueries != 0 {
				t.Fatalf("unexpected saved-account query count: %d", savedQueries)
			}
		})
	}
}
