package activity

import (
	"bytes"
	"strconv"
	"strings"
	"testing"

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
			for j < len(runes) && runes[j] >= '0' && runes[j] <= '9' {
				j++
			}
			n, _ := strconv.Atoi(string(runes[i+2 : j]))
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

func TestTerminalRedrawsThePullBlockInPlace(t *testing.T) {
	var out bytes.Buffer
	sink := Terminal(&out, false, func() int { return 60 }, Palette{})
	for _, e := range []events.Event{
		{Event: events.RunStart, Msg: "install sonarr"},
		{Event: events.StepStart, App: "sonarr", Step: "pull", Msg: "pull 2 images"},
		{Event: events.StepStart, Step: "pull", Msg: "pull 2 images"},
		{Event: events.PullProgress, Image: "lscr.io/linuxserver/sonarr:latest", Layer: "a", Status: "Downloading", Current: 50, Total: 100},
		{Event: events.PullProgress, Image: "redis:7", Layer: "b", Status: "Downloading", Current: 10, Total: 0},
		{Event: events.Info, Msg: "registry is slow"},
		{Event: events.PullProgress, Image: "redis:7", Status: "Pulled"},
		{Event: events.PullProgress, Image: "lscr.io/linuxserver/sonarr:latest", Layer: "a", Status: "Extracting", Current: 100, Total: 100},
		{Event: events.PullProgress, Image: "lscr.io/linuxserver/sonarr:latest", Status: "Pulled"},
		{Event: events.StepOK, App: "sonarr", Step: "pull", Msg: "pulled sonarr"},
		{Event: events.StepOK, Step: "pull", Msg: "pulled sonarr"},
		{Event: events.RunEnd, Msg: "done"},
	} {
		sink.Emit(e)
	}
	raw := out.String()
	if got := strings.Count(raw, "\r\x1b[2A\x1b[J"); got != 1 {
		t.Fatalf("two-line block erased %d times, want 1:\n%q", got, raw)
	}
	if got := strings.Count(raw, "\r\x1b[3A\x1b[J"); got != 5 {
		t.Fatalf("three-line block erased %d times, want 5:\n%q", got, raw)
	}
	want := strings.Join([]string{
		"▶ install sonarr",
		"  registry is slow",
		"Pulled                ███████████████████████  2 of 2 images",
		"  sonarr:latest       ━━━━━━━━━━━━━━━━━━━━━━━  ✓",
		"  redis:7             ━━━━━━━━━━━━━━━━━━━━━━━  ✓",
		"  ✓ sonarr › pull pulled sonarr",
		"  ✓ pull pulled sonarr",
		"■ done",
		"",
	}, "\n")
	if got := screen(t, raw); got != want {
		t.Fatalf("visible output =\n%s\nwant\n%s", got, want)
	}
	if strings.Contains(raw, "%") || strings.Contains(raw, "MB") {
		t.Fatalf("terminal output shows percentages or sizes: %q", raw)
	}
}

func TestTerminalLeavesTheLastBlockWhenANewRunStarts(t *testing.T) {
	var out bytes.Buffer
	sink := Terminal(&out, false, func() int { return 60 }, Palette{})
	for _, e := range []events.Event{
		{Event: events.StepStart, Step: "pull"},
		{Event: events.PullProgress, Image: "redis:7", Layer: "b", Status: "Downloading", Current: 50, Total: 100},
		{Event: events.RunStart, Msg: "setup redis"},
	} {
		sink.Emit(e)
	}
	want := strings.Join([]string{
		"Pulling               ██████░░░░░░░░░░░░░░░░░░  0 of 1 image",
		"  redis:7             ━━━━━━──────────────────",
		"▶ setup redis",
		"",
	}, "\n")
	if got := screen(t, out.String()); got != want {
		t.Fatalf("visible output =\n%s\nwant\n%s", got, want)
	}
}

func TestTerminalWritesNothingWhenTheBlockIsUnchanged(t *testing.T) {
	var out bytes.Buffer
	sink := Terminal(&out, false, func() int { return 60 }, Palette{})
	sink.Emit(events.Event{Event: events.StepStart, Step: "pull"})
	sink.Emit(events.Event{Event: events.PullProgress, Image: "redis:7", Layer: "b", Status: "Downloading", Current: 50, Total: 100})
	out.Reset()
	sink.Emit(events.Event{Event: events.PullProgress, Image: "redis:7", Layer: "b", Status: "Downloading", Current: 51, Total: 100})
	if out.Len() != 0 {
		t.Fatalf("unchanged block was redrawn: %q", out.String())
	}
}

func TestTerminalRedrawsAtTheNewWidth(t *testing.T) {
	var out bytes.Buffer
	width := 60
	sink := Terminal(&out, false, func() int { return width }, Palette{})
	sink.Emit(events.Event{Event: events.StepStart, Step: "pull"})
	sink.Emit(events.Event{Event: events.PullProgress, Image: "redis:7", Layer: "b", Status: "Downloading", Current: 50, Total: 100})
	width = 50
	sink.Emit(events.Event{Event: events.PullProgress, Image: "redis:7", Layer: "b", Status: "Downloading", Current: 51, Total: 100})
	want := strings.Join([]string{
		"Pulling               ███▌░░░░░░░░░░  0 of 1 image",
		"  redis:7             ━━━╸──────────",
		"",
	}, "\n")
	if got := screen(t, out.String()); got != want {
		t.Fatalf("visible output =\n%s\nwant\n%s", got, want)
	}
}
