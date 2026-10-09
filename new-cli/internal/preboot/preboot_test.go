package preboot

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
)

var update = flag.Bool("update", false, "rewrite golden files")

func golden(t *testing.T, name string, lines []string) {
	t.Helper()
	for i, line := range lines {
		lines[i] = strings.TrimRight(ansi.Strip(line), " ")
	}
	got := strings.Join(lines, "\n")
	path := filepath.Join("testdata", name+".golden")
	if *update {
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

var imageNames = []string{"Jellyfin", "Sonarr", "Radarr", "Prowlarr", "qBittorrent", "Seerr", "Homarr"}

// pulling is a pull of seven images of which done are finished.
func pulling(done int) Progress {
	pr := Progress{Fraction: (float64(done) + 0.4) / 7, Done: done, Total: 7, Narrative: "Pulling 7 images"}
	for i, name := range imageNames {
		pr.Images = append(pr.Images, Image{Label: name, Done: i < done})
	}
	if done == 7 {
		pr.Fraction = 1
	}
	return pr
}

// dashboard stands in for the screen the iris opens onto.
func dashboard(w, h int) []string {
	lines := make([]string, h)
	for y := range lines {
		lines[y] = ansi.Truncate(fmt.Sprintf("%02d · %s", y, strings.Repeat("dashboard · ", w)), w, "")
	}
	return lines
}

var sizes = []struct {
	name string
	w, h int
}{{"120x30", 120, 30}, {"80x24", 80, 24}}

func TestGoldenPull(t *testing.T) {
	for _, size := range sizes {
		for _, step := range []struct {
			name        string
			frame, done int
		}{{"start", 0, 0}, {"mid", 72, 3}, {"end", 144, 7}} {
			t.Run(step.name+"-"+size.name, func(t *testing.T) {
				golden(t, "pull-"+step.name+"-"+size.name, Render(step.frame, size.w, size.h, pulling(step.done), Dark(), false))
			})
		}
	}
	t.Run("small", func(t *testing.T) {
		golden(t, "pull-mid-70x20", Render(72, 70, 20, pulling(3), Dark(), false))
	})
}

func TestGoldenExit(t *testing.T) {
	for _, size := range sizes {
		for _, since := range []int{0, 12, 28, 36, ExitFrames - 1} {
			t.Run(fmt.Sprintf("%d-%s", since, size.name), func(t *testing.T) {
				lines := RenderExit(144+since, since, size.w, size.h, pulling(7), Dark(), false, dashboard(size.w, size.h))
				golden(t, fmt.Sprintf("exit-%02d-%s", since, size.name), lines)
			})
		}
	}
}

func TestTheLastExitFrameIsTheScreenItOpensOnto(t *testing.T) {
	under := dashboard(80, 24)

	got := RenderExit(180, ExitFrames-1, 80, 24, pulling(7), Dark(), false, under)

	if !slices.Equal(got, under) {
		t.Fatalf("the exit should end on the landing screen, got\n%s", strings.Join(got, "\n"))
	}
}

func TestRenderingIsAFunctionOfItsInputs(t *testing.T) {
	a := Render(40, 120, 30, pulling(2), Dark(), false)
	b := Render(40, 120, 30, pulling(2), Dark(), false)
	if !slices.Equal(a, b) {
		t.Fatal("the same frame must render the same")
	}
	if slices.Equal(a, Render(41, 120, 30, pulling(2), Dark(), false)) {
		t.Fatal("the next frame must move")
	}
}

func TestWithoutColourTheMotionKeepsItsWeight(t *testing.T) {
	lines := Render(72, 120, 30, pulling(3), Dark(), true)

	out := strings.Join(lines, "\n")
	if strings.Contains(out, "38;2") || strings.Contains(out, "38;5") {
		t.Fatalf("NO_COLOR must not set a colour:\n%q", out)
	}
	if !strings.Contains(out, "\x1b[1m") || !strings.Contains(out, "\x1b[2m") {
		t.Fatalf("NO_COLOR keeps the motion as weight, bold and faint:\n%q", out)
	}
	if !slices.Equal(stripAll(lines), stripAll(Render(72, 120, 30, pulling(3), Dark(), true))) {
		t.Fatal("NO_COLOR must stay deterministic")
	}
}

func TestLightAndDarkPalettesPaintDifferently(t *testing.T) {
	dark := strings.Join(Render(72, 120, 30, pulling(3), Dark(), false), "\n")
	light := strings.Join(Render(72, 120, 30, pulling(3), Light(), false), "\n")

	if dark == light || !strings.Contains(light, "38;2;29;26;43") {
		t.Fatalf("the light palette should paint its own text colour, #1D1A2B")
	}
}

func TestEveryTierKeepsItsTextWhole(t *testing.T) {
	for _, size := range []struct{ w, h int }{{120, 30}, {100, 28}, {80, 24}, {79, 24}, {70, 20}, {60, 16}, {50, 14}, {40, 12}} {
		for _, frame := range []int{0, 37, 144} {
			lines := stripAll(Render(frame, size.w, size.h, pulling(3), Dark(), false))
			if len(lines) != size.h {
				t.Fatalf("%dx%d has %d rows", size.w, size.h, len(lines))
			}
			for _, line := range lines {
				if ansi.StringWidth(line) != size.w {
					t.Fatalf("%dx%d frame %d: a row is %d wide: %q", size.w, size.h, frame, ansi.StringWidth(line), line)
				}
			}
			screen := strings.Join(lines, "\n")
			for _, want := range []string{"s e l f - h o s t", "Go grab a coffee", "c Ko-fi", "s GitHub Sponsors", "enter skip", "3 of 7 images"} {
				if size.w < 50 && want == "s GitHub Sponsors" {
					want = "s Sponsors"
				}
				if !strings.Contains(screen, want) {
					t.Errorf("%dx%d frame %d lacks %q\n%s", size.w, size.h, frame, want, screen)
				}
			}
		}
	}
}

func stripAll(lines []string) []string {
	out := make([]string, len(lines))
	for i, line := range lines {
		out[i] = ansi.Strip(line)
	}
	return out
}
