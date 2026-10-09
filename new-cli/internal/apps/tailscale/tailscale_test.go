package tailscale_test

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/tailscale"
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

// execFake models tailscale up/status inside the container.
type execFake struct {
	mu       sync.Mutex
	enrolled bool
}

func (e *execFake) Exec(_ context.Context, _ string, _ map[string]string, command ...string) (system.Result, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(command) >= 2 && command[0] == "tailscale" {
		switch command[1] {
		case "up":
			e.enrolled = true
		case "status":
			state := "Stopped"
			if e.enrolled {
				state = "Running"
			}
			body, _ := json.Marshal(map[string]any{"BackendState": state})
			return system.Result{Stdout: body}, nil
		}
	}
	return system.Result{}, nil
}

func (e *execFake) LogText(context.Context, int, ...string) (string, error) { return "", nil }
func (e *execFake) Restart(context.Context, ...string) error                { return nil }

func newH(t *testing.T, records *[]helpers.StepResult, inputs map[string]string) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "tailscale", Service: "tailscale",
		Inputs:  inputs,
		Exec:    &execFake{},
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	var records []helpers.StepResult
	h := newH(t, &records, map[string]string{"auth_key": "tskey-auth-example"})
	ctx := context.Background()

	if err := (tailscale.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (tailscale.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	records = nil
	if err := (tailscale.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestMissingAuthKeyHintNamesTheKeyPage(t *testing.T) {
	var records []helpers.StepResult
	h := newH(t, &records, map[string]string{})

	if err := (tailscale.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when no auth key was supplied")
	}
	var hint string
	for _, r := range records {
		if r.Status == stepstatus.StepFail {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "login.tailscale.com") {
		t.Errorf("hint should name where to get the auth key, got %q", hint)
	}
}
