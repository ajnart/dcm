package fireflyiii_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/fireflyiii"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

const email = "admin@example.test"

type fakeFirefly struct {
	mu      sync.Mutex
	pass    string
	owner   bool
	signups int
}

func (f *fakeFirefly) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /register", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `<form method="post"><input name="_token" value="csrftok"><input name="password_confirmation"></form>`)
	})
	mux.HandleFunc("POST /register", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		r.ParseForm()
		if r.PostForm.Get("_token") != "csrftok" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}
		f.signups++
		f.owner = true
		http.Redirect(w, r, "/home", http.StatusFound)
	})
	mux.HandleFunc("GET /login", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `<form method="post"><input name="_token" value="csrftok"><input name="password"></form>`)
	})
	mux.HandleFunc("POST /login", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		r.ParseForm()
		if !f.owner || r.PostForm.Get("email") != email || r.PostForm.Get("password") != f.pass {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "session", Value: "ok"})
		http.Redirect(w, r, "/home", http.StatusFound)
	})
	mux.HandleFunc("GET /profile/change-email", func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie("session"); err != nil || c.Value != "ok" {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}
		fmt.Fprintf(w, `<input id="email" value="%s">`, email)
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
		App: "firefly-iii", Service: "firefly-iii",
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

func TestSetupRegistersTheFirstOwnerThenCheck(t *testing.T) {
	fake := &fakeFirefly{pass: "pw"}
	box := newHarness(t, fake.handler(), secrets{"ADMIN_PASSWORD": "pw"})
	app := fireflyiii.App{}
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
	fake := &fakeFirefly{pass: "pw"}
	box := newHarness(t, fake.handler(), secrets{"ADMIN_PASSWORD": "pw"})
	app := fireflyiii.App{}
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
	if fake.signups != 1 {
		t.Errorf("signups = %d, want 1", fake.signups)
	}
}

func TestRegistrationClosedHintNamesThePage(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /login", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<form method="post"><input name="_token" value="csrftok"><input name="password"></form>`)
	})
	mux.HandleFunc("POST /login", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
	})
	mux.HandleFunc("GET /register", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<p>Registration is currently not available</p>`)
	})
	box := newHarness(t, mux, secrets{"ADMIN_PASSWORD": "pw"})
	err := fireflyiii.App{}.Setup(context.Background(), box.h)
	if err == nil {
		t.Fatal("Setup should fail when registration is closed")
	}
	if !strings.Contains(box.step("admin").Hint, "/register") {
		t.Errorf("hint should name the App page, got %q", box.step("admin").Hint)
	}
}
