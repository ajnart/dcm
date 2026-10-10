package tui

import (
	"strings"
	"testing"

	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
)

func TestActivityViewUpdatesFromTaskEventsWithoutModel(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = service.Status{Apps: []service.AppStatus{{ID: "sonarr", Name: "Sonarr", Image: "sonarr:latest", Managed: true, Steps: []service.StepStatus{{ID: "pull"}}}}}
	var v view = &activityView{}
	task := ctx.tasks.start("update sonarr")
	t.Cleanup(ctx.tasks.cancelAll)
	for _, tc := range []struct {
		event events.Event
		want  []string
	}{
		{events.Event{}, []string{"○ pull", "0 steps running"}},
		{events.Event{Event: events.StepStart, App: "sonarr", Step: "pull"}, []string{"… pull", "1 step running"}},
		{events.Event{Event: events.PullProgress, Image: "sonarr:latest", Layer: "a", Status: "Downloading", Current: 50_000_000, Total: 100_000_000}, []string{"Pulling", "Sonarr", "━─", "0 of 1 image", "… pull", "1 step running"}},
		{events.Event{Event: events.StepOK, App: "sonarr", Step: "pull"}, []string{"✓ pull", "0 steps running"}},
	} {
		if tc.event.Event != "" {
			task.append(tc.event)
		}
		out := ansi.Strip(v.View(ctx, 120, 30))
		assertNoProgressText(t, "Activity view", out)
		for _, want := range tc.want {
			if !strings.Contains(out, want) {
				t.Fatalf("Activity view lacks %q after %q\n%s", want, tc.event.Event, out)
			}
		}
	}
	ctx.tasks.finish(task.id, nil)
	ctx.tasks.start("unrelated Action")
	if out := ansi.Strip(v.View(ctx, 80, 24)); !strings.Contains(out, "✓ pull") || strings.Contains(out, "Pulling") {
		t.Fatalf("finished task result lost or progress retained\n%s", out)
	}
}

func TestActivityViewConfiguredAppExpandsDuringRetry(t *testing.T) {
	for _, event := range []string{events.StepStart, events.StepFail} {
		t.Run(event, func(t *testing.T) {
			ctx := testViewContext(&fakeBackend{})
			ctx.status = service.Status{Apps: []service.AppStatus{{ID: "sonarr", Name: "Sonarr", Managed: true, Setup: stepstatus.SetupOK, Steps: []service.StepStatus{{ID: "ready", Status: stepstatus.StepOK}}}}}
			task := ctx.tasks.start("setup sonarr")
			t.Cleanup(ctx.tasks.cancelAll)
			task.append(events.Event{Event: events.RunStart, App: "sonarr"})
			task.append(events.Event{Event: event, App: "sonarr", Step: "ready", Error: "retry failed"})
			out := ansi.Strip((&activityView{}).View(ctx, 80, 24))
			mark := "… ready"
			if event == events.StepFail {
				mark = "✗ ready"
			}
			if !strings.Contains(out, mark) || !strings.Contains(out, "0 Apps fully set up") {
				t.Fatalf("retry hidden or counted complete\n%s", out)
			}
		})
	}
}

func TestActivityViewSuccessfulRefreshSupersedesFinishedTask(t *testing.T) {
	backend := &fakeBackend{}
	m := New(backend, Options{})
	m.status = service.Status{Apps: []service.AppStatus{{ID: "sonarr", Name: "Sonarr", Managed: true, Setup: stepstatus.SetupIncomplete, Steps: []service.StepStatus{{ID: "ready", Status: stepstatus.StepFail}}}}}
	m.activity, m.surface = &activityView{}, surfaceActivity
	m.width, m.height, m.loaded = 80, 24, true
	task := m.tasks.start("setup sonarr")
	t.Cleanup(m.tasks.cancelAll)
	task.append(events.Event{Event: events.StepFail, App: "sonarr", Step: "ready", Msg: "old TUI failure"})
	m.tasks.finish(task.id, nil)
	if out := screen(m); !strings.Contains(out, "old TUI failure") {
		t.Fatalf("terminal task lost before refresh\n%s", out)
	}
	backend.status = service.Status{Apps: []service.AppStatus{{ID: "sonarr", Name: "Sonarr", Managed: true, Setup: stepstatus.SetupOK, Steps: []service.StepStatus{{ID: "ready", Status: stepstatus.StepOK, Msg: "new CLI success"}}}}}
	m = update(t, m, m.loadStatus()())
	if out := screen(m); strings.Contains(out, "ready · old TUI failure") || !strings.Contains(out, "1 App fully set up") {
		t.Fatalf("finished events override fresh persisted result\n%s", out)
	}
}

func TestActivityViewKeepsEventsUntilRefreshReadsFinishedTask(t *testing.T) {
	backend := &fakeBackend{}
	m := New(backend, Options{})
	backend.status = service.Status{Apps: []service.AppStatus{{ID: "sonarr", Name: "Sonarr", Managed: true, Setup: stepstatus.SetupIncomplete, Steps: []service.StepStatus{{ID: "ready", Status: stepstatus.StepFail, Msg: "saved failure"}}}}}
	m.status = backend.status
	m.activity, m.surface = &activityView{}, surfaceActivity
	m.width, m.height, m.loaded = 80, 24, true
	task := m.tasks.start("setup sonarr")
	t.Cleanup(m.tasks.cancelAll)
	task.append(events.Event{Event: events.StepStart, App: "sonarr", Step: "ready", Msg: "live retry"})
	earlier := m.loadStatus()()
	m = update(t, m, earlier)
	if out := screen(m); !strings.Contains(out, "… ready · live retry") {
		t.Fatalf("running task superseded by refresh\n%s", out)
	}
	task.append(events.Event{Event: events.StepOK, App: "sonarr", Step: "ready", Msg: "live success"})
	m.tasks.finish(task.id, nil)
	// The response was read while the task was running and cannot replace its outcome.
	m = update(t, m, earlier)
	if out := screen(m); !strings.Contains(out, "✓ ready · live success") {
		t.Fatalf("older in-flight refresh erased terminal outcome\n%s", out)
	}
	failed := m.loadStatus()().(statusMsg)
	failed.err = service.ErrIncomplete
	m = update(t, m, failed)
	if out := ansi.Strip(m.activity.View(m.ctx(), 80, 24)); !strings.Contains(out, "✓ ready · live success") {
		t.Fatalf("failed refresh erased terminal outcome\n%s", out)
	}
	backend.status.Apps[0].Steps[0] = service.StepStatus{ID: "ready", Status: stepstatus.StepOK, Msg: "fresh saved success"}
	m = update(t, m, m.loadStatus()())
	if out := screen(m); strings.Contains(out, "live success") || !strings.Contains(out, "fresh saved success") {
		t.Fatalf("authoritative refresh did not replace finished task\n%s", out)
	}
}
