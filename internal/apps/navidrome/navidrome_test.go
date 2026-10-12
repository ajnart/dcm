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
	mu              sync.Mutex
	password        string
	loginLimit      int
	logins, creates int
	window          time.Time
	now             func() time.Time
	subsonicCalls   int
	albumCount      int
	albumPages      int
	samplePages     int
	malformedAlbum  bool
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
		if f.password == "" || body.Password != f.password {
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
		token := fmt.Sprintf("%x", md5.Sum([]byte(f.password+r.Form.Get("s"))))
		if f.password == "" || r.Form.Get("u") != "admin" || r.Form.Get("t") != token || len(r.Form.Get("s")) != 32 || r.Form.Get("v") != "1.16.1" || r.Form.Get("c") != "self-host" || r.Form.Get("f") != "json" {
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
			body["scanStatus"] = map[string]any{"scanning": false, "count": f.albumCount, "lastScan": "2026-10-11T12:00:00Z"}
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
			if f.albumCount == 0 {
				body["status"] = "failed"
				body["error"] = map[string]any{"code": 70, "message": "Library not found or empty"}
			} else {
				body["artists"] = map[string]any{"index": []any{map[string]any{"artist": []any{map[string]any{"id": "artist-1", "name": "Fixture Artist"}}}}}
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
