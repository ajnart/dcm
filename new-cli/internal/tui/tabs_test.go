package tui

import (
	"fmt"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/service"
)

var tabLabels = []string{"1 Overview", "2 Apps", "3 Activity", "4 Catalog", "5 Settings"}

// activeTab is the one tab label drawn in bold on the header row.
func activeTab(t *testing.T, m Model) string {
	t.Helper()
	header := boldText(m.View().Content)[0]
	var found []string
	for _, label := range tabLabels {
		if strings.Contains(header, label) {
			found = append(found, label)
		}
	}
	if len(found) != 1 {
		t.Fatalf("want exactly one bold tab, got %q in %q", found, header)
	}
	return found[0]
}

func TestNumberKeysSwitchTabs(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.catalog = wizardCatalog()

	for _, tc := range []struct{ key, tab, shows string }{
		{"4", "4 Catalog", "Watch your movies"},
		{"2", "2 Apps", "● ◇ Jellyfin         running"},
		{"3", "3 Activity", "fully set up"},
		{"5", "5 Settings", "Host settings"},
		{"1", "1 Overview", "Needs attention"},
	} {
		m = drive(t, m, press(tc.key))
		if got := activeTab(t, m); got != tc.tab {
			t.Fatalf("%s should make %q active, got %q", tc.key, tc.tab, got)
		}
		if !strings.Contains(screen(m), tc.shows) {
			t.Fatalf("%s should show %q\n%s", tc.key, tc.shows, screen(m))
		}
	}
}

func TestArrowsCycleTabsAndWrap(t *testing.T) {
	m, _ := sample(t, 120, 30)

	for _, tc := range []struct{ key, tab string }{
		{"right", "2 Apps"}, {"right", "3 Activity"}, {"left", "2 Apps"},
		{"left", "1 Overview"}, {"left", "5 Settings"}, {"right", "1 Overview"},
	} {
		m = drive(t, m, press(tc.key))
		if got := activeTab(t, m); got != tc.tab {
			t.Fatalf("%s should make %q active, got %q", tc.key, tc.tab, got)
		}
	}
}

func TestInactiveTabsAreGrey(t *testing.T) {
	m, _ := sample(t, 120, 30)
	m = drive(t, m, press("3"))

	header := strings.Split(m.View().Content, "\n")[0]
	grey := "\x1b[38;2;138;138;138m"
	for _, label := range tabLabels {
		if strings.Contains(header, grey+label) == (label == "3 Activity") {
			t.Errorf("%q should be grey only when inactive: %q", label, header)
		}
	}
}

func TestClickingATabSwitchesToIt(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.catalog = wizardCatalog()

	m = drive(t, m, clickMsg{id: "nav:install"})

	if got := activeTab(t, m); got != "4 Catalog" {
		t.Fatalf("clicking Catalog made %q active", got)
	}
}

func numberedCompose(n int) string {
	var lines []string
	for i := 1; i <= n; i++ {
		lines = append(lines, fmt.Sprintf("line %02d", i))
	}
	return strings.Join(lines, "\n")
}

func TestTabDoesNotSwitchSubTabsAnyMore(t *testing.T) {
	m, _ := appsHost(t)

	m = drive(t, m, press("tab"))

	if out := screen(m); strings.Contains(out, "Setup has finished") || !strings.Contains(out, "ready on :80") {
		t.Fatalf("tab moves focus; the logs sub-tab should stay\n%s", out)
	}
}

func TestBarShowsGlobalKeysAndTheFocusedPaneKeys(t *testing.T) {
	m, _ := sample(t, 120, 30)

	bar := lastLine(screen(m))
	for _, want := range []string{"1-5 tabs", "←/→", "A Project", "? help", "q quit", "↑/↓  select", "enter  go to App"} {
		if !strings.Contains(bar, want) {
			t.Errorf("Apps pane bar lacks %q: %q", want, bar)
		}
	}

	m = drive(t, m, press("tab"))
	bar = lastLine(screen(m))
	if !strings.Contains(bar, "a  resolve") || strings.Contains(bar, "o  open") || !strings.Contains(bar, "1-5 tabs") {
		t.Errorf("the Needs attention bar should offer resolving, not opening: %q", bar)
	}

	m = drive(t, m, press("3"))
	bar = lastLine(screen(m))
	if !strings.Contains(bar, "space  collapse") || strings.Contains(bar, "o  open") {
		t.Errorf("Activity bar should show only Activity keys: %q", bar)
	}
}

