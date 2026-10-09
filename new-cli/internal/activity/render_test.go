package activity

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

var updateGolden = flag.Bool("update", false, "rewrite golden files")

func golden(t *testing.T, name, got string) {
	t.Helper()
	path := filepath.Join("testdata", name+".golden")
	if *updateGolden {
		os.MkdirAll("testdata", 0o755)
		os.WriteFile(path, []byte(got), 0o644)
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("missing golden %s (run go test -update): %v", path, err)
	}
	if string(want) != got {
		t.Fatalf("%s changed (run go test -update to accept):\n%s", name, got)
	}
}

var testPalette = Palette{
	Accent: lipgloss.Color("#7A57D3"),
	OK:     lipgloss.Color("#00D787"),
	Fail:   lipgloss.Color("#FF5F5F"),
	Text:   lipgloss.Color("252"),
	Muted:  lipgloss.Color("245"),
	Faint:  lipgloss.Color("238"),
}

const longLabel = "ghcr.io/some-very-long-organisation/an-image-with-a-long-name:2026.10.1"

var pullFrames = []struct {
	name string
	pull Pull
}{
	{"start", Pull{Pulling: true, Total: 3, Images: []Image{
		{Label: "Jellyfin"}, {Label: "sonarr:latest"}, {Label: longLabel},
	}}},
	{"partial", Pull{Pulling: true, Fraction: 0.4, Done: 0, Total: 3, Images: []Image{
		{Label: "Jellyfin", Fraction: 0.6}, {Label: "sonarr:latest", Fraction: 0.55}, {Label: longLabel, Fraction: 0.05},
	}}},
	{"complete", Pull{Fraction: 1, Done: 3, Total: 3, Images: []Image{
		{Label: "Jellyfin", Fraction: 1, Done: true}, {Label: "sonarr:latest", Fraction: 1, Done: true}, {Label: longLabel, Fraction: 1, Done: true},
	}}},
	{"unknown-size", Pull{Pulling: true, Fraction: 0.25, Done: 0, Total: 2, Images: []Image{
		{Label: "radarr"}, {Label: "sonarr:latest", Fraction: 0.5},
	}}},
	{"failed", Pull{Failed: true, Fraction: 0.5, Done: 1, Total: 3, Images: []Image{
		{Label: "Jellyfin", Fraction: 1, Done: true}, {Label: "sonarr:latest", Fraction: 0.4}, {Label: longLabel, Fraction: 0.1},
	}}},
	{"interrupted", Pull{Fraction: 0.5, Done: 1, Total: 2, Images: []Image{
		{Label: "Jellyfin", Fraction: 1, Done: true}, {Label: "sonarr:latest", Fraction: 0.25},
	}}},
	{"out-of-order", Pull{Pulling: true, Fraction: 0.625, Done: 1, Total: 2, Images: []Image{
		{Label: "Jellyfin", Fraction: 0.25}, {Label: "sonarr:latest", Fraction: 1, Done: true},
	}}},
}

func TestRenderPullGoldens(t *testing.T) {
	for _, width := range []int{120, 80} {
		for _, frame := range pullFrames {
			name := fmt.Sprintf("pull-%s-%d", frame.name, width)
			t.Run(name, func(t *testing.T) {
				s := Snapshot{Pull: frame.pull}
				block := Render(s, width, testPalette)
				compact := Compact(s, width, testPalette)
				for _, line := range append(block, compact) {
					if w := ansi.StringWidth(line); w > width {
						t.Fatalf("line is %d cells, wider than %d: %q", w, width, ansi.Strip(line))
					}
					if plain := ansi.Strip(line); strings.ContainsAny(plain, "%") || strings.Contains(plain, "MB") {
						t.Fatalf("progress text in %q", plain)
					}
				}
				golden(t, name, ansi.Strip(strings.Join(block, "\n")+"\n\n"+compact+"\n"))
			})
		}
	}
}

func TestRenderPullFillUsesAccent(t *testing.T) {
	s := Snapshot{Pull: Pull{Pulling: true, Fraction: 0.5, Total: 1, Images: []Image{{Label: "Jellyfin", Fraction: 0.5}}}}
	accent := "\x1b[38;2;122;87;211m"
	block := strings.Join(Render(s, 80, testPalette), "\n")
	if !strings.Contains(block, accent+"█") || !strings.Contains(block, accent+"━") {
		t.Fatalf("fills are not drawn in the accent colour: %q", block)
	}
	if compact := Compact(s, 80, testPalette); !strings.Contains(compact, accent+"█") {
		t.Fatalf("compact fill is not drawn in the accent colour: %q", compact)
	}
}

func TestRenderFailedPullUsesFailRole(t *testing.T) {
	s := Snapshot{Pull: Pull{Failed: true, Fraction: 0.25, Total: 1, Images: []Image{{Label: "sonarr", Fraction: 0.25}}}}
	fail := "\x1b[38;2;255;95;95m"
	block := Render(s, 80, testPalette)
	if !strings.Contains(block[0], fail+"✗") || !strings.Contains(ansi.Strip(block[0]), "Pull failed") {
		t.Fatalf("failed header lacks ✗ in the fail colour and \"Pull failed\": %q", block[0])
	}
	if !strings.Contains(block[1], fail+"✗") {
		t.Fatalf("unfinished image lacks ✗ in the fail colour: %q", block[1])
	}
}

func TestRenderPullWithoutColourKeepsGlyphs(t *testing.T) {
	s := Snapshot{Pull: Pull{Pulling: true, Fraction: 0.5, Done: 1, Total: 2, Images: []Image{{Label: "Jellyfin", Fraction: 1, Done: true}, {Label: "sonarr"}}}}
	block := strings.Join(Render(s, 80, Palette{}), "\n")
	if strings.Contains(block, "\x1b[38") {
		t.Fatalf("colour without a palette: %q", block)
	}
	for _, want := range []string{"█", "░", "━", "─", "✓", "1 of 2 images"} {
		if !strings.Contains(block, want) {
			t.Fatalf("block without colour lacks %q:\n%s", want, block)
		}
	}
}

func TestRenderWithoutPullIsEmpty(t *testing.T) {
	if block, compact := Render(Snapshot{}, 80, testPalette), Compact(Snapshot{}, 80, testPalette); len(block) != 0 || compact != "" {
		t.Fatalf("no pull drew %q and %q", block, compact)
	}
}
