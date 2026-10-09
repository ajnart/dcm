package activity

import (
	"bytes"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/events"
)

// screen replays what a terminal shows for out, understanding the carriage
// return, newline, cursor-up and erase-below sequences the sink writes.
func screen(t *testing.T, out string) string {
	t.Helper()
	lines := [][]rune{nil}
	row, col := 0, 0
	runes := []rune(out)
	for i := 0; i < len(runes); i++ {
		switch r := runes[i]; {
		case r == '\n':
			row, col = row+1, 0
			if row == len(lines) {
				lines = append(lines, nil)
			}
		case r == '\r':
			col = 0
		case r == '\x1b':
			j := i + 2
			for j < len(runes) && (runes[j] >= '0' && runes[j] <= '9' || runes[j] == ';') {
				j++
			}
			n, _ := strconv.Atoi(strings.Split(string(runes[i+2:j]), ";")[0])
			switch runes[j] {
			case 'm':
			case 'A':
				row = max(row-n, 0)
			case 'J':
				lines[row] = lines[row][:min(col, len(lines[row]))]
				lines = lines[:row+1]
			default:
				t.Fatalf("unexpected escape %q", string(runes[i:j+1]))
			}
			i = j
		default:
			for len(lines[row]) <= col {
				lines[row] = append(lines[row], ' ')
			}
			lines[row][col] = r
			col++
		}
	}
	var text []string
	for _, line := range lines {
		text = append(text, strings.TrimRight(string(line), " "))
	}
	return strings.Join(text, "\n")
}

// clock is an injected frame source: tick sends one frame and waits until
// the sink drew it.
type clock struct {
	c       chan time.Time
	ticked  chan struct{}
	started int
	stopped int
}

func newClock() *clock {
	return &clock{c: make(chan time.Time), ticked: make(chan struct{})}
}

func (c *clock) ticks() (<-chan time.Time, func()) {
	c.started++
	return c.c, func() { c.stopped++ }
}

func (c *clock) tick() {
	c.c <- time.Time{}
	<-c.ticked
}

func testTerminal(out *bytes.Buffer, width func() int) (*TerminalSink, *clock) {
	c := newClock()
	sink := newTerminal(out, false, width, Simple, Palette{}, c.ticks)
	sink.ticked = c.ticked
	return sink, c
}

func fixed(n int) func() int { return func() int { return n } }

func TestTerminalPrintsTheLogAboveTheLiveAction(t *testing.T) {
	var out bytes.Buffer
	sink, clock := testTerminal(&out, fixed(60))
	emit := func(evs ...events.Event) {
		for _, e := range evs {
			sink.Emit(e)
		}
	}
	emit(seq(
		events.Event{Event: events.RunStart, Msg: "install sonarr"},
		stage(events.StepStart, "pull", "pull 1 image", "sonarr"),
		layer("lscr.io/linuxserver/sonarr:latest", "a", "Downloading", 50, 100),
	)...)
	clock.tick()
	clock.tick()
	emit(seq(
		pulled("lscr.io/linuxserver/sonarr:latest"),
		stage(events.StepOK, "pull", "pulled sonarr", "sonarr"),
		stage(events.StepStart, "start", "start sonarr", "sonarr"),
	)...)
	clock.tick()
	emit(seq(
		stage(events.StepOK, "start", "started sonarr", "sonarr"),
		ev(events.StepStart, "sonarr", "admin", "create the admin account"),
	)...)
	clock.tick()
	clock.tick()
	emit(seq(
		ev(events.StepOK, "sonarr", "admin", "create the admin account"),
		ev(events.StepStart, "sonarr", "check", "verify Sonarr works"),
		ev(events.StepOK, "sonarr", "check", "verify Sonarr works"),
		events.Event{Event: events.RunEnd, Msg: "done"},
	)...)
	sink.Close()

	raw := out.String()
	if strings.Count(raw, "\x1b[J") < 10 {
		t.Fatalf("the block was not redrawn in place:\n%q", raw)
	}
	if strings.Contains(raw, "%") || strings.Contains(raw, "MB") {
		t.Fatalf("terminal output shows percentages or sizes: %q", raw)
	}
	want := strings.Join([]string{
		"▶ install sonarr",
		"  ✓ sonarr › pull pulled sonarr",
		"  ✓ pull pulled sonarr",
		"  ✓ sonarr › start started sonarr",
		"  ✓ start started sonarr",
		"  ✓ sonarr › admin create the admin account",
		"  ✓ sonarr › check verify Sonarr works",
		"■ done",
		"✓ install sonarr",
		"  ✓ ▣ Pull   ✓ ▣ Start   ✓ ✱ Credentials   ✓ Check",
		"╭─ Apps 1/1 set up ────────────────────────────────────────╮",
		"│ ● sonarr          ready                                  │",
		"╰──────────────────────────────────────────────────────────╯",
		"  sonarr is ready",
		"",
	}, "\n")
	if got := screen(t, raw); got != want {
		t.Fatalf("visible output =\n%s\nwant\n%s", got, want)
	}
}

