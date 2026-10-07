package tui

import (
	"cmp"
	"fmt"
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
	WorkflowRunning WorkflowState = "running"
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
	Steps    []WorkflowStep
}

type WorkflowSnapshot struct {
	Apps   []WorkflowApp
	Counts WorkflowCounts
}

type WorkflowCounts struct {
	AppsSetUp, StepsFailed, StepsRunning int
}

// Workflow merges remembered steps with task events in run order.
func Workflow(status service.Status, evs []events.Event) WorkflowSnapshot {
	var out WorkflowSnapshot
	for _, app := range status.Apps {
		if app.Managed && app.Setup == "ok" {
			out.Counts.AppsSetUp++
		}
		entry := WorkflowApp{ID: app.ID, Name: app.Name, Managed: app.Managed}
		for _, step := range app.Steps {
			state := WorkflowNotRun
			switch step.Status {
			case "ok":
				state = WorkflowDone
			case "skip":
				state = WorkflowSkipped
			case "fail":
				state = WorkflowFailed
			}
			entry.Steps = append(entry.Steps, WorkflowStep{
				ID: step.ID, Label: step.ID, State: state,
				Msg: step.Msg, Error: step.Error, Hint: step.Hint,
			})
		}
		live := map[string]bool{}
		newRun := false
		var progress []events.Event
		sharedPull := false
		for index, e := range evs {
			if e.Event == events.RunStart && (e.App == "" || e.App == app.ID) {
				newRun = true
				sharedPull = false
				continue
			}
			if e.App == "" && e.Step == "pull" {
				if e.Event == events.StepStart {
					sharedPull = false
					for _, next := range evs[index+1:] {
						if next.Event == events.RunStart || next.Event == events.RunEnd || next.Step == "pull" && next.Event != events.PullProgress {
							break
						}
						if next.Event == events.PullProgress && app.Image != "" && next.Image == app.Image {
							sharedPull = true
							break
						}
					}
				}
				if sharedPull {
					e.App = app.ID
				}
			}
			if e.Event == events.PullProgress && (e.App == app.ID || e.App == "" && e.Image == app.Image) {
				i := slices.IndexFunc(entry.Steps, func(s WorkflowStep) bool { return s.ID == "pull" })
				if !newRun && i >= 0 && entry.Steps[i].State == WorkflowRunning {
					progress = append(progress, e)
				}
				continue
			}
			if e.App != app.ID || e.Step == "" {
				continue
			}
			state := WorkflowNotRun
			switch e.Event {
			case events.StepStart:
				state = WorkflowRunning
			case events.StepOK:
				state = WorkflowDone
			case events.StepSkip:
				state = WorkflowSkipped
			case events.StepFail:
				state = WorkflowFailed
			default:
				continue
			}
			if newRun {
				for i, step := range entry.Steps {
					if live[step.ID] {
						entry.Steps[i] = WorkflowStep{ID: step.ID, Label: step.Label, State: WorkflowNotRun}
					}
				}
				clear(live)
				progress = nil
				newRun = false
			}
			if e.Step == "pull" && e.Event == events.StepStart {
				progress = nil
			}
			live[e.Step] = true
			step := WorkflowStep{ID: e.Step, Label: e.Step, State: state, Msg: e.Msg, Error: e.Error, Hint: e.Hint}
			i := slices.IndexFunc(entry.Steps, func(s WorkflowStep) bool { return s.ID == e.Step })
			if i < 0 {
				entry.Steps = append(entry.Steps, step)
			} else {
				entry.Steps[i] = step
			}
		}
		for i, step := range entry.Steps {
			if step.ID == "pull" && step.State == WorkflowRunning {
				for _, image := range pullImages(progress) {
					entry.Steps[i].Msg += fmt.Sprintf(" · %s %d%% · %s/%s", image.image, image.percent(), pullMB(image.current), pullMB(image.total))
				}
			}
			if step.State == WorkflowFailed {
				out.Counts.StepsFailed++
			}
			if step.State == WorkflowRunning {
				out.Counts.StepsRunning++
			}
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
