package tui

import (
	"fmt"
	"strings"
	"testing"

	"charm.land/bubbles/v2/help"
	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/service"
)

// testViewContext is a viewContext over a small fake Backend, with no Model.
func testViewContext(backend Backend) *viewContext {
	return &viewContext{
		width: 120, height: 30,
		theme:   newTheme(true),
		keys:    newKeyMap(),
		help:    help.New(),
		spin:    spinner.New(spinner.WithSpinner(spinner.MiniDot)),
		backend: backend,
		tasks:   &taskManager{},
		status:  sampleStatus(),
	}
}

func TestDashboardViewWithoutAModel(t *testing.T) {
	v := newDashboardView()
	ctx := testViewContext(&fakeBackend{})

	out := ansi.Strip(v.View(ctx, 120, 30))
	for _, want := range []string{"Jellyfin", "Needs action"} {
		if !strings.Contains(out, want) {
			t.Fatalf("dashboard view lacks %q\n%s", want, out)
		}
	}

	next, _, _ := v.Update(ctx, press("down"))
	v = next.(*dashboardView)
	if app, ok := v.selected(ctx); !ok || app.ID != "sonarr" {
		t.Fatalf("down should select sonarr, got %+v", app)
	}
}

func TestInstallViewWithoutAModel(t *testing.T) {
	backend := &fakeBackend{catalog: wizardCatalog()}
	ctx := testViewContext(backend)
	v := newInstallView(ctx)

	next, _, _ := v.Update(ctx, press("/"))
	v = next.(*installView)
	for _, r := range "ntfy" {
		next, _, _ = v.Update(ctx, press(string(r)))
		v = next.(*installView)
	}

	rows := v.rows(ctx)
	if len(rows) != 1 || rows[0].key != "app:ntfy" {
		t.Fatalf("filter should narrow to ntfy: %+v", rows)
	}
}

func TestSettingsViewWithoutAModel(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	v := newSettingsView(ctx)

	next, _, _ := v.Update(ctx, press("space"))
	v = next.(*settingsView)

	if pairs := v.pairs(); len(pairs) != 1 || pairs[0] != "EXPOSURE=local" {
		t.Fatalf("space on EXPOSURE should pend local: %v", pairs)
	}
}

func TestStackViewWithoutAModel(t *testing.T) {
	backend := &fakeBackend{containers: []service.ContainerStatus{
		{App: "jellyfin", Service: "jellyfin", State: "running", Health: "healthy"},
	}}
	ctx := testViewContext(backend)
	ctx.containers = backend.containers

	out := ansi.Strip((&stackView{}).View(ctx, 120, 30))
	for _, want := range []string{"jellyfin", "1 container", "1 running"} {
		if !strings.Contains(out, want) {
			t.Fatalf("stack view lacks %q\n%s", want, out)
		}
	}
}

func stackDownContext(t *testing.T) (*fakeBackend, *viewContext) {
	t.Helper()
	backend := &fakeBackend{}
	ctx := testViewContext(backend)
	ctx.containers = []service.ContainerStatus{{App: "jellyfin", Service: "jellyfin", State: "running"}}
	return backend, ctx
}

func TestStackDownAsksBeforeTakingTheProjectDown(t *testing.T) {
	backend, ctx := stackDownContext(t)
	v := &stackView{}

	next, cmd, nv := v.Update(ctx, press("2"))
	v = next.(*stackView)
	if cmd != nil || nv.kind != navNone {
		t.Fatalf("2 should ask first, got cmd %v nav %+v", cmd, nv)
	}
	out := ansi.Strip(v.View(ctx, 120, 30))
	for _, want := range []string{"containers and networks", "volumes", "App files", "Setup"} {
		if !strings.Contains(out, want) {
			t.Fatalf("confirmation lacks %q\n%s", want, out)
		}
	}
	if got := backend.Actions(); len(got) != 0 {
		t.Fatalf("2 must not take the Project down before confirmation: %v", got)
	}
}

