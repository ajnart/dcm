package tui

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
)

func TestWorkflowViewUpdatesFromTaskEventsWithoutModel(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = service.Status{Apps: []service.AppStatus{{ID: "sonarr", Name: "Sonarr", Image: "sonarr:latest", Managed: true, Steps: []service.StepStatus{{ID: "pull"}}}}}
	var v view = &workflowView{}
	task := ctx.tasks.start("update sonarr")
	t.Cleanup(ctx.tasks.cancelAll)
	for _, tc := range []struct {
		event events.Event
		want  []string
	}{
		{events.Event{}, []string{"○ pull", "0 steps running"}},
		{events.Event{Event: events.StepStart, App: "sonarr", Step: "pull"}, []string{"… pull", "1 step running"}},
		{events.Event{Event: events.PullProgress, Image: "sonarr:latest", Layer: "a", Current: 50_000_000, Total: 100_000_000}, []string{"… pull", "sonarr:latest 50%", "1 step running"}},
		{events.Event{Event: events.StepOK, App: "sonarr", Step: "pull"}, []string{"✓ pull", "0 steps running"}},
	} {
		if tc.event.Event != "" {
			task.append(tc.event)
		}
		out := ansi.Strip(v.View(ctx, 120, 30))
		for _, want := range tc.want {
			if !strings.Contains(out, want) {
				t.Fatalf("Workflow view lacks %q after %q\n%s", want, tc.event.Event, out)
			}
		}
	}
	ctx.tasks.finish(task.id, nil)
	ctx.tasks.start("unrelated Action")
	if out := ansi.Strip(v.View(ctx, 80, 24)); !strings.Contains(out, "✓ pull") || strings.Contains(out, "50%") {
		t.Fatalf("finished task result lost or progress retained\n%s", out)
	}
}
