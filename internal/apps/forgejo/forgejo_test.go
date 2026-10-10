package forgejo_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/forgejo"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
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
	username string
	password string
}

func (f *fakeForgejo) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("GET /api/v1/user", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		user, pass, ok := r.BasicAuth()
		if !ok || f.password == "" || user != f.username || pass != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"login": f.username, "is_admin": true, "active": true})
	})
	return mux
}

type fakeExec struct {
	http       *fakeForgejo
	users      int
	creates    int
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
		_, tail, _ := strings.Cut(command[2], `--username "`)
		user, _, _ := strings.Cut(tail, `"`)
		if user == "admin" {
			return system.Result{ExitCode: 1}, errors.New("CreateUser: name is reserved [name: admin]")
		}
		if f.failCreate {
			return system.Result{ExitCode: 1}, nil
		}
		f.http.mu.Lock()
		f.http.password = env["FORGEJO_ADMIN_PASSWORD"]
		f.http.username = user
		f.users = 1
		f.creates++
		f.http.mu.Unlock()
		return system.Result{}, nil
	}
	return system.Result{}, nil
}

func (f *fakeExec) LogText(context.Context, int, ...string) (string, error) { return "", nil }
func (f *fakeExec) Restart(context.Context, ...string) error                { return nil }
func (f *fakeExec) Up(context.Context, ...string) error                     { return nil }

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
	exec := &fakeExec{http: fake}
	h := newH(t, srv, exec, &records)
	ctx := context.Background()

	if err := (forgejo.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (forgejo.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if h.Secret("FORGEJO_ADMIN_USER") != "selfhost-admin" || h.AdminUser() != "admin" {
		t.Fatal("Forgejo alias was not recorded separately from the shared username")
	}

	records = nil
	if err := (forgejo.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
	if exec.creates != 1 {
		t.Fatalf("Setup created %d users, want exactly one", exec.creates)
	}
}

func TestSetupStepNamesTheAdministratorUsernameUsed(t *testing.T) {
	fake := &fakeForgejo{}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &fakeExec{http: fake}, &records)

	if err := (forgejo.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	var msg string
	for _, r := range records {
		if r.ID == "admin" && r.Status == stepstatus.StepOK {
			msg = r.Msg
		}
	}
	if !strings.Contains(msg, "selfhost-admin") {
		t.Fatalf("Setup step should name the administrator username used, got %q", msg)
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
		if r.Status == stepstatus.StepFail {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host setup forgejo") {
		t.Errorf("hint should name the setup command, got %q", hint)
	}
	if !strings.Contains(hint, "selfhost-admin") || strings.Contains(hint, "create the administrator admin ") {
		t.Errorf("hint should name the Forgejo alias, got %q", hint)
	}
}

func TestExistingAndExplicitUsernamesArePreserved(t *testing.T) {
	for _, tc := range []struct {
		name, user string
		existing   bool
	}{
		{name: "working existing admin", user: "admin", existing: true},
		{name: "explicit username", user: "owner"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fake := &fakeForgejo{}
			exec := &fakeExec{http: fake}
			if tc.existing {
				fake.username, fake.password, exec.users = tc.user, adminPass, 1
			}
			srv := httptest.NewServer(fake.handler())
			t.Cleanup(srv.Close)
			var records []helpers.StepResult
			h := newH(t, srv, exec, &records)
			h.Secrets.Set("ADMIN_USER", tc.user)
			if err := (forgejo.App{}).Setup(context.Background(), h); err != nil {
				t.Fatalf("Setup: %v", err)
			}
			if err := (forgejo.App{}).Check(context.Background(), h); err != nil {
				t.Fatalf("Check: %v", err)
			}
			if fake.username != tc.user || h.AdminUser() != tc.user || h.Secret("FORGEJO_ADMIN_USER") != "" {
				t.Fatal("explicit or existing username changed")
			}
			if tc.existing && exec.creates != 0 {
				t.Fatal("Setup created an additional existing administrator")
			}
		})
	}
}

func TestExistingAccountWithDifferentPasswordDoesNotGetAnAlias(t *testing.T) {
	fake := &fakeForgejo{username: "admin", password: "different-password"}
	exec := &fakeExec{http: fake, users: 1}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, exec, &records)
	if err := (forgejo.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("existing account with a different password should need recovery")
	}
	if h.Secret("FORGEJO_ADMIN_USER") != "" || exec.creates != 0 || fake.username != "admin" {
		t.Fatal("failed existing account was assigned an alias or replaced")
	}
}