func TestStackDownConfirmsWithYAndCancelsOtherwise(t *testing.T) {
	arm := func(t *testing.T) (*stackView, *fakeBackend, *viewContext) {
		t.Helper()
		backend, ctx := stackDownContext(t)
		next, _, _ := (&stackView{}).Update(ctx, press("2"))
		return next.(*stackView), backend, ctx
	}

	t.Run("y runs Down", func(t *testing.T) {
		v, backend, ctx := arm(t)
		next, cmd, _ := v.Update(ctx, press("y"))
		v = next.(*stackView)
		runCmd(cmd)
		if got := backend.Actions(); len(got) != 1 || got[0] != "down" {
			t.Fatalf("y should run Down, actions %v", got)
		}
		if strings.Contains(ansi.Strip(v.View(ctx, 120, 30)), "containers and networks") {
			t.Fatal("confirmation should clear after confirming")
		}
	})

	for _, key := range []string{"n", "esc", "2"} {
		t.Run(key+" cancels", func(t *testing.T) {
			v, backend, ctx := arm(t)
			next, cmd, _ := v.Update(ctx, press(key))
			v = next.(*stackView)
			if cmd != nil || len(backend.Actions()) != 0 {
				t.Fatalf("%s should cancel without an Action, cmd %v actions %v", key, cmd, backend.Actions())
			}
			if strings.Contains(ansi.Strip(v.View(ctx, 120, 30)), "containers and networks") {
				t.Fatalf("%s should clear the confirmation", key)
			}
		})
	}
}

func TestStackDownMouseConfirmsTheSameWay(t *testing.T) {
	backend, ctx := stackDownContext(t)
	v := &stackView{}

	next, cmd, _ := v.Update(ctx, clickMsg{id: "stack:down"})
	v = next.(*stackView)
	if cmd != nil || len(backend.Actions()) != 0 {
		t.Fatalf("a click should ask first, cmd %v actions %v", cmd, backend.Actions())
	}
	if !strings.Contains(ansi.Strip(v.View(ctx, 120, 30)), "containers and networks") {
		t.Fatal("a click should show the confirmation")
	}

	next, cmd, _ = v.Update(ctx, clickMsg{id: "stack:down"})
	v = next.(*stackView)
	runCmd(cmd)
	if got := backend.Actions(); len(got) != 1 || got[0] != "down" {
		t.Fatalf("clicking Down again should run Down, actions %v", got)
	}
}

func TestHelpViewWithoutAModel(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	v := newHelpView()
	v.open(ctx)

	out := ansi.Strip(v.View(ctx, 120, 30))
	for _, want := range []string{"Keys", "start/stop", "copy"} {
		if !strings.Contains(out, want) {
			t.Fatalf("help view lacks %q\n%s", want, out)
		}
	}
}

func workflowStatus() service.Status {
	return service.Status{Apps: []service.AppStatus{
		{ID: "jellyfin", Name: "Jellyfin", Managed: true, Setup: stepstatus.SetupOK, Steps: []service.StepStatus{
			{ID: "ready", Status: stepstatus.StepOK, Msg: "API ready"},
			{ID: "account", Status: stepstatus.StepSkip, Msg: "already configured"},
			{ID: "check", Status: stepstatus.StepOK},
		}},
		{ID: "sonarr", Name: "Sonarr", Managed: true, Setup: stepstatus.SetupIncomplete, Steps: []service.StepStatus{
			{ID: "ready", Status: stepstatus.StepOK},
			{ID: "link-qbittorrent", Status: stepstatus.StepFail, Msg: "download client", Error: "refused login", Hint: "check credentials"},
			{ID: "check"},
		}},
		{ID: "radarr", Name: "Radarr", Managed: true, Setup: stepstatus.SetupPending},
		{ID: "whoami", Name: "whoami", Setup: stepstatus.SetupUnmanaged},
	}}
}

func TestWorkflowViewShowsEveryAppAndRememberedMarks(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = workflowStatus()
	var v view = &workflowView{}
	v, _, _ = v.Update(ctx, press("space")) // expand the collapsed Jellyfin
	out := ansi.Strip(v.View(ctx, 120, 30))
	for _, want := range []string{"Jellyfin", "Sonarr", "Radarr", "whoami", "1 App fully set up", "1 step failed", "✓ ready", "↷ account", "✗ link-qbittorrent", "○ check", "API ready", "Setup has no recorded steps yet", "added by hand, no Setup"} {
		if !strings.Contains(out, want) {
			t.Fatalf("Workflow view lacks %q\n%s", want, out)
		}
	}
}

