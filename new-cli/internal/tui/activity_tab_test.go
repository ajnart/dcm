package tui

import (
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/events"
)

// yieldsFrame reports whether running cmd, as the runtime would, delivers
// a frame of the animation.
func yieldsFrame(cmd tea.Cmd) bool {
	if cmd == nil {
		return false
	}
	done := make(chan tea.Msg, 1)
	go func() { done <- cmd() }()
	select {
	case msg := <-done:
		switch msg := msg.(type) {
		case frameMsg:
			return true
		case tea.BatchMsg:
			for _, c := range msg {
				if yieldsFrame(c) {
					return true
				}
			}
		}
	case <-time.After(time.Second):
	}
	return false
}

// idle runs frames until the Model stops asking for one.
func idle(t *testing.T, m Model) Model {
	t.Helper()
	for i := 0; i < 200; i++ {
		next, cmd := m.Update(frameMsg{})
		m = next.(Model)
		if !yieldsFrame(cmd) {
			return m
		}
	}
	t.Fatal("the frame ticker never stopped")
	return m
}

func TestFramesTickOnlyWhileAnActionRunsOrATransitionPlays(t *testing.T) {
	m, _ := sample(t, 140, 32)
	m = idle(t, m)
	for _, k := range []string{"j", "j", "a", "s"} {
		m = drive(t, m, press(k))
	}

	next, cmd := m.Update(press("enter"))
	m = next.(Model)
	if !yieldsFrame(cmd) {
		t.Fatal("starting an Action must start the frame ticker")
	}
	next, cmd = m.Update(frameMsg{})
	m = next.(Model)
	if !yieldsFrame(cmd) {
		t.Fatal("frames must keep ticking while the Action runs")
	}

	m = drive(t, m, taskDoneMsg{id: m.tasks.latest().id, title: "start whoami"})
	next, cmd = m.Update(frameMsg{})
	m = next.(Model)
	if !yieldsFrame(cmd) {
		t.Fatal("the finish wave must still play after the Action ends")
	}
	m = idle(t, m)
	if _, cmd := m.Update(frameMsg{}); yieldsFrame(cmd) {
		t.Fatal("an idle Dashboard must not tick")
	}
}

func TestAnActionStartingFocusesActivity(t *testing.T) {
	for _, tc := range []struct {
		name string
		host func(t *testing.T) (Model, *fakeBackend)
		keys []string
	}{
		{"from the Overview's Action menu", func(t *testing.T) (Model, *fakeBackend) { return sample(t, 140, 32) }, []string{"j", "j", "a", "s", "enter"}},
		{"from the Catalog", func(t *testing.T) (Model, *fakeBackend) {
			m, backend := sample(t, 140, 32)
			backend.catalog = wizardCatalog()
			return m, backend
		}, []string{"4", "/", "n", "t", "f", "y", "enter", "space", "enter", "enter"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, backend := tc.host(t)
			for _, k := range tc.keys {
				m = drive(t, m, press(k))
			}
			if len(backend.Actions()) != 1 {
				t.Fatalf("one Action should have started, actions %v", backend.Actions())
			}
			if m.surface != surfaceActivity {
				t.Fatalf("an Action started %s must focus Activity, surface = %d", tc.name, m.surface)
			}
		})
	}
}

func TestActivityKeepsTheLiveActionAcrossTabs(t *testing.T) {
	m, _ := sample(t, 140, 32)
	task := m.tasks.start("install jellyfin sonarr")
	t.Cleanup(m.tasks.cancelAll)
	m = drive(t, m, press("3"))
	task.append(events.Event{Event: events.RunStart, Msg: "install jellyfin sonarr"})
	task.append(events.Event{Event: events.StepStart, App: "sonarr", Step: "admin", Msg: "create the admin account"})
	m = drive(t, m, press("1"))
	task.append(events.Event{Event: events.StepOK, App: "sonarr", Step: "admin", Msg: "create the admin account"})
	task.append(events.Event{Event: events.StepStart, App: "sonarr", Step: "root-folder", Msg: "add the root folder /media/tv"})
	m = drive(t, m, press("3"))

	out := screen(m)
	for _, want := range []string{"install jellyfin sonarr", "✓ create the admin account", "•••••• ", "saved", "add the root folder /media/tv",
		"Setting up Sonarr: add the root folder /media/tv"} {
		if !strings.Contains(out, want) {
			t.Fatalf("Activity lost the live Action, lacks %q\n%s", want, out)
		}
	}
}

