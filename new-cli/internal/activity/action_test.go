package activity

import (
	"reflect"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
)

var actionStatus = service.Status{Apps: []service.AppStatus{
	{ID: "qbittorrent", Name: "qBittorrent", Managed: true},
	{ID: "sonarr", Name: "Sonarr", Managed: true},
	{ID: "radarr", Name: "Radarr", Managed: true},
}}

func ev(event, app, step, msg string) events.Event {
	return events.Event{Event: event, App: app, Step: step, Msg: msg}
}

// stage emits a stage the way the service does: once per App, then once
// for the whole Action.
func stage(event, step, msg string, apps ...string) []events.Event {
	var out []events.Event
	for _, app := range apps {
		out = append(out, ev(event, app, step, msg))
	}
	return append(out, ev(event, "", step, msg))
}

func seq(parts ...any) []events.Event {
	var out []events.Event
	for _, part := range parts {
		switch p := part.(type) {
		case events.Event:
			out = append(out, p)
		case []events.Event:
			out = append(out, p...)
		}
	}
	return out
}

// installUntilSonarrSetup is an install of qBittorrent and Sonarr that has
// pulled, started both, set up qBittorrent and is now in Sonarr's Setup.
func installUntilSonarrSetup() []events.Event {
	return seq(
		events.Event{Event: events.RunStart, Msg: "install qbittorrent sonarr"},
		stage(events.StepStart, "pull", "pull 2 images", "qbittorrent", "sonarr"),
		stage(events.StepOK, "pull", "pulled qbittorrent, sonarr", "qbittorrent", "sonarr"),
		stage(events.StepStart, "start", "start qbittorrent, sonarr", "qbittorrent", "sonarr"),
		stage(events.StepOK, "start", "started qbittorrent, sonarr", "qbittorrent", "sonarr"),
		ev(events.StepStart, "qbittorrent", "admin-login", "replace the temporary password with the Admin login"),
		ev(events.StepOK, "qbittorrent", "admin-login", "replace the temporary password with the Admin login"),
		ev(events.StepStart, "qbittorrent", "check", "verify qBittorrent works"),
		ev(events.StepOK, "qbittorrent", "check", "verify qBittorrent works"),
		ev(events.StepStart, "sonarr", "ready", "wait for the API"),
		ev(events.StepOK, "sonarr", "ready", "wait for the API"),
		ev(events.StepStart, "sonarr", "api-key", "read the Sonarr API key"),
	)
}

func appStates(a Action) map[string]State {
	out := map[string]State{}
	for _, app := range a.Apps {
		out[app.ID] = app.State
	}
	return out
}