func TestWorkflowViewExpandsFailedAppsAndCollapsesSetUpApps(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = workflowStatus()
	var v view = &workflowView{}
	out := ansi.Strip(v.View(ctx, 120, 30))

	if strings.Contains(out, "✓ ready · API ready") || strings.Contains(out, "↷ account") {
		t.Fatalf("fully set-up Jellyfin should start collapsed\n%s", out)
	}
	for _, want := range []string{"Jellyfin", "✗ link-qbittorrent", "○ check"} {
		if !strings.Contains(out, want) {
			t.Fatalf("failed Sonarr should start expanded with %q\n%s", want, out)
		}
	}
}

func TestWorkflowViewSpaceTogglesAnApp(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = workflowStatus()
	var v view = &workflowView{}

	next, cmd, nv := v.Update(ctx, press("space"))
	v = next
	if cmd != nil || nv.kind != navNone {
		t.Fatalf("space should toggle in place, got %+v", nv)
	}
	if out := ansi.Strip(v.View(ctx, 120, 30)); !strings.Contains(out, "✓ ready · API ready") {
		t.Fatalf("space should expand the collapsed Jellyfin\n%s", out)
	}

	v, _, _ = v.Update(ctx, press("space"))
	if out := ansi.Strip(v.View(ctx, 120, 30)); strings.Contains(out, "✓ ready · API ready") {
		t.Fatalf("space should collapse Jellyfin again\n%s", out)
	}
}

func workflowFilterStatus() service.Status {
	return service.Status{Apps: []service.AppStatus{
		{ID: "jf", Name: "Jellyfin", Managed: true, Setup: stepstatus.SetupOK},
		{ID: "sonarr", Name: "Sonarr", Managed: true, Setup: stepstatus.SetupIncomplete, Steps: []service.StepStatus{{ID: "ready", Status: stepstatus.StepFail}}},
		{ID: "radarr", Name: "Radarr", Managed: true, Setup: stepstatus.SetupPending},
	}}
}

func TestWorkflowViewFiltersAppsByNameOrID(t *testing.T) {
	for _, tc := range []struct {
		name, query string
		want, gone  []string
	}{
		{"by name", "jelly", []string{"Jellyfin"}, []string{"Sonarr", "Radarr"}},
		{"by id", "jf", []string{"Jellyfin"}, []string{"Sonarr", "Radarr"}},
		{"by id only", "sonarr", []string{"Sonarr"}, []string{"Jellyfin", "Radarr"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := testViewContext(&fakeBackend{})
			ctx.status = workflowFilterStatus()
			var v view = &workflowView{}
			v, _, _ = v.Update(ctx, press("/"))
			for _, r := range tc.query {
				v, _, _ = v.Update(ctx, press(string(r)))
			}
			out := ansi.Strip(v.View(ctx, 120, 30))
			for _, want := range tc.want {
				if !strings.Contains(out, want) {
					t.Fatalf("filter %q should keep %q\n%s", tc.query, want, out)
				}
			}
			for _, gone := range tc.gone {
				if strings.Contains(out, gone) {
					t.Fatalf("filter %q should drop %q\n%s", tc.query, gone, out)
				}
			}
		})
	}
}

func TestWorkflowViewEscClearsFilterThenGoesBack(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = workflowFilterStatus()

	var plain view = &workflowView{}
	if _, cmd, nv := plain.Update(ctx, press("esc")); cmd != nil || nv.kind != navBack {
		t.Fatalf("esc with no filter should navigate back, got %+v", nv)
	}

	var v view = &workflowView{}
	v, _, _ = v.Update(ctx, press("/"))
	for _, r := range "son" {
		v, _, _ = v.Update(ctx, press(string(r)))
	}
	v, _, _ = v.Update(ctx, press("enter"))

	next, cmd, nv := v.Update(ctx, press("esc"))
	v = next
	if cmd != nil || nv.kind != navNone {
		t.Fatalf("first esc should clear the filter, not navigate, got %+v", nv)
	}
	out := ansi.Strip(v.View(ctx, 120, 30))
	if !strings.Contains(out, "Jellyfin") || strings.Contains(out, "/son") {
		t.Fatalf("first esc should clear the filter\n%s", out)
	}

	if _, _, nv := v.Update(ctx, press("esc")); nv.kind != navBack {
		t.Fatalf("second esc should navigate back, got %+v", nv)
	}
}

