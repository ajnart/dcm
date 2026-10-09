package tui

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/events"
)

func assertNoProgressText(t *testing.T, where, out string) {
	t.Helper()
	if strings.Contains(out, "%") || strings.Contains(out, "MB") {
		t.Fatalf("%s shows percentages or sizes:\n%s", where, out)
	}
}

func TestRunningPullShowsFooterAndBars(t *testing.T) {
	m, _ := sample(t, 140, 32)
	task := m.tasks.start("update one")
	for _, e := range []events.Event{
		{Event: events.RunStart, Msg: "update one"},
		{Event: events.StepStart, Step: "pull", Msg: "pull 2 images"},
		{Event: events.PullProgress, Image: "jellyfin:latest", Layer: "l1", Status: "Downloading", Current: 120_000_000, Total: 220_000_000},
		{Event: events.PullProgress, Image: "jellyfin:latest", Layer: "l2", Status: "Extracting", Current: 60_000_000, Total: 80_000_000},
		{Event: events.PullProgress, Image: "sonarr:latest", Layer: "l1", Status: "Downloading", Current: 45_000_000, Total: 100_000_000},
		{Event: events.PullProgress, Image: "sonarr:latest", Status: "Pulled"},
	} {
		task.append(e)
	}

	footer := ansi.Strip(m.footerStatus())
	for _, want := range []string{"update one", "█", "░", "1 of 2 images"} {
		if !strings.Contains(footer, want) {
			t.Fatalf("footer lacks %q:\n%s", want, footer)
		}
	}
	assertNoProgressText(t, "footer", footer)

	m.wizard = &wizard{stage: stageInstalling, taskID: task.id, plan: &plan{}}
	out := ansi.Strip(m.renderInstalling(task.id))
	for _, want := range []string{"Pulling", "jellyfin:latest", "sonarr:latest", "━", "✓", "1 of 2 images"} {
		if !strings.Contains(out, want) {
			t.Fatalf("install screen lacks %q:\n%s", want, out)
		}
	}
	assertNoProgressText(t, "install screen", out)
}

func TestFooterShowsLatestEventOnceThePullEnds(t *testing.T) {
	m, _ := sample(t, 140, 32)
	task := m.tasks.start("update one")
	for _, e := range []events.Event{
		{Event: events.StepStart, Step: "pull", Msg: "pull 1 image"},
		{Event: events.PullProgress, Image: "sonarr:latest", Status: "Pulled"},
		{Event: events.StepOK, Step: "pull", Msg: "pulled sonarr"},
	} {
		task.append(e)
	}
	footer := ansi.Strip(m.footerStatus())
	if !strings.Contains(footer, "✓ pull pulled sonarr") || strings.Contains(footer, "of 1 image") {
		t.Fatalf("footer still shows the ended pull:\n%s", footer)
	}
}
