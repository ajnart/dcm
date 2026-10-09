package service

import (
	"context"
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
