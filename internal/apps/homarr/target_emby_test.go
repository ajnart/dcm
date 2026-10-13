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
)

type embyNativeFixture struct {
	status   int
	version  string
	users    any
	streams  any
	releases any
}

func newEmbyNativeFixture() *embyNativeFixture {
	return &embyNativeFixture{
		status: http.StatusOK, version: "4.10.0.40", users: []any{map[string]any{"Id": "user-1", "Name": "admin"}},
		streams: []any{map[string]any{"integrationId": "emby-owned", "integrationKind": "emby", "sessions": []any{map[string]any{
			"sessionId": "session-1", "user": map[string]any{"userId": "user-1", "username": "", "profilePictureUrl": nil}, "currentlyPlaying": nil,
		}}}},
		releases: map[string]any{"releases": []any{map[string]any{
			"id": "item-1", "title": "Release", "type": "movie", "releaseDate": "2026-10-13T00:00:00Z",
			"integration": map[string]any{"id": "emby-owned", "kind": "emby"},
		}}, "failedIntegrations": []any{}},
	}
}

func (f *embyNativeFixture) peer(t *testing.T) *helpers.H {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Emby-Token") != "fixture-emby-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(f.status)
		switch r.URL.Path {
		case "/emby/System/Info":
			json.NewEncoder(w).Encode(map[string]any{"Id": "server-1", "Version": f.version})
		case "/Auth/Keys":
			w.Write([]byte(`{"Items":[{"AccessToken":"fixture-emby-key","AppName":"self-host Homarr","IsActive":true}],"TotalRecordCount":1}`))
		case "/emby/Sessions":
			w.Write([]byte(`[{"Id":"session-1"}]`))
		case "/Users/Public":
			json.NewEncoder(w).Encode(f.users)
		case "/Users/user-1/Items/Latest":
			w.Write([]byte(`[{"Id":"item-1"}]`))
		default:
			t.Errorf("unexpected native request %s", r.URL.Path)
		}
	}))
	t.Cleanup(srv.Close)
	return helpers.New(helpers.Config{App: "emby", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(), Secrets: statsSecrets{"EMBY_HOMARR_API_KEY": "fixture-emby-key"}})
}

func (f *embyNativeFixture) homarr(t *testing.T, stats *statsFixture) *helpers.H {
	t.Helper()
	h := stats.helpers(t)
	endpoint, err := url.Parse(h.BaseURL)
	if err != nil {
		t.Fatal(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(endpoint)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var value any
		switch r.URL.Path {
		case "/api/trpc/widget.mediaServer.getCurrentStreams":
			value = f.streams
		case "/api/trpc/widget.mediaRelease.getMediaReleases":
			value = f.releases
		default:
			proxy.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("ApiKey") != "fixture-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
	}))
	t.Cleanup(srv.Close)
	h.BaseURL, h.Config.HTTP = srv.URL, srv.Client()
	return h
}

func (f *embyNativeFixture) stream() map[string]any { return f.streams.([]any)[0].(map[string]any) }
func (f *embyNativeFixture) session() map[string]any {
	return f.stream()["sessions"].([]any)[0].(map[string]any)
}
func (f *embyNativeFixture) release() map[string]any {
	return f.releases.(map[string]any)["releases"].([]any)[0].(map[string]any)
}

