package homarr

import (
	"crypto/md5"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

func TestNavidromeStatsVerification(t *testing.T) {
	for _, scenario := range []struct {
		name          string
		change        func(*statsFixture, map[string]any, map[string]any, map[string]any)
		wantError     bool
		wantManual    bool
		wantRefreshes int
	}{
		{"independent populated samples", nil, false, false, 1},
		{"explicit zeros", func(f *statsFixture, _, native, stream map[string]any) {
			for key := range f.values {
				f.values[key] = float64(0)
			}
			for key := range native {
				native[key] = float64(0)
			}
			stream["sessions"] = []any{}
		}, false, false, 1},
		{"negative first sample", func(f *statsFixture, _, _, _ map[string]any) { f.values["songCount"] = float64(-1) }, true, false, 1},
		{"songs without an album", func(f *statsFixture, _, _, _ map[string]any) { f.values["albumCount"] = float64(0) }, true, false, 1},
		{"albums without artists", func(f *statsFixture, _, _, _ map[string]any) { f.values["artistCount"] = float64(0) }, true, false, 1},
		{"fractional count", func(f *statsFixture, _, _, _ map[string]any) { f.values["albumCount"] = 1.5 }, true, false, 1},
		{"album pagination limit", func(f *statsFixture, _, _, _ map[string]any) { f.values["albumCount"] = float64(10001) }, true, false, 1},
		{"missing count", func(f *statsFixture, _, _, _ map[string]any) { delete(f.values, "artistCount") }, true, false, 1},
		{"null count", func(f *statsFixture, _, _, _ map[string]any) { f.values["songCount"] = nil }, true, false, 1},
		{"wrong units", func(f *statsFixture, _, _, _ map[string]any) { f.metrics[0].(map[string]any)["unit"] = "seconds" }, true, false, 1},
		{"missing catalog metric", func(f *statsFixture, _, _, _ map[string]any) { f.metrics = f.metrics[1:] }, true, false, 0},
		{"no advancement", func(f *statsFixture, _, _, _ map[string]any) { f.advance = false }, true, false, 1},
		{"invalid timestamp", func(f *statsFixture, _, _, _ map[string]any) { f.afterRaw = "0" }, true, false, 1},
		{"saved administrator username", func(_ *statsFixture, identity, _, _ map[string]any) {
			identity["secrets"].([]any)[0].(map[string]any)["value"] = "admin"
		}, true, true, 0},
		{"wrong saved username", func(_ *statsFixture, identity, _, _ map[string]any) {
			identity["secrets"].([]any)[0].(map[string]any)["value"] = "other-user"
		}, true, true, 0},
		{"wrong saved destination", func(_ *statsFixture, identity, _, _ map[string]any) { identity["url"] = "http://other:4533" }, true, true, 0},
		{"wrong saved integration ID", func(_ *statsFixture, identity, _, _ map[string]any) { identity["id"] = "unowned" }, true, true, 0},
		{"missing native count", func(_ *statsFixture, _, native, _ map[string]any) { delete(native, "songCount") }, true, false, 0},
		{"fractional native count", func(_ *statsFixture, _, native, _ map[string]any) { native["songCount"] = 1.5 }, true, false, 0},
		{"missing sessions", func(_ *statsFixture, _, _, stream map[string]any) { delete(stream, "sessions") }, true, false, 0},
		{"missing session identifier", func(_ *statsFixture, _, _, stream map[string]any) {
			delete(stream["sessions"].([]any)[0].(map[string]any), "sessionId")
		}, true, false, 0},
		{"wrong stream integration", func(_ *statsFixture, _, _, stream map[string]any) { stream["integrationId"] = "other" }, true, false, 0},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			fixture.values = map[string]any{"artistCount": float64(4), "albumCount": float64(6), "songCount": float64(8)}
			fixture.metrics = []any{}
			for _, metric := range []string{"artistCount", "albumCount", "songCount"} {
				fixture.metrics = append(fixture.metrics, map[string]any{"key": metric, "unit": "count"})
			}
			identity := map[string]any{"id": "nav-owned", "kind": "navidrome", "url": "http://navidrome:4533", "secrets": []any{
				map[string]any{"kind": "username", "value": "self-host-homarr"}, map[string]any{"kind": "password", "value": nil},
			}}
			native := map[string]any{"artistCount": float64(1), "albumCount": float64(3), "songCount": float64(5)}
			stream := map[string]any{"integrationId": "nav-owned", "integrationKind": "navidrome", "error": nil, "sessions": []any{map[string]any{
				"sessionId": "admin-fixture-player", "user": map[string]any{"username": "admin"}, "currentlyPlaying": map[string]any{"type": "audio", "name": "Fixture track"},
			}}}
			if scenario.change != nil {
				scenario.change(fixture, identity, native, stream)
			}
			from, to := navidromeVerificationFixture(t, fixture, identity, native, stream)
			err := navidromeTarget().verifyData(t.Context(), from, to, "nav-owned")
			if (err != nil) != scenario.wantError || errors.Is(err, helpers.ErrManual) != scenario.wantManual {
				t.Fatalf("verifyData error=%v wantError=%v wantManual=%v", err, scenario.wantError, scenario.wantManual)
			}
			if fixture.refreshes != scenario.wantRefreshes || fixture.catalogs > 1 || fixture.refreshes > 0 && !fixture.force {
				t.Fatalf("refreshes=%d catalogs=%d force=%v", fixture.refreshes, fixture.catalogs, fixture.force)
			}
		})
	}
}

