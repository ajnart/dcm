package e2e

import "testing"

func TestManualClassificationUsesStepStatus(t *testing.T) {
	for _, tc := range []struct {
		name   string
		events []event
		want   bool
	}{
		{"manual without error text", []event{{Event: "step.manual", App: "dockge", Step: "admin", Hint: "finish in the browser"}}, true},
		{"failure with old manual message", []event{{Event: "step.fail", Error: "has no headless way"}}, false},
		{"manual and failure", []event{{Event: "step.manual"}, {Event: "step.fail"}}, false},
		{"finished and manual", []event{{Event: "step.ok"}, {Event: "step.manual"}}, true},
		{"no manual steps", []event{{Event: "step.ok"}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := allManual(result{events: tc.events}); got != tc.want {
				t.Fatalf("manual = %t, want %t", got, tc.want)
			}
		})
	}
}
