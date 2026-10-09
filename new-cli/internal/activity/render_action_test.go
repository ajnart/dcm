package activity

import (
	"fmt"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
)

var sceneStatus = service.Status{Apps: []service.AppStatus{
	{ID: "qbittorrent", Name: "qBittorrent"}, {ID: "sonarr", Name: "Sonarr"}, {ID: "radarr", Name: "Radarr"},
	{ID: "jellyfin", Name: "Jellyfin"}, {ID: "seerr", Name: "Seerr"},
}}

var fullPalette = Palette{
	Accent: testPalette.Accent, AccentText: testPalette.Accent, OK: testPalette.OK, Warn: testPalette.Fail,
	Fail: testPalette.Fail, Bright: testPalette.Text, Text: testPalette.Text, Muted: testPalette.Muted, Faint: testPalette.Faint,
}

var installStart = seq(
	events.Event{Event: events.RunStart, Msg: "install qbittorrent sonarr radarr"},
	stage(events.StepStart, "pull", "pull 3 images", "qbittorrent", "sonarr", "radarr"),
	stage(events.StepOK, "pull", "pulled", "qbittorrent", "sonarr", "radarr"),
	stage(events.StepStart, "start", "start", "qbittorrent", "sonarr", "radarr"),
)

var installStarted = seq(installStart, stage(events.StepOK, "start", "started", "qbittorrent", "sonarr", "radarr"))

var setupMidRun = seq(installStarted,
	ev(events.StepOK, "qbittorrent", "admin-login", "replace the temporary password with the Admin login"),
	ev(events.StepOK, "qbittorrent", "check", "verify qBittorrent works"),
	ev(events.StepOK, "sonarr", "ready", "wait for the Sonarr API"),
	ev(events.StepOK, "sonarr", "api-key", "read the Sonarr API key"),
	ev(events.StepStart, "sonarr", "root-folder", "add the root folder /media/tv"),
)

var linksScene = seq(installStarted,
	ev(events.StepOK, "qbittorrent", "check", "verify qBittorrent works"),
	ev(events.StepOK, "sonarr", "check", "verify Sonarr works"),
	ev(events.StepOK, "sonarr", "link-qbittorrent", "use qBittorrent as the download client"),
	ev(events.StepSkip, "radarr", "link-qbittorrent", "waiting for qbittorrent (install it, or finish its Setup)"),
	ev(events.StepStart, "seerr", "link-sonarr", "send requests to Sonarr"),
)

var finished = seq(installStarted,
	ev(events.StepOK, "qbittorrent", "check", "verify qBittorrent works"),
	ev(events.StepOK, "sonarr", "check", "verify Sonarr works"),
	ev(events.StepOK, "radarr", "check", "verify Radarr works"),
	ev(events.StepOK, "sonarr", "link-qbittorrent", "use qBittorrent as the download client"),
	events.Event{Event: events.RunEnd, Msg: "done"},
)

type frameAt struct {
	frame   int
	changed map[string]int
}

var actionScenes = []struct {
	name   string
	evs    []events.Event
	frames []frameAt
}{
	{"start-spinner", installStart, []frameAt{{frame: 3}, {frame: 4}}},
	{"start-pulse", installStarted, []frameAt{
		{10, map[string]int{"app:qbittorrent": 10, "app:sonarr": 10, "app:radarr": 10}},
		{13, map[string]int{"app:qbittorrent": 10, "app:sonarr": 10, "app:radarr": 10}},
		{14, map[string]int{"app:qbittorrent": 10, "app:sonarr": 10, "app:radarr": 10}},
	}},
	{"setup", setupMidRun, []frameAt{{frame: 7, changed: map[string]int{"step:sonarr/root-folder": 5}}}},
	{"step-done", seq(setupMidRun, ev(events.StepOK, "sonarr", "root-folder", "add the root folder /media/tv"),
		ev(events.StepStart, "sonarr", "auth", "require the Admin login (forms authentication)")), []frameAt{{frame: 8}}},
	{"credential", seq(setupMidRun[:len(setupMidRun)-1], ev(events.StepStart, "sonarr", "admin", "create the admin account")), []frameAt{
		{0, map[string]int{"step:sonarr/admin": 0}},
		{4, map[string]int{"step:sonarr/admin": 0}},
		{12, map[string]int{"step:sonarr/admin": 0}},
	}},
	{"credential-saved", seq(setupMidRun[:len(setupMidRun)-1], ev(events.StepOK, "sonarr", "admin", "create the admin account")), []frameAt{
		{14, map[string]int{"step:sonarr/admin": 14}},
		{20, map[string]int{"step:sonarr/admin": 14}},
	}},
	{"failed", seq(installStarted,
		ev(events.StepOK, "qbittorrent", "check", "verify qBittorrent works"),
		events.Event{Event: events.StepFail, App: "sonarr", Step: "root-folder", Msg: "add the root folder /media/tv", Error: "403 Forbidden", Hint: "Sign in to Sonarr with the Admin login and add /media/tv under Settings › Media Management."},
		events.Event{Event: events.RunEnd, Msg: "Setup is incomplete for sonarr"},
	), []frameAt{{frame: 30}}},
	{"manual", seq(installStarted,
		events.Event{Event: events.StepManual, App: "radarr", Step: "wizard", Msg: "finish the startup wizard", Hint: "Open http://192.168.1.20:7878 and finish the wizard as admin."},
		events.Event{Event: events.RunEnd, Msg: "Setup needs you for radarr"},
	), []frameAt{{frame: 30}}},
	{"links", linksScene, []frameAt{
		{30, map[string]int{"link:sonarr/qbittorrent": 30}},
		{32, map[string]int{"link:sonarr/qbittorrent": 30}},
		{36, map[string]int{"link:sonarr/qbittorrent": 30}},
	}},
	{"finish-wave", finished, []frameAt{
		{50, map[string]int{ActionKey: 50}},
		{52, map[string]int{ActionKey: 50}},
		{55, map[string]int{ActionKey: 50}},
		{60, map[string]int{ActionKey: 50}},
	}},
}

