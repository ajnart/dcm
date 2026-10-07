package tui

import (
	"reflect"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/service"
	"github.com/charmbracelet/x/ansi"
)

func TestWorkflowViewEnterExpandsAndCollapsesFailure(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = workflowStatus()
	var v view = &workflowView{}
	for range 20 {
		rows := v.(*workflowView).rows(ctx)
		if row := rows[v.(*workflowView).cursor]; row.step != nil && row.step.State == WorkflowFailed {
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

func TestWorkflowViewRetriesSelectedAppSetup(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status service.Status
		down   int
		want   []string
	}{
		{name: "first App", status: workflowStatus(), want: []string{"setup jellyfin"}},
		{name: "selected consumer", status: workflowStatus(), down: 4, want: []string{"setup sonarr"}},
		{name: "empty Project"},
		{name: "Unmanaged app", status: service.Status{Apps: []service.AppStatus{{ID: "whoami", Steps: []service.StepStatus{{ID: "ready"}}}}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			backend := &fakeBackend{}
			ctx := testViewContext(backend)
			ctx.status = tc.status
			var v view = &workflowView{}
			for range tc.down {
				v, _, _ = v.Update(ctx, press("j"))
			}
			_, cmd, nv := v.Update(ctx, press("r"))
			runCmd(cmd)
			if got := backend.Actions(); !reflect.DeepEqual(got, tc.want) || nv.kind != navNone {
				t.Fatalf("retry Actions = %v, want %v (navigation %v)", got, tc.want, nv.kind)
			}
		})
	}
}
