package homarr

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
)

type homeAssistantAuthFixture struct{ helpers.Executor }

func (homeAssistantAuthFixture) Exec(context.Context, string, map[string]string, ...string) (system.Result, error) {
	return system.Result{Stdout: []byte(`{"status":"ok","user_id":"fixture-user","token_id":"fixture-token-id"}`)}, nil
}

func TestHomeAssistantDescriptorVerifyData(t *testing.T) {
	for _, scenario := range []struct {
		name        string
		change      func(*statsFixture, map[string]any)
		wantError   bool
		wantRefresh int
	}{
		{"available changing entity and zero unavailable", func(*statsFixture, map[string]any) {}, false, 1},
		{"fractional count", func(f *statsFixture, _ map[string]any) { f.values["entities"] = 1.5 }, true, 1},
		{"negative count", func(f *statsFixture, _ map[string]any) { f.values["unavailable"] = -1.0 }, true, 1},
		{"unavailable exceeds entities", func(f *statsFixture, _ map[string]any) { f.values["unavailable"] = 3.0 }, true, 1},
		{"missing selected metric", func(f *statsFixture, _ map[string]any) { delete(f.values, "entities") }, true, 1},
		{"wrong units", func(f *statsFixture, _ map[string]any) { f.metrics[0].(map[string]any)["unit"] = "bytes" }, true, 1},
		{"no-op", func(f *statsFixture, _ map[string]any) { f.advance = false }, true, 1},
		{"wrong entity", func(_ *statsFixture, d map[string]any) { d["entity_id"] = "input_text.other" }, true, 0},
		{"unavailable entity", func(_ *statsFixture, d map[string]any) { d["state"] = "unavailable" }, true, 0},
		{"missing attributes", func(_ *statsFixture, d map[string]any) { delete(d, "attributes") }, true, 0},
		{"invalid timestamp", func(_ *statsFixture, d map[string]any) { d["last_updated"] = "invalid" }, true, 0},
		{"reversed timestamps", func(_ *statsFixture, d map[string]any) { d["last_changed"] = "1970-01-01T00:00:02Z" }, true, 0},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			fixture.values = map[string]any{"entities": 2.0, "unavailable": 0.0}
			fixture.metrics = []any{map[string]any{"key": "entities", "unit": "count"}, map[string]any{"key": "unavailable", "unit": "count"}}
			details := map[string]any{"entity_id": "input_text.fixture", "state": "new state", "attributes": map[string]any{}, "last_changed": "1970-01-01T00:00:00Z", "last_updated": "1970-01-01T00:00:01Z"}
			scenario.change(fixture, details)
			native := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer fixture-token" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				switch r.URL.Path {
				case "/api/config":
					json.NewEncoder(w).Encode(map[string]any{"version": "2026.9.3"})
				case "/api/states/input_text.fixture":
					json.NewEncoder(w).Encode(map[string]any{"entity_id": "input_text.fixture", "state": "previous state", "attributes": map[string]any{}, "last_changed": "1970-01-01T00:00:00Z", "last_updated": "1970-01-01T00:00:00Z"})
				default:
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer native.Close()
			homarr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var result any
				switch r.URL.Path {
				case "/api/boards":
					json.NewEncoder(w).Encode([]any{map[string]any{"name": "Home"}})
					return
				case "/api/trpc/board.getBoardByName":
					result = map[string]any{"items": []any{}}
				case "/api/trpc/widget.smartHome.entityDetails":
					result = details
				default:
					fixture.ServeHTTP(w, r)
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": result}}})
			}))
			defer homarr.Close()
			from := helpers.New(helpers.Config{App: "homarr", BaseURL: homarr.URL, HTTP: homarr.Client(), Log: events.Discard(), Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key"}, Now: func() time.Time { return time.UnixMilli(2000) }})
			to := helpers.New(helpers.Config{App: "home-assistant", BaseURL: native.URL, HTTP: native.Client(), Log: events.Discard(), Exec: homeAssistantAuthFixture{}, Secrets: statsSecrets{"HOME_ASSISTANT_HOMARR_TOKEN": "fixture-token", "HOME_ASSISTANT_HOMARR_USER_ID": "fixture-user", "HOME_ASSISTANT_HOMARR_TOKEN_ID": "fixture-token-id", "HOME_ASSISTANT_HOMARR_ENTITY_ID": "input_text.fixture"}})
			err := homeAssistantTarget().verifyData(t.Context(), from, to, "ha-owned")
			if (err != nil) != scenario.wantError {
				t.Fatalf("unexpected verification result: %v", err)
			}
			if fixture.refreshes != scenario.wantRefresh {
				t.Fatalf("refreshes=%d want %d: %v", fixture.refreshes, scenario.wantRefresh, err)
			}
			if fixture.refreshes > 0 && (!fixture.force || fixture.catalogs != 1 || fixture.integrationID != "ha-owned") {
				t.Fatal("descriptor did not use one owned forced Stats sample")
			}
		})
	}
}

func TestHomeAssistantPreflightKeepsMissingTokenManual(t *testing.T) {
	from := helpers.New(helpers.Config{App: "homarr", Log: events.Discard()})
	to := helpers.New(helpers.Config{App: "home-assistant", Log: events.Discard(), Secrets: statsSecrets{}})
	// Completed first-run state is required before token/entity verification.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/onboarding":
			w.WriteHeader(http.StatusNotFound)
		case "/auth/login_flow":
			json.NewEncoder(w).Encode(map[string]any{"type": "form", "flow_id": "fixture-flow"})
		case "/auth/login_flow/fixture-flow":
			json.NewEncoder(w).Encode(map[string]any{"type": "create_entry", "result": "fixture-code"})
		default:
			w.WriteHeader(http.StatusUnauthorized)
		}
	}))
	defer srv.Close()
	to.BaseURL = srv.URL
	if err := homeAssistantTarget().preflight(t.Context(), from, to); !errors.Is(err, helpers.ErrManual) {
		t.Fatalf("missing token should remain Manual: %v", err)
	}
}
