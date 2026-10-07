package tui

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/events"
)

func TestRunningPullShowsFooterAndBars(t *testing.T) {
	m, _ := sample(t, 140, 32)
	task := m.tasks.start("update one")
	for _, e := range []events.Event{
		{Event: events.PullProgress, Image: "jellyfin:latest", Layer: "l1", Status: "Downloading", Current: 120_000_000, Total: 220_000_000},
		{Event: events.PullProgress, Image: "jellyfin:latest", Layer: "l2", Status: "Extracting", Current: 60_000_000, Total: 80_000_000},
		{Event: events.PullProgress, Image: "sonarr:latest", Layer: "l1", Status: "Downloading", Current: 45_000_000, Total: 100_000_000},
	} {
		task.append(e)
	}

	footer := ansi.Strip(m.footerStatus())
	for _, want := range []string{"pulling 2 images", "56%", "225 MB/400 MB"} {
		if !strings.Contains(footer, want) {
			t.Fatalf("footer lacks %q:\n%s", want, footer)
		}
	}
	if pct, ok := m.pullPercent(); !ok || pct != 56 {
		t.Fatalf("pullPercent = (%d, %v), want (56, true)", pct, ok)
	}

	m.wizard = &wizard{stage: stageInstalling, taskID: task.id, plan: &plan{}}
	out := ansi.Strip(m.renderInstalling(task.id))
	for _, want := range []string{"jellyfin:latest", "sonarr:latest", "█"} {
		if !strings.Contains(out, want) {
			t.Fatalf("install screen lacks %q:\n%s", want, out)
		}
	}
}
