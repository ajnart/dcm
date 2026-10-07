package unbound_test

import (
	"context"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/unbound"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

type fakeExec struct {
	rcode string
	code  int
}

func (f *fakeExec) Exec(context.Context, string, map[string]string, ...string) (system.Result, error) {
	return system.Result{Stdout: []byte(f.rcode), ExitCode: f.code}, nil
}
func (f *fakeExec) LogText(context.Context, int, ...string) (string, error) { return "", nil }
func (f *fakeExec) Restart(context.Context, ...string) error                { return nil }

const answer = ";; ->>HEADER<<- opcode: QUERY, rcode: NOERROR, id: 1\nnlnetlabs.nl. 3600 IN A 185.49.140.10\n"

func newH(t *testing.T, exec *fakeExec, results *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "unbound", Service: "unbound", BaseURL: "http://127.0.0.1:5335", URL: "http://127.0.0.1:5335",
		Secrets: fakeSecrets{},
		Exec:    exec,
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { *results = append(*results, r) },
		Now:     deps.Now,
		Sleep:   deps.Sleep,
	})
}

func TestSetupThenCheckPass(t *testing.T) {
	var results []helpers.StepResult
	h := newH(t, &fakeExec{rcode: answer}, &results)
	ctx := context.Background()

	if err := (unbound.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (unbound.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	var results []helpers.StepResult
	h := newH(t, &fakeExec{rcode: answer}, &results)

	if err := (unbound.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}
	results = results[:0]
	if err := (unbound.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("rerun recorded %d steps, want 2", len(results))
	}
	for i, r := range results {
		if r.Status != "skip" {
			t.Errorf("rerun step %d (%s) = %q, want skip", i, r.ID, r.Status)
		}
	}
}

func TestAFailedQueryNamesTheDrillCommand(t *testing.T) {
	var results []helpers.StepResult
	h := newH(t, &fakeExec{rcode: "connection refused", code: 1}, &results)

	err := (unbound.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want a failure")
	}
	if !strings.Contains(results[len(results)-1].Hint, "drill -p 5335") {
		t.Errorf("hint does not name the drill command: %+v", results[len(results)-1])
	}
}
