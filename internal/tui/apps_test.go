package tui

import (
	tea "charm.land/bubbletea/v2"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/service"
)

func TestAppsTabShowsTheListAndTheSelectedAppsDetails(t *testing.T) {
	m, _ := appsHost(t)

	out := screen(m)

	for _, want := range []string{"Apps 3", "Jellyfin", "Sonarr", "whoami", "running", "stopped",
		"logs", "setup", "info", "compose", "containers", "Jellyfin logs", "ready on :80"} {
		if !strings.Contains(out, want) {
			t.Errorf("the Apps tab lacks %q\n%s", want, out)
		}
	}
	if strings.Contains(out, "Needs attention") {
		t.Errorf("Needs attention belongs to the Overview\n%s", out)
	}
}

func TestBracketsCycleAllFiveSubTabsOnTheAppsTab(t *testing.T) {
	m, _ := appsHost(t)

	for _, tc := range []struct{ key, shows string }{
		{"]", "Setup has finished"},
		{"]", "lscr.io/linuxserver/jellyfin:latest"},
		{"]", "image: example/jellyfin:latest"},
		{"]", "Up 2 hours"},
		{"]", "ready on :80"},
		{"[", "Up 2 hours"},
	} {
		m = drive(t, m, press(tc.key))
		if !strings.Contains(screen(m), tc.shows) {
			t.Fatalf("%s should show %q\n%s", tc.key, tc.shows, screen(m))
		}
	}
}

func TestContainersSubTabShowsOnlyTheSelectedApp(t *testing.T) {
	m, _ := appsHost(t)
	m = drive(t, m, press("[")) // containers

	out := screen(m)
	for _, want := range []string{"1 container · 1 running", "⚠ update available", "checked 12:00",
		"jellyfin", "running", "healthy", "lscr.io/linuxserver/jellyfin:latest"} {
		if !strings.Contains(out, want) {
			t.Errorf("Jellyfin's containers lack %q\n%s", want, out)
		}
	}
	for _, gone := range []string{"sonarr-db", "whoami-sidecar"} {
		if strings.Contains(out, gone) {
			t.Errorf("Jellyfin's containers should not show %q\n%s", gone, out)
		}
	}

	m = drive(t, m, press("down")) // Sonarr
	out = screen(m)
	for _, want := range []string{"3 containers · 3 running", "? update unknown", "sonarr-db", "sonarr-proxy"} {
		if !strings.Contains(out, want) {
			t.Errorf("Sonarr's containers lack %q\n%s", want, out)
		}
	}
	if strings.Contains(out, "whoami-cache") {
		t.Errorf("Sonarr's containers should not show whoami's\n%s", out)
	}
}

func TestEnterOnTheOverviewOpensTheAppInTheAppsTab(t *testing.T) {
	m, backend := sample(t, 120, 30)

	m = drive(t, m, press("down")) // Sonarr
	m = drive(t, m, press("enter"))

	if got := activeTab(t, m); got != "2 Apps" {
		t.Fatalf("enter should switch to the Apps tab, got %q", got)
	}
	if bold := boldText(m.View().Content)[1]; strings.Contains(bold, "Apps") || !strings.Contains(bold, "Sonarr") {
		t.Fatalf("Sonarr's details should be focused: %q", bold)
	}
	if m.selectedID() != "sonarr" || len(backend.Actions()) != 0 {
		t.Fatalf("Sonarr should stay selected and nothing run, got %q %v", m.selectedID(), backend.Actions())
	}
}

func TestAppsTabFocusAndArrows(t *testing.T) {
	m, backend := appsHost(t)
	backend.compose = numberedCompose(60)
	for range 3 {
		m = drive(t, m, press("]")) // compose
	}

	m = drive(t, m, press("down"))
	if m.selectedID() != "sonarr" {
		t.Fatalf("with the list focused, down should select Sonarr, got %q", m.selectedID())
	}
	m = drive(t, m, press("tab"))
	for range 3 {
		m = drive(t, m, press("down"))
	}
	if out := screen(m); m.selectedID() != "sonarr" || strings.Contains(out, "line 01") || !strings.Contains(out, "line 04") {
		t.Fatalf("with the details focused, down should scroll them\n%s", out)
	}
	if bar := lastLine(screen(m)); !strings.Contains(bar, "↑/↓  scroll") {
		t.Fatalf("the bar should show the details' keys: %q", bar)
	}
	m = drive(t, m, press("shift+tab"))
	m = drive(t, m, press("down"))
	if m.selectedID() != "whoami" {
		t.Fatalf("shift+tab should give the arrows back to the list, got %q", m.selectedID())
	}
}

