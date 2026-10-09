package activity

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/events"
)

func TestStripIsTheActionInThreeLines(t *testing.T) {
	pulling := seq(
		events.Event{Event: events.RunStart, Msg: "update jellyfin sonarr"},
		events.Event{Event: events.StepStart, Step: "pull", Msg: "pull 2 images"},
		events.Event{Event: events.PullProgress, Image: "jellyfin:latest", Layer: "l1", Current: 50, Total: 100},
		events.Event{Event: events.PullProgress, Image: "sonarr:latest", Status: "Pulled"},
	)
	failed := seq(
		events.Event{Event: events.RunStart, Msg: "restart sonarr"},
		events.Event{Event: events.RunEnd, Error: "compose restart failed\nmore detail"},
	)

	for _, tc := range []struct {
		name string
		evs  []events.Event
		want []string
	}{
		{"running pull", pulling, []string{
			"⠙ update jellyfin sonarr",
			"█",
			"1 of 2 images",
			"Pulling 2 images",
		}},
		{"running stages", setupMidRun, []string{
			"⠙ install qbittorrent sonarr radarr",
			"✓ ▣ Pull   ✓ ▣ Start   ⠙ Setup",
			"Setting up Sonarr: add the root folder /media/tv",
		}},
		{"finished", finished, []string{
			"✓ install qbittorrent sonarr radarr",
			"All 3 Apps are ready",
		}},
		{"failed", failed, []string{
			"✗ restart sonarr",
			"The Action failed: compose restart failed",
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			lines := Strip(Build(sceneStatus, tc.evs), Motion{Frame: 1}, 80, Simple, Palette{})
			out := ansi.Strip(strings.Join(lines, "\n"))
			if len(lines) > 3 {
				t.Fatalf("the strip should be at most three lines, got %d\n%s", len(lines), out)
			}
			for _, want := range tc.want {
				if !strings.Contains(out, want) {
					t.Fatalf("strip lacks %q\n%s", want, out)
				}
			}
			for _, line := range lines {
				if ansi.StringWidth(line) > 80 {
					t.Fatalf("line wider than 80: %q", line)
				}
			}
		})
	}
}

func TestStripIsEmptyWithoutAnAction(t *testing.T) {
	if lines := Strip(Build(sceneStatus, nil), Motion{}, 80, Simple, Palette{}); len(lines) != 0 {
		t.Fatalf("no Action, no strip: %q", lines)
	}
}

func TestStripStagesCarryTheIconsOfTheGlyphSet(t *testing.T) {
	for set, want := range map[Glyphs]string{
		NerdFont: "✓ \U000F0868 Pull   ✓ \U000F0868 Start   ⠙ Setup",
		Simple:   "✓ ▣ Pull   ✓ ▣ Start   ⠙ Setup",
	} {
		out := ansi.Strip(strings.Join(Strip(Build(sceneStatus, setupMidRun), Motion{Frame: 1}, 80, set, Palette{}), "\n"))
		if !strings.Contains(out, want) {
			t.Errorf("%s: the stage strip lacks %q\n%s", set, want, out)
		}
	}
}
