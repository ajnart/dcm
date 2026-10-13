package homarr

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

type lidarrNativeFixture struct {
	status   int
	version  string
	artists  any
	calendar any
}

func newLidarrNativeFixture() *lidarrNativeFixture {
	return &lidarrNativeFixture{
		status: http.StatusOK, version: "3.1.0.4875",
		artists: []any{map[string]any{"monitored": true}},
		calendar: []any{map[string]any{
			"integration": map[string]any{"id": "lidarr-owned", "kind": "lidarr"},
			"events":      []any{map[string]any{"title": "Release", "subTitle": "Artist", "startDate": "2026-10-13T00:00:00Z", "description": nil, "image": nil, "links": []any{}}},
		}},
	}
}

func (f *lidarrNativeFixture) peer(t *testing.T) *helpers.H {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/login" {
			r.ParseForm()
			if r.PostForm.Get("username") != "admin" || r.PostForm.Get("password") != "fixture-password" {
				w.Header().Set("Location", "/login?loginFailed=true")
			} else {
				w.Header().Set("Location", "/")
			}
			w.WriteHeader(http.StatusFound)
			return
		}
		if r.Header.Get("X-Api-Key") != "fixture-lidarr-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(f.status)
		switch r.URL.Path {
		case "/api/v1/system/status":
			json.NewEncoder(w).Encode(map[string]any{"appName": "Lidarr", "version": f.version})
		case "/api":
			w.Write([]byte(`{"current":"v1"}`))
		case "/api/v1/config/host":
			w.Write([]byte(`{"id":1,"authenticationMethod":"forms","authenticationRequired":"enabled","username":"admin","password":"","passwordConfirmation":"","apiKey":"fixture-lidarr-key"}`))
		case "/api/v1/artist":
			json.NewEncoder(w).Encode(f.artists)
		default:
			t.Errorf("unexpected native request %s", r.URL.Path)
		}
	}))
	t.Cleanup(srv.Close)
	return helpers.New(helpers.Config{App: "lidarr", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(), Secrets: statsSecrets{"LIDARR_API_KEY": "fixture-lidarr-key", "ADMIN_USER": "admin", "ADMIN_PASSWORD": "fixture-password"}})
}

func (f *lidarrNativeFixture) homarr(t *testing.T, stats *statsFixture) *helpers.H {
	t.Helper()
	h := stats.helpers(t)
	endpoint, err := url.Parse(h.BaseURL)
	if err != nil {
		t.Fatal(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(endpoint)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/trpc/widget.calendar.findAllEvents" {
			proxy.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("ApiKey") != "fixture-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": f.calendar}}})
	}))
	t.Cleanup(srv.Close)
	h.BaseURL, h.Config.HTTP = srv.URL, srv.Client()
	return h
}

func TestLidarrVerifyDataUsesOneSemanticStatsSample(t *testing.T) {
	for _, scenario := range []struct {
		name          string
		change        func(*statsFixture, *lidarrNativeFixture)
		wantError     bool
		wantRefreshes int
	}{
		{"zero independently refreshed library", nil, false, 1},
		{"populated counts", func(f *statsFixture, _ *lidarrNativeFixture) {
			f.values = map[string]any{"artists": 2, "monitored": 1, "upcoming": 3}
		}, false, 1},
		{"first invalid sample", func(f *statsFixture, _ *lidarrNativeFixture) { f.values["artists"] = -1 }, true, 1},
		{"fractional count", func(f *statsFixture, _ *lidarrNativeFixture) { f.values["upcoming"] = 0.5 }, true, 1},
		{"missing count", func(f *statsFixture, _ *lidarrNativeFixture) { delete(f.values, "upcoming") }, true, 1},
		{"null count", func(f *statsFixture, _ *lidarrNativeFixture) { f.values["upcoming"] = nil }, true, 1},
		{"wrong unit", func(f *statsFixture, _ *lidarrNativeFixture) { f.metrics[0].(map[string]any)["unit"] = "bytes" }, true, 1},
		{"monitoring exceeds library", func(f *statsFixture, _ *lidarrNativeFixture) { f.values["monitored"] = 1 }, true, 1},
		{"cached no-op", func(f *statsFixture, _ *lidarrNativeFixture) { f.advance = false }, true, 1},
		{"empty native library and calendar", func(_ *statsFixture, n *lidarrNativeFixture) {
			n.artists = []any{}
			n.calendar.([]any)[0].(map[string]any)["events"] = []any{}
		}, false, 1},
		{"nullable subtitle", func(_ *statsFixture, n *lidarrNativeFixture) {
			n.calendar.([]any)[0].(map[string]any)["events"].([]any)[0].(map[string]any)["subTitle"] = nil
		}, false, 1},
		{"native auth rejected", func(_ *statsFixture, n *lidarrNativeFixture) { n.status = http.StatusUnauthorized }, true, 0},
		{"unsupported version", func(_ *statsFixture, n *lidarrNativeFixture) { n.version = "4.0.0.1" }, true, 0},
		{"missing native monitoring", func(_ *statsFixture, n *lidarrNativeFixture) { n.artists = []any{map[string]any{}} }, true, 0},
		{"calendar wrong source", func(_ *statsFixture, n *lidarrNativeFixture) {
			n.calendar.([]any)[0].(map[string]any)["integration"].(map[string]any)["id"] = "other"
		}, true, 0},
		{"calendar failure", func(_ *statsFixture, n *lidarrNativeFixture) {
			n.calendar.([]any)[0].(map[string]any)["error"] = "unavailable"
		}, true, 0},
		{"invalid calendar date", func(_ *statsFixture, n *lidarrNativeFixture) {
			n.calendar.([]any)[0].(map[string]any)["events"].([]any)[0].(map[string]any)["startDate"] = "invalid"
		}, true, 0},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			f := newStatsFixture()
			f.values = map[string]any{"artists": 0, "monitored": 0, "upcoming": 0}
			f.metrics = []any{map[string]any{"key": "artists", "unit": "count"}, map[string]any{"key": "monitored", "unit": "count"}, map[string]any{"key": "upcoming", "unit": "count"}}
			n := newLidarrNativeFixture()
			if scenario.change != nil {
				scenario.change(f, n)
			}
			err := lidarrTarget().verifyData(t.Context(), n.homarr(t, f), n.peer(t), "lidarr-owned")
			if (err != nil) != scenario.wantError {
				t.Fatalf("verifyData error = %v, wantError %v", err, scenario.wantError)
			}
			if f.refreshes != scenario.wantRefreshes || f.catalogs != scenario.wantRefreshes {
				t.Fatalf("refreshes=%d catalogs=%d want=%d", f.refreshes, f.catalogs, scenario.wantRefreshes)
			}
			if f.refreshes == 1 && !f.force {
				t.Fatal("Stats refresh was not forced")
			}
		})
	}
}
