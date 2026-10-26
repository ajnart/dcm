package tui

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
)

// recipeCatalog has one Recipe of two Apps, none of them installed on the
// sample machine.
func recipeCatalog() *catalog.Catalog {
	return catalog.New([]app.App{
		stubApp{info: app.Info{ID: "homarr", Name: "Homarr", Category: "Dashboards", Description: "Dashboard", Image: "ghcr.io/homarr-labs/homarr:latest", Port: 7575}},
		stubApp{info: app.Info{ID: "ntfy", Name: "ntfy", Category: "Notifications", Description: "Notifications", Image: "binwiederhier/ntfy:latest", Port: 2586}},
		stubApp{info: app.Info{ID: "prowlarr", Name: "Prowlarr", Category: "Downloads", Description: "Indexers", Image: "lscr.io/linuxserver/prowlarr:latest", Port: 9696}},
		stubApp{info: app.Info{ID: "radarr", Name: "Radarr", Category: "Downloads", Description: "Movies", Image: "lscr.io/linuxserver/radarr:latest", Port: 7878}},
	}, []catalog.Recipe{{ID: "arr", Name: "Arr", Description: "Find and fetch your movies", Apps: []string{"radarr", "prowlarr"}}})
}

// atWhatWith is Onboarding at the What step over cat, focused on its first
// Recipe, with Homarr picked from the start.
func atWhatWith(t *testing.T, cat *catalog.Catalog, width, height int) (Model, *fakeBackend) {
	t.Helper()
	m, backend := onboardingHost(t, width, height, readyChecks...)
	backend.catalog = cat
	m = frames(t, m, introFrames)
	return drive(t, m, press("enter")), backend
}

// whatMark is the mark a What row shows for name: ✓ picked, ◐ some of a
// Recipe's Apps, ○ none.
func whatMark(t *testing.T, out, name string) string {
	t.Helper()
	row := regexp.MustCompile(`(?m)^\s*(?:> )?([✓◐○]) (?:\S+ )?` + regexp.QuoteMeta(name) + `(?: \(Recipe\))?\s*$`)
	found := row.FindStringSubmatch(out)
	if found == nil {
		t.Fatalf("What has no row for %q\n%s", name, out)
	}
	return found[1]
}

// catalogMark is the mark a Catalog row shows for name.
func catalogMark(t *testing.T, out, name string) string {
	t.Helper()
	row := regexp.MustCompile(`(?m)^│\s*(?:> )?\s*(✓|◐|○)\s+(?:❖ )?` + regexp.QuoteMeta(name) + `\s`)
	found := row.FindStringSubmatch(out)
	if found == nil {
		t.Fatalf("the Catalog has no row for %q\n%s", name, out)
	}
	return found[1]
}

func TestPickingARecipeInWhatPicksItsApps(t *testing.T) {
	m, _ := atWhatWith(t, recipeCatalog(), 120, 30)
	m = drive(t, m, press("up")) // Homarr -> the Arr Recipe

	m = drive(t, m, press("x"))

	out := screen(m)
	for name, want := range map[string]string{"Arr": "✓", "Radarr": "✓", "Prowlarr": "✓", "Homarr": "✓", "ntfy": "○"} {
		if got := whatMark(t, out, name); got != want {
			t.Fatalf("%s should be %s, got %s\n%s", name, want, got, out)
		}
	}
}

