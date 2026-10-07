package bookstack_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/bookstack"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

// execAdapter turns the scripted Runner into the Executor the helpers need.
type execAdapter struct{ runner *systemtest.Runner }

func (e execAdapter) Exec(_ context.Context, _ string, _ map[string]string, command ...string) (system.Result, error) {
	return e.runner.Run(context.Background(), system.Cmd{Name: command[0], Args: command[1:]})
}

func (execAdapter) LogText(context.Context, int, ...string) (string, error) { return "", nil }
func (execAdapter) Restart(context.Context, ...string) error                { return nil }

type fakeBookstack struct {
	mu   sync.Mutex
	pass string
}

func (f *fakeBookstack) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /login", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<form method="post"><input name="_token" value="csrftok"><input name="email"><input name="password"></form>`)
	})
	mux.HandleFunc("POST /login", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		r.ParseForm()
		if r.PostForm.Get("_token") != "csrftok" || r.PostForm.Get("password") != f.pass {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "bookstack_session", Value: "ok"})
		http.Redirect(w, r, "/settings/users", http.StatusFound)
	})
	mux.HandleFunc("GET /settings/users", func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie("bookstack_session"); err != nil || c.Value != "ok" {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}
		fmt.Fprint(w, `<h1>Users</h1>`)
	})
	return mux
}

type harness struct {
	h       *helpers.H
	results []helpers.StepResult
}

func newHarness(t *testing.T, runner *systemtest.Runner, handler http.Handler, sec secrets) *harness {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	deps := systemtest.NewDeps(t)
	box := &harness{}
	box.h = helpers.New(helpers.Config{
		App: "bookstack", Service: "bookstack",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: sec, Log: events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Exec:   execAdapter{runner: runner},
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

func TestSetupCreatesTheAdminThenCheck(t *testing.T) {
	fake := &fakeBookstack{pass: "generated-pw"}
	runner := &systemtest.Runner{}
	runner.On("php /app/www/artisan", system.Result{Stdout: []byte("generated-pw\n")})
	box := newHarness(t, runner, fake.handler(), secrets{})
	app := bookstack.App{}
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := app.Check(context.Background(), box.h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if box.h.AdminPassword() != "generated-pw" {
		t.Fatalf("captured password = %q", box.h.AdminPassword())
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	fake := &fakeBookstack{pass: "generated-pw"}
	runner := &systemtest.Runner{}
	runner.On("php /app/www/artisan", system.Result{Stdout: []byte("generated-pw\n")})
	box := newHarness(t, runner, fake.handler(), secrets{})
	app := bookstack.App{}
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
	if calls := runner.Calls(); len(calls) != 1 {
		t.Errorf("artisan ran %d times, want 1: %v", len(calls), calls)
	}
}

func TestNoLoginFormHintNamesTheCommand(t *testing.T) {
	runner := &systemtest.Runner{}
	runner.On("php /app/www/artisan", system.Result{Stdout: []byte("generated-pw\n")})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /login", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<p>no form here</p>`)
	})
	box := newHarness(t, runner, mux, secrets{})
	err := bookstack.App{}.Setup(context.Background(), box.h)
	if err == nil {
		t.Fatal("Setup should fail without a login form")
	}
	hint := box.step("admin").Hint
	if !strings.Contains(hint, "bookstack:create-admin") {
		t.Errorf("hint should name the command, got %q", hint)
	}
}