func navidromeVerificationFixture(t *testing.T, stats *statsFixture, identity, native, stream map[string]any) (*helpers.H, *helpers.H) {
	t.Helper()
	statsHelper := stats.helpers(t)
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/auth/login":
			var login struct{ Username, Password string }
			json.NewDecoder(r.Body).Decode(&login)
			if login.Username != "self-host-homarr" || login.Password != "fixture-password" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"id": "regular-owned", "username": "self-host-homarr", "isAdmin": false, "token": "fixture-user-token"})
			return
		case "/api/user/regular-owned":
			if r.Header.Get("X-ND-Authorization") != "Bearer fixture-user-token" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"id": "regular-owned", "userName": "self-host-homarr", "isAdmin": false, "libraries": []any{map[string]any{"id": 1}}})
			return
		case "/api/library":
			if r.Header.Get("X-ND-Authorization") != "Bearer fixture-user-token" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.WriteHeader(http.StatusForbidden)
			return
		}
		r.ParseForm()
		if r.Method != http.MethodPost || r.URL.RawQuery != "" || r.Form.Get("u") != "self-host-homarr" || r.Form.Get("p") != "" || r.Form.Get("s") == "" || r.Form.Get("t") != fmt.Sprintf("%x", md5.Sum([]byte("fixture-password"+r.Form.Get("s")))) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		body := map[string]any{"status": "ok", "version": "1.16.1", "type": "navidrome", "serverVersion": "0.64.0 (fixture)"}
		switch r.URL.Path {
		case "/rest/ping.view":
		case "/rest/getMusicFolders.view":
			body["musicFolders"] = map[string]any{"musicFolder": []any{map[string]any{"id": 1, "name": "Fixture music"}}}
		case "/rest/getScanStatus.view":
			body["scanStatus"] = map[string]any{"scanning": false, "count": 3, "lastScan": "2026-10-13T00:00:00Z"}
		case "/rest/getAlbumList2.view":
			if r.Form.Get("size") != "500" || r.Form.Get("offset") != "0" || r.Form.Get("type") != "alphabeticalByName" {
				t.Error("unexpected consumer album query")
			}
			w.Header().Set("X-Total-Count", "2")
			body["albumList2"] = map[string]any{"album": []any{map[string]any{"id": "album-one", "name": "First", "songCount": 1}, map[string]any{"id": "album-two", "name": "Second", "songCount": 2}}}
		case "/rest/getArtists.view":
			body["artists"] = map[string]any{"index": []any{map[string]any{"artist": []any{map[string]any{"id": "artist-one", "name": "Fixture artist"}}}}}
		case "/rest/getNowPlaying.view":
			body["nowPlaying"] = map[string]any{"entry": []any{map[string]any{"id": "track-one", "title": "Fixture track", "username": "admin", "playerName": "fixture-player"}}}
		default:
			w.WriteHeader(http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"subsonic-response": body})
	}))
	t.Cleanup(peer.Close)
	to := helpers.New(helpers.Config{App: "navidrome", BaseURL: peer.URL, HTTP: peer.Client(), Log: events.Discard(), Secrets: statsSecrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "fixture-admin-password", "NAVIDROME_HOMARR_USERNAME": "self-host-homarr", "NAVIDROME_HOMARR_PASSWORD": "fixture-password", "NAVIDROME_HOMARR_USER_ID": "regular-owned"}})
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
			value = identity
		case "/api/trpc/widget.audioStats.getStats":
			value = map[string]any{"kind": "navidrome", "data": native}
		case "/api/trpc/widget.mediaServer.getCurrentStreams":
			value = []any{stream}
		default:
			w.WriteHeader(http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
	}))
	t.Cleanup(homarr.Close)
	from := helpers.New(helpers.Config{App: "homarr", BaseURL: homarr.URL, HTTP: homarr.Client(), Log: events.Discard(), Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key", "HOMARR_LINKED_NAVIDROME": "nav-owned"}})
	return from, to
}

func TestNavidromeNativeCredentialRejectionBeforeStats(t *testing.T) {
	fixture := newStatsFixture()
	identity := map[string]any{"id": "nav-owned", "kind": "navidrome", "url": "http://navidrome:4533", "secrets": []any{
		map[string]any{"kind": "username", "value": "self-host-homarr"}, map[string]any{"kind": "password", "value": nil},
	}}
	from, to := navidromeVerificationFixture(t, fixture, identity, nil, nil)
	to.SetSecret(to.Key("homarr_password"), "rejected-fixture-password")
	if err := navidromeTarget().verifyData(t.Context(), from, to, "nav-owned"); err == nil {
		t.Fatal("accepted rejected Subsonic credentials")
	}
	if fixture.catalogs != 0 || fixture.refreshes != 0 {
		t.Fatalf("native credential failure acquired Stats: catalogs=%d refreshes=%d", fixture.catalogs, fixture.refreshes)
	}
}

func TestNavidromeHomarrSelectsRegularCredentials(t *testing.T) {
	fixture := newStatsFixture()
	identity := map[string]any{"id": "nav-owned", "kind": "navidrome", "url": "http://navidrome:4533", "secrets": []any{
		map[string]any{"kind": "username", "value": "self-host-homarr"}, map[string]any{"kind": "password", "value": nil},
	}}
	from, to := navidromeVerificationFixture(t, fixture, identity, nil, nil)
	credentials := navidromeTarget().secrets(from, to)
	if len(credentials) != 2 || credentials[0].Value != to.Secret(to.Key("homarr_username")) || credentials[1].Value != to.Secret(to.Key("homarr_password")) {
		t.Fatal("Homarr selected administrator credentials instead of the saved regular account")
	}
	if credentials[0].Value == to.AdminUser() || credentials[1].Value == to.AdminPassword() {
		t.Fatal("Homarr receives the shared administrator login")
	}
}

type navidromePrivacyTransport struct{ requests int }

func (transport *navidromePrivacyTransport) RoundTrip(*http.Request) (*http.Response, error) {
	transport.requests++
	return nil, errors.New("unexpected HTTP before Navidrome privacy hold")
}

func TestNavidromePrivacyHoldPrecedesAllRequests(t *testing.T) {
	for _, path := range []string{"add", "linked"} {
		t.Run(path, func(t *testing.T) {
			var messages []string
			log := events.New(events.SinkFunc(func(event events.Event) {
				if event.Event == events.Info {
					messages = append(messages, event.Msg)
				}
			}))
			homarrHTTP, providerHTTP := &navidromePrivacyTransport{}, &navidromePrivacyTransport{}
			from := helpers.New(helpers.Config{App: "homarr", BaseURL: "http://homarr.invalid", HTTP: &http.Client{Transport: homarrHTTP}, Log: log, Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key", "HOMARR_LINKED_NAVIDROME": "nav-owned"}})
			to := helpers.New(helpers.Config{App: "navidrome", BaseURL: "http://navidrome.invalid", HTTP: &http.Client{Transport: providerHTTP}, Log: log, Secrets: statsSecrets{"NAVIDROME_HOMARR_USERNAME": "self-host-homarr", "NAVIDROME_HOMARR_PASSWORD": "fixture-regular-password", "NAVIDROME_HOMARR_USER_ID": "regular-owned"}})
			descriptor := navidromeTarget()
			var err error
			if path == "add" {
				err = descriptor.add(t.Context(), from, to)
			} else {
				var linked bool
				linked, err = descriptor.linked(t.Context(), from, to)
				if linked {
					t.Fatal("privacy hold claimed a completed Link")
				}
			}
			if !errors.Is(err, helpers.ErrManual) || homarrHTTP.requests != 0 || providerHTTP.requests != 0 {
				t.Fatalf("privacy hold must precede all HTTP: manual=%v Homarr=%d provider=%d", errors.Is(err, helpers.ErrManual), homarrHTTP.requests, providerHTTP.requests)
			}
			message := strings.Join(messages, " ")
			if !strings.Contains(message, "#363") || !strings.Contains(message, "#7170") || !strings.Contains(message, "do not create a manual integration or bypass this hold") || !strings.Contains(message, "exact supported stable image") {
				t.Fatal("privacy hold lacks the upstream image prerequisite and no-bypass policy")
			}
		})
	}
}
