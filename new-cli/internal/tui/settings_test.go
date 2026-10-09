package tui

import (
	"slices"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
)

var settingsSubTabs = []string{"Host", "Appearance", "Backups", "Tools", "About"}

// activeSubTab is the one Settings sub-tab drawn in bold on the strip, the
// row below the header.
func activeSubTab(t *testing.T, m Model) string {
	t.Helper()
	strip := boldText(m.View().Content)[1]
	var found []string
	for _, name := range settingsSubTabs {
		if strings.Contains(strip, name) {
			found = append(found, name)
		}
	}
	if len(found) != 1 {
		t.Fatalf("want exactly one bold sub-tab, got %q in %q", found, strip)
	}
	return found[0]
}

func aboutHost(t *testing.T) (Model, *fakeBackend) {
	t.Helper()
	m, backend := settingsHost(t)
	for i := 0; i < 4; i++ {
		m = drive(t, m, press("]"))
	}
	return m, backend
}

func TestBracketsCycleTheFiveSettingsSubTabsAndTheStripShowsTheActiveOne(t *testing.T) {
	m, _ := settingsHost(t)

	for _, tc := range []struct{ key, active, shows string }{
		{"", "Host", "Host settings"},
		{"]", "Appearance", "Learn about Nerd Fonts"},
		{"]", "Backups", "Coming in the next update"},
		{"]", "Tools", "never installs these for you"},
		{"]", "About", "Project folder"},
		{"]", "Host", "Host settings"},
		{"[", "About", "Project folder"},
		{"[", "Tools", "never installs these for you"},
	} {
		if tc.key != "" {
			m = drive(t, m, press(tc.key))
		}
		if got := activeSubTab(t, m); got != tc.active {
			t.Fatalf("%q should make %s active, got %s", tc.key, tc.active, got)
		}
		out := screen(m)
		if !strings.Contains(out, tc.shows) {
			t.Fatalf("%s should show %q\n%s", tc.active, tc.shows, out)
		}
	}
}

func TestClickingASettingsSubTabOpensIt(t *testing.T) {
	m, _ := settingsHost(t)

	m = drive(t, m, clickMsg{id: "tab:4"})

	if got := activeSubTab(t, m); got != "About" {
		t.Fatalf("clicking About should open it, got %s", got)
	}
}

func TestBackupsIsAPlaceholderUntilItLands(t *testing.T) {
	m, _ := settingsHost(t)
	grey := "\x1b[38;2;138;138;138m"

	for _, name := range []string{"Backups"} {
		m = drive(t, m, press("]"))
		m = drive(t, m, press("]"))
		raw := m.View().Content
		if !strings.Contains(raw, grey+"Coming in the next update") {
			t.Errorf("%s: the placeholder should be dim\n%s", name, ansi.Strip(raw))
		}
		m = drive(t, m, press("["))
		m = drive(t, m, press("["))
		m = drive(t, m, press("]"))
	}
}

func TestHostSettingsKeepTheirEditsWhileAnotherSubTabIsOpen(t *testing.T) {
	m, _ := settingsHost(t)

	m = drive(t, m, press("space")) // EXPOSURE: lan → local
	m = drive(t, m, press("]"))
	m = drive(t, m, press("["))

	if out := screen(m); !strings.Contains(out, "lan → local") || !strings.Contains(out, "1 pending") {
		t.Fatalf("the pending change should survive a sub-tab switch\n%s", out)
	}
}

func TestEscapeFromAnotherSubTabAsksToDiscardOnTheHostSubTab(t *testing.T) {
	m, backend := settingsHost(t)

	m = drive(t, m, press("space"))
	m = drive(t, m, press("]"))
	m = drive(t, m, press("esc"))

	if got := activeSubTab(t, m); got != "Host" || !strings.Contains(screen(m), "discard 1 changes? y/n") {
		t.Fatalf("the question must be on screen, sub-tab %s\n%s", got, screen(m))
	}
	m = drive(t, m, press("y"))
	if m.surface != surfaceDashboard || len(backend.Actions()) != 0 {
		t.Fatal("y should discard and return without applying")
	}
}

