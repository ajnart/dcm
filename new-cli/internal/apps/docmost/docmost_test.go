package docmost_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/docmost"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

type fakeDocmost struct {
	mu     sync.Mutex
	email  string
	pass   string
	owner  bool
	setups int
}

// jsonOnly mirrors Docmost's Fastify, which answers 415 when a POST carries a
// body that has no application/json media type.
func jsonOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.ContentLength != 0 && !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			w.WriteHeader(http.StatusUnsupportedMediaType)
			return
		}
		next(w, r)
	}
}

func (f *fakeDocmost) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("POST /api/auth/setup", jsonOnly(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.setups++
		var body struct{ Name, Email, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if body.Email != f.email || body.Password != f.pass {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.owner = true
		http.SetCookie(w, &http.Cookie{Name: "authToken", Value: "cookie"})
		json.NewEncoder(w).Encode(map[string]any{"success": true, "status": 200, "data": map[string]string{"id": "w1"}})
	}))
	mux.HandleFunc("POST /api/auth/login", jsonOnly(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct{ Email, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if !f.owner || body.Email != f.email || body.Password != f.pass {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "authToken", Value: "cookie"})
		json.NewEncoder(w).Encode(map[string]any{"success": true, "status": 200})
	}))
	mux.HandleFunc("POST /api/users/me", jsonOnly(func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie("authToken"); err != nil || c.Value != "cookie" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"success": true, "status": 200,
			"data": map[string]any{"user": map[string]string{"email": f.email, "role": "owner"}},
		})
	}))
	return mux
}

type harness struct {
	h       *helpers.H
	results []helpers.StepResult
}

func newHarness(t *testing.T, fake *fakeDocmost, sec secrets) *harness {
	t.Helper()
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	deps := systemtest.NewDeps(t)
	box := &harness{}
	box.h = helpers.New(helpers.Config{
		App: "docmost", Service: "docmost",
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

func TestSetupCreatesTheFirstOwnerThenCheck(t *testing.T) {
	fake := &fakeDocmost{email: "admin@selfhost.local", pass: "pw"}
	box := newHarness(t, fake, secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})
	app := docmost.App{}
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := app.Check(context.Background(), box.h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if fake.setups != 1 {
		t.Fatalf("setups = %d, want 1", fake.setups)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	fake := &fakeDocmost{email: "admin@selfhost.local", pass: "pw"}
	box := newHarness(t, fake, secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})
	app := docmost.App{}
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}
	box.results = nil
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for _, id := range []string{"admin"} {
		if got := box.step(id); got.Status != "skip" {
			t.Errorf("step %s on rerun = %q, want skip", id, got.Status)
		}
	}
	if fake.setups != 1 {
		t.Errorf("setups = %d, want 1", fake.setups)
	}
}

func TestWrongPasswordHintNamesThePage(t *testing.T) {
	fake := &fakeDocmost{email: "admin@selfhost.local", pass: "right", owner: true}
	box := newHarness(t, fake, secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "wrong"})
	err := docmost.App{}.Setup(context.Background(), box.h)
	if err == nil {
		t.Fatal("Setup should fail with the wrong password")
	}
	if !strings.Contains(box.step("admin").Hint, box.h.URL) {
		t.Errorf("hint should name the App page, got %q", box.step("admin").Hint)
	}
}