func TestAppsTabOpensTheActionMenuOpensAndCopies(t *testing.T) {
	m, backend := appsHost(t)

	m = drive(t, m, press("a"))
	if !strings.Contains(screen(m), "Jellyfin · Actions") {
		t.Fatalf("a should open Jellyfin's Action menu\n%s", screen(m))
	}
	m = drive(t, m, press("esc"))
	m = drive(t, m, press("o"))
	if !slices.Equal(backend.opened, []string{"http://192.168.1.20:8096"}) {
		t.Fatalf("o should open Jellyfin, opened %v", backend.opened)
	}
	m = drive(t, m, press("c"))
	if out := screen(m); !strings.Contains(out, "Admin password") || strings.Contains(out, "s3cret-pass") {
		t.Fatalf("c should offer the credentials without showing them\n%s", out)
	}
}

func TestAppsTabRRefreshesUpdatesAndContainers(t *testing.T) {
	m, backend := appsHost(t)
	m = drive(t, m, press("[")) // containers
	backend.containers = append(backend.containers, service.ContainerStatus{App: "jellyfin", Service: "jellyfin-transcoder", State: "running"})
	before := backend.updateCalls

	m = drive(t, m, press("r"))

	if backend.updateCalls <= before || len(backend.Actions()) != 0 {
		t.Fatalf("r should only check updates again (%d → %d), actions %v", before, backend.updateCalls, backend.Actions())
	}
	if !strings.Contains(screen(m), "jellyfin-transcoder") {
		t.Fatalf("r should reload the containers\n%s", screen(m))
	}
}

func TestTheOverviewFollowsTheAppsTabSelection(t *testing.T) {
	m, _ := appsHost(t)

	m = drive(t, m, press("down"))
	m = drive(t, m, press("1"))
	m = drive(t, m, press("a"))

	if !strings.Contains(screen(m), "Sonarr · Actions") {
		t.Fatalf("the Overview should show the App selected on the Apps tab\n%s", screen(m))
	}
}

func TestNoStackWordingRemains(t *testing.T) {
	m, _ := sample(t, 140, 100)

	if help := helpText(t, m); strings.Contains(help, "Stack") || !strings.Contains(help, "Overview · Needs attention") {
		t.Fatalf("help should describe the Apps tab without Stack\n%s", help)
	}
}

func TestAnActionFromTheAppsTabLandsOnActivity(t *testing.T) {
	m, backend := appsHost(t)
	m = drive(t, m, press("down")) // Sonarr

	m = drive(t, m, press("a"))
	m = drive(t, m, press("t")) // Restart
	m = drive(t, m, press("enter"))

	if got := backend.Actions(); !slices.Equal(got, []string{"restart sonarr"}) {
		t.Fatalf("actions %v", got)
	}
	if got := activeTab(t, m); got != "3 Activity" {
		t.Fatalf("a started Action should show Activity, got %q", got)
	}
	m = drive(t, m, press("2"))
	if m.selectedID() != "sonarr" || !strings.Contains(screen(m), "Sonarr logs") {
		t.Fatalf("returning to Apps should keep Sonarr selected\n%s", screen(m))
	}
}

func TestEnterOnTheAppsListFocusesTheDetails(t *testing.T) {
	m, _ := appsHost(t)
	if bar := lastLine(screen(m)); !strings.Contains(bar, "enter  details") {
		t.Fatalf("the list's bar should offer enter: %q", bar)
	}

	m = drive(t, m, press("enter"))

	if bar := lastLine(screen(m)); !strings.Contains(bar, "↑/↓  scroll") {
		t.Fatalf("enter should focus the details: %q", bar)
	}
}

func TestTheActionsChipSurvivesEightyColumns(t *testing.T) {
	for _, tab := range []string{"1", "2"} {
		m, _ := sample(t, 80, 24)
		m = drive(t, m, press(tab))

		if bar := lastLine(screen(m)); !strings.Contains(bar, "a  actions") {
			t.Errorf("tab %s: the bar should keep a actions at 80 columns: %q", tab, bar)
		}
	}
}

