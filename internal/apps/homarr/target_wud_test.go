package homarr

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

func TestWUDDescriptorVerifyData(t *testing.T) {
	for _, scenario := range []struct {
		name        string
		change      func(*statsFixture, map[string]any)
		wantError   bool
		wantRefresh int
	}{
		{"changing counts and nullable update fields", func(*statsFixture, map[string]any) {}, false, 1},
		{"legitimate zero updates", func(f *statsFixture, d map[string]any) {
			f.values["updatesAvailable"] = 0.0
			s := d["stats"].(map[string]any)
			s["updatesAvailable"] = 0.0
			s["updates"] = []any{}
		}, false, 1},
		{"fractional count", func(f *statsFixture, _ map[string]any) { f.values["totalContainers"] = 1.5 }, true, 1},
		{"negative count", func(f *statsFixture, _ map[string]any) { f.values["updatesAvailable"] = -1.0 }, true, 1},
		{"updates exceed total", func(f *statsFixture, _ map[string]any) { f.values["updatesAvailable"] = 3.0 }, true, 1},
		{"null count", func(f *statsFixture, _ map[string]any) { f.values["totalContainers"] = nil }, true, 1},
		{"wrong units", func(f *statsFixture, _ map[string]any) { f.metrics[0].(map[string]any)["unit"] = "bytes" }, true, 1},
		{"no-op", func(f *statsFixture, _ map[string]any) { f.advance = false }, true, 1},
		{"before request", func(f *statsFixture, _ map[string]any) { f.timestamp = 1000 }, true, 1},
		{"after completion skew", func(f *statsFixture, _ map[string]any) { f.timestamp = 49000 }, true, 1},
		{"invalid native timestamp", func(_ *statsFixture, d map[string]any) { d["updatedAt"] = "invalid" }, true, 0},
		{"stale native timestamp", func(_ *statsFixture, d map[string]any) { d["updatedAt"] = "1969-12-31T23:59:00Z" }, true, 0},
		{"missing native version", func(_ *statsFixture, d map[string]any) {
			delete(d["stats"].(map[string]any)["updates"].([]any)[0].(map[string]any), "currentVersion")
		}, true, 0},
		{"malformed native version", func(_ *statsFixture, d map[string]any) {
			d["stats"].(map[string]any)["updates"].([]any)[0].(map[string]any)["newVersion"] = 42.0
		}, true, 0},
		{"missing native update identity", func(_ *statsFixture, d map[string]any) {
			d["stats"].(map[string]any)["updates"].([]any)[0].(map[string]any)["id"] = ""
		}, true, 0},
		{"native update count mismatch", func(_ *statsFixture, d map[string]any) { d["stats"].(map[string]any)["updatesAvailable"] = 0.0 }, true, 0},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			fixture.timestamp = 45000
			fixture.values = map[string]any{"totalContainers": 2.0, "updatesAvailable": 1.0}
			fixture.metrics = []any{map[string]any{"key": "totalContainers", "unit": "count"}, map[string]any{"key": "updatesAvailable", "unit": "count"}}
			details := map[string]any{"updatedAt": "1970-01-01T00:00:02Z", "stats": map[string]any{"totalContainers": 1.0, "updatesAvailable": 1.0, "updates": []any{map[string]any{"id": "fixture-container", "name": "fixture image", "currentVersion": nil, "newVersion": "v2", "link": nil}}}}
			scenario.change(fixture, details)
			native := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				user, pass, ok := r.BasicAuth()
				if !ok || user != "fixture-admin" || pass != "fixture-password" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				switch r.URL.Path {
				case "/auth/user":
					json.NewEncoder(w).Encode(map[string]any{"username": "fixture-admin", "role": "admin"})
				case "/api/containers":
					json.NewEncoder(w).Encode([]any{map[string]any{"id": "fixture-container", "name": "fixture image", "watcher": "approved", "updateAvailable": false}})
				default:
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer native.Close()
			homarr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/trpc/widget.wud.getStats" {
					json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": details}}})
					return
				}
				fixture.ServeHTTP(w, r)
			}))
			defer homarr.Close()
			from := helpers.New(helpers.Config{App: "homarr", BaseURL: homarr.URL, HTTP: homarr.Client(), Log: events.Discard(), Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key"}, Now: func() time.Time {
				if fixture.refreshes == 0 {
					return time.UnixMilli(2000)
				}
				return time.UnixMilli(47000)
			}})
			to := helpers.New(helpers.Config{App: "wud", BaseURL: native.URL, HTTP: native.Client(), Log: events.Discard(), Secrets: statsSecrets{"ADMIN_USER": "fixture-admin", "ADMIN_PASSWORD": "fixture-password"}})
			err := wudTarget().verifyData(t.Context(), from, to, "wud-owned")
			if (err != nil) != scenario.wantError {
				t.Fatalf("unexpected verification result: %v", err)
			}
			if fixture.refreshes != scenario.wantRefresh {
				t.Fatalf("refreshes=%d want %d: %v", fixture.refreshes, scenario.wantRefresh, err)
			}
			if fixture.refreshes > 0 && (!fixture.force || fixture.catalogs != 1 || fixture.integrationID != "wud-owned") {
				t.Fatal("descriptor did not use one owned forced Stats sample")
			}
		})
	}
}

func TestWUDPreflightKeepsTLSPrerequisitesManual(t *testing.T) {
	from := helpers.New(helpers.Config{App: "homarr", Log: events.Discard()})
	to := helpers.New(helpers.Config{App: "wud", Log: events.Discard(), Inputs: map[string]string{}})
	if err := wudTarget().preflight(t.Context(), from, to); !errors.Is(err, helpers.ErrManual) {
		t.Fatalf("missing approved TLS endpoint should remain Manual: %v", err)
	}
}
