package tui

import (
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/charmbracelet/x/ansi"
)

func TestWorkflowViewEnterExpandsAndCollapsesFailure(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = workflowStatus()
	var v view = &workflowView{}
	for range 20 {
		rows := v.(*workflowView).rows(ctx)
		if row := rows[v.(*workflowView).cursor]; row.step != nil && row.step.State == activity.Failed {
			break
		}
		v, _, _ = v.Update(ctx, press("j"))
	}
	for i, expanded := range []bool{false, true, false} {
		if i > 0 {
			next, cmd, nv := v.Update(ctx, press("enter"))
			v = next
			if cmd != nil || nv.kind != navNone {
				t.Fatal("enter should inspect the failure without an Action or navigation")
			}
		}
		out := ansi.Strip(v.View(ctx, 120, 30))
		for _, detail := range []string{"refused login", "check credentials"} {
			if strings.Contains(out, detail) != expanded {
				t.Fatalf("expanded=%v: failure detail %q visibility is wrong", expanded, detail)
			}
		}
	}
	// Successful steps have no failure details to open.
	v, _, _ = v.Update(ctx, press("k"))
	v, _, _ = v.Update(ctx, press("enter"))
	if out := ansi.Strip(v.View(ctx, 120, 30)); strings.Contains(out, "refused login") {
		t.Fatal("enter on a successful step opened failure details")
	}
}

func TestActivityRDoesNotRetrySetup(t *testing.T) {
	backend := &fakeBackend{}
	ctx := testViewContext(backend)
	ctx.status = workflowStatus()
	var v view = &workflowView{}

	_, cmd, _ := v.Update(ctx, press("r"))
	runCmd(cmd)

	if got := backend.Actions(); len(got) != 0 {
		t.Fatalf("Retry Setup goes through the Action menu now, actions %v", got)
	}
}
