package status

import "testing"

func TestStepNeedsAttention(t *testing.T) {
	for _, step := range []Step{StepOK, StepSkip, StepFail, StepManual, "", "future"} {
		want := step == StepFail || step == StepManual
		if step.NeedsAttention() != want {
			t.Errorf("%q attention = %v, want %v", step, step.NeedsAttention(), want)
		}
	}
}
