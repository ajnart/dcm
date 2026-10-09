package tui

import (
	"fmt"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/service"
)

// testViewContext is a viewContext over a small fake Backend, with no Model.
func testViewContext(backend Backend) *viewContext {
	return &viewContext{
		width: 120, height: 30,
		theme:   newTheme(true),
		glyphs:  activity.Simple,
		keys:    newKeyMap(),
		backend: backend,
		tasks:   &taskManager{},
		status:  sampleStatus(),
	}
}

func TestDashboardViewWithoutAModel(t *testing.T) {
	v := newDashboardView(newAppsView())
	ctx := testViewContext(&fakeBackend{})

	out := ansi.Strip(v.View(ctx, 120, 30))
	for _, want := range []string{"Jellyfin", "Needs attention"} {
		if !strings.Contains(out, want) {
			t.Fatalf("dashboard view lacks %q\n%s", want, out)
		}
	}

	next, _, _ := v.Update(ctx, press("down"))
	v = next.(*dashboardView)
	if app, ok := v.selectedApp(ctx); !ok || app.ID != "sonarr" {
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

func TestAppsViewWithoutAModel(t *testing.T) {
	backend := &fakeBackend{}
	ctx := testViewContext(backend)
	ctx.containers = []service.ContainerStatus{{App: "jellyfin", Service: "jellyfin", State: "running", Health: "healthy"}}
	var v view = newAppsView()

	v, _, _ = v.Update(ctx, press("["))
	out := ansi.Strip(v.View(ctx, 120, 30))

	for _, want := range []string{"Apps 3", "Jellyfin", "containers", "1 container · 1 running", "healthy"} {
		if !strings.Contains(out, want) {
			t.Fatalf("Apps view lacks %q\n%s", want, out)
		}
	}
}

func TestHelpViewWithoutAModel(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	v := newHelpView()
	v.open(ctx, []pane{{"Global", ctx.keys.global()}, {"Overview · Apps", overviewAppsKeys}})

	out := ansi.Strip(v.View(ctx, 120, 30))
	for _, want := range []string{"Keys", "Global", "1-5", "tabs", "Overview · Apps", "actions", "copy"} {
		if !strings.Contains(out, want) {
			t.Fatalf("help view lacks %q\n%s", want, out)
		}
	}
}

func activityStatus() service.Status {
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

func TestActivityViewShowsEveryAppAndRememberedMarks(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = activityStatus()
	var v view = &activityView{}
	v, _, _ = v.Update(ctx, press("space")) // expand the collapsed Jellyfin
	out := ansi.Strip(v.View(ctx, 120, 30))
	for _, want := range []string{"Jellyfin", "Sonarr", "Radarr", "whoami", "1 App fully set up", "1 step failed", "✓ ready", "↷ account", "✗ link-qbittorrent", "○ check", "API ready", "Setup has no recorded steps yet", "added by hand, no Setup"} {
		if !strings.Contains(out, want) {
			t.Fatalf("Activity view lacks %q\n%s", want, out)
		}
	}
}

func TestActivityViewExpandsFailedAppsAndCollapsesSetUpApps(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = activityStatus()
	var v view = &activityView{}
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

func TestActivityViewSpaceTogglesAnApp(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = activityStatus()
	var v view = &activityView{}

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

func activityFilterStatus() service.Status {
	return service.Status{Apps: []service.AppStatus{
		{ID: "jf", Name: "Jellyfin", Managed: true, Setup: stepstatus.SetupOK},
		{ID: "sonarr", Name: "Sonarr", Managed: true, Setup: stepstatus.SetupIncomplete, Steps: []service.StepStatus{{ID: "ready", Status: stepstatus.StepFail}}},
		{ID: "radarr", Name: "Radarr", Managed: true, Setup: stepstatus.SetupPending},
	}}
}

func TestActivityViewFiltersAppsByNameOrID(t *testing.T) {
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
			ctx.status = activityFilterStatus()
			var v view = &activityView{}
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

func TestActivityViewEscClearsFilterThenGoesBack(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = activityFilterStatus()

	var plain view = &activityView{}
	if _, cmd, nv := plain.Update(ctx, press("esc")); cmd != nil || nv.kind != navBack {
		t.Fatalf("esc with no filter should navigate back, got %+v", nv)
	}

	var v view = &activityView{}
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

func activityMany(n int) service.Status {
	var apps []service.AppStatus
	for i := 0; i < n; i++ {
		apps = append(apps, service.AppStatus{ID: fmt.Sprintf("app%02d", i), Name: fmt.Sprintf("App %02d", i),
			Managed: true, Setup: stepstatus.SetupIncomplete, Steps: []service.StepStatus{{ID: "ready"}}})
	}
	return service.Status{Apps: apps}
}

func TestActivityViewScrollsToTheLastOfFortyApps(t *testing.T) {
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
			ctx.status = activityMany(40)
			v := &activityView{}
			for i := 0; i < tc.times; i++ {
				next, _, _ := v.Update(ctx, tc.msg)
				v = next.(*activityView)
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

func TestActivityViewKeepsTheLastUnmanagedAppOnScreen(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	var apps []service.AppStatus
	for i := 0; i < 40; i++ {
		apps = append(apps, service.AppStatus{ID: fmt.Sprintf("app%02d", i), Name: fmt.Sprintf("App %02d", i)})
	}
	ctx.status = service.Status{Apps: apps}
	v := &activityView{}
	for i := 0; i < 50; i++ {
		next, _, _ := v.Update(ctx, press("down"))
		v = next.(*activityView)
	}
	out := ansi.Strip(v.View(ctx, 80, 24))
	if !strings.Contains(out, "App 39") {
		t.Fatalf("the selected last App should be on screen\n%s", out)
	}
}

func TestActivityViewFitsEightyColumns(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = service.Status{Apps: []service.AppStatus{
		{ID: "long", Name: "An App whose name is far too long to ever fit an eighty column terminal",
			Managed: true, Setup: stepstatus.SetupIncomplete,
			Steps: []service.StepStatus{{ID: "ready", Status: stepstatus.StepFail,
				Msg: "a step message that also runs on and on well past the width of a narrow terminal"}}},
		{ID: "other", Name: "Other", Managed: true, Setup: stepstatus.SetupIncomplete,
			Steps: []service.StepStatus{{ID: "ready"}}},
	}}
	var v view = &activityView{}
	for _, line := range strings.Split(ansi.Strip(v.View(ctx, 80, 24)), "\n") {
		if ansi.StringWidth(line) > 80 {
			t.Fatalf("line wider than 80 columns: %q", line)
		}
	}
}

func TestActivityViewSelectsStepsWithArrowsAndJK(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = activityStatus()
	var v view = &activityView{}
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

func TestActivityViewEscNavigatesBack(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	var v view = &activityView{}
	_, cmd, nv := v.Update(ctx, press("esc"))
	if cmd != nil || nv.kind != navBack {
		t.Fatalf("esc should navigate back without an Action, got %+v", nv)
	}
}

func TestActivityAdvertisesItsKeysMostFrequentFirst(t *testing.T) {
	var v view = &activityView{}
	var keys []string
	for _, binding := range v.Keys() {
		keys = append(keys, binding.Help().Key+" "+binding.Help().Desc)
	}
	want := "↑/↓ select, a actions, enter error/hint, space collapse, / search, pgup/pgdn page, esc back"
	if got := strings.Join(keys, ", "); got != want || v.Title() != "Activity" {
		t.Fatalf("Activity should advertise its own keys, got %q (%s)", got, v.Title())
	}
}

func TestNeedsActionOffersStartNotSetupForAFailedStart(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = service.Status{Apps: []service.AppStatus{{ID: "one", Name: "One", Managed: true, State: "exited", Setup: stepstatus.SetupOK,
		Steps: []service.StepStatus{{ID: "start", Status: stepstatus.StepFail, Error: "port is already allocated"}}}}}
	for _, item := range (&dashboardView{}).needsAttention(ctx) {
		if item.desc == "retry Setup" {
			t.Fatalf("a failed start cannot be fixed by Setup: %+v", item)
		}
	}
}

func TestDashboardManualNeedsAction(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = service.Status{Apps: []service.AppStatus{{ID: "dockge", Name: "Dockge", Managed: true, State: "running", Setup: stepstatus.SetupManual, Steps: []service.StepStatus{{ID: "admin", Status: stepstatus.StepManual, Hint: "Open the browser and create the administrator"}}}}}
	v := &dashboardView{}
	needs := v.needsAttention(ctx)
	if len(needs) != 1 || needs[0].broken || needs[0].key != "a r" || !strings.Contains(needs[0].text, "Open the browser") {
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

func TestActivityManualShowsHintWithoutFailures(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = service.Status{Apps: []service.AppStatus{{ID: "dockge", Name: "Dockge", Managed: true, Setup: stepstatus.SetupManual, Steps: []service.StepStatus{{ID: "admin", Status: stepstatus.StepManual, Hint: "Open the browser and create the administrator"}}}}}
	v := &activityView{}
	out := ansi.Strip(v.View(ctx, 120, 30))
	for _, want := range []string{"manual", "Open the browser", "0 steps failed", "0 Apps fully set up"} {
		if !strings.Contains(out, want) {
			t.Fatalf("Activity lacks %q: %s", want, out)
		}
	}
}

func TestManualInstallReturnsToDashboardWithAttention(t *testing.T) {
	m, _ := sample(t, 120, 30)
	task := m.tasks.start("install dockge")
	m.onboarding = &onboarding{step: stepReview, task: task.id, plan: &plan{}}
	m = drive(t, m, taskDoneMsg{id: task.id, title: "install dockge", err: service.ErrManual})
	if m.onboarding != nil {
		t.Fatal("manual install treated as failed review")
	}
	if m.flashLevel != levelWarn {
		t.Fatalf("manual install flash = %+v, want warning", m.flash)
	}
}
