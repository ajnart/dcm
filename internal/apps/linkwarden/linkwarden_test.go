package linkwarden_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/linkwarden"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

type fakeLinkwarden struct {
	mu      sync.Mutex
	user    string
	pass    string
	created bool
	signups int
}

func (f *fakeLinkwarden) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"message":"ok"}`))
	})
	mux.HandleFunc("POST /api/v1/users", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.signups++
		var body struct{ Username, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if body.Username != f.user || body.Password != f.pass {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.created = true
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{"response": map[string]any{"id": 1, "username": f.user}})
	})
	mux.HandleFunc("POST /api/v1/session", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct{ Username, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if !f.created || body.Username != f.user || body.Password != f.pass {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"response": map[string]string{"token": "tok"}})
	})
	mux.HandleFunc("GET /api/v1/users/me", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"response": map[string]any{"id": 1, "username": f.user}})
	})
	return mux
}

type harness struct {
	h       *helpers.H
	results []helpers.StepResult
}

func newHarness(t *testing.T, handler http.Handler, sec secrets) *harness {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	deps := systemtest.NewDeps(t)
	box := &harness{}
	box.h = helpers.New(helpers.Config{
		App: "linkwarden", Service: "linkwarden",
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
	fake := &fakeLinkwarden{user: "admin", pass: "pw"}
	box := newHarness(t, fake.handler(), secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})
	app := linkwarden.App{}
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
	fake := &fakeLinkwarden{user: "admin", pass: "pw"}
	box := newHarness(t, fake.handler(), secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})
	app := linkwarden.App{}
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}
	box.results = nil
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for _, id := range []string{"ready", "admin"} {
		if got := box.step(id); got.Status != "skip" {
			t.Errorf("step %s on rerun = %q, want skip", id, got.Status)
		}
	}
	if fake.signups != 1 {
		t.Errorf("signups = %d, want 1", fake.signups)
	}
}

func TestUnreadyHintNamesTheLogCommand(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})
	box := newHarness(t, mux, secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})
	err := linkwarden.App{}.Setup(context.Background(), box.h)
	if err == nil {
		t.Fatal("Setup should fail while the App is unreachable")
	}
	if !strings.Contains(box.step("ready").Hint, "self-host logs linkwarden") {
		t.Errorf("hint should name the command, got %q", box.step("ready").Hint)
	}
}
