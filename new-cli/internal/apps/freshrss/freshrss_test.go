package freshrss_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/freshrss"
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

type fakeExec struct {
	exists     bool
	password   string
	failCreate bool
}

func (f *fakeExec) Exec(_ context.Context, _ string, env map[string]string, command ...string) (system.Result, error) {
	if command[0] != "sh" {
		return system.Result{}, nil
	}
	script := command[2]
	switch {
	case strings.Contains(script, "test -f"):
		// Model the container shell: a bare `test -f` exits 1 when the file is
		// absent, and Compose turns any non-zero exit into an error.
		if strings.Contains(script, "echo yes") {
			if f.exists {
				return system.Result{Stdout: []byte("yes")}, nil
			}
			return system.Result{Stdout: []byte("no")}, nil
		}
		if f.exists {
			return system.Result{}, nil
		}
		return system.Result{ExitCode: 1}, errors.New("docker compose exec: exit 1")
	case strings.Contains(script, "do-install"):
		if f.failCreate {
			return system.Result{ExitCode: 1}, nil
		}
		f.exists, f.password = true, env["FRESHRSS_ADMIN_PASSWORD"]
		return system.Result{}, nil
	case strings.Contains(script, "password_verify"):
		if f.exists && env["FRESHRSS_ADMIN_PASSWORD"] == f.password {
			return system.Result{}, nil
		}
		return system.Result{ExitCode: 1}, nil
	}
	return system.Result{}, nil
}

func (f *fakeExec) LogText(context.Context, int, ...string) (string, error) { return "", nil }
func (f *fakeExec) Restart(context.Context, ...string) error                { return nil }

func newH(t *testing.T, srv *httptest.Server, exec *fakeExec, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "freshrss", Service: "freshrss",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep, Exec: exec,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &fakeExec{}, &records)
	ctx := context.Background()

	if err := (freshrss.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (freshrss.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	records = nil
	if err := (freshrss.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != "skip" {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestFailingStepHintNamesTheSetupCommand(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &fakeExec{failCreate: true}, &records)

	if err := (freshrss.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when installation fails")
	}
	var hint string
	for _, r := range records {
		if r.Status == "fail" {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host setup freshrss") {
		t.Errorf("hint should name the setup command, got %q", hint)
	}
}