func TestActionStagesInOrder(t *testing.T) {
	for _, tc := range []struct {
		name string
		evs  []events.Event
		want []Stage
	}{
		{"nothing yet", []events.Event{{Event: events.RunStart, Msg: "start sonarr"}}, nil},
		{"pull running", seq(events.Event{Event: events.RunStart}, stage(events.StepStart, "pull", "pull 1 image", "sonarr")),
			[]Stage{{StagePull, Running}}},
		{"Setup and credentials of an install", installUntilSonarrSetup(), []Stage{
			{StagePull, Done}, {StageStart, Done}, {StageSetup, Running}, {StageCredentials, Running}, {StageCheck, NotRun},
		}},
		{"some Apps passed a stage and none is in it", seq(
			events.Event{Event: events.RunStart},
			stage(events.StepOK, "start", "", "qbittorrent", "sonarr"),
			ev(events.StepOK, "qbittorrent", "admin-login", ""),
			ev(events.StepOK, "qbittorrent", "check", ""),
		), []Stage{{StageStart, Done}, {StageCredentials, NotRun}, {StageCheck, NotRun}}},
		{"finished marks every reached stage done", seq(
			events.Event{Event: events.RunStart},
			stage(events.StepOK, "start", "", "qbittorrent", "sonarr"),
			ev(events.StepOK, "qbittorrent", "admin-login", ""),
			ev(events.StepOK, "qbittorrent", "check", ""),
			events.Event{Event: events.RunEnd, Msg: "done"},
		), []Stage{{StageStart, Done}, {StageCredentials, Done}, {StageCheck, Done}}},
		{"the App between two Setup steps is in Setup", seq(
			events.Event{Event: events.RunStart},
			ev(events.StepOK, "sonarr", "ready", ""),
		), []Stage{{StageSetup, Running}}},
		{"one App failed a stage", seq(
			events.Event{Event: events.RunStart},
			stage(events.StepFail, "start", "", "qbittorrent"),
			stage(events.StepOK, "start", "", "sonarr"),
		), []Stage{{StageStart, Failed}}},
		{"Links after check", seq(
			events.Event{Event: events.RunStart},
			ev(events.StepOK, "sonarr", "check", ""),
			ev(events.StepSkip, "sonarr", "link-qbittorrent", "waiting for qbittorrent"),
			ev(events.StepFail, "radarr", "link-qbittorrent", "download client"),
		), []Stage{{StageLinks, Failed}, {StageCheck, Done}}},
		{"a skipped stage", seq(events.Event{Event: events.RunStart}, ev(events.StepSkip, "sonarr", "ready", "already done"), events.Event{Event: events.RunEnd}),
			[]Stage{{StageSetup, Skipped}}},
		{"manual Setup", seq(events.Event{Event: events.RunStart}, ev(events.StepManual, "sonarr", "wizard", "")),
			[]Stage{{StageSetup, Manual}}},
		{"render is not a stage", seq(events.Event{Event: events.RunStart}, stage(events.StepOK, "render", "", "sonarr")), nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := Build(actionStatus, tc.evs).Action.Stages
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("stages = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestActionAppStates(t *testing.T) {
	start := seq(events.Event{Event: events.RunStart, Msg: "install qbittorrent sonarr"})
	for _, tc := range []struct {
		name string
		evs  []events.Event
		want map[string]State
	}{
		{"starting", seq(start, stage(events.StepStart, "start", "", "qbittorrent", "sonarr")),
			map[string]State{"qbittorrent": Running, "sonarr": Running}},
		{"started and waiting for Setup", seq(start, stage(events.StepStart, "start", "", "qbittorrent", "sonarr"), stage(events.StepOK, "start", "", "qbittorrent", "sonarr")),
			map[string]State{"qbittorrent": Done, "sonarr": Done}},
		{"pulled but not started", seq(start, stage(events.StepOK, "pull", "", "qbittorrent", "sonarr")),
			map[string]State{"qbittorrent": NotRun, "sonarr": NotRun}},
		{"one App at a time in Setup", installUntilSonarrSetup(),
			map[string]State{"qbittorrent": Done, "sonarr": Running}},
		{"between two Setup steps", seq(start, ev(events.StepOK, "sonarr", "ready", "")),
			map[string]State{"sonarr": Running}},
		{"failed", seq(start, ev(events.StepFail, "sonarr", "root-folder", "")), map[string]State{"sonarr": Failed}},
		{"manual", seq(start, ev(events.StepManual, "sonarr", "wizard", "")), map[string]State{"sonarr": Manual}},
		{"start failed", seq(start, stage(events.StepFail, "start", "", "sonarr")), map[string]State{"sonarr": Failed}},
		{"ready when finished", seq(start, ev(events.StepOK, "sonarr", "ready", ""), events.Event{Event: events.RunEnd, Msg: "done"}),
			map[string]State{"sonarr": Done}},
		{"a Link does not make its App busy", seq(start, ev(events.StepOK, "sonarr", "check", ""), ev(events.StepStart, "sonarr", "link-qbittorrent", "")),
			map[string]State{"sonarr": Done}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := appStates(Build(actionStatus, tc.evs).Action); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("App states = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestActionAppIsReadyAfterItsCheck(t *testing.T) {
	ready := map[string]bool{}
	for _, app := range Build(actionStatus, installUntilSonarrSetup()).Action.Apps {
		ready[app.ID] = app.Ready
	}
	if !ready["qbittorrent"] || ready["sonarr"] {
		t.Fatalf("ready = %v, want qBittorrent ready after its check and Sonarr not yet", ready)
	}
	started := Build(actionStatus, seq(events.Event{Event: events.RunStart}, stage(events.StepOK, "start", "", "sonarr"))).Action
	if started.Apps[0].State != Done || started.Apps[0].Ready || started.Counts.AppsSetUp != 0 {
		t.Fatalf("a started App is not set up yet: %+v", started)
	}
}

func TestActionStepRows(t *testing.T) {
	for _, tc := range []struct {
		event string
		want  State
	}{
		{events.StepStart, Running}, {events.StepOK, Done}, {events.StepSkip, Skipped},
		{events.StepFail, Failed}, {events.StepManual, Manual},
	} {
		t.Run(string(tc.want), func(t *testing.T) {
			evs := []events.Event{
				{Event: events.RunStart},
				{Event: events.StepOK, App: "sonarr", Step: "ready", Msg: "wait for the API"},
				{Event: tc.event, App: "sonarr", Step: "root-folder", Msg: "add the root folder /media/tv", Error: "403", Hint: "check the Admin login"},
			}
			steps := Build(actionStatus, evs).Action.Apps[0].Steps
			want := []Step{
				{ID: "ready", Label: "ready", State: Done, Msg: "wait for the API", Key: "step:sonarr/ready"},
				{ID: "root-folder", Label: "root-folder", State: tc.want, Msg: "add the root folder /media/tv", Error: "403", Hint: "check the Admin login", Key: "step:sonarr/root-folder"},
			}
			if !reflect.DeepEqual(steps, want) {
				t.Fatalf("steps =\n%+v\nwant\n%+v", steps, want)
			}
		})
	}
}

func TestActionStagesAreNotStepRows(t *testing.T) {
	app := Build(actionStatus, installUntilSonarrSetup()).Action.Apps[1]
	var ids []string
	for _, step := range app.Steps {
		ids = append(ids, step.ID)
	}
	if !reflect.DeepEqual(ids, []string{"ready", "api-key"}) {
		t.Fatalf("Sonarr's rows = %v, want its Setup steps only", ids)
	}
}

func TestActionCredentialsCarryOnlyAName(t *testing.T) {
	for _, tc := range []struct{ step, want string }{
		{"api-key", "API key"}, {"admin-login", "Admin login"}, {"admin", "Admin login"},
		{"rpc-token", "token"}, {"web-password", "password"}, {"ready", ""}, {"root-folder", ""},
	} {
		t.Run(tc.step, func(t *testing.T) {
			evs := []events.Event{{Event: events.RunStart}, {Event: events.StepOK, App: "sonarr", Step: tc.step, Msg: "secret-free message"}}
			if got := Build(actionStatus, evs).Action.Apps[0].Steps[0].Credential; got != tc.want {
				t.Fatalf("credential = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestActionLinks(t *testing.T) {
	evs := []events.Event{
		{Event: events.RunStart},
		{Event: events.StepOK, App: "sonarr", Step: "link-qbittorrent", Msg: "use qBittorrent as the download client"},
		{Event: events.StepSkip, App: "radarr", Step: "link-qbittorrent", Msg: "waiting for qbittorrent (install it, or finish its Setup)"},
		{Event: events.StepStart, App: "radarr", Step: "link-sonarr", Msg: "share the library"},
		{Event: events.StepFail, App: "sonarr", Step: "link-prowlarr", Msg: "sync indexers", Error: "refused", Hint: "check the API key"},
		{Event: events.StepSkip, App: "radarr", Step: "link-jellyfin", Msg: "already configured"},
	}
	a := Build(actionStatus, evs).Action
	want := []Link{
		{Key: "link:sonarr/qbittorrent", Source: "Sonarr", Target: "qBittorrent", Purpose: "use qBittorrent as the download client", State: Done},
		{Key: "link:radarr/qbittorrent", Source: "Radarr", Target: "qBittorrent", State: NotRun, Waiting: "waiting for qbittorrent (install it, or finish its Setup)"},
		{Key: "link:radarr/sonarr", Source: "Radarr", Target: "Sonarr", Purpose: "share the library", State: Running},
		{Key: "link:sonarr/prowlarr", Source: "Sonarr", Target: "prowlarr", Purpose: "sync indexers", State: Failed, Error: "refused", Hint: "check the API key"},
		{Key: "link:radarr/jellyfin", Source: "Radarr", Target: "jellyfin", Purpose: "already configured", State: Skipped},
	}
	if !reflect.DeepEqual(a.Links, want) {
		t.Fatalf("links =\n%+v\nwant\n%+v", a.Links, want)
	}
	if a.Counts.LinksApplied != 2 || a.Counts.LinksTotal != 5 {
		t.Fatalf("Links %d/%d, want 2/5", a.Counts.LinksApplied, a.Counts.LinksTotal)
	}
}

func TestActionCounters(t *testing.T) {
	evs := seq(installUntilSonarrSetup()[:1],
		stage(events.StepStart, "pull", "", "qbittorrent", "sonarr"),
		progress("lscr.io/linuxserver/qbittorrent:latest", "a", 10, 100),
		pulled("lscr.io/linuxserver/sonarr:latest"),
		installUntilSonarrSetup()[7:],
	)
	got := Build(actionStatus, evs).Action.Counts
	want := ActionCounts{AppsSetUp: 1, AppsTotal: 2, ImagesPulled: 1, ImagesTotal: 2}
	if got != want {
		t.Fatalf("counts = %+v, want %+v", got, want)
	}
}

func TestActionNarrative(t *testing.T) {
	start := events.Event{Event: events.RunStart, Msg: "install qbittorrent sonarr"}
	end := events.Event{Event: events.RunEnd, Msg: "done"}
	for _, tc := range []struct {
		name string
		evs  []events.Event
		want string
	}{
		{"no Action", nil, ""},
		{"pulling without sizes", seq(start, stage(events.StepStart, "pull", "", "sonarr")), "Pulling images"},
		{"pulling", seq(start, stage(events.StepStart, "pull", "", "qbittorrent", "sonarr"), progress("a", "l", 1, 10), progress("b", "l", 1, 10), progress("c", "l", 1, 10)), "Pulling 3 images"},
		{"starting one", seq(start, stage(events.StepStart, "start", "", "sonarr")), "Starting Sonarr"},
		{"starting several", seq(start, stage(events.StepStart, "start", "", "qbittorrent", "sonarr")), "Starting 2 Apps"},
		{"Setup step", seq(start, ev(events.StepStart, "sonarr", "admin", "create the admin account")), "Setting up Sonarr: create the admin account"},
		{"check", seq(start, ev(events.StepStart, "sonarr", "check", "verify Sonarr works")), "Checking Sonarr"},
		{"Link", seq(start, ev(events.StepStart, "sonarr", "link-qbittorrent", "")), "Linking Sonarr to qBittorrent"},
		{"between steps", seq(start, ev(events.StepOK, "sonarr", "ready", "")), "Working on install qbittorrent sonarr"},
		{"all ready", seq(start, ev(events.StepOK, "qbittorrent", "check", ""), ev(events.StepOK, "sonarr", "check", ""), end), "All 2 Apps are ready"},
		{"one ready", seq(start, ev(events.StepOK, "sonarr", "check", ""), end), "Sonarr is ready"},
		{"needs you", seq(start, events.Event{Event: events.StepManual, App: "sonarr", Step: "wizard", Hint: "open the browser and finish the wizard"}, end),
			"Sonarr needs you: open the browser and finish the wizard"},
		{"failed step", seq(start, events.Event{Event: events.StepFail, App: "sonarr", Step: "root-folder", Error: "403 forbidden\nbody"}, end), "Sonarr failed: 403 forbidden"},
		{"failed Link", seq(start, events.Event{Event: events.StepFail, App: "sonarr", Step: "link-qbittorrent", Error: "refused"}, end), "Linking Sonarr to qBittorrent failed: refused"},
		{"failed Action", seq(start, events.Event{Event: events.RunEnd, Error: "docker is not running"}), "The Action failed: docker is not running"},
		{"nothing to do", seq(start, end), "Done"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := Build(actionStatus, tc.evs).Action.Narrative; got != tc.want {
				t.Fatalf("narrative = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestActionFinishedAndResetOnNewRun(t *testing.T) {
	first := seq(events.Event{Event: events.RunStart, Msg: "setup sonarr"}, ev(events.StepFail, "sonarr", "root-folder", ""), events.Event{Event: events.RunEnd, Msg: "incomplete"})
	a := Build(actionStatus, first).Action
	if !a.Finished || a.Running || a.Title != "setup sonarr" || a.Empty() {
		t.Fatalf("finished Action = %+v", a)
	}
	next := Build(actionStatus, seq(first, events.Event{Event: events.RunStart, Msg: "start radarr"}, stage(events.StepStart, "start", "", "radarr"))).Action
	if next.Finished || !next.Running || next.Title != "start radarr" || len(next.Apps) != 1 || next.Apps[0].ID != "radarr" {
		t.Fatalf("new run kept the old Action: %+v", next)
	}
	if !Build(actionStatus, nil).Action.Empty() {
		t.Fatal("no events must give no Action")
	}
}
