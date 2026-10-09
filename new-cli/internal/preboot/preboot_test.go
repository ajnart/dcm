package preboot

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

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

// pulling is a pull of seven images of which done are finished, with
// remaining of the time estimated to be left (0 before there is an estimate).
func pulling(done int, remaining time.Duration) Progress {
	pr := Progress{Fraction: (float64(done) + 0.4) / 7, Done: done, Total: 7, Narrative: "Pulling 7 images", Remaining: remaining}
	if done == 7 {
		pr.Fraction = 1
	}
	return pr
}

// dashboard stands in for the screen the wipe brings in.
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
			remaining   time.Duration
		}{{"start", 0, 0, 0}, {"mid", 72, 3, 75 * time.Second}, {"end", 144, 7, 10 * time.Second}} {
			t.Run(step.name+"-"+size.name, func(t *testing.T) {
				pr := pulling(step.done, step.remaining)
				golden(t, "pull-"+step.name+"-"+size.name, Render(step.frame, size.w, size.h, pr, Dark(), false))
			})
		}
	}
	t.Run("small", func(t *testing.T) {
		golden(t, "pull-mid-70x20", Render(72, 70, 20, pulling(3, 75*time.Second), Dark(), false))
	})
}

func TestGoldenExit(t *testing.T) {
	for _, size := range sizes {
		for _, since := range []int{0, 12, 28, 36, ExitFrames - 1} {
			t.Run(fmt.Sprintf("%d-%s", since, size.name), func(t *testing.T) {
				lines := RenderExit(144+since, since, size.w, size.h, pulling(7, 10*time.Second), Dark(), false, dashboard(size.w, size.h))
				golden(t, fmt.Sprintf("exit-%02d-%s", since, size.name), lines)
			})
		}
	}
}

func TestTheLastExitFrameIsTheScreenItOpensOnto(t *testing.T) {
	under := dashboard(80, 24)

	got := RenderExit(180, ExitFrames-1, 80, 24, pulling(7, 10*time.Second), Dark(), false, under)

	if !slices.Equal(got, under) {
		t.Fatalf("the exit should end on the landing screen, got\n%s", strings.Join(got, "\n"))
	}
}

func TestRenderingIsAFunctionOfItsInputs(t *testing.T) {
	a := Render(40, 120, 30, pulling(2, 0), Dark(), false)
	b := Render(40, 120, 30, pulling(2, 0), Dark(), false)
	if !slices.Equal(a, b) {
		t.Fatal("the same frame must render the same")
	}
	if slices.Equal(a, Render(41, 120, 30, pulling(2, 0), Dark(), false)) {
		t.Fatal("the next frame must move")
	}
}

func TestWithoutColourTheMotionKeepsItsWeight(t *testing.T) {
	lines := Render(72, 120, 30, pulling(3, 75*time.Second), Dark(), true)

	out := strings.Join(lines, "\n")
	if strings.Contains(out, "38;2") || strings.Contains(out, "38;5") {
		t.Fatalf("NO_COLOR must not set a colour:\n%q", out)
	}
	if !strings.Contains(out, "\x1b[1m") || !strings.Contains(out, "\x1b[2m") {
		t.Fatalf("NO_COLOR keeps the motion as weight, bold and faint:\n%q", out)
	}
	if !slices.Equal(stripAll(lines), stripAll(Render(72, 120, 30, pulling(3, 75*time.Second), Dark(), true))) {
		t.Fatal("NO_COLOR must stay deterministic")
	}
}

func TestLightAndDarkPalettesPaintDifferently(t *testing.T) {
	dark := strings.Join(Render(72, 120, 30, pulling(3, 75*time.Second), Dark(), false), "\n")
	light := strings.Join(Render(72, 120, 30, pulling(3, 75*time.Second), Light(), false), "\n")

	if dark == light || !strings.Contains(light, "38;2;29;26;43") {
		t.Fatalf("the light palette should paint its own text colour, #1D1A2B")
	}
}