func TestRenderActionGoldens(t *testing.T) {
	for _, width := range []int{120, 80} {
		for _, scene := range actionScenes {
			name := fmt.Sprintf("action-%s-%d", scene.name, width)
			t.Run(name, func(t *testing.T) {
				s := Build(sceneStatus, scene.evs)
				var out []string
				for _, f := range scene.frames {
					lines := Render(s, Motion{Frame: f.frame, Changed: f.changed}, width, fullPalette)
					for _, line := range lines {
						if w := ansi.StringWidth(line); w > width {
							t.Fatalf("frame %d: line is %d cells, wider than %d: %q", f.frame, w, width, ansi.Strip(line))
						}
					}
					out = append(out, fmt.Sprintf("── frame %d ──", f.frame), ansi.Strip(strings.Join(lines, "\n")))
				}
				golden(t, name, strings.Join(out, "\n")+"\n")
			})
		}
	}
}

func TestRenderActionWithoutColourKeepsEveryGlyph(t *testing.T) {
	for _, scene := range actionScenes {
		s := Build(sceneStatus, scene.evs)
		f := scene.frames[0]
		plain := strings.Join(Render(s, Motion{Frame: f.frame, Changed: f.changed}, 120, Palette{}), "\n")
		if strings.Contains(plain, "\x1b[38") || strings.Contains(plain, "\x1b[48") {
			t.Fatalf("%s: colour without a palette: %q", scene.name, plain)
		}
		coloured := ansi.Strip(strings.Join(Render(s, Motion{Frame: f.frame, Changed: f.changed}, 120, fullPalette), "\n"))
		if ansi.Strip(plain) != coloured {
			t.Fatalf("%s: glyphs differ without colour:\n%s\nwant\n%s", scene.name, ansi.Strip(plain), coloured)
		}
	}
}

func TestRenderActionColourRoles(t *testing.T) {
	const (
		accent = "\x1b[38;2;122;87;211m"
		ok     = "\x1b[38;2;0;215;135m"
		fail   = "\x1b[38;2;255;95;95m"
	)
	for _, tc := range []struct {
		scene string
		frame int
		want  string
	}{
		{"links", 36, accent + "━━━━━━━▶"},
		{"start-pulse", 14, ok + "●"},
		{"failed", 30, fail + "✗"},
		{"setup", 7, accent + Spinner(7)},
	} {
		for _, scene := range actionScenes {
			if scene.name != tc.scene {
				continue
			}
			s := Build(sceneStatus, scene.evs)
			out := strings.Join(Render(s, Motion{Frame: tc.frame, Changed: scene.frames[0].changed}, 120, fullPalette), "\n")
			if !strings.Contains(out, tc.want) {
				t.Fatalf("%s lacks %q:\n%q", tc.scene, tc.want, out)
			}
		}
	}
}

func TestRenderActionNeverShowsASecret(t *testing.T) {
	const secret = "hunter2-correct-horse"
	evs := seq(setupMidRun[:len(setupMidRun)-1],
		events.Event{Event: events.StepOK, App: "sonarr", Step: "api-key", Msg: "read the Sonarr API key", Credential: secret})
	out := ansi.Strip(strings.Join(Render(Build(sceneStatus, evs), Motion{}, 120, Palette{}), "\n"))
	if strings.Contains(out, secret) || !strings.Contains(out, "••••••") {
		t.Fatalf("credential not masked:\n%s", out)
	}
}

func TestAnimatingWhileRunningAndUntilTransitionsEnd(t *testing.T) {
	running := Build(sceneStatus, setupMidRun)
	done := Build(sceneStatus, finished)
	for _, tc := range []struct {
		name string
		s    Snapshot
		m    Motion
		want bool
	}{
		{"running", running, Motion{Frame: 1000}, true},
		{"finish wave playing", done, Motion{Frame: 52, Changed: map[string]int{ActionKey: 50}}, true},
		{"settled", done, Motion{Frame: 500, Changed: map[string]int{ActionKey: 50}}, false},
		{"nothing ever changed", done, Motion{Frame: 3}, false},
	} {
		if got := Animating(tc.s, tc.m); got != tc.want {
			t.Fatalf("%s: Animating = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestTrackerRecordsTheFrameOfEachChange(t *testing.T) {
	var tr Tracker
	tr.Observe(Build(sceneStatus, finished), 3)
	if m := tr.Motion(3); len(m.Changed) != 0 {
		t.Fatalf("rows seen at the first observation must count as settled: %v", m.Changed)
	}
	tr.Observe(Build(sceneStatus, seq(finished, events.Event{Event: events.RunStart, Msg: "setup sonarr"})), 7)
	tr.Observe(Build(sceneStatus, seq(finished, events.Event{Event: events.RunStart, Msg: "setup sonarr"}, ev(events.StepStart, "sonarr", "admin", ""))), 9)
	tr.Observe(Build(sceneStatus, seq(finished, events.Event{Event: events.RunStart, Msg: "setup sonarr"}, ev(events.StepStart, "sonarr", "admin", ""))), 11)
	m := tr.Motion(11)
	if m.Changed[ActionKey] != 7 || m.Changed["step:sonarr/admin"] != 9 || m.Changed["app:sonarr"] != 9 {
		t.Fatalf("changes = %v, want the Action at 7 and Sonarr's step and row at 9", m.Changed)
	}
}