func TestTerminalShowsPullBarsAndAnimatesBetweenEvents(t *testing.T) {
	var out bytes.Buffer
	sink, clock := testTerminal(&out, fixed(60))
	t.Cleanup(sink.Close)
	for _, e := range seq(
		events.Event{Event: events.RunStart, Msg: "install sonarr"},
		stage(events.StepStart, "pull", "pull 1 image", "sonarr"),
		layer("redis:7", "b", "Downloading", 50, 100),
	) {
		sink.Emit(e)
	}
	first := screen(t, out.String())
	clock.tick()
	second := screen(t, out.String())
	for _, want := range []string{"⠋ install sonarr", "Pulling", "redis:7", "0 of 1 image"} {
		if !strings.Contains(first, want) {
			t.Fatalf("live block lacks %q:\n%s", want, first)
		}
	}
	if !strings.Contains(second, "⠙ install sonarr") || strings.Contains(second, "⠋") {
		t.Fatalf("a frame must advance the spinner in place:\n%s", second)
	}
}

func TestTerminalWritesNothingWhenTheBlockIsUnchanged(t *testing.T) {
	var out bytes.Buffer
	sink, _ := testTerminal(&out, fixed(60))
	t.Cleanup(sink.Close)
	sink.Emit(events.Event{Event: events.RunStart})
	sink.Emit(events.Event{Event: events.StepStart, Step: "pull"})
	sink.Emit(layer("redis:7", "b", "Downloading", 50, 100))
	out.Reset()
	sink.Emit(layer("redis:7", "b", "Downloading", 51, 100))
	if out.Len() != 0 {
		t.Fatalf("unchanged block was redrawn: %q", out.String())
	}
}

func TestTerminalRedrawsAtTheNewWidth(t *testing.T) {
	var out bytes.Buffer
	width := 60
	sink, clock := testTerminal(&out, func() int { return width })
	t.Cleanup(sink.Close)
	sink.Emit(events.Event{Event: events.RunStart, Msg: "pull"})
	sink.Emit(events.Event{Event: events.StepStart, Step: "pull"})
	sink.Emit(layer("redis:7", "b", "Downloading", 50, 100))
	width = 40
	clock.tick()
	for _, line := range strings.Split(screen(t, out.String()), "\n") {
		if w := ansi.StringWidth(line); w > 40 {
			t.Fatalf("line is %d cells after the resize: %q", w, line)
		}
	}
}

func TestTerminalTickerRunsFromRunStartToRunEnd(t *testing.T) {
	var out bytes.Buffer
	sink, clock := testTerminal(&out, fixed(60))
	sink.Emit(events.Event{Event: events.Info, Msg: "before the Action"})
	if clock.started != 0 {
		t.Fatal("the ticker must wait for run.start")
	}
	sink.Emit(events.Event{Event: events.RunStart, Msg: "start sonarr"})
	sink.Emit(events.Event{Event: events.RunEnd, Msg: "done"})
	if clock.started != 1 || clock.stopped != 1 {
		t.Fatalf("ticker started %d and stopped %d times, want 1 and 1", clock.started, clock.stopped)
	}
	sink.Emit(events.Event{Event: events.RunStart, Msg: "start radarr"})
	sink.Close()
	if clock.started != 2 || clock.stopped != 2 {
		t.Fatalf("Close must stop the ticker: started %d, stopped %d", clock.started, clock.stopped)
	}
}

func TestTerminalLeavesTheLastBlockWhenANewRunStarts(t *testing.T) {
	var out bytes.Buffer
	sink, _ := testTerminal(&out, fixed(60))
	t.Cleanup(sink.Close)
	for _, e := range seq(
		events.Event{Event: events.RunStart, Msg: "start sonarr"},
		stage(events.StepStart, "start", "start sonarr", "sonarr"),
		events.Event{Event: events.RunStart, Msg: "setup sonarr"},
	) {
		sink.Emit(e)
	}
	want := strings.Join([]string{
		"▶ start sonarr",
		"⠋ start sonarr",
		"  ⠋ ▣ Start",
		"╭─ Apps 0/1 set up ────────────────────────────────────────╮",
		"│ ⠋ sonarr          starting                               │",
		"╰──────────────────────────────────────────────────────────╯",
		"  Starting sonarr",
		"▶ setup sonarr",
		"",
	}, "\n")
	if got := screen(t, out.String()); got != want {
		t.Fatalf("visible output =\n%s\nwant\n%s", got, want)
	}
}
