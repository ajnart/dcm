package telemetry

import (
	"time"

	"github.com/ajnart/self-host/internal/events"
)

type Progress struct {
	Report   Report
	Now      func() time.Time
	KnownApp func(string) bool
	starts   map[string]time.Time
}

func (p *Progress) Emit(e events.Event) {
	if e.Step == "" {
		return
	}
	id := e.Step
	if e.App != "" {
		if p.KnownApp == nil || !p.KnownApp(e.App) {
			return
		}
		id = e.App + "/" + e.Step
	}
	if e.Event == events.StepStart {
		if p.starts == nil {
			p.starts = map[string]time.Time{}
		}
		p.starts[id] = p.Now()
		return
	}
	outcome, ok := stepEvents[e.Event]
	if !ok {
		return
	}
	step := Step{ID: id, Outcome: outcome}
	if start, started := p.starts[id]; started {
		step.Duration = p.Now().Sub(start)
		delete(p.starts, id)
	}
	p.Report.Steps = append(p.Report.Steps, step)
	if e.Event == events.StepFail {
		p.Report.FailedSteps = append(p.Report.FailedSteps, id)
		if p.Report.Stack == nil {
			p.Report.Stack = CaptureStack(1)
		}
	}
}

var stepEvents = map[string]StepOutcome{
	events.StepOK:     StepOK,
	events.StepSkip:   StepSkipped,
	events.StepWarn:   StepWarned,
	events.StepFail:   StepFailed,
	events.StepManual: StepManual,
}
