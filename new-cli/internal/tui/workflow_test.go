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
			status := service.Status{Apps: []service.AppStatus{{ID: "sonarr", Steps: []service.StepStatus{
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