func TestEmbyVerifyDataUsesOneSemanticStatsSample(t *testing.T) {
	for _, scenario := range []struct {
		name          string
		change        func(*statsFixture, *embyNativeFixture)
		wantError     bool
		wantRefreshes int
	}{
		{"independently refreshed zero sessions", nil, false, 1},
		{"populated count", func(f *statsFixture, _ *embyNativeFixture) { f.values["sessions"] = 3 }, false, 1},
		{"first invalid sample", func(f *statsFixture, _ *embyNativeFixture) { f.values["sessions"] = -1 }, true, 1},
		{"fractional count", func(f *statsFixture, _ *embyNativeFixture) { f.values["sessions"] = 0.5 }, true, 1},
		{"null count", func(f *statsFixture, _ *embyNativeFixture) { f.values["sessions"] = nil }, true, 1},
		{"missing count", func(f *statsFixture, _ *embyNativeFixture) { delete(f.values, "sessions") }, true, 1},
		{"wrong unit", func(f *statsFixture, _ *embyNativeFixture) { f.metrics[0].(map[string]any)["unit"] = "bytes" }, true, 1},
		{"cached no-op", func(f *statsFixture, _ *embyNativeFixture) { f.advance = false }, true, 1},
		{"empty native media and sessions", func(_ *statsFixture, n *embyNativeFixture) {
			n.stream()["sessions"] = []any{}
			n.releases.(map[string]any)["releases"] = []any{}
		}, false, 1},
		{"nullable playback metadata", func(_ *statsFixture, n *embyNativeFixture) {
			n.session()["currentlyPlaying"] = map[string]any{"type": "movie", "name": "", "metadata": nil, "playback": map[string]any{"state": "playing", "positionMs": nil, "durationMs": nil}}
		}, false, 1},
		{"native auth rejected", func(_ *statsFixture, n *embyNativeFixture) { n.status = http.StatusUnauthorized }, true, 0},
		{"unsupported server version", func(_ *statsFixture, n *embyNativeFixture) { n.version = "4.9.0.0" }, true, 0},
		{"manual public user prerequisite", func(_ *statsFixture, n *embyNativeFixture) { n.users = []any{} }, true, 0},
		{"wrong session source", func(_ *statsFixture, n *embyNativeFixture) { n.stream()["integrationId"] = "other" }, true, 0},
		{"wrong session kind", func(_ *statsFixture, n *embyNativeFixture) { n.stream()["integrationKind"] = "jellyfin" }, true, 0},
		{"session source failed", func(_ *statsFixture, n *embyNativeFixture) { n.stream()["error"] = "unavailable" }, true, 0},
		{"missing session identity", func(_ *statsFixture, n *embyNativeFixture) { delete(n.session(), "sessionId") }, true, 0},
		{"missing user identity", func(_ *statsFixture, n *embyNativeFixture) { delete(n.session()["user"].(map[string]any), "userId") }, true, 0},
		{"missing playback data", func(_ *statsFixture, n *embyNativeFixture) { delete(n.session(), "currentlyPlaying") }, true, 0},
		{"invalid playback timing", func(_ *statsFixture, n *embyNativeFixture) {
			n.session()["currentlyPlaying"] = map[string]any{"playback": map[string]any{"positionMs": -1, "durationMs": nil}}
		}, true, 0},
		{"release failure", func(_ *statsFixture, n *embyNativeFixture) {
			n.releases.(map[string]any)["failedIntegrations"] = []any{map[string]any{"integrationId": "emby-owned"}}
		}, true, 0},
		{"missing media identity", func(_ *statsFixture, n *embyNativeFixture) { delete(n.release(), "id") }, true, 0},
		{"wrong media source", func(_ *statsFixture, n *embyNativeFixture) {
			n.release()["integration"].(map[string]any)["id"] = "other"
		}, true, 0},
		{"invalid release date", func(_ *statsFixture, n *embyNativeFixture) { n.release()["releaseDate"] = "invalid" }, true, 0},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			f := newStatsFixture()
			f.values = map[string]any{"sessions": 0}
			f.metrics = []any{map[string]any{"key": "sessions", "unit": "count"}}
			n := newEmbyNativeFixture()
			if scenario.change != nil {
				scenario.change(f, n)
			}
			err := embyTarget().verifyData(t.Context(), n.homarr(t, f), n.peer(t), "emby-owned")
			if (err != nil) != scenario.wantError {
				t.Fatalf("verifyData error=%v, wantError=%v", err, scenario.wantError)
			}
			if scenario.name == "manual public user prerequisite" && !errors.Is(err, helpers.ErrManual) {
				t.Fatalf("user prerequisite must remain Manual: %v", err)
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
