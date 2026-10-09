package valkey_test

import (
	"context"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/valkey"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

type fakeExec struct{ stdout string }

func (f *fakeExec) Exec(context.Context, string, map[string]string, ...string) (system.Result, error) {
	return system.Result{Stdout: []byte(f.stdout)}, nil
}
func (f *fakeExec) LogText(context.Context, int, ...string) (string, error) { return "", nil }
func (f *fakeExec) Restart(context.Context, ...string) error                { return nil }

func newH(t *testing.T, stdout string, results *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "valkey", Service: "valkey", BaseURL: "http://127.0.0.1:6379", URL: "http://127.0.0.1:6379",
		Secrets: fakeSecrets{},
		Exec:    &fakeExec{stdout: stdout},
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { *results = append(*results, r) },
		Now:     deps.Now,
		Sleep:   deps.Sleep,
	})
}

func TestSetupThenCheckPass(t *testing.T) {
	var results []helpers.StepResult
	h := newH(t, "PONG\n", &results)
	ctx := context.Background()

	if err := (valkey.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (valkey.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	var results []helpers.StepResult
	h := newH(t, "PONG\n", &results)

	if err := (valkey.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}
	results = results[:0]
	if err := (valkey.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	if len(results) != 1 || results[0].Status != stepstatus.StepSkip {
		t.Fatalf("rerun results = %+v, want the ping step skipped", results)
	}
}

func TestAMissingPongNamesTheCommand(t *testing.T) {
	var results []helpers.StepResult
	h := newH(t, "\n", &results)

	err := (valkey.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want a failure")
	}
	if !strings.Contains(results[len(results)-1].Hint, "valkey-cli PING") {
		t.Errorf("hint does not name the PING command: %+v", results[len(results)-1])
	}
}
