package immich_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/immich"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

type fakeImmich struct {
	mu      sync.Mutex
	email   string
	pass    string
	init    bool
	signups int
}

func (f *fakeImmich) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/server/config", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]bool{"isInitialized": f.init})
	})
	mux.HandleFunc("POST /api/auth/admin-sign-up", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.signups++
		f.init = true
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"id": "u1"})
	})
	mux.HandleFunc("POST /api/auth/login", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct{ Email, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if !f.init || body.Email != f.email || body.Password != f.pass {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{"userEmail": f.email, "isAdmin": true, "accessToken": "tok"})
	})
	mux.HandleFunc("GET /api/api-keys", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]any{})
	})
	mux.HandleFunc("POST /api/api-keys", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{"id": "statistics-key", "secret": "statistics-secret"})
	})
	mux.HandleFunc("GET /api/api-keys/me", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "statistics-secret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"id": "statistics-key", "permissions": []string{"user.read", "server.statistics"}})
	})
	mux.HandleFunc("GET /api/users/me", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"email": f.email, "isAdmin": true})
	})
	mux.HandleFunc("GET /api/users", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]any{map[string]string{"id": "u1"}})
	})
	mux.HandleFunc("GET /api/server/statistics", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]int{"photos": 0, "videos": 0, "usage": 0})
	})
	return mux
}

type harness struct {
	h       *helpers.H
	results []helpers.StepResult
}

func newHarness(t *testing.T, fake *fakeImmich, sec secrets) *harness {
	t.Helper()
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	deps := systemtest.NewDeps(t)
	box := &harness{}
	box.h = helpers.New(helpers.Config{
		App: "immich", Service: "immich",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: sec, Log: events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { box.results = append(box.results, r) },
	})
	return box
}

func (b *harness) step(id string) helpers.StepResult {
	for i := len(b.results) - 1; i >= 0; i-- {
		if b.results[i].ID == id {
			return b.results[i]
		}
	}
	return helpers.StepResult{}
}

func TestSetupCreatesTheFirstAdminThenCheck(t *testing.T) {
	fake := &fakeImmich{email: "admin@example.test", pass: "pw"}
	box := newHarness(t, fake, secrets{"ADMIN_PASSWORD": "pw"})
	app := immich.App{}
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := app.Check(context.Background(), box.h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if fake.signups != 1 {
		t.Fatalf("signups = %d, want 1", fake.signups)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	fake := &fakeImmich{email: "admin@example.test", pass: "pw"}
	box := newHarness(t, fake, secrets{"ADMIN_PASSWORD": "pw"})
	app := immich.App{}
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}
	box.results = nil
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for _, id := range []string{"admin"} {
		if got := box.step(id); got.Status != stepstatus.StepSkip {
			t.Errorf("step %s on rerun = %q, want skip", id, got.Status)
		}
	}
	if fake.signups != 1 {
		t.Errorf("signups = %d, want 1", fake.signups)
	}
}

func TestWrongPasswordHintNamesThePage(t *testing.T) {
	fake := &fakeImmich{email: "admin@example.test", pass: "right", init: true}
	box := newHarness(t, fake, secrets{"ADMIN_PASSWORD": "wrong"})
	err := immich.App{}.Setup(context.Background(), box.h)
	if err == nil {
		t.Fatal("Setup should fail with the wrong password")
	}
	if !strings.Contains(box.step("admin").Hint, box.h.URL) {
		t.Errorf("hint should name the App page, got %q", box.step("admin").Hint)
	}
}
