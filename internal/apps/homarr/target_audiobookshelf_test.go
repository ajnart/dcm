package homarr

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

func TestAudiobookshelfStatsVerification(t *testing.T) {
	for _, scenario := range []struct {
		name          string
		change        func(*statsFixture, map[string]any, map[string]any)
		wantError     bool
		wantRefreshes int
	}{
		{"independent populated samples", nil, false, 1},
		{"explicit zeros", func(f *statsFixture, native, library map[string]any) {
			for key := range f.values {
				f.values[key] = float64(0)
			}
			native["totalAudiobooks"] = float64(0)
			native["activeSessions"] = float64(0)
			native["libraryCount"] = float64(0)
			native["libraries"] = []any{}
			library["totalItems"] = float64(0)
		}, false, 1},
		{"negative first sample", func(f *statsFixture, _, _ map[string]any) { f.values["activeSessions"] = float64(-1) }, true, 1},
		{"media without a library", func(f *statsFixture, _, _ map[string]any) { f.values["libraryCount"] = float64(0) }, true, 1},
		{"fractional count", func(f *statsFixture, _, _ map[string]any) { f.values["totalAudiobooks"] = 1.5 }, true, 1},
		{"missing count", func(f *statsFixture, _, _ map[string]any) { delete(f.values, "totalPodcasts") }, true, 1},
		{"null count", func(f *statsFixture, _, _ map[string]any) { f.values["libraryCount"] = nil }, true, 1},
		{"wrong units", func(f *statsFixture, _, _ map[string]any) { f.metrics[0].(map[string]any)["unit"] = "seconds" }, true, 1},
		{"missing catalog metric", func(f *statsFixture, _, _ map[string]any) { f.metrics = f.metrics[1:] }, true, 0},
		{"no advancement", func(f *statsFixture, _, _ map[string]any) { f.advance = false }, true, 1},
		{"invalid timestamp", func(f *statsFixture, _, _ map[string]any) { f.afterRaw = "0" }, true, 1},
		{"wrong library identity", func(_ *statsFixture, _, library map[string]any) { library["id"] = "unknown-library" }, true, 0},
		{"missing native listening", func(_ *statsFixture, native, _ map[string]any) { delete(native, "totalListeningTimeSeconds") }, true, 0},
		{"missing nullable field", func(_ *statsFixture, _, library map[string]any) { delete(library, "totalSizeBytes") }, true, 0},
		{"fractional library size", func(_ *statsFixture, _, library map[string]any) { library["totalSizeBytes"] = 1.5 }, true, 0},
		{"negative duration", func(_ *statsFixture, _, library map[string]any) { library["totalDurationSeconds"] = float64(-1) }, true, 0},
		{"inconsistent native total", func(_ *statsFixture, native, _ map[string]any) { native["totalAudiobooks"] = float64(11) }, true, 0},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			fixture.values = map[string]any{"libraryCount": float64(1), "totalAudiobooks": float64(7), "totalPodcasts": float64(0), "activeSessions": float64(3)}
			fixture.metrics = []any{}
			for _, metric := range []string{"libraryCount", "totalAudiobooks", "totalPodcasts", "activeSessions"} {
				fixture.metrics = append(fixture.metrics, map[string]any{"key": metric, "unit": "count"})
			}
			library := map[string]any{"id": "book-library", "name": "Books", "mediaType": "book", "totalItems": float64(10), "totalDurationSeconds": nil, "totalSizeBytes": nil}
			native := map[string]any{"libraryCount": float64(1), "totalAudiobooks": float64(10), "totalPodcasts": float64(0), "activeSessions": float64(1), "totalListeningTimeSeconds": 1.5, "libraries": []any{library}}
			if scenario.change != nil {
				scenario.change(fixture, native, library)
			}
			from, to := audiobookshelfVerificationFixture(t, fixture, native)
			if err := audiobookshelfTarget().verifyData(t.Context(), from, to, "abs-owned"); (err != nil) != scenario.wantError {
				t.Fatalf("verifyData error = %v, wantError=%v", err, scenario.wantError)
			}
			if fixture.refreshes != scenario.wantRefreshes || fixture.catalogs > 1 || fixture.refreshes > 0 && !fixture.force {
				t.Fatalf("refreshes=%d catalogs=%d force=%v", fixture.refreshes, fixture.catalogs, fixture.force)
			}
		})
	}
}