func TestUntickingARecipesAppsMakesItHalfThenEmptyInWhat(t *testing.T) {
	m, _ := atWhatWith(t, recipeCatalog(), 120, 30)
	m = drive(t, m, press("up"))
	m = drive(t, m, press("x"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("down")) // Prowlarr

	m = drive(t, m, press("x"))

	out := screen(m)
	if whatMark(t, out, "Arr") != "◐" || whatMark(t, out, "Prowlarr") != "○" || whatMark(t, out, "Radarr") != "✓" {
		t.Fatalf("one App out of two should leave the Recipe half picked\n%s", out)
	}
	m = drive(t, m, press("down")) // Radarr
	m = drive(t, m, press("x"))
	if out := screen(m); whatMark(t, out, "Arr") != "○" {
		t.Fatalf("no App left should leave the Recipe empty\n%s", out)
	}
}

func TestPickingAHalfPickedRecipeInWhatPicksTheRest(t *testing.T) {
	m, _ := atWhatWith(t, recipeCatalog(), 120, 30)
	m = drive(t, m, press("down"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("x")) // Prowlarr alone
	for range 3 {
		m = drive(t, m, press("up"))
	}

	m = drive(t, m, press("x"))

	if out := screen(m); whatMark(t, out, "Arr") != "✓" || whatMark(t, out, "Radarr") != "✓" {
		t.Fatalf("picking a half-picked Recipe should pick all its Apps\n%s", out)
	}
	m = drive(t, m, press("x"))
	if out := screen(m); whatMark(t, out, "Arr") != "○" || whatMark(t, out, "Prowlarr") != "○" {
		t.Fatalf("picking it again should unpick them all\n%s", out)
	}
}

func TestWhatKeepsRecipeAndAppPicksAcrossEscAndForward(t *testing.T) {
	m, _ := atWhatWith(t, recipeCatalog(), 120, 30)
	m = drive(t, m, press("up"))
	m = drive(t, m, press("x"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("x")) // Prowlarr out again
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("esc"))

	out := screen(m)
	if !strings.Contains(indicator(t, m), "● What") || whatMark(t, out, "Arr") != "◐" || whatMark(t, out, "Radarr") != "✓" || whatMark(t, out, "Prowlarr") != "○" {
		t.Fatalf("coming back to What should show the same picks\n%s", out)
	}
}

func TestWhatFiltersAndStillPicks(t *testing.T) {
	m, _ := atWhatWith(t, recipeCatalog(), 120, 30)

	m = drive(t, m, press("/"))
	m = typeText(t, m, "radar")

	out := screen(m)
	if strings.Contains(out, "ntfy") || !strings.Contains(out, "Radarr") {
		t.Fatalf("the filter should narrow the list to Radarr\n%s", out)
	}
	m = drive(t, m, press("enter")) // done typing, keep the filter
	m = drive(t, m, press("x"))
	m = drive(t, m, press("esc")) // clear the filter

	out = screen(m)
	if !strings.Contains(out, "ntfy") || whatMark(t, out, "Radarr") != "✓" || whatMark(t, out, "Arr") != "◐" {
		t.Fatalf("esc should clear the filter and keep the pick\n%s", out)
	}
}

func TestWhatRequiresAPick(t *testing.T) {
	m, _ := atWhatWith(t, recipeCatalog(), 120, 30)
	m = drive(t, m, press("down"))
	m = drive(t, m, press("x")) // Homarr out

	m = drive(t, m, press("enter"))

	if out := screen(m); !strings.Contains(out, "pick at least one Recipe or App") || !strings.Contains(indicator(t, m), "● What") {
		t.Fatalf("an empty pick should stay on What and say why\n%s", out)
	}
}

func TestReviewListsExactlyThePickedAppsAndApprovingInstallsThem(t *testing.T) {
	m, backend := atWhatWith(t, recipeCatalog(), 120, 30)
	m = drive(t, m, press("up"))
	m = drive(t, m, press("x")) // the Arr Recipe, with Homarr
	for range 3 {
		m = drive(t, m, press("down"))
	}
	m = drive(t, m, press("x")) // Prowlarr out
	m = drive(t, m, press("enter"))
	for range 5 { // Where
		m = drive(t, m, press("enter"))
	}
	m = drive(t, m, press("enter")) // Who: admin user
	m = drive(t, m, press("enter")) // Who: generated password
	m = drive(t, m, press("enter")) // Look
	out := screen(m)
	if !strings.Contains(indicator(t, m), "● Review") || !strings.Contains(out, "Homarr") || !strings.Contains(out, "Radarr") || strings.Contains(out, "Prowlarr") || strings.Contains(out, "ntfy") {
		t.Fatalf("Review should list exactly Homarr and Radarr\n%s", out)
	}

	m = drive(t, m, press("enter"))

	got := backend.installs()
	if len(got) != 1 || strings.Join(got[0].Targets, ",") != "homarr,radarr" {
		t.Fatalf("approving should install exactly Homarr and Radarr, got %+v", got)
	}
}

func TestPickingARecipeInTheCatalogPicksItsApps(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.catalog = recipeCatalog()
	m = drive(t, m, press("4"))

	m = drive(t, m, press("space")) // the Arr Recipe

	out := screen(m)
	for name, want := range map[string]string{"Arr": "✓", "Radarr": "✓", "Prowlarr": "✓", "Homarr": "○", "ntfy": "○"} {
		if got := catalogMark(t, out, name); got != want {
			t.Fatalf("%s should show %s, got %s\n%s", name, want, got, out)
		}
	}
}

func TestUntickingARecipesAppsMakesItHalfThenEmptyInTheCatalog(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.catalog = recipeCatalog()
	m = drive(t, m, press("4"))
	m = drive(t, m, press("space"))
	rows := m.installRows()
	for i, row := range rows {
		if row.key == "app:prowlarr" {
			for range i {
				m = drive(t, m, press("down"))
			}
		}
	}

	m = drive(t, m, press("space"))

	out := screen(m)
	if catalogMark(t, out, "Arr") != "◐" || catalogMark(t, out, "Prowlarr") != "○" || catalogMark(t, out, "Radarr") != "✓" {
		t.Fatalf("one App out of two should leave the Recipe half picked\n%s", out)
	}
	m = drive(t, m, press("down"))
	m = drive(t, m, press("space"))
	if out := screen(m); catalogMark(t, out, "Arr") != "○" {
		t.Fatalf("no App left should leave the Recipe empty\n%s", out)
	}
}

func TestCatalogReviewListsExactlyThePickedAppsAndApprovingInstallsThem(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.catalog = recipeCatalog()
	m = drive(t, m, press("4"))
	m = drive(t, m, press("space")) // the Arr Recipe
	for i, row := range m.installRows() {
		if row.key == "app:prowlarr" {
			for range i {
				m = drive(t, m, press("down"))
			}
		}
	}
	m = drive(t, m, press("space")) // Prowlarr out

	m = drive(t, m, press("enter"))

	out := screen(m)
	if !strings.Contains(out, "Review") || !strings.Contains(out, "Radarr") || strings.Contains(out, "Prowlarr") {
		t.Fatalf("Review should list exactly Radarr\n%s", out)
	}
	m = drive(t, m, press("enter"))
	if got := backend.installs(); len(got) != 1 || strings.Join(got[0].Targets, ",") != "radarr" {
		t.Fatalf("approving should install exactly Radarr, got %+v", got)
	}
}

func TestCatalogRecipeCountsInstalledAppsAsHaving(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.catalog = catalog.New([]app.App{
		stubApp{info: app.Info{ID: "jellyfin", Name: "Jellyfin", Description: "Media server", Image: "x", Port: 1}},
		stubApp{info: app.Info{ID: "radarr", Name: "Radarr", Description: "Movies", Image: "x", Port: 2}},
	}, []catalog.Recipe{{ID: "media", Name: "Media", Description: "Watch", Apps: []string{"jellyfin", "radarr"}}})
	m = drive(t, m, press("4"))

	if out := screen(m); catalogMark(t, out, "Media") != "◐" {
		t.Fatalf("a Recipe with one App installed and one not should be half\n%s", out)
	}
	m = drive(t, m, press("space"))
	if out := screen(m); catalogMark(t, out, "Media") != "✓" || catalogMark(t, out, "Radarr") != "✓" {
		t.Fatalf("picking it should pick only the App not installed\n%s", out)
	}
}

func TestGoldenRecipePicks(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		t.Run("what"+size.suffix, func(t *testing.T) {
			m, _ := atWhatWith(t, recipeCatalog(), size.width, size.height)
			m = drive(t, m, press("up"))
			m = drive(t, m, press("x"))
			for range 3 {
				m = drive(t, m, press("down"))
			}
			m = drive(t, m, press("x"))
			golden(t, "onboarding-what-recipe"+size.suffix, trimLines(screen(m)))
		})
		t.Run("catalog"+size.suffix, func(t *testing.T) {
			m, backend := sample(t, size.width, size.height)
			backend.catalog = recipeCatalog()
			m = drive(t, m, press("4"))
			m = drive(t, m, press("space"))
			for i, row := range m.installRows() {
				if row.key == "app:prowlarr" {
					for range i {
						m = drive(t, m, press("down"))
					}
				}
			}
			m = drive(t, m, press("space"))
			golden(t, "tab-catalog-recipe"+size.suffix, trimLines(screen(m)))
		})
	}
}
