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
	for _, key := range []string{"down", "down", "space", "enter"} {
		m = drive(t, m, press(key))
	}
	if !strings.Contains(screen(m), "Tailscale auth key") || m.onboarding.form == nil {
		t.Fatalf("Access must ask for the key privately before leaving\n%s", screen(m))
	}
	m = typeText(t, m, "synthetic-private-key")
	if strings.Contains(screen(m), "synthetic-private-key") {
		t.Fatal("private input is visible")
	}
	m = drive(t, m, press("?"))
	if m.showHelp || *m.onboarding.answers.inputs["tailscale.auth_key"] != "synthetic-private-key?" {
		t.Fatal("question mark must remain private input, not open help")
	}
	m = drive(t, m, press("enter"))
	if m.onboarding.step != stepWho {
		t.Fatalf("completed private input should reach Who, got %v", m.onboarding.step)
	}
	p := planFromAnswers(m.backend, m.onboarding.answers)
	if !slices.Contains(p.opts.Targets, "tailscale") || p.opts.PrivateInputs["tailscale"]["auth_key"] != "synthetic-private-key?" || p.opts.Exposure != "lan" {
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
	m = typeText(t, m, "synthetic-private-key")
	if strings.Contains(screen(m), "synthetic-private-key") {
		t.Fatal("Settings review must conceal its key")
	}
	m = drive(t, m, press("enter"))
	installs := backend.installs()
	if len(installs) != 1 || installs[0].PrivateInputs["tailscale"]["auth_key"] != "synthetic-private-key" || len(installs[0].Sets) != 0 {
		t.Fatal("approved Settings install must carry the key only as a private input")
	}
}

func TestInstallReviewNamesPrivateAccessBeforeApproval(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.catalog = withTailscale(goldenCatalog())
	m.status.Access = []string{"home", "tailscale"}
	ctx := m.ctx()
	v := newInstallView(ctx)
	v.picked = picks{"ntfy": true}
	v.planPicked(ctx)
	if !strings.Contains(renderPlan(m.theme, v.plan, "approve"), "Private: ntfy (only missing nodes while Tailscale is on)") {
		t.Fatal("review must name the App whose private Access may start")
	}
	if len(backend.Actions()) != 0 {
		t.Fatal("review must not start Access")
	}
}