func TestAboutShowsTheVersionProjectFolderAndUpdateStatus(t *testing.T) {
	for _, tc := range []struct {
		name, latest, want string
		checked            bool
	}{
		{"newer release", "v1.2.0", "↑ v1.2.0 is available: run self-host self-update", true},
		{"current", "v1.0.0", "✓ up to date", true},
		{"not looked up", "", "? not checked", false},
	} {
		m, _ := aboutHost(t)
		if tc.checked {
			m = drive(t, m, releaseMsg{version: tc.latest})
		}

		out := screen(m)

		for _, want := range []string{"Version", "v1.0.0", "Project folder", "/home/alice/.self-host", "Updates", tc.want} {
			if !strings.Contains(out, want) {
				t.Errorf("%s: About lacks %q\n%s", tc.name, want, out)
			}
		}
	}
}

func TestAboutKeysOpenTheDonationPages(t *testing.T) {
	m, backend := aboutHost(t)

	m = drive(t, m, press("c"))
	if !slices.Equal(backend.opened, []string{"https://ko-fi.com/ajnart"}) {
		t.Fatalf("c should open Ko-fi, opened %v", backend.opened)
	}
	m = drive(t, m, press("s"))

	if !slices.Equal(backend.opened, []string{"https://ko-fi.com/ajnart", "https://github.com/sponsors/ajnart"}) {
		t.Fatalf("s should open GitHub Sponsors, opened %v", backend.opened)
	}
	if status := statusLine(screen(m)); !strings.Contains(status, "opened https://github.com/sponsors/ajnart") {
		t.Fatalf("the status line should say what opened: %q", status)
	}
}

func TestAboutOffersTheDonationPagesAsKeysAndTerminalLinks(t *testing.T) {
	m, _ := aboutHost(t)

	out := screen(m)
	for _, want := range []string{"c  buy us a coffee", "https://ko-fi.com/ajnart", "s  sponsor on GitHub", "https://github.com/sponsors/ajnart"} {
		if !strings.Contains(out, want) {
			t.Errorf("About lacks %q\n%s", want, out)
		}
	}
	view := m.settings.View(m.ctx(), 120, 30)
	for _, url := range []string{"https://ko-fi.com/ajnart", "https://github.com/sponsors/ajnart"} {
		if !strings.Contains(view, ansi.SetHyperlink(url)) {
			t.Errorf("%s is not an OSC 8 hyperlink: %q", url, view)
		}
	}
}

func TestDonationKeysDoNothingOutsideAbout(t *testing.T) {
	m, backend := settingsHost(t)

	for _, k := range []string{"c", "s", "]", "c", "s"} {
		m = drive(t, m, press(k))
	}

	if len(backend.opened) != 0 {
		t.Fatalf("c and s belong to About, opened %v", backend.opened)
	}
}

func TestSettingsViewWithoutAModelShowsAbout(t *testing.T) {
	backend := &fakeBackend{}
	ctx := testViewContext(backend)
	ctx.version = "1.4.0"
	ctx.latest = "v1.5.0"
	var v view = newSettingsView(ctx)

	for i := 0; i < 4; i++ {
		v, _, _ = v.Update(ctx, press("]"))
	}
	out := ansi.Strip(v.View(ctx, 120, 30))
	for _, want := range []string{"v1.4.0", "/home/alice/.self-host", "↑ v1.5.0 is available"} {
		if !strings.Contains(out, want) {
			t.Errorf("About lacks %q\n%s", want, out)
		}
	}
	v, cmd, _ := v.Update(ctx, press("c"))
	if cmd == nil {
		t.Fatal("c should open Ko-fi")
	}
	cmd()
	if !slices.Equal(backend.opened, []string{"https://ko-fi.com/ajnart"}) {
		t.Fatalf("opened %v", backend.opened)
	}
}
