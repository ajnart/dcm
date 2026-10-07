package forgejo_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/forgejo"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

const (
	adminUser = "admin"
	adminPass = "correct-horse-battery"
)

type fakeForgejo struct {
	mu       sync.Mutex
	password string
}

func (f *fakeForgejo) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("GET /api/v1/user", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		user, pass, ok := r.BasicAuth()
		if !ok || f.password == "" || user != adminUser || pass != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"login": adminUser, "is_admin": true, "active": true})
	})
	return mux
}

type fakeExec struct {
	http       *fakeForgejo
	users      int
	failCreate bool
}

func (f *fakeExec) Exec(_ context.Context, _ string, env map[string]string, command ...string) (system.Result, error) {
	switch command[0] {
	case "su-exec":
		out := "ID Username Email IsActive IsAdmin 2FA\n"
		if f.users > 0 {
			out += "1 admin admin@forgejo.local true true false\n"
		}
		return system.Result{Stdout: []byte(out)}, nil
	case "sh":
		if f.failCreate {
			return system.Result{ExitCode: 1}, nil
		}
		f.http.mu.Lock()
		f.http.password = env["FORGEJO_ADMIN_PASSWORD"]
		f.users = 1
		f.http.mu.Unlock()
		return system.Result{}, nil
	}
	return system.Result{}, nil
}

func (f *fakeExec) LogText(context.Context, int, ...string) (string, error) { return "", nil }
func (f *fakeExec) Restart(context.Context, ...string) error                { return nil }

func newH(t *testing.T, srv *httptest.Server, exec *fakeExec, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "forgejo", Service: "forgejo",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep, Exec: exec,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	fake := &fakeForgejo{}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &fakeExec{http: fake}, &records)
	ctx := context.Background()

	if err := (forgejo.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (forgejo.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	records = nil
	if err := (forgejo.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != "skip" {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestFailingStepHintNamesTheSetupCommand(t *testing.T) {
	fake := &fakeForgejo{}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &fakeExec{http: fake, failCreate: true}, &records)

	if err := (forgejo.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the create command fails")
	}
	var hint string
	for _, r := range records {
		if r.Status == "fail" {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host setup forgejo") {
		t.Errorf("hint should name the setup command, got %q", hint)
	}
}
