// Package status defines the persisted step outcomes and App Setup states.
package status

type Step string

const (
	StepOK     Step = "ok"
	StepSkip   Step = "skip"
	StepFail   Step = "fail"
	StepManual Step = "manual"
)

type Setup string

const (
	SetupOK         Setup = "ok"
	SetupIncomplete Setup = "incomplete"
	SetupManual     Setup = "manual"
	SetupPending    Setup = "pending"
	SetupUnmanaged  Setup = "unmanaged"
)

func (s Step) NeedsAttention() bool {
	return s == StepFail || s == StepManual
}
