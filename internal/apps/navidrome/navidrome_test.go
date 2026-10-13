package navidrome_test

import (
	"context"
	"crypto/md5"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/apps/navidrome"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

type recorder struct{ steps []helpers.StepResult }

func (r *recorder) record(step helpers.StepResult) { r.steps = append(r.steps, step) }

func (r *recorder) status(id string) stepstatus.Step {
	for _, step := range r.steps {
		if step.ID == id {
			return step.Status
		}
	}
	return ""
}

func (r *recorder) hint() string {
	for _, step := range r.steps {
		if step.Status == stepstatus.StepFail {
			return step.Hint
		}
	}
	return ""
}

type fakeNavidrome struct {
	mu                  sync.Mutex
	password            string
	homarrPassword      string
	homarrCreates       int
	homarrAdmin         bool
	homarrLibraryDenied bool
	homarrMissingRole   bool
	homarrNoLibraries   bool
	lostCreateResponse  bool
	adminSubsonicCalls  int
	loginLimit          int
	logins, creates     int
	window              time.Time
	now                 func() time.Time
	subsonicCalls       int
	albumCount          int
	inaccessibleSongs   int
	artistShape         string
	albumPages          int
	samplePages         int
	malformedAlbum      bool
}

func (f *fakeNavidrome) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("POST /auth/login", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.loginLimit > 0 {
			if f.window.IsZero() || f.now().Sub(f.window) >= 20*time.Second {
				f.window = f.now()
				f.logins = 0
			}
			f.logins++
			if f.logins > f.loginLimit {
				w.Header().Set("Retry-After", "20")
				w.WriteHeader(http.StatusTooManyRequests)
				return
			}
		}
		var body struct{ Username, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if body.Username == "self-host-homarr" && f.homarrPassword != "" && body.Password == f.homarrPassword {
			json.NewEncoder(w).Encode(map[string]any{"username": "self-host-homarr", "isAdmin": f.homarrAdmin, "id": "regular-owned", "token": "regular-token"})
			return
		}
		if body.Username != "admin" || f.password == "" || body.Password != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"username": "admin", "isAdmin": true, "id": "abc", "token": "a.b.c"})
	})
	mux.HandleFunc("POST /auth/createAdmin", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.creates++
		if f.password != "" {
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]string{"error": "Cannot create another first admin"})
			return
		}
		var body struct{ Username, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		f.password = body.Password
		json.NewEncoder(w).Encode(map[string]any{"username": "admin", "isAdmin": true, "id": "abc", "token": "a.b.c"})
	})
	mux.HandleFunc("POST /api/user", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("X-ND-Authorization") != "Bearer a.b.c" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		var body struct {
			Username string `json:"userName"`
			Name     string `json:"name"`
			Password string `json:"password"`
			IsAdmin  bool   `json:"isAdmin"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.Username != "self-host-homarr" || body.Password == "" || body.Name == "" || body.IsAdmin {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if f.homarrPassword != "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.homarrPassword = body.Password
		f.homarrCreates++
		if f.lostCreateResponse {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{"id": "regular-owned", "userName": body.Username, "isAdmin": false})
	})
	mux.HandleFunc("GET /api/user/regular-owned", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("X-ND-Authorization") != "Bearer regular-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		account := map[string]any{"id": "regular-owned", "userName": "self-host-homarr", "isAdmin": f.homarrAdmin, "libraries": []any{map[string]any{"id": 1}}}
		if f.homarrMissingRole {
			delete(account, "isAdmin")
		}
		if f.homarrNoLibraries {
			delete(account, "libraries")
		}
		json.NewEncoder(w).Encode(account)
	})
	mux.HandleFunc("GET /api/library", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("X-ND-Authorization") != "Bearer regular-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if f.homarrLibraryDenied {
			json.NewEncoder(w).Encode([]any{})
			return
		}
		w.WriteHeader(http.StatusForbidden)
	})
	mux.HandleFunc("POST /rest/{endpoint}", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.subsonicCalls++
		if r.URL.RawQuery != "" || r.ParseForm() != nil || r.Form.Get("p") != "" || r.Form.Get("jwt") != "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		body := map[string]any{"status": "ok", "version": "1.16.1", "type": "navidrome", "serverVersion": "0.64.0 (1072e9f7)"}
		write := func() { json.NewEncoder(w).Encode(map[string]any{"subsonic-response": body}) }
		if r.Form.Get("u") == "admin" {
			f.adminSubsonicCalls++
		}
		token := fmt.Sprintf("%x", md5.Sum([]byte(f.homarrPassword+r.Form.Get("s"))))
		if f.homarrPassword == "" || r.Form.Get("u") != "self-host-homarr" || r.Form.Get("t") != token || len(r.Form.Get("s")) != 32 || r.Form.Get("v") != "1.16.1" || r.Form.Get("c") != "self-host" || r.Form.Get("f") != "json" {
			body["status"] = "failed"
			body["error"] = map[string]any{"code": 40, "message": "Wrong username or password"}
			write()
			return
		}
		switch r.PathValue("endpoint") {
		case "ping.view":
		case "getMusicFolders.view":
			body["musicFolders"] = map[string]any{"musicFolder": []any{map[string]any{"id": 1, "name": "Music"}}}
		case "getScanStatus.view":
			body["scanStatus"] = map[string]any{"scanning": false, "count": f.albumCount + f.inaccessibleSongs, "lastScan": "2026-10-11T12:00:00Z"}
		case "getAlbumList2.view":
			offset, err := strconv.Atoi(r.Form.Get("offset"))
			size, sizeErr := strconv.Atoi(r.Form.Get("size"))
			if r.Form.Get("type") != "alphabeticalByName" || sizeErr != nil || size != 1 && size != 500 || err != nil || offset < 0 || offset%500 != 0 {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			f.albumPages++
			if size == 1 {
				f.samplePages++
			}
			w.Header().Set("X-Total-Count", strconv.Itoa(f.albumCount))
			albums := []any{}
			for i := offset; i < min(offset+size, f.albumCount); i++ {
				album := map[string]any{"id": fmt.Sprintf("album-%05d", i), "name": fmt.Sprintf("Album %05d", i), "songCount": 1}
				if f.malformedAlbum {
					album["songCount"] = nil
				}
				albums = append(albums, album)
			}
			body["albumList2"] = map[string]any{}
			if len(albums) > 0 {
				body["albumList2"] = map[string]any{"album": albums}
			}
		case "getArtists.view":
			switch f.artistShape {
			case "absent":
			case "empty object":
				body["artists"] = map[string]any{}
			case "empty index":
				body["artists"] = map[string]any{"index": []any{}}
			case "malformed artist":
				body["artists"] = map[string]any{"index": []any{map[string]any{"artist": []any{map[string]any{"name": "Missing ID"}}}}}
			case "empty failure":
				body["status"] = "failed"
				body["error"] = map[string]any{"code": 70, "message": "Library not found or empty"}
			default:
				if f.albumCount == 0 {
					body["status"] = "failed"
					body["error"] = map[string]any{"code": 70, "message": "Library not found or empty"}
				} else {
					body["artists"] = map[string]any{"index": []any{map[string]any{"artist": []any{map[string]any{"id": "artist-1", "name": "Fixture Artist"}}}}}
				}
			}
		case "getNowPlaying.view":
			body["nowPlaying"] = map[string]any{}
		default:
			w.WriteHeader(http.StatusNotFound)
			return
		}
		write()
	})
	return mux
}

func newH(t *testing.T, server *httptest.Server, secrets secrets, rec *recorder) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "navidrome", Service: "navidrome", BaseURL: server.URL, URL: server.URL,
		HTTP: server.Client(), Secrets: secrets, Log: events.Discard(),
		Now: deps.Now, Sleep: deps.Sleep, Record: rec.record,
	})
}

func TestCreatesTheFirstAdministratorThenProvesTheLogin(t *testing.T) {
	fake := &fakeNavidrome{}
	server := httptest.NewServer(fake.handler())
	defer server.Close()
	secrets := secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "correct-horse-battery"}
	rec := &recorder{}
	h := newH(t, server, secrets, rec)

	if err := (navidrome.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (navidrome.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if rec.status("admin") != stepstatus.StepOK {
		t.Fatalf("admin step = %q, want ok", rec.status("admin"))
	}
	if fake.subsonicCalls != 12 || fake.samplePages != 2 || fake.albumPages != 2 || rec.status("homarr-api") != stepstatus.StepSkip {
		t.Fatal("Setup and Check did not freshly verify the explicit empty music library and listening sessions")
	}
	data, err := navidrome.ReadHomarrData(context.Background(), h)
	if err != nil || data != (navidrome.HomarrData{}) || fake.subsonicCalls != 18 || fake.albumPages != 3 || fake.samplePages != 2 {
		t.Fatalf("Homarr did not freshly verify complete authenticated empty-library data: %v", err)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	fake := &fakeNavidrome{password: "correct-horse-battery", albumCount: 10001}
	server := httptest.NewServer(fake.handler())
	defer server.Close()
	secrets := secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "correct-horse-battery"}
	rec := &recorder{}
	h := newH(t, server, secrets, rec)

	if err := (navidrome.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (navidrome.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("standalone Check rejected a healthy 10001-album API: %v", err)
	}
	if rec.status("ready") != stepstatus.StepSkip || rec.status("admin") != stepstatus.StepSkip || rec.status("homarr-api") != stepstatus.StepSkip {
		t.Fatalf("rerun should skip every step: ready=%q admin=%q homarr-api=%q", rec.status("ready"), rec.status("admin"), rec.status("homarr-api"))
	}
	if fake.subsonicCalls != 12 || fake.albumPages != 2 || fake.samplePages != 2 {
		t.Fatal("standalone Setup and Check exceeded six fresh API reads and one single-album page each")
	}
	fake.mu.Lock()
	fake.albumCount = 60001
	fake.mu.Unlock()
	if err := (navidrome.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("standalone Check rejected a healthy larger API: %v", err)
	}
	if fake.subsonicCalls != 18 || fake.albumPages != 3 || fake.samplePages != 3 {
		t.Fatal("standalone readiness request/page bound grew with the library")
	}
	if _, err := navidrome.ReadHomarrData(context.Background(), h); err == nil || !strings.Contains(err.Error(), "10000-album limit") {
		t.Fatalf("Homarr consumer preflight did not reject its unsupported library size: %v", err)
	}
	if fake.subsonicCalls != 22 || fake.albumPages != 4 || fake.samplePages != 3 {
		t.Fatal("Homarr consumer preflight did not stop at the explicit unsupported total")
	}
	fake.mu.Lock()
	fake.albumCount = 503
	fake.mu.Unlock()
	data, err := navidrome.ReadHomarrData(context.Background(), h)
	if err != nil || data != (navidrome.HomarrData{ArtistCount: 1, AlbumCount: 503, SongCount: 503}) || fake.subsonicCalls != 29 || fake.albumPages != 6 || fake.samplePages != 3 {
		t.Fatalf("Homarr did not reconcile both full album pages and complete counts: %v", err)
	}
	fake.mu.Lock()
	fake.malformedAlbum = true
	fake.mu.Unlock()
	if err := (navidrome.App{}).Check(context.Background(), h); err == nil || !strings.Contains(err.Error(), "incomplete") {
		t.Fatalf("standalone readiness accepted a null representative song count: %v", err)
	}
	if fake.subsonicCalls != 33 || fake.albumPages != 7 || fake.samplePages != 4 {
		t.Fatal("malformed readiness did not stop within its fixed request/page bound")
	}
}

func TestTheHintNamesTheSignInPageWhenAnAdministratorAlreadyExists(t *testing.T) {
	fake := &fakeNavidrome{password: "set-by-hand"}
	server := httptest.NewServer(fake.handler())
	defer server.Close()
	secrets := secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "correct-horse-battery"}
	rec := &recorder{}
	h := newH(t, server, secrets, rec)

	err := (navidrome.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup should fail against an administrator with a different password")
	}
	if rec.status("admin") != stepstatus.StepFail || !strings.Contains(rec.hint(), server.URL) || !strings.Contains(rec.hint(), "existing") || !strings.Contains(rec.hint(), "Do not delete") {
		t.Fatalf("administrator conflict lacks account-preserving recovery hint: %q", rec.hint())
	}
	if fake.password != "set-by-hand" {
		t.Fatal("incompatible administrator password changed")
	}
}

func TestRepeatedSetupWaitsForLoginRateLimitWithoutRecreatingAdmin(t *testing.T) {
	fake := &fakeNavidrome{loginLimit: 5}
	server := httptest.NewServer(fake.handler())
	t.Cleanup(server.Close)
	saved := secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "fixture-only-password"}
	rec := &recorder{}
	h := newH(t, server, saved, rec)
	fake.now = h.Now
	for run := 0; run < 3; run++ {
		if err := (navidrome.App{}).Setup(context.Background(), h); err != nil {
			t.Fatalf("Setup run %d: %v", run, err)
		}
		if err := (navidrome.App{}).Check(context.Background(), h); err != nil {
			t.Fatalf("Check run %d: %v", run, err)
		}
	}
	if fake.creates != 1 || fake.password != saved["ADMIN_PASSWORD"] {
		t.Fatal("repeated Setup recreated or changed the saved administrator")
	}
	if fake.subsonicCalls != 36 {
		t.Fatal("repeated Setup or Check reused stale music library or session data")
	}
}

func TestLoginProbeErrorsNeverAttemptAdministratorCreation(t *testing.T) {
	for _, status := range []int{http.StatusTooManyRequests, http.StatusInternalServerError} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			fake := &fakeNavidrome{password: "fixture-only-password"}
			routes := fake.handler()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/auth/login" {
					w.WriteHeader(status)
					return
				}
				routes.ServeHTTP(w, r)
			}))
			t.Cleanup(server.Close)
			saved := secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "fixture-only-password"}
			rec := &recorder{}
			h := newH(t, server, saved, rec)
			if err := (navidrome.App{}).Setup(context.Background(), h); err == nil {
				t.Fatal("Setup falsely succeeded without proving the login")
			}
			if fake.creates != 0 || fake.password != saved["ADMIN_PASSWORD"] {
				t.Fatal("uncertain login attempted administrator creation or changed its password")
			}
			if rec.status("admin") != stepstatus.StepFail || !strings.Contains(rec.hint(), server.URL) {
				t.Fatal("uncertain login lacks an actionable administrator failure")
			}
		})
	}
}

type loginTransport func(*http.Request) (*http.Response, error)

func (f loginTransport) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func TestLoginHTTPHasBoundedDeadlineAndHonorsCancellation(t *testing.T) {
	caller, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	seen := make(chan context.Context, 1)
	client := &http.Client{Transport: loginTransport(func(req *http.Request) (*http.Response, error) {
		seen <- req.Context()
		<-req.Context().Done()
		return nil, req.Context().Err()
	})}
	h := helpers.New(helpers.Config{App: "navidrome", BaseURL: "http://navidrome.invalid", HTTP: client, Secrets: secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "fixture-only-password"}, Log: events.Discard()})
	started := time.Now()
	result := make(chan error, 1)
	go func() { result <- (navidrome.App{}).Check(caller, h) }()
	requestCtx := <-seen
	deadline, bounded := requestCtx.Deadline()
	cancel()
	err := <-result
	if !bounded || deadline.After(time.Now().Add(time.Minute)) || deadline.Before(started) {
		t.Fatal("login HTTP request lacks its one-minute deadline")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("login did not propagate caller cancellation: %v", err)
	}
}

func TestHomarrRegularAccountRetryAndRecovery(t *testing.T) {
	for _, lostResponse := range []bool{false, true} {
		t.Run(fmt.Sprintf("lost response %v", lostResponse), func(t *testing.T) {
			fake := &fakeNavidrome{lostCreateResponse: lostResponse}
			server := httptest.NewServer(fake.handler())
			t.Cleanup(server.Close)
			saved := secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "fixture-admin-password"}
			h := newH(t, server, saved, &recorder{})
			err := (navidrome.App{}).Setup(t.Context(), h)
			if (err != nil) != lostResponse {
				t.Fatalf("Setup error=%v", err)
			}
			password := saved[h.Key("homarr_password")]
			if password == "" || password == saved["ADMIN_PASSWORD"] {
				t.Fatal("Homarr did not receive a separate saved password")
			}
			if err := (navidrome.App{}).Setup(t.Context(), h); err != nil {
				t.Fatalf("retry: %v", err)
			}
			if err := (navidrome.App{}).Check(t.Context(), h); err != nil {
				t.Fatalf("Check: %v", err)
			}
			if fake.creates != 1 || fake.homarrCreates != 1 || fake.adminSubsonicCalls != 0 || saved[h.Key("homarr_password")] != password || saved[h.Key("homarr_user_id")] != "regular-owned" {
				t.Fatal("retry changed identities/credentials or used the administrator for Subsonic")
			}
			// The native user-create API forbids administration by a regular JWT.
			req, err := http.NewRequest(http.MethodPost, server.URL+"/api/user", strings.NewReader(`{"userName":"unauthorized","password":"fixture","isAdmin":true}`))
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("X-ND-Authorization", "Bearer regular-token")
			resp, err := server.Client().Do(req)
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
			if resp.StatusCode != http.StatusForbidden || fake.homarrCreates != 1 {
				t.Fatal("regular account could create an administrator")
			}
			for _, breakAccount := range []string{"password lost", "password rejected", "administrator role", "missing native role", "missing library access", "administrative library access", "different native ID"} {
				t.Run(breakAccount, func(t *testing.T) {
					saved[h.Key("homarr_password")] = password
					saved[h.Key("homarr_user_id")] = "regular-owned"
					fake.homarrAdmin, fake.homarrMissingRole, fake.homarrLibraryDenied, fake.homarrNoLibraries = false, false, false, false
					switch breakAccount {
					case "password lost":
						saved[h.Key("homarr_password")] = ""
					case "password rejected":
						saved[h.Key("homarr_password")] = "rejected-fixture"
					case "administrator role":
						fake.homarrAdmin = true
					case "missing native role":
						fake.homarrMissingRole = true
					case "missing library access":
						fake.homarrNoLibraries = true
					case "administrative library access":
						fake.homarrLibraryDenied = true
					case "different native ID":
						saved[h.Key("homarr_user_id")] = "different-owned"
					}
					before := saved[h.Key("homarr_password")]
					if err := (navidrome.App{}).Setup(t.Context(), h); !errors.Is(err, helpers.ErrManual) {
						t.Fatalf("expected account-preserving Manual recovery: %v", err)
					}
					if saved[h.Key("homarr_password")] != before || fake.homarrPassword != password || fake.password != saved["ADMIN_PASSWORD"] || fake.homarrCreates != 1 || fake.creates != 1 {
						t.Fatal("account recovery mutated an existing user or credential")
					}
				})
			}
		})
	}
}

func TestHomarrRegularAccountPreservesConflictingUser(t *testing.T) {
	fake := &fakeNavidrome{password: "fixture-admin-password", homarrPassword: "fixture-existing-user-password"}
	server := httptest.NewServer(fake.handler())
	t.Cleanup(server.Close)
	saved := secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "fixture-admin-password"}
	h := newH(t, server, saved, &recorder{})
	if err := (navidrome.App{}).Setup(t.Context(), h); !errors.Is(err, helpers.ErrManual) {
		t.Fatalf("existing regular user did not require Manual recovery: %v", err)
	}
	password := saved[h.Key("homarr_password")]
	if err := (navidrome.App{}).Setup(t.Context(), h); !errors.Is(err, helpers.ErrManual) {
		t.Fatalf("retry adopted an unrelated account: %v", err)
	}
	if fake.homarrCreates != 0 || fake.creates != 0 || fake.homarrPassword != "fixture-existing-user-password" || fake.password != saved["ADMIN_PASSWORD"] || password == "" || saved[h.Key("homarr_password")] != password || saved[h.Key("homarr_user_id")] != "" {
		t.Fatal("conflict recovery changed an existing user or rotated the pending credential")
	}
}

func TestHomarrEmptyAccessibleLibraryIgnoresGlobalScanCount(t *testing.T) {
	for _, scenario := range []struct {
		name        string
		artistShape string
		albumCount  int
		wantError   bool
	}{
		{"explicit empty library", "", 0, false},
		{"absent artists object", "absent", 0, true},
		{"empty artists object", "empty object", 0, true},
		{"empty artist index", "empty index", 0, true},
		{"malformed artist", "malformed artist", 0, true},
		{"empty artists with accessible albums", "empty failure", 1, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			// The regular user sees only empty library 1; scanner count includes
			// 37 tracks from inaccessible library 2 (scanner/controller.go).
			fake := &fakeNavidrome{password: "fixture-admin-password", homarrPassword: "fixture-regular-password", inaccessibleSongs: 37, artistShape: scenario.artistShape, albumCount: scenario.albumCount}
			server := httptest.NewServer(fake.handler())
			t.Cleanup(server.Close)
			saved := secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "fixture-admin-password", "NAVIDROME_HOMARR_USERNAME": "self-host-homarr", "NAVIDROME_HOMARR_PASSWORD": "fixture-regular-password", "NAVIDROME_HOMARR_USER_ID": "regular-owned"}
			h := newH(t, server, saved, &recorder{})
			data, err := navidrome.ReadHomarrData(t.Context(), h)
			if (err != nil) != scenario.wantError {
				t.Fatalf("ReadHomarrData: %v, wantError=%v", err, scenario.wantError)
			}
			if scenario.wantError {
				return
			}
			if data != (navidrome.HomarrData{}) {
				t.Fatal("inaccessible tracks became account-scoped Homarr data")
			}
			if err := (navidrome.App{}).Setup(t.Context(), h); err != nil {
				t.Fatalf("Setup rejected the accessible empty library: %v", err)
			}
			if err := (navidrome.App{}).Check(t.Context(), h); err != nil {
				t.Fatalf("Check rejected the accessible empty library: %v", err)
			}
			if fake.homarrCreates != 0 || fake.creates != 0 || fake.adminSubsonicCalls != 0 || fake.inaccessibleSongs != 37 {
				t.Fatal("empty-library readiness changed accounts or used administrator access")
			}
		})
	}
}
