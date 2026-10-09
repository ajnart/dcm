package tui

import (
	"slices"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
)

func withGlyphs(t *testing.T, m Model, g activity.Glyphs) Model {
	t.Helper()
	return drive(t, m, appearanceMsg{glyphs: g})
}

func TestAppsListsShowACategoryIconInEachSet(t *testing.T) {
	for _, tc := range []struct {
		set                     activity.Glyphs
		media, downloads, other string
	}{
		{activity.NerdFont, "\U000F0FCE", "\U000F01DA", "\U000F08C6"},
		{activity.Simple, "▶", "↓", "◇"},
	} {
		m := goldenModel(t, 120, 30)
		m = withGlyphs(t, m, tc.set)

		overview := screen(m)
		for _, want := range []string{tc.media + " Jellyfin", tc.downloads + " Sonarr", tc.other + " whoami"} {
			if !strings.Contains(overview, want) {
				t.Errorf("%s: the Overview's Apps lack %q\n%s", tc.set, want, overview)
			}
		}
		apps := screen(drive(t, m, press("2")))
		for _, want := range []string{tc.media + " Jellyfin", tc.downloads + " Sonarr", tc.other + " whoami"} {
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

func narrowSettings(t *testing.T) Model {
	t.Helper()
	m, backend := sample(t, 80, 24)
	backend.review = []service.SettingReview{
		{Key: "EXPOSURE", Current: "lan", Choices: []string{"lan", "local"}},
		{Key: "LAN_IP", Current: "192.168.1.20", Detected: "192.168.1.20", Choices: []string{"192.168.1.20"}},
		{Key: "TZ", Current: "Europe/Paris", Detected: "Europe/Paris"},
		{Key: "PUID", Current: "1000", Detected: "1000"},
		{Key: "PGID", Current: "1000", Detected: "1000"},
		{Key: "UMASK", Current: "022"},
		{Key: "MEDIA_ROOT", Current: "/home/alice/media"},
		{Key: "DOWNLOADS_ROOT", Current: "/home/alice/downloads"},
	}
	m = drive(t, m, press("5"))
	m = drive(t, m, press("space"))
	for i := 0; i < 3; i++ {
		m = drive(t, m, press("down"))
	}
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("ctrl+u"))
	m = typeText(t, m, "1001")
	m = drive(t, m, press("enter"))
	for i := 0; i < 4; i++ {
		m = drive(t, m, press("down"))
	}
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("ctrl+u"))
	m = typeText(t, m, "/srv/downloads")
	return drive(t, m, press("enter"))
}

func TestSettingsKeepsAppearanceAndTheCursorOnScreenWithPendingChanges(t *testing.T) {
	m := narrowSettings(t)

	out := screen(m)

	for _, want := range []string{"Pending changes", "EXPOSURE", "PUID", "1000 → 1001", "PUID/PGID changes",
		"> DOWNLOADS_ROOT", "(pending)", "Appearance", "○ Nerd Font", "● Simple", "Learn about Nerd Fonts: https://www.nerdfonts.com"} {
		if !strings.Contains(out, want) {
			t.Errorf("Settings lacks %q at 80×24 with pending changes\n%s", want, out)
		}
	}
	if lines := strings.Split(out, "\n"); len(lines) != 24 {
		t.Fatalf("screen is %d rows, want 24", len(lines))
	}

	for i := 0; i < 8; i++ {
		m = drive(t, m, press("up"))
	}
	if out := screen(m); !strings.Contains(out, "> EXPOSURE") || !strings.Contains(out, "Learn about Nerd Fonts") || !strings.Contains(out, "● Simple") {
		t.Fatalf("scrolling back up must keep the cursor and Appearance on screen\n%s", out)
	}
}

func TestSettingsConfirmDiscardStaysOnScreenAt80x24(t *testing.T) {
	m := narrowSettings(t)

	m = drive(t, m, press("esc"))

	if out := screen(m); !strings.Contains(out, "discard 3 changes? y/n") || !strings.Contains(out, "Learn about Nerd Fonts") {
		t.Fatalf("the prompt and the Appearance section must both fit\n%s", out)
	}
}

func TestSettingsPendingChangesGoldenAtEightyColumns(t *testing.T) {
	golden(t, "settings-pending-narrow", trimLines(screen(narrowSettings(t))))
}

func TestNowStripStagesCarryTheIconsOfTheGlyphSet(t *testing.T) {
	for set, want := range map[activity.Glyphs]string{
		activity.Simple:   "✓ ▣ Pull",
		activity.NerdFont: "✓ \U000F0868 Pull",
	} {
		m, _ := sample(t, 120, 30)
		m = withGlyphs(t, m, set)
		task := m.tasks.start("update jellyfin")
		t.Cleanup(m.tasks.cancelAll)
		for _, e := range []events.Event{
			{Event: events.RunStart, Msg: "update jellyfin"},
			{Event: events.StepOK, Step: "pull", Msg: "pulled"},
			{Event: events.StepStart, Step: "start", Msg: "start"},
		} {
			task.append(e)
		}

		if out := screen(m); !strings.Contains(out, want) {
			t.Errorf("%s: the Now strip lacks %q\n%s", set, want, out)
		}
	}
}

func TestSettingsPanesAreBoxesAndTheFocusedOneHasTheBoldTitle(t *testing.T) {
	for _, size := range []struct{ width, height int }{{120, 30}, {80, 24}} {
		m, _ := sample(t, size.width, size.height)
		m = drive(t, m, press("5"))
		titleRow := func(title string) int {
			for i, line := range strings.Split(screen(m), "\n") {
				if strings.Contains(line, "╭─ "+title) {
					return i
				}
			}
			t.Fatalf("%dx%d: no box titled %q\n%s", size.width, size.height, title, screen(m))
			return -1
		}

		bold := boldText(m.View().Content)
		if host, look := titleRow("Host settings"), titleRow("Appearance"); !strings.Contains(bold[host], "Host settings") || strings.Contains(bold[look], "Appearance") {
			t.Errorf("%dx%d: Host settings has the focus, so only its title is bold: %q %q", size.width, size.height, bold[host], bold[look])
		}

		m = drive(t, m, press("tab"))

		bold = boldText(m.View().Content)
		if host, look := titleRow("Host settings"), titleRow("Appearance"); strings.Contains(bold[host], "Host settings") || !strings.Contains(bold[look], "Appearance") {
			t.Errorf("%dx%d: tab moves the bold title to Appearance: %q %q", size.width, size.height, bold[host], bold[look])
		}
	}
}
