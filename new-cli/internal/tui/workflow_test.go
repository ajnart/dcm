package tui

import (
	"reflect"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
)

func TestWorkflowStepRunsUntilEnd(t *testing.T) {
	for _, tc := range []struct{ end, want string }{
		{"", "running"}, {events.StepOK, "done"}, {events.StepSkip, "skipped"}, {events.StepFail, "failed"},
	} {
		t.Run(tc.want, func(t *testing.T) {
			evs := []events.Event{{Event: events.StepStart, App: "sonarr", Step: "ready", Msg: "waiting for API"}}
			if tc.end != "" {
				evs = append(evs, events.Event{Event: tc.end, App: "sonarr", Step: "ready"})
			}
			got := Workflow(service.Status{Apps: []service.AppStatus{{ID: "sonarr", Managed: true}}}, evs)
			if len(got.Apps[0].Steps) != 1 {
				t.Fatalf("live steps = %d, want 1", len(got.Apps[0].Steps))
			}
			if step := got.Apps[0].Steps[0]; string(step.State) != tc.want || step.Label != "ready" {
				t.Fatalf("live step = %+v, want %s ready", step, tc.want)
			}
		})
	}
}

func TestWorkflowLiveEventOverridesRememberedFailure(t *testing.T) {
	for _, tc := range []struct{ event, state string }{
		{events.StepStart, "running"}, {events.StepOK, "done"}, {events.StepSkip, "skipped"},
	} {
		t.Run(tc.state, func(t *testing.T) {
			status := service.Status{Apps: []service.AppStatus{{ID: "sonarr", Managed: true, Steps: []service.StepStatus{
				{ID: "ready", Status: "fail", Msg: "old", Error: "timeout", Hint: "check port"},
			}}}}
			got := Workflow(status, []events.Event{{Event: tc.event, App: "sonarr", Step: "ready", Msg: "new"}})
			step := got.Apps[0].Steps[0]
			if string(step.State) != tc.state || step.Msg != "new" || step.Error != "" || step.Hint != "" || got.Counts.StepsFailed != 0 {
				t.Fatalf("live override = %+v, failed = %d; want %s, new message, no stale failure", step, got.Counts.StepsFailed, tc.state)
			}
			if status.Apps[0].Steps[0].Status != "fail" {
				t.Fatal("Workflow mutated remembered status")
			}
		})
	}
}

func TestWorkflowNewRunResetsOnlyThatAppsLiveSteps(t *testing.T) {
	status := service.Status{Apps: []service.AppStatus{
		{ID: "sonarr", Managed: true, Steps: []service.StepStatus{{ID: "account", Status: "fail", Error: "old failure"}}},
		{ID: "radarr", Managed: true},
	}}
	evs := []events.Event{
		{Event: events.RunStart},
		{Event: events.StepOK, App: "sonarr", Step: "ready"},
		{Event: events.StepFail, App: "sonarr", Step: "account", Error: "refused", Hint: "retry"},
		{Event: events.StepOK, App: "radarr", Step: "ready"},
		{Event: events.RunEnd},
		{Event: events.RunStart},
		{Event: events.StepStart, App: "sonarr", Step: "ready"},
	}
	got := Workflow(status, evs)
	for _, step := range got.Apps[0].Steps {
		want := "notRun"
		if step.ID == "ready" {
			want = "running"
		}
		if string(step.State) != want || step.Error != "" || step.Hint != "" {
			t.Fatalf("retry step = %+v, want %s without old failure", step, want)
		}
	}
	if step := got.Apps[1].Steps[0]; string(step.State) != "done" {
		t.Fatalf("unrelated App reset: %+v", step)
	}
}

