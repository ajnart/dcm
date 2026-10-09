package tui

import (
	"slices"
	"strings"
	"testing"

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

	if !strings.Contains(screen(m), "Sonarr logs") {
		t.Fatalf("the Overview should show the App selected on the Apps tab\n%s", screen(m))
	}
}

func TestNoStackWordingRemains(t *testing.T) {
	m, _ := sample(t, 140, 100)

	if help := helpText(t, m); strings.Contains(help, "Stack") || !strings.Contains(help, "Apps · Details") {
		t.Fatalf("help should describe the Apps tab without Stack\n%s", help)
	}
}
