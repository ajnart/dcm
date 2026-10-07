package navidrome_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/navidrome"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

type recorder struct{ steps []helpers.StepResult }

func (r *recorder) record(step helpers.StepResult) { r.steps = append(r.steps, step) }

func (r *recorder) status(id string) string {
	for _, step := range r.steps {
		if step.ID == id {
			return step.Status
		}
	}
	return ""
}

func (r *recorder) hint() string {
	for _, step := range r.steps {
		if step.Status == "fail" {
			return step.Hint
		}
	}
	return ""
}

type fakeNavidrome struct {
	mu       sync.Mutex
	password string
}

func (f *fakeNavidrome) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("POST /auth/login", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
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
		if f.password != "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		var body struct{ Username, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		f.password = body.Password
		json.NewEncoder(w).Encode(map[string]any{"username": "admin", "isAdmin": true, "id": "abc", "token": "a.b.c"})
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
	if rec.status("admin") != "ok" {
		t.Fatalf("admin step = %q, want ok", rec.status("admin"))
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	fake := &fakeNavidrome{password: "correct-horse-battery"}
	server := httptest.NewServer(fake.handler())
	defer server.Close()
	secrets := secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "correct-horse-battery"}
	rec := &recorder{}
	h := newH(t, server, secrets, rec)

	if err := (navidrome.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if rec.status("ready") != "skip" || rec.status("admin") != "skip" {
		t.Fatalf("rerun should skip both steps: ready=%q admin=%q", rec.status("ready"), rec.status("admin"))
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
	if rec.status("admin") != "fail" || !strings.Contains(rec.hint(), server.URL) {
		t.Fatalf("admin step should fail with the App URL in its hint, got %q", rec.hint())
	}
}
