package homarr

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/status"
)

type lidarrNativeFixture struct {
	status               int
	version              string
	authenticationMethod string
	artists              any
	calendar             any
}

func newLidarrNativeFixture() *lidarrNativeFixture {
	return &lidarrNativeFixture{
		status: http.StatusOK, version: "3.1.0.4875", authenticationMethod: "forms",
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
			json.NewEncoder(w).Encode(map[string]any{"id": 1, "authenticationMethod": f.authenticationMethod, "authenticationRequired": "enabled", "username": "admin", "password": "", "passwordConfirmation": "", "apiKey": "fixture-lidarr-key"})
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

func TestLidarrManualPrerequisitesStopBeforeHomarr(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		change func(*lidarrNativeFixture)
		manual bool
	}{
		{"unsupported version drift", func(f *lidarrNativeFixture) { f.version = "4.0.0.1" }, true},
		{"external authentication drift", func(f *lidarrNativeFixture) { f.authenticationMethod = "external" }, true},
		{"rejected API key remains failed", func(f *lidarrNativeFixture) { f.status = http.StatusUnauthorized }, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			native := newLidarrNativeFixture()
			scenario.change(native)
			peer := native.peer(t)
			requests := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				w.WriteHeader(http.StatusNotFound)
			}))
			t.Cleanup(srv.Close)
			var recorded []helpers.StepResult
			from := helpers.New(helpers.Config{
				App: "homarr", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(),
				Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key"},
				Record:  func(result helpers.StepResult) { recorded = append(recorded, result) },
			})
			descriptor := lidarrTarget()
			err := descriptor.verifyData(t.Context(), from, peer, "lidarr-owned")
			if err == nil || errors.Is(err, helpers.ErrManual) != scenario.manual {
				t.Errorf("native verification must preserve Manual classification=%v: %v", scenario.manual, err)
			}
			err = descriptor.link().Apply(t.Context(), from, peer)
			if err == nil || errors.Is(err, helpers.ErrManual) != scenario.manual || errors.Is(err, helpers.ErrStepFailed) == scenario.manual {
				t.Errorf("Link must retain Manual/failed classification=%v: %v", scenario.manual, err)
			}
			wantStatus := status.StepFail
			if scenario.manual {
				wantStatus = status.StepManual
			}
			if len(recorded) != 1 || recorded[0].Status != wantStatus {
				t.Errorf("Link recorded %v, want one %s step", recorded, wantStatus)
			}
			if requests != 0 {
				t.Errorf("known App prerequisite reached Homarr %d times; want zero requests before resource work", requests)
			}
		})
	}
}