func TestEveryTierKeepsItsTextWhole(t *testing.T) {
	for _, size := range []struct{ w, h int }{{120, 30}, {100, 28}, {80, 24}, {79, 24}, {70, 20}, {60, 16}, {50, 14}, {40, 12}} {
		for _, frame := range []int{0, 37, 144} {
			lines := stripAll(Render(frame, size.w, size.h, pulling(3, 75*time.Second), Dark(), false))
			if len(lines) != size.h {
				t.Fatalf("%dx%d has %d rows", size.w, size.h, len(lines))
			}
			for _, line := range lines {
				if ansi.StringWidth(line) != size.w {
					t.Fatalf("%dx%d frame %d: a row is %d wide: %q", size.w, size.h, frame, ansi.StringWidth(line), line)
				}
			}
			screen := strings.Join(lines, "\n")
			for _, want := range []string{"s e l f - h o s t", "as long as a song on the radio.", "c Ko-fi", "s GitHub Sponsors", "enter skip", "3 of 7 images"} {
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

func TestTheTimeLineFollowsTheEstimate(t *testing.T) {
	for _, step := range []struct {
		remaining time.Duration
		want      string
	}{
		{10 * time.Second, "This should take about as long as a deep breath."},
		{29 * time.Second, "This should take about as long as a deep breath."},
		{30 * time.Second, "This should take about as long as a song on the radio."},
		{119 * time.Second, "This should take about as long as a song on the radio."},
		{2 * time.Minute, "This should take about as long as brewing a pot of tea."},
		{4*time.Minute + 59*time.Second, "This should take about as long as brewing a pot of tea."},
		{5 * time.Minute, "This should take about as long as a walk around the block."},
		{14 * time.Minute, "This should take about as long as a walk around the block."},
		{15 * time.Minute, "This should take about as long as an episode of your favourite show."},
		{3 * time.Hour, "This should take about as long as an episode of your favourite show."},
	} {
		if got := timeLines(step.remaining, 0)[0].String(); got != step.want {
			t.Errorf("%v left: %q, want %q", step.remaining, got, step.want)
		}
	}
}

func TestAComparisonRotatesEveryTenSeconds(t *testing.T) {
	for _, step := range []struct {
		frame int
		want  string
	}{
		{0, "This should take about as long as a song on the radio."},
		{239, "This should take about as long as a song on the radio."},
		{240, "This should take about as long as the kettle coming to the boil."},
		{480, "This should take about as long as a quick tidy of your desk."},
		{720, "This should take about as long as a song on the radio."},
	} {
		if got := timeLines(time.Minute, step.frame)[0].String(); got != step.want {
			t.Errorf("frame %d: %q, want %q", step.frame, got, step.want)
		}
	}
}

func TestAShortFormKeepsTheLineWholeInANarrowTerminal(t *testing.T) {
	lines := timeLines(90*time.Second, 0)

	if got := lines[1].String(); got != "About as long as a song on the radio." {
		t.Fatalf("got %q", got)
	}
	screen := strings.Join(stripAll(Render(0, 40, 12, pulling(3, 90*time.Second), Dark(), false)), "\n")
	if !strings.Contains(screen, "About as long as a song on the radio.") {
		t.Fatalf("a narrow terminal should get the short form\n%s", screen)
	}
}

func TestBeforeAnEstimateTheScreenWarmsUp(t *testing.T) {
	for frame, want := range map[int]string{0: "Warming up the engines…", 239: "Warming up the engines…", 240: "Measuring the distance to your Apps…", 480: "Warming up the engines…"} {
		screen := strings.Join(stripAll(Render(frame, 120, 30, pulling(0, 0), Dark(), false)), "\n")
		if !strings.Contains(screen, want) || strings.Contains(screen, "as long as") {
			t.Errorf("frame %d should say %q\n%s", frame, want, screen)
		}
	}
}

func TestTheScreenNeverTalksCoffeeOrPercent(t *testing.T) {
	for _, remaining := range []time.Duration{0, 10 * time.Second, time.Minute, 3 * time.Minute, 8 * time.Minute, time.Hour} {
		for frame := 0; frame < 3*rotateFrames; frame += 37 {
			for _, size := range []struct{ w, h int }{{120, 30}, {80, 24}, {70, 20}} {
				screen := strings.ToLower(strings.Join(stripAll(Render(frame, size.w, size.h, pulling(3, remaining), Dark(), false)), "\n"))
				if strings.Contains(screen, "coffee") || strings.Contains(screen, "%") || strings.Contains(screen, "╭─────╮") {
					t.Fatalf("%v left, frame %d, %dx%d:\n%s", remaining, frame, size.w, size.h, screen)
				}
			}
		}
	}
	for _, b := range buckets {
		for _, line := range b.lines {
			if strings.Contains(strings.ToLower(line), "coffee") || strings.ContainsAny(line, "0123456789") {
				t.Errorf("a comparison has coffee or a number: %q", line)
			}
		}
	}
}

// observe plays seconds of the pull through p at the given fraction.
func observe(p *Pace, from, seconds int, fraction float64) int {
	frame := from
	for range seconds * FPS {
		frame++
		p.Observe(frame, fraction)
	}
	return frame
}

func TestPaceHasNoEstimateUntilItHasSeenEnough(t *testing.T) {
	var p Pace

	p.Observe(FPS, 0.5)
	p.Observe(10*FPS, 0.01)

	if p.Remaining() != 0 {
		t.Fatalf("one second in, or 1%% done, is too little to guess: %v", p.Remaining())
	}
}

func TestPaceEstimatesFromElapsedTimeAndTheFraction(t *testing.T) {
	cases := []struct {
		seconds  int
		fraction float64
		want     time.Duration
	}{
		{10, 0.5, 15 * time.Second},   // 10 s for half: 10 s left
		{10, 0.25, time.Minute},       // 10 s for a quarter: 30 s left
		{30, 0.2, 3 * time.Minute},    // 30 s for a fifth: 120 s left
		{60, 0.1, 8 * time.Minute},    // 60 s for a tenth: 540 s left
		{120, 0.05, 25 * time.Minute}, // 120 s for a twentieth: 2280 s left
		{10, 1, 15 * time.Second},     // nothing left
	}
	for _, c := range cases {
		var p Pace
		p.Observe(c.seconds*FPS, c.fraction)
		if got := p.Remaining(); got != c.want {
			t.Errorf("%d s in at %v: %v, want %v", c.seconds, c.fraction, got, c.want)
		}
	}
}

func TestPaceDoesNotFlickerBetweenBuckets(t *testing.T) {
	var p Pace
	frame := observe(&p, 0, 10, 0.5)
	if p.Remaining() != 15*time.Second {
		t.Fatalf("setup: %v", p.Remaining())
	}

	// The estimate crosses 30 s for two seconds, then falls back: the line
	// stays.
	frame = observe(&p, frame, 2, 0.2)
	frame = observe(&p, frame, 2, 0.5)
	if p.Remaining() != 15*time.Second {
		t.Fatalf("a brief crossing should not change the bucket: %v", p.Remaining())
	}

	// Back over the boundary and staying there changes it after four seconds.
	frame = observe(&p, frame, 3, 0.2)
	if p.Remaining() != 15*time.Second {
		t.Fatalf("three seconds past the boundary is not enough: %v", p.Remaining())
	}
	observe(&p, frame, 2, 0.2)
	if p.Remaining() != time.Minute {
		t.Fatalf("after four seconds past the boundary the bucket should move: %v", p.Remaining())
	}
}

func TestTheNarrativeStaysPutWhileItsDotsAnimate(t *testing.T) {
	for _, size := range sizes {
		start := -1
		for frame := 0; frame < FPS; frame++ {
			col := -1
			for _, line := range Render(frame, size.w, size.h, pulling(3, 0), Dark(), false) {
				plain := ansi.Strip(line)
				if i := strings.Index(plain, "Pulling 7 images"); i >= 0 {
					col = ansi.StringWidth(plain[:i])
				}
			}
			if col < 0 {
				t.Fatalf("%s frame %d: no narrative", size.name, frame)
			}
			if start < 0 {
				start = col
			}
			if col != start {
				t.Fatalf("%s frame %d: narrative at column %d, was %d", size.name, frame, col, start)
			}
		}
	}
}