func TestBarKeepsGlobalKeysAtEightyColumns(t *testing.T) {
	m, _ := sample(t, 80, 24)

	bar := lastLine(screen(m))

	if ansi.StringWidth(bar) > 80 || !strings.HasPrefix(strings.TrimSpace(bar), "1-5 tabs") || !strings.Contains(bar, "q quit") {
		t.Fatalf("global keys must stay visible at 80 columns: %q", bar)
	}
	if !strings.HasSuffix(strings.TrimRight(bar, " "), "…") {
		t.Fatalf("pane chips that do not fit should end in …: %q", bar)
	}
}

func TestStatusLineSitsAboveTheBar(t *testing.T) {
	m, _ := sample(t, 120, 30)

	m = drive(t, m, flashMsg{text: "copied Admin password", level: levelOK})

	lines := strings.Split(screen(m), "\n")
	if !strings.Contains(lines[len(lines)-2], "copied Admin password") || !strings.Contains(lines[len(lines)-1], "1-5 tabs") {
		t.Fatalf("the status line belongs above the bar\n%s", screen(m))
	}
}

// quits reports whether cmd, run like the runtime would, asks to quit.
func quits(cmd tea.Cmd) bool {
	if cmd == nil {
		return false
	}
	done := make(chan tea.Msg, 1)
	go func() { done <- cmd() }()
	select {
	case msg := <-done:
		switch msg := msg.(type) {
		case tea.QuitMsg:
			return true
		case tea.BatchMsg:
			for _, c := range msg {
				if quits(c) {
					return true
				}
			}
		}
	case <-time.After(200 * time.Millisecond):
	}
	return false
}

func TestTypedTextIsNotSwallowedByGlobalKeys(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.catalog = wizardCatalog()
	m = drive(t, m, press("4"))
	m = drive(t, m, press("/"))

	for _, k := range []string{"1", "?", "[", "]", "5"} {
		m = drive(t, m, press(k))
	}
	next, cmd := m.Update(press("q"))
	m = next.(Model)

	if quits(cmd) {
		t.Fatal("q while typing a search must not quit")
	}
	if got := activeTab(t, m); got != "4 Catalog" {
		t.Fatalf("digits while typing must not switch tabs, got %q", got)
	}
	if out := screen(m); !strings.Contains(out, "/ 1?[]5q") || strings.Contains(out, "any other key closes") {
		t.Fatalf("typed keys should land in the search\n%s", out)
	}
	if bar := lastLine(screen(m)); strings.Contains(bar, "1-5 tabs") || !strings.Contains(bar, "typing") {
		t.Fatalf("while typing, the bar should say keys go to the input: %q", bar)
	}
}

func TestSettingsEditTakesDigitsAndBrackets(t *testing.T) {
	m, _ := settingsHost(t)

	m = drive(t, m, press("down"))
	m = drive(t, m, press("down")) // TZ
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("ctrl+u"))
	m = typeText(t, m, "Etc/GMT+1[2]")
	m = drive(t, m, press("enter"))

	if got := activeTab(t, m); got != "5 Settings" {
		t.Fatalf("digits while editing must not switch tabs, got %q", got)
	}
	if !strings.Contains(screen(m), "Europe/Paris → Etc/GMT+1[2]") {
		t.Fatalf("the typed value should be pending\n%s", screen(m))
	}
}

func TestActivitySearchTakesDigits(t *testing.T) {
	m, _ := sample(t, 120, 30)
	m = drive(t, m, press("3"))

	m = drive(t, m, press("/"))
	m = typeText(t, m, "2")

	if got := activeTab(t, m); got != "3 Activity" || !strings.Contains(screen(m), "/2") {
		t.Fatalf("2 while searching Activity should be text, tab %q\n%s", got, screen(m))
	}
}

