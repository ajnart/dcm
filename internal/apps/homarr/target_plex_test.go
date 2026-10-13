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

func TestPlexDescriptorVerifyData(t *testing.T) {
	for _, scenario := range []struct {
		name      string
		change    func(*statsFixture)
		wantError bool
	}{
		{"authenticated zero", nil, false},
		{"independent playback count", func(f *statsFixture) { f.values["sessions"] = float64(3) }, false},
		{"invalid first sample", func(f *statsFixture) { f.values["sessions"] = float64(-1) }, true},
		{"fractional count", func(f *statsFixture) { f.values["sessions"] = 0.5 }, true},
		{"wrong unit", func(f *statsFixture) { f.metrics = []any{map[string]any{"key": "sessions", "unit": "bytes"}} }, true},
		{"missing count", func(f *statsFixture) { delete(f.values, "sessions") }, true},
		{"null count", func(f *statsFixture) { f.values["sessions"] = nil }, true},
		{"no-op refresh", func(f *statsFixture) { f.advance = false }, true},
		{"advancing but old", func(f *statsFixture) { f.timestamp = 900 }, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			fixture.values = map[string]any{"sessions": float64(0)}
			fixture.metrics = []any{map[string]any{"key": "sessions", "unit": "count"}}
			if scenario.change != nil {
				scenario.change(fixture)
			}
			from, to := plexDescriptorHelpers(t, fixture, "", true)
			err := plexTarget().verifyData(t.Context(), from, to, "plex-owned")
			if (err != nil) != scenario.wantError {
				t.Fatalf("verifyData: %v", err)
			}
			if fixture.refreshes != 1 || fixture.catalogs != 1 || !fixture.force || fixture.integrationID != "plex-owned" {
				t.Fatalf("expected exactly one owned forced refresh: %+v", fixture)
			}
		})
	}
}

func TestPlexDescriptorRejectsNativeDataBeforeStats(t *testing.T) {
	for _, failure := range []string{"account", "authentication", "session", "user", "release", "integration", "source error"} {
		t.Run(failure, func(t *testing.T) {
			fixture := newStatsFixture()
			from, to := plexDescriptorHelpers(t, fixture, failure, failure != "account")
			err := plexTarget().verifyData(t.Context(), from, to, "plex-owned")
			if err == nil || fixture.catalogs != 0 || fixture.refreshes != 0 {
				t.Fatalf("native failure reached Stats: %v", err)
			}
			if failure == "account" && !errors.Is(err, helpers.ErrManual) {
				t.Fatalf("account prerequisite must stay Manual: %v", err)
			}
		})
	}
}

func plexDescriptorHelpers(t *testing.T, fixture *statsFixture, failure string, owned bool) (*helpers.H, *helpers.H) {
	t.Helper()
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/identity" {
			json.NewEncoder(w).Encode(map[string]any{"MediaContainer": map[string]any{"machineIdentifier": "fixture-machine", "claimed": true}})
			return
		}
		if r.Header.Get("X-Plex-Token") != "fixture-server-token" || failure == "authentication" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"MediaContainer": map[string]any{"size": 0}})
	}))
	t.Cleanup(peer.Close)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("ApiKey") != "fixture-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var value any
		switch r.URL.Path {
		case "/api/trpc/widget.mediaServer.getCurrentStreams":
			sessions := []any{}
			if failure == "session" || failure == "user" {
				session := map[string]any{"sessionId": "native-session", "user": map[string]any{"userId": "native-user"}}
				if failure == "session" {
					session["sessionId"] = "unknown"
				}
				if failure == "user" {
					session["user"] = map[string]any{"userId": "Anonymous"}
				}
				sessions = append(sessions, session)
			}
			stream := map[string]any{"integrationId": "plex-owned", "integrationKind": "plex", "sessions": sessions}
			if failure == "source error" {
				stream["error"] = "unavailable"
			}
			value = []any{stream}
		case "/api/trpc/widget.mediaRelease.getMediaReleases":
			items := []any{}
			if failure == "release" || failure == "integration" {
				release := map[string]any{"id": "native-item", "title": "Fixture", "integration": map[string]any{"id": "plex-owned", "kind": "plex"}}
				if failure == "release" {
					delete(release, "id")
				}
				if failure == "integration" {
					release["integration"] = map[string]any{"id": "other", "kind": "plex"}
				}
				items = append(items, release)
			}
			value = map[string]any{"failedIntegrations": []any{}, "releases": items}
		default:
			fixture.ServeHTTP(w, r)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
	}))
	t.Cleanup(server.Close)
	from := helpers.New(helpers.Config{App: "homarr", BaseURL: server.URL, HTTP: server.Client(), Log: events.Discard(), Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key"}, Now: func() time.Time { return time.UnixMilli(1000) }})
	inputs := map[string]string{}
	if owned {
		inputs["verified_server_id"] = "fixture-machine"
	}
	to := helpers.New(helpers.Config{App: "plex", BaseURL: peer.URL, HTTP: peer.Client(), Log: events.Discard(), Inputs: inputs, Secrets: statsSecrets{"PLEX_API_KEY": "fixture-server-token", "PLEX_SERVER_ID": "fixture-machine"}})
	return from, to
}
