package tui

import (
	"strings"
	"testing"
)

// appRows are the Apps shown, told apart by their address.
func appRows(out string) []string {
	var rows []string
	for _, app := range []struct{ port, name string }{{":8096", "jellyfin"}, {":8989", "sonarr"}, {":8099", "whoami"}} {
		if strings.Contains(out, app.port) {
			rows = append(rows, app.name)
		}
	}
	return rows
}

func TestSearchOnTheOverviewFiltersTheAppsByNameOrID(t *testing.T) {
	m, _ := sample(t, 120, 30)

	m = drive(t, m, press("/"))
	m = typeText(t, m, "SON")

	if got := appRows(screen(m)); len(got) != 1 || got[0] != "sonarr" {
		t.Fatalf("searching a name should leave Sonarr, got %v\n%s", got, screen(m))
	}
	if m.selectedID() != "sonarr" {
		t.Fatalf("the selection should follow the filter, got %q", m.selectedID())
	}

	m = drive(t, m, press("esc"))
	m = drive(t, m, press("/"))
	m = typeText(t, m, "jellyf")

	if got := appRows(screen(m)); len(got) != 1 || got[0] != "jellyfin" {
		t.Fatalf("searching an id should leave Jellyfin, got %v", got)
	}
}

func TestSearchCapturesInputSoGlobalKeysAreText(t *testing.T) {
	m, backend := sample(t, 120, 30)

	m = drive(t, m, press("/"))
	m = typeText(t, m, "q2a")

	out := screen(m)
	if !strings.Contains(out, "/q2a") {
		t.Fatalf("the typed text should show as the search\n%s", out)
	}
	if got := activeTab(t, m); got != "1 Overview" || strings.Contains(out, "Actions") || len(backend.Actions()) != 0 {
		t.Fatalf("q, 2 and a are text while searching; tab %q\n%s", got, out)
	}
	if bar := lastLine(out); !strings.Contains(bar, "typing") || !strings.Contains(bar, "esc  clear") {
		t.Fatalf("the bar should show the search keys: %q", bar)
	}
}

func TestSearchEscClearsThenLeavesAndTheSelectionStaysValid(t *testing.T) {
	m, _ := sample(t, 120, 30)
	m = drive(t, m, press("/"))
	m = typeText(t, m, "who")
	if m.selectedID() != "whoami" {
		t.Fatalf("whoami should be selected, got %q", m.selectedID())
	}

	m = drive(t, m, press("esc"))

	if got := appRows(screen(m)); len(got) != 3 {
		t.Fatalf("esc should show every App again, got %v", got)
	}
	if m.selectedID() != "whoami" {
		t.Fatalf("the selected App should stay selected, got %q", m.selectedID())
	}
	m = drive(t, m, press("2"))
	if got := activeTab(t, m); got != "2 Apps" {
		t.Fatalf("keys act normally after the search, tab %q", got)
	}
}

func TestSearchEnterKeepsTheFilterAndEscClearsIt(t *testing.T) {
	m, _ := sample(t, 120, 30)
	m = drive(t, m, press("/"))
	m = typeText(t, m, "son")

	m = drive(t, m, press("enter"))

	if got := appRows(screen(m)); len(got) != 1 {
		t.Fatalf("enter should keep the filter, got %v", got)
	}
	if bar := lastLine(screen(m)); !strings.Contains(bar, "1-5 tabs") {
		t.Fatalf("the global keys should act again: %q", bar)
	}
	m = drive(t, m, press("esc"))
	if got := appRows(screen(m)); len(got) != 3 {
		t.Fatalf("esc should clear the filter, got %v", got)
	}
}

func TestSearchWithNoMatchLeavesNothingSelected(t *testing.T) {
	m, backend := sample(t, 120, 30)
	m = drive(t, m, press("/"))
	m = typeText(t, m, "zzz")

	out := screen(m)
	if got := appRows(out); len(got) != 0 || !strings.Contains(out, "No Apps match") {
		t.Fatalf("no App should match, got %v\n%s", got, out)
	}
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("a"))
	if strings.Contains(screen(m), "Actions") || m.selectedID() != "" {
		t.Fatalf("with no App there is nothing to open Actions for\n%s", screen(m))
	}
	m = drive(t, m, press("esc"))

	if got := appRows(screen(m)); len(got) != 3 || m.selectedID() == "" || len(backend.Actions()) != 0 {
		t.Fatalf("clearing the filter should restore the list, got %v", got)
	}
}

func TestSearchOnTheAppsTabFiltersTheListAndTheDetailsFollow(t *testing.T) {
	m, _ := appsHost(t)

	m = drive(t, m, press("/"))
	m = typeText(t, m, "sonarr")

	out := screen(m)
	if !strings.Contains(out, "Sonarr logs") || strings.Contains(out, "Jellyfin") || strings.Contains(out, "whoami") {
		t.Fatalf("the list should keep Sonarr and the details follow\n%s", out)
	}
	if m.selectedID() != "sonarr" {
		t.Fatalf("Sonarr should be selected, got %q", m.selectedID())
	}
	m = drive(t, m, press("esc"))
	if out := screen(m); !strings.Contains(out, "Jellyfin") || !strings.Contains(out, "whoami") {
		t.Fatalf("esc should show every App again\n%s", out)
	}
}

func TestSearchOnTheOverviewIsForTheAppsPaneOnly(t *testing.T) {
	m, _ := sample(t, 120, 30)
	m = drive(t, m, press("tab")) // Needs attention

	m = drive(t, m, press("/"))

	if bar := lastLine(screen(m)); strings.Contains(bar, "typing") {
		t.Fatalf("Needs attention has no search: %q", bar)
	}
}

func TestSearchChipIsOnTheAppsPaneAndTheAppsList(t *testing.T) {
	m, _ := sample(t, 140, 30)
	if bar := lastLine(screen(m)); !strings.Contains(bar, "/  search") {
		t.Fatalf("the Overview's Apps pane should offer /: %q", bar)
	}

	m = drive(t, m, press("2"))

	if bar := lastLine(screen(m)); !strings.Contains(bar, "/  search") {
		t.Fatalf("the Apps tab list should offer /: %q", bar)
	}
}