func TestWorkflowPullProgressOnlyOnRunningPull(t *testing.T) {
	status := service.Status{Apps: []service.AppStatus{{ID: "sonarr", Image: "sonarr:latest", Managed: true, Steps: []service.StepStatus{{ID: "pull"}, {ID: "ready"}}}}}
	evs := []events.Event{
		{Event: events.StepStart, App: "sonarr", Step: "pull", Msg: "pull image"},
		{Event: events.PullProgress, Image: "radarr:latest", Layer: "a", Current: 90_000_000, Total: 100_000_000},
		{Event: events.PullProgress, Image: "sonarr:latest", Layer: "a", Current: 10_000_000, Total: 100_000_000},
		{Event: events.PullProgress, Image: "sonarr:latest", Layer: "a", Current: 50_000_000, Total: 100_000_000},
	}
	for _, tc := range []struct{ name, end, want string }{
		{"running", "", "pull image · sonarr:latest 50% · 50 MB/100 MB"},
		{"finished", events.StepOK, "pulled"},
		{"retry", events.RunStart, "pull again"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := append([]events.Event(nil), evs...)
			if tc.end == events.RunStart {
				input = append(input, events.Event{Event: events.RunStart}, events.Event{Event: events.StepStart, App: "sonarr", Step: "pull", Msg: tc.want})
			} else if tc.end != "" {
				input = append(input, events.Event{Event: tc.end, App: "sonarr", Step: "pull", Msg: tc.want})
			}
			steps := Workflow(status, input).Apps[0].Steps
			if steps[0].Msg != tc.want || steps[1].Msg != "" {
				t.Fatalf("pull message = %q, want %q; ready message = %q", steps[0].Msg, tc.want, steps[1].Msg)
			}
		})
	}
}