func TestFinishedActionStaysUntilTheNextOne(t *testing.T) {
	m, _ := sample(t, 140, 32)
	first := m.tasks.start("setup sonarr")
	first.append(events.Event{Event: events.RunStart, Msg: "setup sonarr"})
	first.append(events.Event{Event: events.StepOK, App: "sonarr", Step: "check", Msg: "verify Sonarr works"})
	first.append(events.Event{Event: events.RunEnd, Msg: "done"})
	m.tasks.finish(first.id, nil)
	m = drive(t, m, m.loadStatus()())
	m = drive(t, m, press("3"))
	if out := screen(m); !strings.Contains(out, "✓ setup sonarr") || !strings.Contains(out, "Sonarr is ready") {
		t.Fatalf("the finished Action must stay after a refresh\n%s", out)
	}

	next := m.tasks.start("start whoami")
	t.Cleanup(m.tasks.cancelAll)
	next.append(events.Event{Event: events.RunStart, Msg: "start whoami"})
	if out := screen(m); strings.Contains(out, "setup sonarr") || !strings.Contains(out, "start whoami") {
		t.Fatalf("the next Action must replace the finished one\n%s", out)
	}
}

func TestActionWithoutItsOwnEndStillFinishes(t *testing.T) {
	m, _ := sample(t, 140, 32)
	task := m.tasks.start("update jellyfin")
	task.append(events.Event{Event: events.RunStart, Msg: "update jellyfin"})
	m.tasks.finish(task.id, errString("docker is not running"))
	m = drive(t, m, press("3"))
	if out := screen(m); !strings.Contains(out, "✗ update jellyfin") || !strings.Contains(out, "The Action failed: docker is not running") {
		t.Fatalf("a failed task must end its Action\n%s", out)
	}
}

type errString string

func (e errString) Error() string { return string(e) }

// activityGoldenModel is an install mid-run in Setup at a fixed frame.
func activityGoldenModel(t *testing.T, width, height int) (Model, *task) {
	t.Helper()
	m := goldenModel(t, width, height)
	task := m.tasks.start("install jellyfin sonarr")
	t.Cleanup(m.tasks.cancelAll)
	for _, e := range []events.Event{
		{Event: events.RunStart, Msg: "install jellyfin sonarr"},
		{Event: events.StepOK, App: "jellyfin", Step: "start", Msg: "started"},
		{Event: events.StepOK, App: "sonarr", Step: "start", Msg: "started"},
		{Event: events.StepOK, App: "jellyfin", Step: "wizard", Msg: "finish the startup wizard with the Admin login"},
		{Event: events.StepOK, App: "jellyfin", Step: "api-key", Msg: "create the selfhost API key"},
		{Event: events.StepOK, App: "jellyfin", Step: "check", Msg: "verify Jellyfin works"},
		{Event: events.StepOK, App: "sonarr", Step: "ready", Msg: "wait for the Sonarr API"},
		{Event: events.StepOK, App: "sonarr", Step: "api-key", Msg: "read the Sonarr API key"},
		{Event: events.StepStart, App: "sonarr", Step: "root-folder", Msg: "add the root folder /media/tv"},
	} {
		task.append(e)
	}
	m = drive(t, m, press("3"))
	for i := 0; i < 7; i++ {
		m = update(t, m, frameMsg{})
	}
	return m, task
}

func TestGoldenActivityRunningAndFinished(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		t.Run("running"+size.suffix, func(t *testing.T) {
			m, _ := activityGoldenModel(t, size.width, size.height)
			for _, line := range strings.Split(screen(m), "\n") {
				if w := ansi.StringWidth(line); w > size.width {
					t.Fatalf("line is %d cells, wider than %d: %q", w, size.width, line)
				}
			}
			golden(t, "activity-running"+size.suffix, trimLines(screen(m)))
		})
		t.Run("finished"+size.suffix, func(t *testing.T) {
			m, task := activityGoldenModel(t, size.width, size.height)
			task.append(events.Event{Event: events.StepOK, App: "sonarr", Step: "root-folder", Msg: "add the root folder /media/tv"})
			task.append(events.Event{Event: events.StepOK, App: "sonarr", Step: "check", Msg: "verify Sonarr works"})
			task.append(events.Event{Event: events.StepOK, App: "sonarr", Step: "link-jellyfin", Msg: "add Jellyfin as a connection"})
			task.append(events.Event{Event: events.RunEnd, Msg: "done"})
			m.tasks.finish(task.id, nil)
			m = idle(t, m)
			golden(t, "activity-finished"+size.suffix, trimLines(screen(m)))
		})
	}
}
