package tui

import (
	"context"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/service"
)

type stubApp struct {
	info   app.Info
	inputs []app.Input
	links  []app.Link
}

func (s stubApp) Info() app.Info                          { return s.info }
func (s stubApp) Inputs() []app.Input                     { return s.inputs }
func (s stubApp) Compose(app.RenderContext) string        { return "" }
func (s stubApp) Setup(context.Context, *helpers.H) error { return nil }
func (s stubApp) Check(context.Context, *helpers.H) error { return nil }
func (s stubApp) Links() []app.Link                       { return s.links }

func wizardCatalog() *catalog.Catalog {
	return catalog.New([]app.App{
		stubApp{info: app.Info{ID: "homarr", Name: "Homarr", Description: "Dashboard", Image: "ghcr.io/homarr-labs/homarr:latest", Port: 7575}},
		stubApp{info: app.Info{ID: "ntfy", Name: "ntfy", Description: "Notifications", Image: "binwiederhier/ntfy:latest", Port: 2586},
			links: []app.Link{{ID: "homarr-tile", Target: "homarr", Title: "show ntfy in Homarr"}}},
		stubApp{info: app.Info{ID: "jellyfin", Name: "Jellyfin", Description: "Media server", Image: "lscr.io/linuxserver/jellyfin:latest", Port: 8096, UsesMedia: true},
			inputs: []app.Input{{Key: "server_name", Prompt: "Server name", Default: "Home"}}},
	}, []catalog.Recipe{{ID: "media", Name: "Media", Description: "Watch your movies", Apps: []string{"jellyfin"}}})
}

func freshHost(t *testing.T) (Model, *fakeBackend) {
	t.Helper()
	backend := &fakeBackend{catalog: wizardCatalog(), checks: []host.Check{
		{ID: "docker", Title: "Docker", Level: host.OK, Detail: "docker command found"},
		{ID: "compose", Title: "Docker Compose", Level: host.OK, Detail: "compose 2.29"},
	}}
	m := New(backend, Options{Version: "1.0.0"})
	m = drive(t, m, statusMsgFor(service.ErrNoProject))
	m = update(t, m, doctorMsg{checks: backend.checks})
	m = update(t, m, windowSize(120, 40))
	return m, backend
}

func typeText(t *testing.T, m Model, text string) Model {
	for _, r := range text {
		m = drive(t, m, press(string(r)))
	}
	return m
}

func TestFreshHostOpensTheWizardWithHostChecks(t *testing.T) {
	m, _ := freshHost(t)

	out := screen(m)
	if m.wizard == nil || !strings.Contains(out, "Welcome") || !strings.Contains(out, "Docker Compose") {
		t.Fatalf("wizard not shown\n%s", out)
	}
}

func TestWizardInstallsTheSelectionWithReviewedSettings(t *testing.T) {
	m, backend := freshHost(t)

	m = drive(t, m, press("enter")) // welcome -> form
	m = drive(t, m, press("enter")) // exposure: local network (default)
	for i := 0; i < 3; i++ {        // selection: Media, Homarr (pre-selected), Jellyfin, ntfy
		m = drive(t, m, press("down"))
	}
	m = drive(t, m, press("x"))     // toggle ntfy
	m = drive(t, m, press("enter")) // submit selection
	for i := 0; i < 4; i++ {        // TZ, LAN IP, PUID, PGID keep defaults
		m = drive(t, m, press("enter"))
	}
	m = drive(t, m, press("enter"))    // admin user: admin
	m = typeText(t, m, "hunter2-long") // admin password
	m = drive(t, m, press("enter"))

	out := screen(m)
	for _, want := range []string{"Review", "Homarr", "ntfy", "binwiederhier/ntfy:latest", "local network", "show ntfy in Homarr"} {
		if !strings.Contains(out, want) {
			t.Fatalf("review lacks %q\n%s", want, out)
		}
	}
	if len(backend.Actions()) != 0 {
		t.Fatal("nothing may be installed before the review is accepted")
	}

	m = drive(t, m, press("enter"))

	got := backend.installs()
	if len(got) != 1 {
		t.Fatalf("installs %v", got)
	}
	opts := got[0]
	if strings.Join(opts.Targets, ",") != "homarr,ntfy" || opts.Exposure != "lan" || opts.AdminPassword != "hunter2-long" || opts.Settings["TZ"] == "" {
		t.Fatalf("install options %+v", opts)
	}
}

func TestWizardAsksForMediaFoldersOnlyWhenNeeded(t *testing.T) {
	m, backend := freshHost(t)
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("x")) // Jellyfin, right after the pre-selected Homarr
	m = drive(t, m, press("enter"))
	for i := 0; i < 4; i++ {
		m = drive(t, m, press("enter"))
	}

	if !strings.Contains(screen(m), "Media folder") {
		t.Fatalf("media folders not asked\n%s", screen(m))
	}
	_ = backend
}

func TestCancellingTheWizardWritesNothing(t *testing.T) {
	m, backend := freshHost(t)
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter"))

	m = drive(t, m, ctrlC())

	if len(backend.Actions()) != 0 || m.wizard == nil || !strings.Contains(screen(m), "Welcome") {
		t.Fatalf("cancel should return to the welcome step without installing\n%s", screen(m))
	}
}
