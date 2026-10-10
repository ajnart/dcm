package service

import (
	"context"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// agentApp has a hub and an agent; the agent needs a key that only Setup stores.
type agentApp struct{ testApp }

func (a *agentApp) Compose(rc app.RenderContext) string {
	return "services:\n  " + a.id + ":\n    image: example/hub:1\n  " + a.id + "-agent:\n    image: example/agent:1\n"
}

func (a *agentApp) Deferred(h *helpers.H) []string {
	if h.Secret(h.Key("agent_key")) != "" {
		return nil
	}
	return []string{a.id + "-agent"}
}

func (a *agentApp) Setup(ctx context.Context, h *helpers.H) error {
	return h.SetSecret(h.Key("agent_key"), "stored-by-setup")
}

func TestInstallLeavesAHeldBackServiceToSetupAndLaterStartsStartIt(t *testing.T) {
	h := newHarness(t, &agentApp{testApp{id: "hub", done: map[string]bool{}}})

	if err := h.install("hub"); err != nil {
		t.Fatalf("install: %v", err)
	}
	assertCalls(t, h.composeCalls(), []string{"--progress json pull hub hub-agent", "up -d --remove-orphans hub"})

	before := len(h.composeCalls())
	if err := h.svc.Start(context.Background(), []string{"hub"}); err != nil {
		t.Fatalf("start: %v", err)
	}
	assertCalls(t, h.composeCalls()[before:], []string{"up -d --remove-orphans hub hub-agent"})
}

type heldApp struct{ agentApp }

func (a *heldApp) Setup(ctx context.Context, h *helpers.H) error { return nil }

func heldBackHarness(t *testing.T) *harness {
	t.Helper()
	h := newHarness(t, &heldApp{agentApp{testApp{id: "hub", done: map[string]bool{}}}})
	if err := h.install("hub"); err != nil {
		t.Fatal(err)
	}
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " ps ") {
			return system.Result{Stdout: []byte(`[{"Service":"hub","State":"running","Health":"healthy"}]`)}
		}
		return system.Result{}
	})
	return h
}

func TestStatusReadsAHeldBackServiceAsNotMissing(t *testing.T) {
	h := heldBackHarness(t)
	status, err := h.svc.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got := status.Apps[0]; got.State != "running" {
		t.Fatalf("held-back agent degraded the App: %+v", got)
	}
}

func TestDoctorDoesNotFailAHeldBackService(t *testing.T) {
	h := heldBackHarness(t)
	for _, c := range h.svc.Doctor(context.Background()) {
		if c.App == "hub" && c.ID == "running" && c.Level != host.OK {
			t.Fatalf("running check = %+v", c)
		}
	}
}