func workflowMany(n int) service.Status {
	var apps []service.AppStatus
	for i := 0; i < n; i++ {
		apps = append(apps, service.AppStatus{ID: fmt.Sprintf("app%02d", i), Name: fmt.Sprintf("App %02d", i),
			Managed: true, Setup: stepstatus.SetupIncomplete, Steps: []service.StepStatus{{ID: "ready"}}})
	}
	return service.Status{Apps: apps}
}

func TestWorkflowViewScrollsToTheLastOfFortyApps(t *testing.T) {
	for _, tc := range []struct {
		name  string
		msg   tea.Msg
		times int
	}{
		{"down keys", press("down"), 200},
		{"pgdn", pgdownKey(), 100},
		{"mouse wheel", wheelMsg(true), 100},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := testViewContext(&fakeBackend{})
			ctx.status = workflowMany(40)
			v := &workflowView{}
			for i := 0; i < tc.times; i++ {
				next, _, _ := v.Update(ctx, tc.msg)
				v = next.(*workflowView)
			}
			rows := v.rows(ctx)
			if v.cursor != len(rows)-1 {
				t.Fatalf("cursor %d, want the last of %d rows", v.cursor, len(rows))
			}
			out := ansi.Strip(v.View(ctx, 80, 24))
			if !strings.Contains(out, "App 39") {
				t.Fatalf("the last App should be on screen\n%s", out)
			}
		})
	}
}

func TestWorkflowViewKeepsTheLastUnmanagedAppOnScreen(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	var apps []service.AppStatus
	for i := 0; i < 40; i++ {
		apps = append(apps, service.AppStatus{ID: fmt.Sprintf("app%02d", i), Name: fmt.Sprintf("App %02d", i)})
	}
	ctx.status = service.Status{Apps: apps}
	v := &workflowView{}
	for i := 0; i < 50; i++ {
		next, _, _ := v.Update(ctx, press("down"))
		v = next.(*workflowView)
	}
	out := ansi.Strip(v.View(ctx, 80, 24))
	if !strings.Contains(out, "App 39") {
		t.Fatalf("the selected last App should be on screen\n%s", out)
	}
}

func TestWorkflowViewFitsEightyColumns(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = service.Status{Apps: []service.AppStatus{
		{ID: "long", Name: "An App whose name is far too long to ever fit an eighty column terminal",
			Managed: true, Setup: stepstatus.SetupIncomplete,
			Steps: []service.StepStatus{{ID: "ready", Status: stepstatus.StepFail,
				Msg: "a step message that also runs on and on well past the width of a narrow terminal"}}},
		{ID: "other", Name: "Other", Managed: true, Setup: stepstatus.SetupIncomplete,
			Steps: []service.StepStatus{{ID: "ready"}}},
	}}
	var v view = &workflowView{}
	for _, line := range strings.Split(ansi.Strip(v.View(ctx, 80, 24)), "\n") {
		if ansi.StringWidth(line) > 80 {
			t.Fatalf("line wider than 80 columns: %q", line)
		}
	}
}

func TestWorkflowViewSelectsStepsWithArrowsAndJK(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = workflowStatus()
	var v view = &workflowView{}
	for _, tc := range []struct{ key, selected string }{
		{"up", "> ▸ Jellyfin"},
		{"down", "> ▾ Sonarr"},
		{"down", "> ✓ ready\n"},
		{"down", "> ✗ link-qbittorrent"},
		{"down", "> ○ check"},
		{"down", "> ▾ Radarr"},
		{"k", "> ○ check"},
		{"up", "> ✗ link-qbittorrent"},
		{"up", "> ✓ ready\n"},
	} {
		next, cmd, nv := v.Update(ctx, press(tc.key))
		v = next
		out := trimLines(ansi.Strip(v.View(ctx, 120, 30)))
		if cmd != nil || nv.kind != navNone || !strings.Contains(out, tc.selected) || strings.Count(out, "> ") != 1 {
			t.Fatalf("%s should select %q\n%s", tc.key, tc.selected, out)
		}
	}
	ctx.status = service.Status{}
	v, _, _ = v.Update(ctx, press("down"))
	if out := ansi.Strip(v.View(ctx, 120, 30)); strings.Contains(out, "> ") {
		t.Fatalf("empty Project has a selected step\n%s", out)
	}
}

