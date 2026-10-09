package tui

import (
	"slices"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/activity"
)

func withGlyphs(t *testing.T, m Model, g activity.Glyphs) Model {
	t.Helper()
	return drive(t, m, appearanceMsg{glyphs: g})
}

func TestAppsListsShowACategoryIconInEachSet(t *testing.T) {
	for _, tc := range []struct {
		set                    activity.Glyphs
		media, requests, other string
	}{
		{activity.NerdFont, "\U000F0FCE", "\U000F11D2", "\U000F08C6"},
		{activity.Simple, "▶", "⊕", "◇"},
	} {
		m := goldenModel(t, 120, 30)
		m = withGlyphs(t, m, tc.set)

		overview := screen(m)
		for _, want := range []string{tc.media + " Jellyfin", tc.requests + " Sonarr", tc.other + " whoami"} {
			if !strings.Contains(overview, want) {
				t.Errorf("%s: the Overview's Apps lack %q\n%s", tc.set, want, overview)
			}
		}
		apps := screen(drive(t, m, press("2")))
		for _, want := range []string{tc.media + " jellyfin", tc.requests + " sonarr", tc.other + " whoami"} {
			if !strings.Contains(apps, want) {
				t.Errorf("%s: the Apps tab lacks %q\n%s", tc.set, want, apps)
			}
		}
	}
}

func TestTheBrandMarkFollowsTheGlyphSet(t *testing.T) {
	m := goldenModel(t, 120, 30)
	if !strings.HasPrefix(screen(m), " ◆ self-host") {
		t.Fatalf("Simple is the default and draws the reel's ◆\n%s", screen(m))
	}

	m = withGlyphs(t, m, activity.NerdFont)

	if !strings.HasPrefix(screen(m), " \U000F070B self-host") {
		t.Fatalf("the Nerd Font brand mark is nf-md-rhombus\n%s", screen(m))
	}
}

func TestTheSavedGlyphSetIsUsedFromTheStart(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.glyphs = activity.NerdFont

	for _, msg := range runCmd(m.Init()) {
		m = drive(t, m, msg)
	}

	if !strings.HasPrefix(screen(m), " \U000F070B self-host") {
		t.Fatalf("the Project's Nerd Font choice is not used\n%s", screen(m))
	}
}

func TestGoldenGlyphSets(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		for _, set := range []activity.Glyphs{activity.NerdFont, activity.Simple} {
			for _, tab := range []struct{ name, key string }{{"overview", "1"}, {"apps", "2"}} {
				name := "glyphs-" + string(set) + "-" + tab.name + size.suffix
				t.Run(name, func(t *testing.T) {
					m := goldenModel(t, size.width, size.height)
					m = withGlyphs(t, m, set)

					m = drive(t, m, press(tab.key))

					golden(t, name, trimLines(screen(m)))
				})
			}
		}
	}
}

func TestSettingsShowsTheAppearanceSampleChoiceAndLink(t *testing.T) {
	m, _ := settingsHost(t)

	out := screen(m)

	for _, want := range []string{"Appearance", "◆ self-host", "▣ Docker", "✱ key", "⇄ link",
		"Nerd Font", "Simple", "Learn about Nerd Fonts: https://www.nerdfonts.com"} {
		if !strings.Contains(out, want) {
			t.Errorf("Settings lacks %q\n%s", want, out)
		}
	}
	view := m.settings.View(m.ctx(), 120, 30)
	if !strings.Contains(view, ansi.SetHyperlink("https://www.nerdfonts.com")) {
		t.Fatalf("the Nerd Fonts link is not an OSC 8 hyperlink: %q", view)
	}
}

func TestChoosingAGlyphSetSavesAndRedrawsAtOnce(t *testing.T) {
	m, backend := settingsHost(t)

	m = drive(t, m, press("tab"))
	m = drive(t, m, press("up"))
	m = drive(t, m, press("enter"))

	if got := backend.savedGlyphs(); !slices.Equal(got, []activity.Glyphs{activity.NerdFont}) {
		t.Fatalf("saved %v, want the Nerd Font set once", got)
	}
	out := screen(m)
	if !strings.HasPrefix(out, " \U000F070B self-host") || !strings.Contains(out, "\U000F0868 Docker") {
		t.Fatalf("the whole UI should redraw with Nerd Font icons at once\n%s", out)
	}
	if m.surface != surfaceSettings || len(backend.Actions()) != 0 {
		t.Fatalf("choosing icons is not a Host settings change: surface %v, actions %v", m.surface, backend.Actions())
	}

	m = drive(t, m, press("down"))
	m = drive(t, m, press("enter"))

	if got := backend.savedGlyphs(); !slices.Equal(got, []activity.Glyphs{activity.NerdFont, activity.Simple}) || !strings.HasPrefix(screen(m), " ◆ self-host") {
		t.Fatalf("switching back to Simple: saved %v\n%s", got, screen(m))
	}
}

func TestSettingsAppearanceGoldens(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		t.Run("settings-appearance"+size.suffix, func(t *testing.T) {
			m := goldenModel(t, size.width, size.height)
			m = drive(t, m, press("5"))

			m = drive(t, m, press("tab"))

			golden(t, "settings-appearance"+size.suffix, trimLines(screen(m)))
		})
	}
}
