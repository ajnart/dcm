package tui

import (
	"slices"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/service"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

// entryLines is what each menu entry reads as: mnemonic, label and, when
// unavailable, the reason.
func entryLines(entries []menuEntry) []string {
	var out []string
	for _, e := range entries {
		line := e.mnemonic + " " + e.label
		if e.reason != "" {
			line += " — " + e.reason
		}
		out = append(out, line)
	}
	return out
}

func TestAppActionsPerState(t *testing.T) {
	running := service.AppStatus{ID: "jellyfin", Name: "Jellyfin", Managed: true, State: "running", Setup: stepstatus.SetupOK}
	stopped := running
	stopped.State = "exited"
	degraded := running
	degraded.State = "degraded"
	unmanaged := service.AppStatus{ID: "whoami", Name: "whoami", State: "running", Setup: stepstatus.SetupUnmanaged}
	const noUpdate = "no update known (checked every 30 minutes)"
	const wait = "wait for the running Action"

	for _, tc := range []struct {
		name   string
		app    service.AppStatus
		update string
		busy   bool
		want   []string
	}{
		{"running, no update known", running, service.UpdateUnknown, false, []string{
			"s Stop", "t Restart", "u Update — " + noUpdate, "r Retry Setup", "b Backup", "m Remove"}},
		{"degraded counts as running", degraded, service.UpdateCurrent, false, []string{
			"s Stop", "t Restart", "u Update — " + noUpdate, "r Retry Setup", "b Backup", "m Remove"}},
		{"stopped", stopped, service.UpdateUnknown, false, []string{
			"s Start", "u Update — " + noUpdate, "r Retry Setup", "b Backup", "m Remove"}},
		{"update known", running, service.UpdateAvailable, false, []string{
			"s Stop", "t Restart", "u Update", "r Retry Setup", "b Backup", "m Remove"}},
		{"unmanaged", unmanaged, service.UpdateUnknown, false, []string{
			"s Stop", "t Restart", "u Update — " + noUpdate, "r Retry Setup — added by hand, no Setup", "b Backup", "m Remove"}},
		{"an Action is running", running, service.UpdateAvailable, true, []string{
			"s Stop — " + wait, "t Restart — " + wait, "u Update — " + wait, "r Retry Setup — " + wait, "b Backup — " + wait, "m Remove — " + wait}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := entryLines(appActions(tc.app, tc.update, tc.busy)); !slices.Equal(got, tc.want) {
				t.Fatalf("entries\n got %q\nwant %q", got, tc.want)
			}
		})
	}
}

func TestAppActionsMarkStopAndRemoveDestructive(t *testing.T) {
	app := service.AppStatus{ID: "jellyfin", Name: "Jellyfin", Managed: true, State: "running"}
	var destructive []string
	for _, e := range appActions(app, service.UpdateAvailable, false) {
		if e.destructive {
			destructive = append(destructive, e.label)
		}
	}
	if !slices.Equal(destructive, []string{"Stop", "Remove"}) {
		t.Fatalf("destructive entries = %q", destructive)
	}
}

func TestProjectActionsPerState(t *testing.T) {
	status := sampleStatus()
	withUpdate := sampleStatus()
	withUpdate.Apps[0].Update = service.UpdateAvailable
	const wait = "wait for the running Action"

	for _, tc := range []struct {
		name   string
		status service.Status
		busy   bool
		want   []string
	}{
		{"no update known", status, false, []string{
			"p Up all", "d Down all", "r Restart all", "u Update all — no update known (checked every 30 minutes)", "b Backup"}},
		{"an update known", withUpdate, false, []string{
			"p Up all", "d Down all", "r Restart all", "u Update all", "b Backup"}},
		{"an Action is running", withUpdate, true, []string{
			"p Up all — " + wait, "d Down all — " + wait, "r Restart all — " + wait, "u Update all — " + wait, "b Backup — " + wait}},
		{"no Apps", service.Status{}, false, []string{
			"p Up all — the Project has no Apps", "d Down all — the Project has no Apps", "r Restart all — the Project has no Apps",
			"u Update all — the Project has no Apps", "b Backup — the Project has no Apps"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := entryLines(projectActions(tc.status, tc.busy)); !slices.Equal(got, tc.want) {
				t.Fatalf("entries\n got %q\nwant %q", got, tc.want)
			}
		})
	}
}