func TestMovingThroughTheOverviewStartsNoLogStream(t *testing.T) {
	m, backend := sample(t, 120, 30)

	for _, k := range []string{"j", "k", "j", "tab", "tab"} {
		m = drive(t, m, press(k))
	}
	m = drive(t, m, statusMsg{status: backend.status})

	if started, _ := backend.logStreams(); started != 0 {
		t.Fatalf("nothing on the Overview shows logs, yet %d stream(s) started", started)
	}
	m = drive(t, m, press("2"))
	if started, _ := backend.logStreams(); started != 1 || !strings.Contains(screen(m), "ready on :80") {
		t.Fatalf("the Apps tab's logs should start one stream, started %d\n%s", started, screen(m))
	}
}

func TestTheLogStreamStopsWhenLogsLeaveTheScreen(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.holdLogs = true
	running := func(want int) {
		t.Helper()
		for range 100 {
			if _, n := backend.logStreams(); n == want {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		_, n := backend.logStreams()
		t.Fatalf("want %d running log stream(s), have %d", want, n)
	}

	m = drive(t, m, press("2"))
	running(1)
	m = drive(t, m, press("]")) // setup
	running(0)
	m = drive(t, m, press("["))
	running(1)
	m = drive(t, m, press("3"))
	running(0)
	_ = m
}

func TestContainersSubTabShowsCPUAndMemoryBars(t *testing.T) {
	m, backend := appsHost(t)
	backend.usage = []service.ContainerUsage{
		{Service: "jellyfin", CPU: 0.5, Mem: 0.25, MemBytes: 512 << 20},
		{Service: "sonarr", CPU: 1, Mem: 1, MemBytes: 2048 << 20},
	}

	m = drive(t, m, press("["))

	out := screen(m)
	if want := "  cpu ━━━━━━──────  mem ━━━─────────  512 MiB"; !strings.Contains(out, want) {
		t.Fatalf("Jellyfin's row lacks %q\n%s", want, out)
	}
	if strings.Contains(out, "%") {
		t.Fatalf("usage is shown as bars, not percentages\n%s", out)
	}
	m = drive(t, m, press("down"))
	if want := "  cpu ━━━━━━━━━━━━  mem ━━━━━━━━━━━━  2048 MiB"; !strings.Contains(screen(m), want) {
		t.Fatalf("Sonarr's row lacks %q\n%s", want, screen(m))
	}
}

func TestContainersWithoutUsageShowNoBars(t *testing.T) {
	m, _ := appsHost(t)

	m = drive(t, m, press("["))

	if out := screen(m); strings.Contains(out, "cpu ") || strings.Contains(out, "MiB") {
		t.Fatalf("no stats arrived, so no bars\n%s", out)
	}
}

func TestTheUsageStreamRunsOnlyOnTheContainersSubTab(t *testing.T) {
	m, backend := appsHost(t)
	backend.usage = []service.ContainerUsage{{Service: "jellyfin", CPU: 0.5, Mem: 0.25, MemBytes: 512 << 20}}
	running := func(want int) {
		t.Helper()
		for range 100 {
			if _, n := backend.usageStreams(); n == want {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		_, n := backend.usageStreams()
		t.Fatalf("want %d running usage stream(s), have %d", want, n)
	}

	running(0)
	m = drive(t, m, press("]")) // setup
	running(0)
	m = drive(t, m, press("[")) // logs
	m = drive(t, m, press("[")) // containers
	running(1)
	m = drive(t, m, press("down")) // another App keeps the one stream
	if started, _ := backend.usageStreams(); started != 1 {
		t.Fatalf("moving between Apps restarted the usage stream: %d started", started)
	}
	m = drive(t, m, press("]"))
	running(0)
	m = drive(t, m, press("["))
	running(1)
	m = drive(t, m, press("3"))
	running(0)
	_ = m
}

func TestWhenTheBarsCannotFitOnlyTheMemoryInUseRemains(t *testing.T) {
	m, backend := appsHost(t)
	backend.usage = []service.ContainerUsage{{Service: "jellyfin", CPU: 0.5, Mem: 0.25, MemBytes: 512 << 20}}
	m = drive(t, m, tea.WindowSizeMsg{Width: 60, Height: 24})

	m = drive(t, m, press("["))

	out := screen(m)
	if !strings.Contains(out, "│   512 MiB ") || strings.Contains(out, "cpu") || strings.Contains(out, "━") {
		t.Fatalf("too narrow for bars: expected only the MiB under the row\n%s", out)
	}
}
