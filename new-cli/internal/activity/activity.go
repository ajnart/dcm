// Package activity turns Project status and task events into what a person
// sees of an Action, and draws it. It has no I/O and no clock.
package activity

import (
	"cmp"
	"slices"
	"strings"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

type State string

const (
	Done    State = "done"
	Skipped State = "skipped"
	Failed  State = "failed"
	Manual  State = "manual"
	Running State = "running"
	NotRun  State = "notRun"
)

type Step struct {
	ID, Label        string
	Target           string
	State            State
	Msg, Error, Hint string
}

type App struct {
	ID, Name string
	Managed  bool
	SetUp    bool
	Steps    []Step
}

type Snapshot struct {
	Apps   []App
	Counts Counts
	// Pull is the image pull of the running or most recent Action.
	Pull Pull
}

type Counts struct {
	AppsSetUp, StepsFailed, StepsRunning int
}

// Build merges remembered steps with task events in run order.
func Build(status service.Status, evs []events.Event) Snapshot {
	out := Snapshot{Pull: buildPull(status, evs)}
	for _, app := range status.Apps {
		entry := App{ID: app.ID, Name: app.Name, Managed: app.Managed, SetUp: app.Managed && app.Setup == stepstatus.SetupOK}
		if !app.Managed {
			out.Apps = append(out.Apps, entry)
			continue
		}
		for _, step := range app.Steps {
			state := NotRun
			switch step.Status {
			case stepstatus.StepOK:
				state = Done
			case stepstatus.StepSkip:
				state = Skipped
			case stepstatus.StepManual:
				state = Manual
			case stepstatus.StepFail:
				state = Failed
			}
			entry.Steps = append(entry.Steps, newStep(step.ID, state, step.Msg, step.Error, step.Hint))
		}
		applyEvents(&entry, app, evs)
		for _, step := range entry.Steps {
			if step.State == Manual {
				entry.SetUp = false
			}
			if step.State == Failed {
				entry.SetUp = false
				out.Counts.StepsFailed++
			}
			if step.State == Running {
				entry.SetUp = false
				out.Counts.StepsRunning++
			}
		}
		if entry.SetUp {
			out.Counts.AppsSetUp++
		}
		slices.SortStableFunc(entry.Steps, func(a, b Step) int {
			return cmp.Compare(stepOrder(a.ID), stepOrder(b.ID))
		})
		out.Apps = append(out.Apps, entry)
	}
	return out
}

// applyEvents overlays task events on the App's remembered steps in run order:
// a new run resets the steps it touches, and a shared pull is attributed to
// the App by its image.
func applyEvents(entry *App, app service.AppStatus, evs []events.Event) {
	live := map[string]bool{}
	newRun := false
	sharedPull := false
	for index, e := range evs {
		if e.Event == events.RunStart && (e.App == "" || e.App == app.ID) {
			newRun = true
			sharedPull = false
			continue
		}
		if e.App == "" && e.Step == service.StagePull {
			if e.Event == events.StepStart {
				sharedPull = false
				for _, next := range evs[index+1:] {
					if next.Event == events.RunStart || next.Event == events.RunEnd || next.Step == service.StagePull && next.Event != events.PullProgress {
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
		if e.Event == events.PullProgress || e.App != app.ID || e.Step == "" {
			continue
		}
		state := NotRun
		switch e.Event {
		case events.StepStart:
			state = Running
		case events.StepOK:
			state = Done
		case events.StepSkip:
			state = Skipped
		case events.StepManual:
			state = Manual
		case events.StepFail:
			state = Failed
		default:
			continue
		}
		if newRun {
			// Link-only and check-only refreshes keep the App's own Setup.
			if !strings.HasPrefix(e.Step, "link-") && e.Step != "check" {
				for i, step := range entry.Steps {
					reset := live[step.ID]
					if !service.IsStage(e.Step) {
						reset = !service.IsStage(step.ID)
					}
					if reset {
						entry.Steps[i] = newStep(step.ID, NotRun, "", "", "")
					}
				}
				clear(live)
			}
			newRun = false
		}
		live[e.Step] = true
		step := newStep(e.Step, state, e.Msg, e.Error, e.Hint)
		i := slices.IndexFunc(entry.Steps, func(s Step) bool { return s.ID == e.Step })
		if i < 0 {
			entry.Steps = append(entry.Steps, step)
		} else {
			entry.Steps[i] = step
		}
	}
}

// newStep builds one step. A Link step names its target, and a Link
// waiting for its target has not run yet.
func newStep(id string, state State, msg, err, hint string) Step {
	step := Step{ID: id, Label: id, State: state, Msg: msg, Error: err, Hint: hint}
	if target, link := strings.CutPrefix(id, "link-"); link {
		step.Target = target
		step.Label += " → " + target
		if state == Skipped && strings.HasPrefix(msg, "waiting for ") {
			step.State = NotRun
		}
	}
	return step
}

func stepOrder(id string) int {
	switch id {
	case service.StageRender:
		return 0
	case service.StagePull:
		return 1
	case service.StageStart:
		return 2
	case "check":
		return 5
	}
	if strings.HasPrefix(id, "link-") {
		return 4
	}
	return 3
}
