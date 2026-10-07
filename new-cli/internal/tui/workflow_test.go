package tui

import (
	"reflect"
	"testing"

	"github.com/ajnart/self-host/internal/service"
)

func TestWorkflowOrdersRememberedSteps(t *testing.T) {
	for _, tc := range []struct {
		name string
		ids  []string
		want []string
	}{
		{"Setup before Links and check", []string{"check", "link-sonarr", "ready", "account", "link-radarr", "library"}, []string{"ready", "account", "library", "link-sonarr", "link-radarr", "check"}},
		{"stages when present", []string{"start", "ready", "pull", "check", "render", "link-sonarr"}, []string{"render", "pull", "start", "ready", "link-sonarr", "check"}},
		{"no invented stages", []string{"ready"}, []string{"ready"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app := service.AppStatus{ID: "homarr", Name: "Homarr", Managed: true}
			for _, id := range tc.ids {
				app.Steps = append(app.Steps, service.StepStatus{ID: id})
			}
			got := Workflow(service.Status{Apps: []service.AppStatus{app}}, nil)
			if len(got.Apps) != 1 || got.Apps[0].ID != "homarr" || got.Apps[0].Name != "Homarr" {
				t.Fatalf("App missing from Workflow: %+v", got)
			}
			var ids []string
			for _, step := range got.Apps[0].Steps {
				ids = append(ids, step.ID)
			}
			if !reflect.DeepEqual(ids, tc.want) {
				t.Fatalf("ordered steps = %v, want %v", ids, tc.want)
			}
		})
	}
}

func TestWorkflowUnmanagedAppHasNoSetupSteps(t *testing.T) {
	for _, steps := range [][]service.StepStatus{
		nil,
		{{ID: "ready", Status: "fail", Error: "stale Setup failure"}},
	} {
		status := service.Status{Apps: []service.AppStatus{{ID: "whoami", Name: "whoami", Setup: "unmanaged", Steps: steps}}}
		got := Workflow(status, nil)
		if len(got.Apps) != 1 || got.Apps[0].ID != "whoami" || got.Apps[0].Name != "whoami" || got.Apps[0].Managed || len(got.Apps[0].Steps) != 0 || got.Counts != (WorkflowCounts{}) {
			t.Fatalf("Unmanaged app must have no Setup steps or progress: %+v", got)
		}
	}
}

func TestWorkflowWaitingLinkIsNotRunWithReason(t *testing.T) {
	for _, tc := range []struct {
		id, msg string
		want    WorkflowState
	}{
		{"link-qbittorrent", "waiting for qbittorrent (install it, or finish its Setup)", WorkflowNotRun},
		{"link-qbittorrent", "already configured", WorkflowSkipped},
		{"ready", "waiting for API", WorkflowSkipped},
	} {
		t.Run(tc.id+"/"+tc.msg, func(t *testing.T) {
			status := service.Status{Apps: []service.AppStatus{{ID: "sonarr", Managed: true, Steps: []service.StepStatus{
				{ID: tc.id, Status: "skip", Msg: tc.msg},
			}}}}
			got := Workflow(status, nil)
			step := got.Apps[0].Steps[0]
			if step.State != tc.want || step.Msg != tc.msg || got.Counts.StepsFailed != 0 {
				t.Fatalf("step %s state = %s, want %s with reason %q: %+v", tc.id, step.State, tc.want, tc.msg, step)
			}
		})
	}
}

func TestWorkflowFailedLinkBelongsToConsumerWithTarget(t *testing.T) {
	status := service.Status{Apps: []service.AppStatus{
		{ID: "qbittorrent", Name: "qBittorrent", Managed: true, Setup: "ok", Steps: []service.StepStatus{{ID: "ready", Status: "ok"}}},
		{ID: "sonarr", Name: "Sonarr", Managed: true, Setup: "incomplete", Steps: []service.StepStatus{
			{ID: "link-qbittorrent", Status: "fail", Msg: "download client", Error: "refused login", Hint: "check credentials"},
		}},
	}}
	got := Workflow(status, nil)
	if len(got.Apps) != 2 || len(got.Apps[0].Steps) != 1 || got.Apps[0].Steps[0].State != WorkflowDone || got.Apps[1].ID != "sonarr" || len(got.Apps[1].Steps) != 1 {
		t.Fatalf("failed Link must belong to consumer sonarr, leaving target healthy: %+v", got)
	}
	step := got.Apps[1].Steps[0]
	if step.ID != "link-qbittorrent" || step.Target != "qbittorrent" || step.Label != "link-qbittorrent → qbittorrent" || step.State != WorkflowFailed || step.Error != "refused login" || step.Hint != "check credentials" {
		t.Fatalf("consumer's failed Link must name target qbittorrent and retain failure details: %+v", step)
	}
	if got.Counts.AppsSetUp != 1 || got.Counts.StepsFailed != 1 {
		t.Fatalf("failed consumer Link should not affect target's Setup count: %+v", got.Counts)
	}
}

func TestWorkflowCountsProjectProgress(t *testing.T) {
	for _, tc := range []struct {
		name          string
		apps          []service.AppStatus
		setup, failed int
	}{
		{name: "empty Project"},
		{name: "Setup status is authoritative", apps: []service.AppStatus{
			{ID: "complete", Managed: true, Setup: "ok"},
			{ID: "pending", Managed: true, Setup: "pending"},
			{ID: "incomplete", Managed: true, Setup: "incomplete", Steps: []service.StepStatus{{ID: "ready", Status: "ok"}}},
			{ID: "unmanaged", Setup: "unmanaged"},
		}, setup: 1},
		{name: "failed steps across Apps", apps: []service.AppStatus{
			{ID: "sonarr", Managed: true, Setup: "incomplete", Steps: []service.StepStatus{{ID: "ready", Status: "fail"}, {ID: "link-qbittorrent", Status: "fail"}, {ID: "check", Status: ""}}},
			{ID: "radarr", Managed: true, Setup: "incomplete", Steps: []service.StepStatus{{ID: "check", Status: "fail"}}},
		}, failed: 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := Workflow(service.Status{Apps: tc.apps}, nil)
			if len(got.Apps) != len(tc.apps) || got.Counts.AppsSetUp != tc.setup || got.Counts.StepsFailed != tc.failed || got.Counts.StepsRunning != 0 {
				t.Fatalf("Workflow = %+v, want %d Apps, %d set up, %d failed, 0 running", got, len(tc.apps), tc.setup, tc.failed)
			}
		})
	}
}

func TestWorkflowMapsPersistedStates(t *testing.T) {
	for _, tc := range []struct{ status, want string }{
		{"ok", "done"}, {"skip", "skipped"}, {"fail", "failed"},
		{"", "notRun"}, {"pending", "notRun"}, {"unknown", "notRun"},
	} {
		t.Run(tc.status, func(t *testing.T) {
			status := service.Status{Apps: []service.AppStatus{{ID: "sonarr", Managed: true, Steps: []service.StepStatus{
				{ID: "ready", Status: tc.status, Msg: "waiting for API", Error: "timeout", Hint: "check port"},
			}}}}
			step := Workflow(status, nil).Apps[0].Steps[0]
			if string(step.State) != tc.want {
				t.Fatalf("state = %q, want %q", step.State, tc.want)
			}
			if step.Label != "ready" || step.Msg != "waiting for API" || step.Error != "timeout" || step.Hint != "check port" {
				t.Fatalf("remembered step details lost: %+v", step)
			}
		})
	}
}
