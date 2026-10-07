package tui

import (
	"strings"
	"testing"

	"charm.land/bubbles/v2/help"
	"charm.land/bubbles/v2/spinner"
	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/service"
)

// testViewContext is a viewContext over a small fake Backend, with no Model.
func testViewContext(backend Backend) *viewContext {
	return &viewContext{
		width: 120, height: 30,
		theme:   newTheme(true),
		keys:    newKeyMap(),
		help:    help.New(),
		spin:    spinner.New(spinner.WithSpinner(spinner.MiniDot)),
		backend: backend,
		tasks:   &taskManager{},
		status:  sampleStatus(),
	}
}

func TestDashboardViewWithoutAModel(t *testing.T) {
	v := newDashboardView()
	ctx := testViewContext(&fakeBackend{})

	out := ansi.Strip(v.View(ctx, 120, 30))
	for _, want := range []string{"Jellyfin", "Needs action"} {
		if !strings.Contains(out, want) {
			t.Fatalf("dashboard view lacks %q\n%s", want, out)
		}
	}

	next, _, _ := v.Update(ctx, press("down"))
	v = next.(*dashboardView)
	if app, ok := v.selected(ctx); !ok || app.ID != "sonarr" {
		t.Fatalf("down should select sonarr, got %+v", app)
	}
}

func TestInstallViewWithoutAModel(t *testing.T) {
	backend := &fakeBackend{catalog: wizardCatalog()}
	ctx := testViewContext(backend)
	v := newInstallView(ctx)

	next, _, _ := v.Update(ctx, press("/"))
	v = next.(*installView)
	for _, r := range "ntfy" {
		next, _, _ = v.Update(ctx, press(string(r)))
		v = next.(*installView)
	}

	rows := v.rows(ctx)
	if len(rows) != 1 || rows[0].key != "app:ntfy" {
		t.Fatalf("filter should narrow to ntfy: %+v", rows)
	}
}

func TestSettingsViewWithoutAModel(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	v := newSettingsView(ctx)

	next, _, _ := v.Update(ctx, press("space"))
	v = next.(*settingsView)

	if pairs := v.pairs(); len(pairs) != 1 || pairs[0] != "EXPOSURE=local" {
		t.Fatalf("space on EXPOSURE should pend local: %v", pairs)
	}
}

func TestStackViewWithoutAModel(t *testing.T) {
	backend := &fakeBackend{containers: []service.ContainerStatus{
		{App: "jellyfin", Service: "jellyfin", State: "running", Health: "healthy"},
	}}
	ctx := testViewContext(backend)
	ctx.containers = backend.containers

	out := ansi.Strip((&stackView{}).View(ctx, 120, 30))
	for _, want := range []string{"jellyfin", "1 container", "1 running"} {
		if !strings.Contains(out, want) {
			t.Fatalf("stack view lacks %q\n%s", want, out)
		}
	}
}

func TestHelpViewWithoutAModel(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	v := newHelpView()
	v.open(ctx)

	out := ansi.Strip(v.View(ctx, 120, 30))
	for _, want := range []string{"Keys", "start/stop", "copy password"} {
		if !strings.Contains(out, want) {
			t.Fatalf("help view lacks %q\n%s", want, out)
		}
	}
}
