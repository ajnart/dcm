package homarr

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"testing"

	"github.com/ajnart/self-host/internal/helpers"
)

func TestTraefikStatsUseOneFreshSampleAfterProtectedAPI(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		change func(*statsFixture)
		valid  bool
	}{
		{"zero volatile counts", func(*statsFixture) {}, true},
		{"positive volatile counts", func(f *statsFixture) { f.values["routers"] = float64(7) }, true},
		{"negative count", func(f *statsFixture) { f.values["services"] = float64(-1) }, false},
		{"fractional count", func(f *statsFixture) { f.values["middlewares"] = 0.5 }, false},
		{"null count", func(f *statsFixture) { f.values["routers"] = nil }, false},
		{"missing count", func(f *statsFixture) { delete(f.values, "routers") }, false},
		{"wrong unit", func(f *statsFixture) { f.metrics[0].(map[string]any)["unit"] = "bytes" }, false},
		{"missing catalog metric", func(f *statsFixture) { f.metrics = f.metrics[:1] }, false},
		{"no-op refresh", func(f *statsFixture) { f.advance = false }, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			fixture.values = map[string]any{"routers": float64(0), "services": float64(0), "middlewares": float64(0)}
			fixture.metrics = []any{map[string]any{"key": "routers", "unit": "count"}, map[string]any{"key": "services", "unit": "count"}, map[string]any{"key": "middlewares", "unit": "count"}}
			scenario.change(fixture)
			from := traefikHomarrLeafFixture(t, fixture, false)
			to := traefikNativeLeafFixture(t, "1", http.StatusUnauthorized)
			err := traefikTarget().verifyData(t.Context(), from, to, "traefik-owned")
			if (err == nil) != scenario.valid {
				t.Fatalf("valid=%v, got %v", scenario.valid, err)
			}
			refreshes := 1
			if scenario.name == "missing catalog metric" {
				refreshes = 0
			}
			if fixture.catalogs != 1 || fixture.refreshes != refreshes {
				t.Fatalf("catalogs=%d refreshes=%d", fixture.catalogs, fixture.refreshes)
			}
			if scenario.valid && (fixture.refreshes != 1 || !fixture.force) {
				t.Fatal("valid counts must use one forced fresh sample")
			}
		})
	}
}

func TestTraefikNativeFailureStopsBeforeStats(t *testing.T) {
	for _, scenario := range []struct {
		name      string
		page      string
		anonymous int
		manual    bool
	}{
		{"another resource page", "2", http.StatusUnauthorized, true},
		{"invalid pagination", "invalid", http.StatusUnauthorized, false},
		{"anonymous API", "1", http.StatusOK, true},
		{"unsupported protection", "1", http.StatusForbidden, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			from := traefikHomarrLeafFixture(t, fixture, false)
			to := traefikNativeLeafFixture(t, scenario.page, scenario.anonymous)
			err := traefikTarget().verifyData(t.Context(), from, to, "traefik-owned")
			if err == nil || errors.Is(err, helpers.ErrManual) != scenario.manual || fixture.catalogs != 0 || fixture.refreshes != 0 {
				t.Fatalf("native failure reached Stats: err=%v catalogs=%d refreshes=%d", err, fixture.catalogs, fixture.refreshes)
			}
		})
	}
}

func TestTraefikDashboardFailureStopsBeforeStats(t *testing.T) {
	fixture := newStatsFixture()
	from := traefikHomarrLeafFixture(t, fixture, true)
	to := traefikNativeLeafFixture(t, "1", http.StatusUnauthorized)
	if err := traefikTarget().verifyData(t.Context(), from, to, "traefik-owned"); err == nil || fixture.catalogs != 0 || fixture.refreshes != 0 {
		t.Fatalf("failed dashboard reached Stats: err=%v catalogs=%d refreshes=%d", err, fixture.catalogs, fixture.refreshes)
	}
}

func traefikHomarrLeafFixture(t *testing.T, fixture *statsFixture, failed bool) *helpers.H {
	t.Helper()
	from := fixture.helpers(t)
	upstream, err := url.Parse(from.BaseURL)
	if err != nil {
		t.Fatal(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/trpc/widget.traefik.getDashboard" {
			proxy.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("ApiKey") != "fixture-key" || r.Method != http.MethodGet {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		dashboard := map[string]any{
			"version": "3.6.22", "failedEndpoints": []any{}, "entryPoints": []any{"health"},
			"resources": []any{map[string]any{"name": "selfhost-api@file", "protocol": "http", "type": "router", "status": "enabled"}},
		}
		if failed {
			dashboard["failedEndpoints"] = []any{"http/services"}
		}
		for _, protocol := range []string{"http", "tcp", "udp"} {
			group := map[string]any{}
			for _, kind := range []string{"routers", "services", "middlewares"} {
				group[kind] = map[string]any{"total": 1, "enabled": 1, "warnings": 0, "errors": 0}
			}
			dashboard[protocol] = group
		}
		value := []any{map[string]any{"integrationId": "traefik-owned", "error": nil, "dashboard": dashboard}}
		json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
	}))
	t.Cleanup(srv.Close)
	from.BaseURL, from.Config.HTTP = srv.URL, srv.Client()
	return from
}

func traefikNativeLeafFixture(t *testing.T, page string, anonymous int) *helpers.H {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if r.URL.Path == "/ping" {
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.Header.Get("Authorization") == "" {
			if r.URL.Path != "/api/version" {
				t.Error("Traefik attempted an anonymous resource probe")
			}
			w.Header().Set("WWW-Authenticate", `Basic realm="fixture"`)
			w.WriteHeader(anonymous)
			return
		}
		user, password, ok := r.BasicAuth()
		if !ok || user != "fixture-admin" || password != "fixture-password" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("X-Next-Page", page)
		switch r.URL.Path {
		case "/api/version":
			w.Write([]byte(`{"Version":"3.6.22"}`))
		case "/api/entrypoints":
			w.Write([]byte(`[{"name":"health"}]`))
		case "/api/http/routers":
			w.Write([]byte(`[{"name":"selfhost-api@file","provider":"file","status":"enabled","service":"api@internal","middlewares":["selfhost-auth@file"]}]`))
		case "/api/http/services":
			w.Write([]byte(`[{"name":"api@internal","provider":"internal","status":"enabled"}]`))
		case "/api/http/middlewares":
			w.Write([]byte(`[{"name":"selfhost-auth@file","provider":"file","status":"enabled","type":"basicauth"}]`))
		case "/api/tcp/routers", "/api/tcp/services", "/api/tcp/middlewares", "/api/udp/routers", "/api/udp/services":
			w.Write([]byte(`[]`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return helpers.New(helpers.Config{App: "traefik", BaseURL: srv.URL, HTTP: srv.Client(), Secrets: statsSecrets{"ADMIN_USER": "fixture-admin", "ADMIN_PASSWORD": "fixture-password"}})
}
