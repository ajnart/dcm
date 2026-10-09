package activity

import (
	"fmt"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/events"
)

// wiredScene reaches every stage with an icon: the Docker stages (pull,
// start), the key stage (credentials) and Links.
var wiredScene = seq(installStarted,
	ev(events.StepOK, "sonarr", "admin", "create the admin account"),
	ev(events.StepOK, "qbittorrent", "check", "verify qBittorrent works"),
	ev(events.StepOK, "sonarr", "check", "verify Sonarr works"),
	ev(events.StepOK, "sonarr", "link-qbittorrent", "use qBittorrent as the download client"),
	ev(events.StepSkip, "radarr", "link-qbittorrent", "waiting for qbittorrent (install it, or finish its Setup)"),
	ev(events.StepStart, "seerr", "link-sonarr", "send requests to Sonarr"),
)

func TestRenderGlyphSetGoldens(t *testing.T) {
	for _, set := range []Glyphs{NerdFont, Simple} {
		for _, width := range []int{120, 80} {
			name := fmt.Sprintf("glyphs-%s-%d", set, width)
			t.Run(name, func(t *testing.T) {
				lines := Render(Build(sceneStatus, wiredScene), Motion{Frame: 40}, width, set, fullPalette)
				for _, line := range lines {
					if w := ansi.StringWidth(line); w > width {
						t.Fatalf("line is %d cells, wider than %d: %q", w, width, ansi.Strip(line))
					}
				}
				golden(t, name, ansi.Strip(strings.Join(lines, "\n"))+"\n")
			})
		}
	}
}

func TestStageStripAndLinkRowsCarryTheSetIcons(t *testing.T) {
	for _, tc := range []struct {
		set               Glyphs
		docker, key, link string
	}{
		{NerdFont, "\U000F0868", "\U000F0306", "\U000F0339"},
		{Simple, "▣", "✱", "⇄"},
	} {
		lines := Render(Build(sceneStatus, wiredScene), Motion{Frame: 40}, 120, tc.set, Palette{})
		strip := ansi.Strip(lines[1])
		for _, want := range []string{tc.docker + " Pull", tc.docker + " Start", tc.key + " Credentials", tc.link + " Links"} {
			if !strings.Contains(strip, want) {
				t.Errorf("%s: stage strip lacks %q: %q", tc.set, want, strip)
			}
		}
		if out := ansi.Strip(strings.Join(lines, "\n")); !strings.Contains(out, "✓ "+tc.link+" Sonarr") {
			t.Errorf("%s: Link row lacks the link icon:\n%s", tc.set, out)
		}
	}
}

// progressRunes are the bars, spinner frames and state dots: they must look
// the same whatever glyph set is chosen.
const progressRunes = "█▏▎▍▌▋▊▉░━╸─╌▶⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏●◐◉○✓✗↷!•·"

func progressOnly(s string) string {
	var b strings.Builder
	for _, r := range s {
		if strings.ContainsRune(progressRunes, r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func TestProgressGlyphsAreTheSameInEveryGlyphSet(t *testing.T) {
	scenes := append(actionScenes, struct {
		name   string
		evs    []events.Event
		frames []frameAt
	}{"wired", wiredScene, []frameAt{{frame: 40}}})
	for _, scene := range scenes {
		s := Build(sceneStatus, scene.evs)
		for _, f := range scene.frames {
			m := Motion{Frame: f.frame, Changed: f.changed}
			nerd := ansi.Strip(strings.Join(Render(s, m, 120, NerdFont, Palette{}), "\n"))
			simple := ansi.Strip(strings.Join(Render(s, m, 120, Simple, Palette{}), "\n"))
			if progressOnly(nerd) == "" || progressOnly(nerd) != progressOnly(simple) {
				t.Fatalf("%s frame %d: progress glyphs differ between sets:\n%s\n---\n%s", scene.name, f.frame, nerd, simple)
			}
		}
	}
}

func TestEveryIconIsOneCellAndTheSetsDiffer(t *testing.T) {
	categories := []string{"Analytics", "Backups", "Cameras", "Communication", "Containers", "DNS", "Dashboard",
		"Databases", "Developer tools", "Documents", "Downloads", "Files", "Home automation", "Identity", "Ingress",
		"Local AI", "Media", "Monitoring", "Observability", "Passwords", "Photos", "Productivity", "Remote access",
		"Requests", "Storage", "Something new"}
	for _, set := range []Glyphs{NerdFont, Simple} {
		icons := []string{set.Brand(), set.Docker(), set.Key(), set.Link(), set.Recipe()}
		for _, c := range categories {
			icons = append(icons, set.Category(c))
		}
		for _, icon := range icons {
			if ansi.StringWidth(icon) != 1 {
				t.Errorf("%s: icon %q is %d cells, want 1", set, icon, ansi.StringWidth(icon))
			}
		}
	}
	if NerdFont.Category("Media") == Simple.Category("Media") || NerdFont.Brand() == Simple.Brand() || NerdFont.Recipe() == Simple.Recipe() {
		t.Fatal("the Nerd Font set must draw its own icons")
	}
	if Simple.Category("Something new") != "◇" || Simple.Category("") != "◇" {
		t.Fatalf("an unknown category falls back to ◇, got %q", Simple.Category("Something new"))
	}
}

func TestGlyphSetsParseFromTheirSavedNames(t *testing.T) {
	for in, want := range map[string]Glyphs{"nerd-font": NerdFont, "simple": Simple, "": Simple, "ascii": Simple} {
		if got := ParseGlyphs(in); got != want {
			t.Errorf("ParseGlyphs(%q) = %q, want %q", in, got, want)
		}
	}
	if NerdFont.Label() != "Nerd Font" || Simple.Label() != "Simple" || Glyphs("").Label() != "Simple" {
		t.Fatal("labels are Nerd Font and Simple, and an unset choice reads as Simple")
	}
}
