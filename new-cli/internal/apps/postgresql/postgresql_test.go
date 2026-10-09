package postgresql_test

import (
	"context"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/postgresql"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

const (
	adminUser     = "admin"
	adminPassword = "Pa55word-long"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

// fakeExec answers pg_isready and psql differently, like the container would.
type fakeExec struct{ authenticated bool }

func (f *fakeExec) Exec(_ context.Context, _ string, _ map[string]string, command ...string) (system.Result, error) {
	if len(command) > 0 && command[0] == "psql" && f.authenticated {
		return system.Result{Stdout: []byte(adminUser + "\n")}, nil
	}
	return system.Result{}, nil
}
func (f *fakeExec) LogText(context.Context, int, ...string) (string, error) { return "", nil }
func (f *fakeExec) Restart(context.Context, ...string) error                { return nil }

func newH(t *testing.T, exec *fakeExec, results *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "postgresql", Service: "postgresql", BaseURL: "http://127.0.0.1:5432", URL: "http://127.0.0.1:5432",
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPassword},
		Exec:    exec,
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { *results = append(*results, r) },
		Now:     deps.Now,
		Sleep:   deps.Sleep,
	})
}

func TestSetupThenCheckPass(t *testing.T) {
	var results []helpers.StepResult
	h := newH(t, &fakeExec{authenticated: true}, &results)
	ctx := context.Background()

	if err := (postgresql.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (postgresql.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	var results []helpers.StepResult
	h := newH(t, &fakeExec{authenticated: true}, &results)

	if err := (postgresql.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}
	results = results[:0]
	if err := (postgresql.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("rerun recorded %d steps, want 2", len(results))
	}
	for i, r := range results {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %d (%s) = %q, want skip", i, r.ID, r.Status)
		}
	}
}

func TestARejectedPasswordNamesTheCredentialsCommand(t *testing.T) {
	var results []helpers.StepResult
	h := newH(t, &fakeExec{authenticated: false}, &results)

	err := (postgresql.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want a failure")
	}
	fail := results[len(results)-1]
	if fail.Status != stepstatus.StepFail || !strings.Contains(fail.Hint, "self-host credentials") {
		t.Errorf("hint does not name the credentials command: %+v", fail)
	}
}
