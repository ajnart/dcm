package tui

import (
	"cmp"
	"slices"
	"strings"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
)

type WorkflowState string

const (
	WorkflowDone    WorkflowState = "done"
	WorkflowSkipped WorkflowState = "skipped"
	WorkflowFailed  WorkflowState = "failed"
	WorkflowNotRun  WorkflowState = "notRun"
)

type WorkflowStep struct {
	ID, Label        string
	State            WorkflowState
	Msg, Error, Hint string
}

type WorkflowApp struct {
	ID, Name string
	Managed  bool
	SetUp    bool
	Steps    []WorkflowStep
}

type WorkflowSnapshot struct {
	Apps   []WorkflowApp
	Counts WorkflowCounts
}

type WorkflowCounts struct {
	AppsSetUp, StepsFailed, StepsRunning int
}

// Workflow traces remembered steps. Task events are reserved for live updates.
func Workflow(status service.Status, _ []events.Event) WorkflowSnapshot {
	var out WorkflowSnapshot
	for _, app := range status.Apps {
		if app.Managed && app.Setup == "ok" {
			out.Counts.AppsSetUp++
		}
		entry := WorkflowApp{ID: app.ID, Name: app.Name, Managed: app.Managed, SetUp: app.Managed && app.Setup == "ok"}
		for _, step := range app.Steps {
			state := WorkflowNotRun
			switch step.Status {
			case "ok":
				state = WorkflowDone
			case "skip":
				state = WorkflowSkipped
			case "fail":
				state = WorkflowFailed
				out.Counts.StepsFailed++
			}
			entry.Steps = append(entry.Steps, WorkflowStep{
				ID: step.ID, Label: step.ID, State: state,
				Msg: step.Msg, Error: step.Error, Hint: step.Hint,
			})
		}
		slices.SortStableFunc(entry.Steps, func(a, b WorkflowStep) int {
			return cmp.Compare(workflowOrder(a.ID), workflowOrder(b.ID))
		})
		out.Apps = append(out.Apps, entry)
	}
	return out
}

func workflowOrder(id string) int {
	switch id {
	case "render":
		return 0
	case "pull":
		return 1
	case "start":
		return 2
	case "check":
		return 5
	}
	if strings.HasPrefix(id, "link-") {
		return 4
	}
	return 3
}