func TestTabContentsPersistAcrossSwitches(t *testing.T) {
	m, backend := settingsHost(t)
	backend.catalog = wizardCatalog()

	m = drive(t, m, press("space")) // EXPOSURE: lan → local, pending
	m = drive(t, m, press("4"))
	m = drive(t, m, press("space")) // pick the Media Recipe
	m = drive(t, m, press("1"))
	m = drive(t, m, press("4"))
	if !strings.Contains(screen(m), "[x]") {
		t.Fatalf("the Catalog pick should survive a tab switch\n%s", screen(m))
	}
	m = drive(t, m, press("5"))
	if out := screen(m); !strings.Contains(out, "Pending changes") || !strings.Contains(out, "lan → local") {
		t.Fatalf("the pending Settings change should survive a tab switch\n%s", out)
	}
}

func TestEnteringSettingsLoadsTheHostReview(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.review = []service.SettingReview{
		{Key: "LAN_IP", Current: "192.168.1.20", Detected: "192.168.0.12", Drift: true, Note: "not an address of this machine any more"},
	}

	m = drive(t, m, press("5"))

	if !strings.Contains(screen(m), "not an address of this machine any more") {
		t.Fatalf("entering Settings should load the Host review\n%s", screen(m))
	}
}

func TestHelpGroupsGlobalKeysThenEachTab(t *testing.T) {
	m, _ := sample(t, 140, 100)

	help := helpText(t, m)
	order := []string{"Global", "1-5", "tabs", "Action menu", "highlight an Action", "Overview · Apps", "Overview · Needs attention", "Apps · List", "Apps · Details", "Activity", "Catalog · List", "Catalog · Detail", "Settings"}
	at := 0
	for _, want := range order {
		i := strings.Index(help[at:], want)
		if i < 0 {
			t.Fatalf("help lacks %q after offset %d\n%s", want, at, help)
		}
		at += i + len(want)
	}
	for _, want := range []string{"previous tab", "next tab", "next pane", "sub-tab", "Project", "actions", "destructive Actions need it twice", "goes through the Action menu"} {
		if !strings.Contains(help, want) {
			t.Errorf("help lacks %q\n%s", want, help)
		}
	}
}

// longDetailCatalog has an App whose detail is taller than the screen.
func longDetailCatalog() *catalog.Catalog {
	var inputs []app.Input
	for i := 1; i <= 40; i++ {
		inputs = append(inputs, app.Input{Key: fmt.Sprintf("k%02d", i), Prompt: fmt.Sprintf("Input %02d", i)})
	}
	return catalog.New([]app.App{
		stubApp{info: app.Info{ID: "big", Name: "Big", Category: "Media", Description: "ZDESC first line"}, inputs: inputs},
		stubApp{info: app.Info{ID: "small", Name: "Small", Category: "Media", Description: "a small App"}},
	}, nil)
}

func TestCatalogTabFocusesTheDetailAndArrowsScrollIt(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.catalog = longDetailCatalog()
	m = drive(t, m, press("4"))

	m = drive(t, m, press("tab"))
	for range 5 {
		m = drive(t, m, press("down"))
	}
	if out := screen(m); strings.Contains(out, "ZDESC") || !strings.Contains(out, "> [ ] Big") {
		t.Fatalf("down in the detail should scroll it and keep Big selected\n%s", out)
	}
	if bar := lastLine(screen(m)); !strings.Contains(bar, "↑/↓  scroll") {
		t.Fatalf("the bar should show the detail's keys: %q", bar)
	}

	m = drive(t, m, press("tab"))
	m = drive(t, m, press("down"))
	if out := screen(m); !strings.Contains(out, "> [ ] Small") || !strings.Contains(out, "a small App") {
		t.Fatalf("after tab, down should select the next App\n%s", out)
	}
}

func TestSearchEndsWhenTheTabChanges(t *testing.T) {
	m, _ := sample(t, 140, 32)
	m = drive(t, m, press("/"))
	m = drive(t, m, press("s"))

	m = drive(t, m, clickMsg{id: "nav:activity"})
	m = drive(t, m, clickMsg{id: "nav:dashboard"})
	m = drive(t, m, press("q"))

	out := screen(m)
	if strings.Contains(out, "/sq") || strings.Contains(out, "▏") {
		t.Fatalf("search still typing after a tab switch\n%s", out)
	}
	if !strings.Contains(out, "/s") {
		t.Fatalf("filter was dropped\n%s", out)
	}
}
