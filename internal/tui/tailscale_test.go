package tui

import (
	"slices"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/tailscale"
	"github.com/ajnart/self-host/internal/catalog"
)

func withTailscale(cat *catalog.Catalog) *catalog.Catalog {
	return catalog.New(append(slices.Clone(cat.Apps()), app.App(tailscale.App{})), cat.Recipes())
}

func TestOnboardingTailscaleAsksPrivatelyBeforeReview(t *testing.T) {
	m, backend := freshHost(t)
	backend.catalog = withTailscale(backend.Catalog())
	m = atAccess(t, m)
	for _, key := range []string{"down", "down", "enter"} {
		m = drive(t, m, press(key))
	}
	if !strings.Contains(screen(m), "Tailscale auth key") || m.onboarding.form == nil {
		t.Fatalf("Access must ask for the key privately before leaving\n%s", screen(m))
	}
	m = typeText(t, m, "synthetic-private-key")
	if strings.Contains(screen(m), "synthetic-private-key") {
		t.Fatal("private input is visible")
	}
	m = drive(t, m, press("enter"))
	if m.onboarding.step != stepWho {
		t.Fatalf("completed private input should reach Who, got %v", m.onboarding.step)
	}
	p := m.planFromAnswers(m.onboarding.answers)
	if !slices.Contains(p.opts.Targets, "tailscale") || p.opts.PrivateInputs["tailscale"]["auth_key"] != "synthetic-private-key" || p.opts.Exposure != "lan" {
		t.Fatalf("Access must add Tailscale without replacing Home network")
	}
	if len(backend.Actions()) != 0 {
		t.Fatal("choosing Access must not apply before approval")
	}
}

func TestSettingsTailscaleOpensAnApprovedInstallReview(t *testing.T) {
	m, backend := sample(t, 80, 24)
	backend.catalog = withTailscale(backend.Catalog())
	for _, key := range []string{"5", "]", "down", "down", "enter"} {
		m = drive(t, m, press(key))
	}
	if m.surface != surfaceInstall || !strings.Contains(screen(m), "Tailscale auth key") {
		t.Fatalf("Settings must open Tailscale's private install review\n%s", screen(m))
	}
	if len(backend.Actions()) != 0 {
		t.Fatal("opening review must not run an Action")
	}
}
