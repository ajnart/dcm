package tui

import (
	"slices"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/service"
)

var settingsSubTabs = []string{"Host", "Access", "Appearance", "Backups", "Tools", "About"}

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
	for i := 0; i < 5; i++ {
		m = drive(t, m, press("]"))
	}
	return m, backend
}

func TestBracketsCycleTheSixSettingsSubTabsAndTheStripShowsTheActiveOne(t *testing.T) {
	m, _ := settingsHost(t)

	for _, tc := range []struct{ key, active, shows string }{
		{"", "Host", "Host settings"},
		{"]", "Access", "Home network (default)"},
		{"]", "Appearance", "Learn about Nerd Fonts"},
		{"]", "Backups", "No backups yet"},
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

	m = drive(t, m, clickMsg{id: "tab:5"})

	if got := activeSubTab(t, m); got != "About" {
		t.Fatalf("clicking About should open it, got %s", got)
	}
}

func TestHostSettingsKeepTheirEditsWhileAnotherSubTabIsOpen(t *testing.T) {
	m, _ := settingsHostWith(t, service.ExposureLocal)

	m = pickHomeNetwork(t, m) // access: this computer only → Home network
	m = drive(t, m, press("]"))
	m = drive(t, m, press("["))

	if out := screen(m); !strings.Contains(out, "This computer only → Home network") || !strings.Contains(out, "1 pending") {
		t.Fatalf("the pending change should survive a sub-tab switch\n%s", out)
	}
}

func TestEscapeFromAnotherSubTabAsksToDiscardOnTheHostSubTab(t *testing.T) {
	m, backend := settingsHostWith(t, service.ExposureLocal)

	m = pickHomeNetwork(t, m)
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

	for i := 0; i < 5; i++ {
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

func TestSettingsAccessSubTabListsTheFiveOptionsAndExplainsTheHighlightedOne(t *testing.T) {
	m, _ := settingsHost(t)

	m = drive(t, m, press("]"))

	out := screen(m)
	last := -1
	for _, want := range []string{"● Home network (default)", "○ Easy names at home · coming soon", "○ From anywhere, privately",
		"○ Your own web address", "○ Bring your own"} {
		at := strings.Index(out, want)
		if at <= last {
			t.Fatalf("%q should follow the options before it\n%s", want, out)
		}
		last = at
	}
	if !strings.Contains(flat(out), lanExplanation) || !strings.Contains(out, "phones · TVs · laptops ──── router ──── this computer 192.168.1.20") {
		t.Fatalf("the highlighted option shows the explanation and the diagram Onboarding does\n%s", out)
	}
	if len(m.settings.pairs()) != 0 {
		t.Fatalf("opening the sub-tab changes nothing, pairs %v", m.settings.pairs())
	}
}

func TestSettingsHostSubTabNoLongerHasAnAccessRow(t *testing.T) {
	m, _ := settingsHost(t)

	out := screen(m)

	if strings.Contains(out, "EXPOSURE") || !strings.Contains(out, "> LAN_IP") {
		t.Fatalf("the Access choice moved to its own sub-tab\n%s", out)
	}
}

func TestSettingsAccessSubTabShowsTheComputerOnlyAccessInUse(t *testing.T) {
	m, _ := settingsHostWith(t, service.ExposureLocal)

	m = drive(t, m, press("]"))

	out := screen(m)
	if !strings.Contains(out, "Now This computer only") || strings.Contains(out, "● Home network") || !strings.Contains(out, "○ Home network (default)") {
		t.Fatalf("the sub-tab says what is in use and offers Home network\n%s", out)
	}
	m = drive(t, m, press("enter"))
	if got := m.settings.pairs(); len(got) != 1 || got[0] != "EXPOSURE=lan" || !strings.Contains(screen(m), "Home network (default) (pending)") {
		t.Fatalf("choosing Home network pends EXPOSURE=lan, pairs %v\n%s", got, screen(m))
	}
}

func TestSettingsAccessAppliesTheChosenOptionWithCtrlS(t *testing.T) {
	m, backend := settingsHostWith(t, service.ExposureLocal)
	m = drive(t, m, press("]"))
	m = drive(t, m, press("enter"))

	m = drive(t, m, ctrlS())

	if got := backend.Actions(); !slices.Equal(got, []string{"config EXPOSURE=lan"}) {
		t.Fatalf("actions %v", got)
	}
}

func TestQuestionMarkOpensTheHelpPageOfTheHighlightedAccessOptionAndEscCloses(t *testing.T) {
	m, _ := settingsHost(t)
	m = drive(t, m, press("]"))

	m = drive(t, m, press("?"))

	page := flat(screen(m))
	for _, want := range []string{"What is a LAN address?", "Nobody on the internet can open your Apps unless your router forwards ports", "╭", "Technical details"} {
		if !strings.Contains(page, want) {
			t.Fatalf("the Settings help page lacks %q\n%s", want, screen(m))
		}
	}
	if strings.Contains(page, "highlight an Action") {
		t.Fatalf("on the Access sub-tab ? opens the option's page, not the key reference\n%s", screen(m))
	}
	m = drive(t, m, press("esc"))
	if m.showHelp || m.surface != surfaceSettings || strings.Contains(screen(m), "What is a LAN address?") {
		t.Fatalf("esc closes the page and stays in Settings\n%s", screen(m))
	}
	m = drive(t, m, press("down"))
	m = drive(t, m, press("?"))
	if page = flat(screen(m)); !strings.Contains(page, "Easy names at home") || !strings.Contains(page, "A Caddy container on this computer will own port 80") {
		t.Fatalf("the page follows the highlight\n%s", screen(m))
	}
	m = drive(t, m, press("?"))
	if m.showHelp || m.settings.accessCursor != 1 {
		t.Fatalf("? closes the page and keeps the highlight, cursor %d", m.settings.accessCursor)
	}
}

func TestQuestionMarkOffTheAccessSubTabStillOpensTheKeyReference(t *testing.T) {
	m, _ := settingsHost(t)

	m = drive(t, m, press("?"))

	if page := screen(m); !strings.Contains(page, "Keys") || strings.Contains(page, "What is a LAN address?") {
		t.Fatalf("on the Host sub-tab ? is the global Help\n%s", page)
	}
	m = drive(t, m, press("x")) // any key closes the key reference
	m = drive(t, m, press("5"))
	m = drive(t, m, press("]"))
	m = drive(t, m, press("]"))
	m = drive(t, m, press("?"))
	if page := screen(m); !strings.Contains(page, "Keys") {
		t.Fatalf("on the other sub-tabs ? is the global Help\n%s", page)
	}
}

func TestQuestionMarkTypesWhileEditingASetting(t *testing.T) {
	m, _ := settingsHost(t)
	m = drive(t, m, press("down"))
	m = drive(t, m, press("down")) // TZ
	m = drive(t, m, press("enter"))

	m = drive(t, m, press("?"))

	if got := m.settings.input.Value(); !strings.HasSuffix(got, "?") || m.showHelp {
		t.Fatalf("? while editing types a question mark, input %q", got)
	}
}

func TestSettingsBarOffersMoreOnlyOnTheAccessSubTab(t *testing.T) {
	m, _ := settingsHost(t)
	bar := func(m Model) string { return strings.Join(strings.Fields(lastLine(screen(m))), " ") }

	if got := bar(m); strings.Contains(got, "? more") || !strings.Contains(got, "? help") {
		t.Fatalf("on Host the ? entry is help: %q", got)
	}
	m = drive(t, m, press("]"))
	if got := bar(m); !strings.Contains(got, "? more") || strings.Contains(got, "? help") {
		t.Fatalf("on Access the one ? entry is more: %q", got)
	}
}

func TestChoosingAnAccessOptionNotBuiltYetChangesNothingInSettings(t *testing.T) {
	for downs, name := range map[int]string{1: "Easy names at home"} {
		m, backend := settingsHost(t)
		m = drive(t, m, press("]"))
		for range downs {
			m = drive(t, m, press("down"))
		}

		m = drive(t, m, press("enter"))

		if out := flat(screen(m)); !strings.Contains(out, name+" is coming soon; your Apps stay on your network") {
			t.Fatalf("%s: enter says it is coming soon\n%s", name, screen(m))
		}
		if len(m.settings.pairs()) != 0 || len(backend.Actions()) != 0 || m.settings.accessCursor != downs {
			t.Fatalf("%s: enter changes nothing, pairs %v actions %v", name, m.settings.pairs(), backend.Actions())
		}
		if out := screen(m); !strings.Contains(out, "● Home network (default)") || strings.Contains(out, "(pending)") {
			t.Fatalf("%s: Home network stays the selected option\n%s", name, out)
		}
	}
}

func TestChoosingBringYourOwnInSettingsExplainsAndChangesNothing(t *testing.T) {
	m, backend := settingsHost(t)
	m = drive(t, m, press("]"))
	for range 4 {
		m = drive(t, m, press("down"))
	}

	m = drive(t, m, press("enter"))

	if out := flat(screen(m)); !strings.Contains(out, "Nothing changes: your Apps stay on your network. Run: self-host access export") {
		t.Fatalf("enter points at the command\n%s", screen(m))
	}
	if len(m.settings.pairs()) != 0 || len(backend.Actions()) != 0 {
		t.Fatalf("enter changes nothing, pairs %v actions %v", m.settings.pairs(), backend.Actions())
	}
	if out := screen(m); !strings.Contains(out, "● Home network (default)") || strings.Contains(out, "(pending)") {
		t.Fatalf("Home network stays the selected option\n%s", out)
	}
}

func TestSettingsAccessKeepsTheRunningActionsProgressLine(t *testing.T) {
	m, _ := settingsHost(t)
	m = drive(t, m, press("2"))
	m = drive(t, m, press("a"))
	m = drive(t, m, press("t"))
	next, _ := m.Update(press("enter"))
	m = next.(Model)
	m = drive(t, m, press("5"))
	m = drive(t, m, press("]"))

	m = drive(t, m, press("down"))

	if !strings.Contains(statusLine(screen(m)), "restart jellyfin") {
		t.Fatalf("hides the running Action\n%s", screen(m))
	}
}
