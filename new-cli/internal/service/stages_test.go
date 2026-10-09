package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestInstallReportsPerAppStartWhileComposeRuns(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}}, &testApp{id: "two", done: map[string]bool{}})
	observed := false
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if !strings.Contains(systemtest.Line(cmd), " up -d --remove-orphans one two") {
			return system.Result{}
		}
		observed = true
		h.rec.mu.Lock()
		defer h.rec.mu.Unlock()
		for _, id := range []string{"one", "two"} {
			started := false
			for _, e := range h.rec.events {
				if e.App == id && e.Step == "start" && e.Event == events.StepStart {
					started = true
				}
			}
			if !started {
				t.Errorf("%s has no live start while Compose is running", id)
			}
		}
		return system.Result{}
	})
	if err := h.svc.Install(context.Background(), InstallOptions{Targets: []string{"one", "two"}}); err != nil {
		t.Fatal(err)
	}
	if !observed {
		t.Fatal("Compose never started both Apps")
	}
	for _, id := range []string{"one", "two"} {
		for _, stage := range []string{"render", "pull", "start"} {
			if e := h.rec.find(id, stage); e == nil || e.Event != events.StepOK {
				t.Errorf("%s has no terminal %s outcome: %+v", id, stage, e)
			}
			started := false
			for _, e := range h.rec.events {
				if e.App == id && e.Step == stage && e.Event == events.StepStart {
					started = true
				}
			}
			if !started {
				t.Errorf("%s has no %s start event", id, stage)
			}
		}
	}
}

func TestInstallStopsBeforeStartWhenPullOutcomeCannotBeSaved(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), "--progress json pull") {
			statePath := filepath.Join(h.root(), "state.json")
			if err := os.Remove(statePath); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(statePath, 0o700); err != nil {
				t.Fatal(err)
			}
		}
		return system.Result{}
	})
	err := h.install("one")
	if err == nil || !strings.Contains(err.Error(), "could not save pull stage") {
		t.Fatalf("install error = %v, want failed stage persistence", err)
	}
	for _, call := range h.composeCalls() {
		if strings.Contains(call, "up -d") {
			t.Fatalf("containers started after failed persistence: %v", h.composeCalls())
		}
	}
	if e := h.rec.find("one", "state"); e == nil || e.Event != events.StepFail || e.Hint == "" {
		t.Fatalf("missing persistence recovery hint: %+v", e)
	}
}

type stageProbeApp struct {
	*testApp
	probe func()
}

func (a *stageProbeApp) Setup(ctx context.Context, h *helpers.H) error {
	a.probe()
	return a.testApp.Setup(ctx, h)
}

func TestCompletedInstallStagesAreReadableBeforeSetupFinishes(t *testing.T) {
	a := &stageProbeApp{testApp: &testApp{id: "one", done: map[string]bool{}}}
	h := newHarness(t, a)
	observed := false
	a.probe = func() {
		observed = true
		// Status reopens the persisted Project while this install is still in Setup.
		status, err := h.svc.Status(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if len(status.Apps) != 1 {
			t.Fatalf("Apps = %+v", status.Apps)
		}
		for _, id := range []string{"render", "pull", "start"} {
			found := false
			for _, step := range status.Apps[0].Steps {
				if step.ID == id && step.Status == stepstatus.StepOK {
					found = true
				}
			}
			if !found {
				t.Errorf("completed %s was not saved before Setup: %+v", id, status.Apps[0].Steps)
			}
		}
	}
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	if !observed {
		t.Fatal("Setup never ran")
	}
}