func audiobookshelfVerificationFixture(t *testing.T, stats *statsFixture, native map[string]any) (*helpers.H, *helpers.H) {
	t.Helper()
	statsHelper := stats.helpers(t)
	user := map[string]any{"id": "abs-user", "username": "self-host-homarr", "type": "admin", "isActive": true, "permissions": map[string]bool{
		"download": false, "update": false, "delete": false, "upload": false, "createEreader": false,
		"accessAllLibraries": true, "accessAllTags": true, "accessExplicitContent": true, "selectedTagsNotAccessible": false,
	}}
	key := "synthetic." + base64.RawURLEncoding.EncodeToString([]byte(`{"type":"api","keyId":"abs-key","name":"self-host Homarr"}`)) + ".synthetic"
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+key {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var value any
		switch r.URL.Path {
		case "/api/authorize":
			value = map[string]any{"user": user}
		case "/api/libraries":
			libraries := []any{map[string]any{"id": "book-library", "name": "Books", "mediaType": "book"}}
			if len(native["libraries"].([]any)) == 0 {
				libraries = []any{}
			}
			value = map[string]any{"libraries": libraries}
		case "/api/libraries/book-library/stats":
			value = map[string]any{"totalItems": 2}
		case "/api/me/listening-stats":
			value = map[string]any{"totalTime": 0}
		case "/api/users/online":
			value = map[string]any{"openSessions": []any{}}
		default:
			w.WriteHeader(http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(value)
	}))
	t.Cleanup(peer.Close)
	to := helpers.New(helpers.Config{App: "audiobookshelf", BaseURL: peer.URL, HTTP: peer.Client(), Log: events.Discard(), Secrets: statsSecrets{
		"AUDIOBOOKSHELF_API_KEY": key, "AUDIOBOOKSHELF_HOMARR_USER_ID": "abs-user", "AUDIOBOOKSHELF_HOMARR_API_KEY_ID": "abs-key",
	}})
	homarr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("ApiKey") != "fixture-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/trpc/widget.stats.") {
			request, err := http.NewRequestWithContext(r.Context(), r.Method, statsHelper.BaseURL+r.URL.RequestURI(), r.Body)
			if err != nil {
				t.Error(err)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			request.Header = r.Header.Clone()
			response, err := statsHelper.Config.HTTP.Do(request)
			if err != nil {
				t.Error(err)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			defer response.Body.Close()
			w.WriteHeader(response.StatusCode)
			io.Copy(w, response.Body)
			return
		}
		var value any
		switch r.URL.Path {
		case "/api/trpc/integration.byId":
			value = map[string]any{"id": "abs-owned", "kind": "audiobookshelf", "url": "http://audiobookshelf:80"}
		case "/api/trpc/integration.request":
			var input struct {
				JSON struct {
					IntegrationID string `json:"integrationId"`
					Method        string `json:"method"`
					Path          string `json:"path"`
				} `json:"json"`
			}
			if json.NewDecoder(r.Body).Decode(&input) != nil || input.JSON.IntegrationID != "abs-owned" || input.JSON.Method != http.MethodPost || input.JSON.Path != "/api/authorize" {
				t.Error("unexpected saved credential authorization request")
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			value = map[string]any{"ok": true, "status": 200, "integration": map[string]any{"id": "abs-owned", "kind": "audiobookshelf"}, "data": map[string]any{"user": user}}
		case "/api/trpc/widget.audioStats.getStats":
			value = map[string]any{"kind": "audiobookshelf", "data": native}
		default:
			w.WriteHeader(http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
	}))
	t.Cleanup(homarr.Close)
	from := helpers.New(helpers.Config{App: "homarr", BaseURL: homarr.URL, HTTP: homarr.Client(), Log: events.Discard(), Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key", "HOMARR_LINKED_AUDIOBOOKSHELF": "abs-owned"}})
	return from, to
}

func TestAudiobookshelfNativeCredentialRejectionBeforeStats(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		change func(*helpers.H, *helpers.H)
	}{
		{"lost owned integration", func(from, _ *helpers.H) { from.SetSecret(from.Key("linked_audiobookshelf"), "other") }},
		{"rejected persistent key", func(_, to *helpers.H) {
			to.SetSecret(to.Key("api_key"), "rejected."+strings.Split(to.Secret(to.Key("api_key")), ".")[1]+".synthetic")
		}},
		{"wrong owned account", func(_, to *helpers.H) { to.SetSecret(to.Key("homarr_user_id"), "other-user") }},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			from, to := audiobookshelfVerificationFixture(t, fixture, nil)
			scenario.change(from, to)
			if err := audiobookshelfTarget().verifyData(t.Context(), from, to, "abs-owned"); err == nil {
				t.Fatal("accepted unavailable owned credentials")
			}
			if fixture.catalogs != 0 || fixture.refreshes != 0 {
				t.Fatalf("native credential failure acquired Stats: catalogs=%d refreshes=%d", fixture.catalogs, fixture.refreshes)
			}
		})
	}
}