func TestAppMenuMnemonicMovesTheHighlightAndEnterDispatches(t *testing.T) {
	m, backend := sample(t, 120, 30)

	m = drive(t, m, press("a"))
	if out := screen(m); !strings.Contains(out, "Jellyfin · Actions") ||
		!strings.Contains(out, "Stops Jellyfin's containers. Its data, settings and Setup stay.") {
		t.Fatalf("a should open Jellyfin's menu with Stop highlighted\n%s", out)
	}
	m = drive(t, m, press("t"))
	if out := screen(m); !strings.Contains(out, "> Restart") || !strings.Contains(out, "Restarts Jellyfin's containers.") {
		t.Fatalf("t should highlight Restart and preview it\n%s", out)
	}
	if len(backend.Actions()) != 0 {
		t.Fatalf("a mnemonic must only move the highlight: %v", backend.Actions())
	}
	m = drive(t, m, press("enter"))

	if got := backend.Actions(); !slices.Equal(got, []string{"restart jellyfin"}) {
		t.Fatalf("actions %v", got)
	}
	if strings.Contains(screen(m), "Jellyfin · Actions") {
		t.Fatal("the menu should close after dispatching")
	}
}

func TestArrowsMoveTheMenuHighlight(t *testing.T) {
	m, _ := sample(t, 120, 30)

	m = drive(t, m, press("a"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("up"))

	if !strings.Contains(screen(m), "> Restart") {
		t.Fatalf("↓ ↓ ↑ should land on Restart\n%s", screen(m))
	}
}

func TestDestructiveActionNeedsASecondEnter(t *testing.T) {
	m, backend := sample(t, 120, 30)
	m = drive(t, m, press("a"))

	m = drive(t, m, press("enter"))
	if len(backend.Actions()) != 0 {
		t.Fatalf("the first enter on Stop must only arm it: %v", backend.Actions())
	}
	if out := screen(m); !strings.Contains(out, "Press enter again to stop Jellyfin") {
		t.Fatalf("an armed Stop should say what the second enter does\n%s", out)
	}
	if bar := lastLine(screen(m)); !strings.Contains(bar, "enter  confirm Stop") {
		t.Fatalf("the bar should show the confirmation: %q", bar)
	}

	m = drive(t, m, press("t"))
	m = drive(t, m, press("s"))
	if strings.Contains(screen(m), "Press enter again") {
		t.Fatal("moving the highlight should disarm")
	}
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter"))

	if got := backend.Actions(); !slices.Equal(got, []string{"stop jellyfin"}) {
		t.Fatalf("actions %v", got)
	}
}

func TestEscClosesTheMenuWithoutDispatching(t *testing.T) {
	m, backend := sample(t, 120, 30)
	m = drive(t, m, press("a"))
	m = drive(t, m, press("enter")) // arm Stop

	m = drive(t, m, press("esc"))

	if len(backend.Actions()) != 0 || strings.Contains(screen(m), "Jellyfin · Actions") {
		t.Fatalf("esc must close without an Action: %v\n%s", backend.Actions(), screen(m))
	}
}

func TestUnavailableEntryShowsItsReasonAndDispatchesNothing(t *testing.T) {
	m, backend := sample(t, 120, 30)
	m = drive(t, m, press("a"))

	m = drive(t, m, press("u"))
	m = drive(t, m, press("enter"))

	out := screen(m)
	if !strings.Contains(out, "no update known (checked every 30 minutes)") || !strings.Contains(out, "Jellyfin · Actions") {
		t.Fatalf("Update should stay open with its reason\n%s", out)
	}
	if len(backend.Actions()) != 0 {
		t.Fatalf("an unavailable entry must not dispatch: %v", backend.Actions())
	}
}

func TestOpenMenuCapturesGlobalKeys(t *testing.T) {
	m, _ := sample(t, 120, 30)
	m = drive(t, m, press("a"))

	m = drive(t, m, press("2"))
	m = drive(t, m, press("right"))
	next, cmd := m.Update(press("q"))
	m = next.(Model)

	if quits(cmd) || activeTab(t, m) != "1 Overview" || !strings.Contains(screen(m), "Jellyfin · Actions") {
		t.Fatalf("keys must stay in the open menu\n%s", screen(m))
	}
	if bar := lastLine(screen(m)); strings.Contains(bar, "1-5 tabs") || !strings.Contains(bar, "esc  close") {
		t.Fatalf("the bar should show the menu's keys: %q", bar)
	}
}

func TestMenuEntriesAreClickable(t *testing.T) {
	m, backend := sample(t, 120, 30)
	m = drive(t, m, press("a"))

	m = drive(t, m, clickMsg{id: "menu:1"})

	if got := backend.Actions(); !slices.Equal(got, []string{"restart jellyfin"}) {
		t.Fatalf("clicking Restart should run it, actions %v", got)
	}
}

func TestMnemonicIsBoldInsideTheLabel(t *testing.T) {
	m, _ := sample(t, 120, 30)
	m = drive(t, m, press("a"))

	raw := m.View().Content
	lines := strings.Split(raw, "\n")
	for i, line := range lines {
		if strings.Contains(ansi.Strip(line), "Restart") {
			if bold := boldText(raw)[i]; bold != "t" {
				t.Fatalf("only Restart's mnemonic should be bold on its row, got %q", bold)
			}
			return
		}
	}
	t.Fatalf("no Restart entry\n%s", screen(m))
}

func TestProjectMenuDispatchesEveryEntry(t *testing.T) {
	for _, tc := range []struct {
		keys []string
		want string
	}{
		{[]string{"p", "enter"}, "up"},
		{[]string{"d", "enter", "enter"}, "down"},
		{[]string{"r", "enter"}, "restart"},
		{[]string{"u", "enter"}, "update jellyfin"},
		{[]string{"b", "enter"}, "backup"},
	} {
		t.Run(tc.want, func(t *testing.T) {
			m, backend := sample(t, 120, 30)
			m = update(t, m, updatesMsg{updates: map[string]string{"jellyfin": service.UpdateAvailable}})
			m = drive(t, m, press("A"))
			if !strings.Contains(screen(m), "Project · Actions") {
				t.Fatalf("A should open the Project menu\n%s", screen(m))
			}
			for _, k := range tc.keys {
				m = drive(t, m, press(k))
			}
			if got := backend.Actions(); !slices.Equal(got, []string{tc.want}) {
				t.Fatalf("actions %v, want %q", got, tc.want)
			}
		})
	}
}

func TestProjectDownShowsItsConsequenceBeforeRunning(t *testing.T) {
	m, backend := sample(t, 120, 30)
	m = drive(t, m, press("A"))

	m = drive(t, m, press("d"))
	m = drive(t, m, press("enter"))

	out := screen(m)
	for _, want := range []string{"Press enter again to take the Project down", "Containers", "networks", "volumes", "App files", "Setup stay"} {
		if !strings.Contains(out, want) {
			t.Fatalf("an armed Down all lacks %q\n%s", want, out)
		}
	}
	if len(backend.Actions()) != 0 {
		t.Fatalf("Down all must wait for the second enter: %v", backend.Actions())
	}
}

func TestAppMenuOpensFromTheAppsAndActivityTabs(t *testing.T) {
	m, _ := stackHost(t)

	m = drive(t, m, press("down")) // sonarr's container
	m = drive(t, m, press("a"))
	if !strings.Contains(screen(m), "Sonarr · Actions") {
		t.Fatalf("a on the Apps tab should open the selected container's App menu\n%s", screen(m))
	}
	m = drive(t, m, press("esc"))

	m = drive(t, m, press("3"))
	for i := 0; i < 10 && !strings.Contains(screen(m), "> ▾ whoami"); i++ {
		m = drive(t, m, press("down"))
	}
	m = drive(t, m, press("a"))
	if !strings.Contains(screen(m), "whoami · Actions") {
		t.Fatalf("a on Activity should open the selected row's App menu\n%s", screen(m))
	}
}

func TestAOnTabsWithoutAnAppDoesNothing(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.catalog = wizardCatalog()
	m = drive(t, m, press("4"))

	m = drive(t, m, press("a"))

	if strings.Contains(screen(m), "· Actions") {
		t.Fatalf("the Catalog has no selected App\n%s", screen(m))
	}
}

func TestEnterOnTheAppsPaneGoesIntoTheApp(t *testing.T) {
	m, backend := sample(t, 120, 30)

	m = drive(t, m, press("enter"))

	if bold := boldText(m.View().Content)[1]; strings.Contains(bold, "Apps") || !strings.Contains(bold, "Jellyfin") {
		t.Fatalf("enter should focus Jellyfin's details: %q", bold)
	}
	if len(backend.Actions()) != 0 {
		t.Fatalf("enter must not start or stop anything: %v", backend.Actions())
	}
}

func TestBarOffersTheActionMenus(t *testing.T) {
	m, _ := sample(t, 120, 30)

	bar := lastLine(screen(m))

	if !strings.Contains(bar, "A Project") || !strings.Contains(bar, "a  actions") {
		t.Fatalf("the bar should offer A and a: %q", bar)
	}
}