func TestWorkflowCountsRunningSteps(t *testing.T) {
	status := service.Status{Apps: []service.AppStatus{{ID: "sonarr", Managed: true}, {ID: "radarr", Managed: true}}}
	evs := []events.Event{
		{Event: events.StepStart, App: "sonarr", Step: "ready"},
		{Event: events.StepStart, App: "sonarr", Step: "account"},
		{Event: events.StepOK, App: "sonarr", Step: "ready"},
		{Event: events.StepStart, App: "radarr", Step: "pull"},
		{Event: events.StepStart, App: "outside-project", Step: "ready"},
	}
	for _, tc := range []struct {
		name string
		end  bool
		want int
	}{
		{"running", false, 2}, {"ended", true, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := append([]events.Event(nil), evs...)
			if tc.end {
				input = append(input, events.Event{Event: events.StepFail, App: "sonarr", Step: "account"}, events.Event{Event: events.StepOK, App: "radarr", Step: "pull"})
			}
			if got := Workflow(status, input).Counts.StepsRunning; got != tc.want {
				t.Fatalf("running steps = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestWorkflowSharedPullEventsMatchAppsImage(t *testing.T) {
	status := service.Status{Apps: []service.AppStatus{
		{ID: "sonarr", Image: "sonarr:latest", Managed: true},
		{ID: "radarr", Image: "radarr:latest", Managed: true},
	}}
	evs := []events.Event{
		{Event: events.RunStart},
		{Event: events.StepStart, Step: "pull", Msg: "pull 1 image"},
		{Event: events.PullProgress, Image: "sonarr:latest", Layer: "a", Current: 50_000_000, Total: 100_000_000},
	}
	for _, tc := range []struct{ name, end, want string }{
		{"running", "", "running"}, {"finished", events.StepOK, "done"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := append([]events.Event(nil), evs...)
			if tc.end != "" {
				input = append(input, events.Event{Event: tc.end, Step: "pull"})
			}
			got := Workflow(status, input)
			if len(got.Apps[0].Steps) != 1 {
				t.Fatalf("shared pull steps = %d, want 1", len(got.Apps[0].Steps))
			}
			if string(got.Apps[0].Steps[0].State) != tc.want || len(got.Apps[1].Steps) != 0 {
				t.Fatalf("shared pull attribution = %+v, want %s only on Sonarr", got.Apps, tc.want)
			}
		})
	}
}

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

func TestWorkflowLiveLinkKeepsItsTargetAndWaitingIsNotRun(t *testing.T) {
	status := service.Status{Apps: []service.AppStatus{{ID: "sonarr", Name: "Sonarr", Managed: true, Setup: "ok"}}}
	evs := []events.Event{
		{Event: events.RunStart},
		{Event: events.StepSkip, App: "sonarr", Step: "link-qbittorrent", Msg: "waiting for qbittorrent"},
	}
	steps := Workflow(status, evs).Apps[0].Steps
	if len(steps) != 1 {
		t.Fatalf("steps = %+v, want the live Link", steps)
	}
	if steps[0].Target != "qbittorrent" || steps[0].Label != "link-qbittorrent → qbittorrent" {
		t.Fatalf("live Link lost its target: %+v", steps[0])
	}
	if steps[0].State != WorkflowNotRun {
		t.Fatalf("state = %s, want notRun while waiting for the target", steps[0].State)
	}
}

func TestWorkflowConsumerLinkRefreshPreservesSetupResults(t *testing.T) {
	status := service.Status{Apps: []service.AppStatus{{ID: "sonarr", Managed: true}}}
	evs := []events.Event{
		{Event: events.RunStart},
		{Event: events.StepOK, App: "sonarr", Step: "ready"},
		{Event: events.StepOK, App: "sonarr", Step: "account"},
		{Event: events.StepOK, App: "sonarr", Step: "check"},
		{Event: events.StepSkip, App: "sonarr", Step: "link-qbittorrent", Msg: "waiting for qbittorrent"},
		{Event: events.RunEnd},
		{Event: events.RunStart},
		{Event: events.StepStart, App: "sonarr", Step: "link-qbittorrent"},
	}
	got := Workflow(status, evs)
	for _, step := range got.Apps[0].Steps {
		if step.ID == "link-qbittorrent" {
			if step.State != WorkflowRunning || step.Target != "qbittorrent" {
				t.Fatalf("Link = %+v", step)
			}
		} else if step.State != WorkflowDone {
			t.Fatalf("consumer Setup result lost: %+v", step)
		}
	}
}

func TestWorkflowRetryAfterConsumerLinkRefreshResetsOwnResults(t *testing.T) {
	status := service.Status{Apps: []service.AppStatus{{ID: "sonarr", Managed: true}}}
	evs := []events.Event{
		{Event: events.RunStart, App: "sonarr"},
		{Event: events.StepOK, App: "sonarr", Step: "ready"},
		{Event: events.StepFail, App: "sonarr", Step: "account", Error: "old error"},
		{Event: events.RunEnd},
		{Event: events.RunStart},
		{Event: events.StepOK, App: "sonarr", Step: "link-qbittorrent"},
		{Event: events.RunEnd},
		{Event: events.RunStart, App: "sonarr"},
		{Event: events.StepStart, App: "sonarr", Step: "ready"},
	}
	for _, step := range Workflow(status, evs).Apps[0].Steps {
		if step.ID == "account" && (step.State != WorkflowNotRun || step.Error != "") {
			t.Fatalf("own retry retained earlier failure: %+v", step)
		}
	}
}

func TestWorkflowSetupRetryResetsRememberedSetupButKeepsStages(t *testing.T) {
	status := service.Status{Apps: []service.AppStatus{{ID: "sonarr", Managed: true, Steps: []service.StepStatus{
		{ID: "render", Status: "ok"}, {ID: "pull", Status: "ok"}, {ID: "start", Status: "ok"},
		{ID: "ready", Status: "ok"}, {ID: "account", Status: "fail", Error: "old failure"},
	}}}}
	evs := []events.Event{{Event: events.RunStart, App: "sonarr"}, {Event: events.StepStart, App: "sonarr", Step: "ready"}}
	for _, step := range Workflow(status, evs).Apps[0].Steps {
		if step.ID == "account" && (step.State != WorkflowNotRun || step.Error != "") {
			t.Fatalf("remembered failure retained during retry: %+v", step)
		}
		if service.IsStage(step.ID) && step.State != WorkflowDone {
			t.Fatalf("Setup retry reset install stage: %+v", step)
		}
	}
}

func TestWorkflowCheckRefreshPreservesRememberedSetup(t *testing.T) {
	status := service.Status{Apps: []service.AppStatus{{ID: "sonarr", Managed: true, Steps: []service.StepStatus{{ID: "account", Status: "ok"}, {ID: "check", Status: "ok"}}}}}
	evs := []events.Event{{Event: events.RunStart}, {Event: events.StepStart, App: "sonarr", Step: "check"}}
	for _, step := range Workflow(status, evs).Apps[0].Steps {
		if step.ID == "account" && step.State != WorkflowDone {
			t.Fatalf("check refresh erased Setup: %+v", step)
		}
	}
}