func TestWorkflowViewEscNavigatesBack(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	var v view = &workflowView{}
	_, cmd, nv := v.Update(ctx, press("esc"))
	if cmd != nil || nv.kind != navBack {
		t.Fatalf("esc should navigate back without an Action, got %+v", nv)
	}
}

func TestDashboardWOpensWorkflow(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	v := newDashboardView()
	_, cmd, nv := v.Update(ctx, press("w"))
	if cmd != nil || nv.kind != navTo || nv.to != surfaceWorkflow {
		t.Fatalf("w should open Workflow without an Action, got %+v", nv)
	}
}

func TestHelpListsWorkflowKey(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	v := newHelpView()
	v.open(ctx)
	out := ansi.Strip(v.View(ctx, 120, 30))
	if !strings.Contains(strings.Join(strings.Fields(out), " "), "w workflow") {
		t.Fatalf("help should list w for Workflow\n%s", out)
	}
}

func TestWorkflowViewAdvertisesNavigationKeys(t *testing.T) {
	var v view = &workflowView{}
	var keys []string
	for _, binding := range v.Keys() {
		keys = append(keys, binding.Keys()...)
	}
	if got := strings.Join(keys, " "); got != "up k down j enter r space / esc pgup pgdown" || v.Title() != "Workflow" {
		t.Fatalf("Workflow should advertise its own keys, got %q (%s)", got, v.Title())
	}
}

func TestNeedsActionOffersStartNotSetupForAFailedStart(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = service.Status{Apps: []service.AppStatus{{ID: "one", Name: "One", Managed: true, State: "exited", Setup: stepstatus.SetupOK,
		Steps: []service.StepStatus{{ID: "start", Status: stepstatus.StepFail, Error: "port is already allocated"}}}}}
	for _, item := range (&dashboardView{}).needsAction(ctx) {
		if item.desc == "retry Setup" {
			t.Fatalf("a failed start cannot be fixed by Setup: %+v", item)
		}
	}
}

func TestDashboardManualNeedsAction(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = service.Status{Apps: []service.AppStatus{{ID: "dockge", Name: "Dockge", Managed: true, State: "running", Setup: stepstatus.SetupManual, Steps: []service.StepStatus{{ID: "admin", Status: stepstatus.StepManual, Hint: "Open the browser and create the administrator"}}}}}
	v := &dashboardView{}
	needs := v.needsAction(ctx)
	if len(needs) != 1 || needs[0].broken || needs[0].key != "r" || !strings.Contains(needs[0].text, "Open the browser") {
		t.Fatalf("manual Needs action = %+v", needs)
	}
	out := ansi.Strip(renderSetup(ctx.theme, ctx.status.Apps[0], 100))
	if !strings.Contains(out, "manual") || !strings.Contains(out, "Open the browser") || strings.Contains(out, "✗") {
		t.Fatalf("manual Setup details: %s", out)
	}
	if level := service.Level(ctx.status.Apps[0]); level != "attention" {
		t.Fatalf("manual Status = %s, want attention", level)
	}
}

func TestWorkflowManualShowsHintWithoutFailures(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = service.Status{Apps: []service.AppStatus{{ID: "dockge", Name: "Dockge", Managed: true, Setup: stepstatus.SetupManual, Steps: []service.StepStatus{{ID: "admin", Status: stepstatus.StepManual, Hint: "Open the browser and create the administrator"}}}}}
	v := &workflowView{}
	out := ansi.Strip(v.View(ctx, 120, 30))
	for _, want := range []string{"manual", "Open the browser", "0 steps failed", "0 Apps fully set up"} {
		if !strings.Contains(out, want) {
			t.Fatalf("Workflow lacks %q: %s", want, out)
		}
	}
	_, cmd, _ := v.Update(ctx, press("r"))
	if cmd == nil {
		t.Fatal("manual Setup retry unavailable")
	}
}

func TestManualInstallReturnsToDashboardWithAttention(t *testing.T) {
	m, _ := sample(t, 120, 30)
	task := m.tasks.start("install dockge")
	m.wizard = &wizard{stage: stageInstalling, taskID: task.id, plan: &plan{}}
	m = update(t, m, taskDoneMsg{id: task.id, title: "install dockge", err: service.ErrManual})
	if m.wizard != nil {
		t.Fatal("manual install treated as failed review")
	}
	if m.flashLevel != levelWarn {
		t.Fatalf("manual install flash = %+v, want warning", m.flash)
	}
}
