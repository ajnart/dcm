package zerotier_test

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/zerotier"
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
	token     = "a-valid-generated-api-token"
)

// execFake answers the node-local curl reads ZeroTier Setup runs.
type execFake struct {
	mu sync.Mutex
}

func (e *execFake) Exec(_ context.Context, _ string, env map[string]string, command ...string) (system.Result, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	script := strings.Join(command, " ")
	if env["ZT_TOKEN"] != token {
		return system.Result{Stdout: []byte("401")}, nil
	}
	switch {
	case strings.Contains(script, "/status"):
		return system.Result{Stdout: []byte(`{"version":"1.14.2","address":"0123456789","publicIdentity":"0123456789:0:abcdef","online":false}200`)}, nil
	case strings.Contains(script, "/network"):
		return system.Result{Stdout: []byte("[]200")}, nil
	}
	return system.Result{Stdout: []byte("404")}, nil
}

func (e *execFake) LogText(context.Context, int, ...string) (string, error) { return "", nil }
func (e *execFake) Restart(context.Context, ...string) error                { return nil }
func (e *execFake) Up(context.Context, ...string) error                     { return nil }

func newH(t *testing.T, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "zerotier", Service: "zerotier",
		Exec:    &execFake{},
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass, "ZEROTIER_API_SECRET": token},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	var records []helpers.StepResult
	h := newH(t, &records)
	ctx := context.Background()

	if err := (zerotier.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (zerotier.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	records = nil
	if err := (zerotier.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestFailingIdentityHintNamesTheStartCommand(t *testing.T) {
	var records []helpers.StepResult
	deps := systemtest.NewDeps(t)
	h := helpers.New(helpers.Config{
		App: "zerotier", Service: "zerotier",
		Exec:    &execFake{},
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass, "ZEROTIER_API_SECRET": "wrong-token"},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { records = append(records, r) },
	})

	if err := (zerotier.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the API token does not authenticate")
	}
	var hint string
	for _, r := range records {
		if r.Status == stepstatus.StepFail {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host start zerotier") {
		t.Errorf("hint should name the start command, got %q", hint)
	}
}
