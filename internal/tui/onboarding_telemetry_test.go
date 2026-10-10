package tui

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/systemtest"
	"github.com/ajnart/self-host/internal/telemetry"
	"github.com/ajnart/self-host/internal/telemetry/telemetrytest"
)

const noticeLines = "Anonymous usage data helps improve self-host: no IP, no personal data.\n" +
	"Details: https://github.com/ajnart/selfhost-skills/wiki/Telemetry"

func welcomeWithNotice(t *testing.T, width, height int) Model {
	t.Helper()
	backend := &fakeBackend{catalog: wizardCatalog(), checks: readyChecks, telemetryNotice: noticeLines}
	m := New(backend, Options{Version: "1.0.0"})
	m = update(t, m, windowSize(width, height))
	m = drive(t, m, statusMsgFor(service.ErrNoProject))
	m = update(t, m, doctorMsg{checks: backend.checks})
	return drive(t, frames(t, m, 60), press("enter"))
}

type telemetryPanicApp struct{ stubApp }

func (a telemetryPanicApp) Setup(context.Context, *helpers.H) error {
	panic("synthetic-secret /home/alice alice-laptop")
}

func TestATUIActionFlushesAnUnhandledPanicBeforeRethrowing(t *testing.T) {
	key := telemetry.ProjectKey
	telemetry.ProjectKey = "phc_test"
	t.Cleanup(func() { telemetry.ProjectKey = key })
	deps := systemtest.NewDeps(t)
	deps.Version = "1.2.3"
	net := &telemetrytest.Transport{}
	deps.HTTP = net.Client()
	cat := catalog.New([]app.App{telemetryPanicApp{stubApp: stubApp{info: app.Info{ID: "one", Name: "One", Image: "one:latest"}}}}, nil)
	backend := ServiceBackend{Deps: deps, Apps: cat}
	backend.TelemetryNotice()
	var crash any
	func() {
		defer func() { crash = recover() }()
		backend.Run(context.Background(), Request{Action: ActionInstall, Install: &service.InstallOptions{Targets: []string{"one"}, Exposure: "lan"}}, events.Discard())
	}()
	if crash != "synthetic-secret /home/alice alice-laptop" {
		t.Fatalf("panic changed: %v", crash)
	}
	var exception map[string]any
	for _, e := range net.Events() {
		if e["event"] == "$exception" {
			exception = e["properties"].(map[string]any)
		}
	}
	if exception == nil {
		t.Fatal("panic was not sent before rethrowing")
	}
	item := exception["$exception_list"].([]any)[0].(map[string]any)
	if item["mechanism"].(map[string]any)["handled"] != false || item["value"] != "panic" {
		t.Fatalf("exception = %v, want an unhandled panic", item)
	}
	for _, body := range net.Bodies() {
		for _, forbidden := range []string{"synthetic-secret", "/home/alice", "alice-laptop"} {
			if strings.Contains(body, forbidden) {
				t.Fatalf("sent %q: %s", forbidden, body)
			}
		}
	}
}

func TestTheTUIInstallReportsTheChosenAccess(t *testing.T) {
	key := telemetry.ProjectKey
	telemetry.ProjectKey = "phc_test"
	t.Cleanup(func() { telemetry.ProjectKey = key })
	for _, choice := range []struct{ exposure, access string }{{"lan", "home"}, {"local", "local"}} {
		t.Run(choice.access, func(t *testing.T) {
			deps := systemtest.NewDeps(t)
			deps.Version = "1.2.3"
			net := &telemetrytest.Transport{}
			deps.HTTP = net.Client()
			deps.Runner.(*systemtest.Runner).OnStreamError("--progress json pull", "", errors.New("synthetic pull failure"))
			backend := ServiceBackend{Deps: deps, Apps: wizardCatalog()}
			backend.TelemetryNotice()
			m := New(backend, Options{Version: "1.2.3"})
			p := m.planFromAnswers(&answers{picks: picks{"ntfy": true}, exposure: choice.exposure, adminUser: "admin", inputs: map[string]*string{}})
			backend.Run(context.Background(), Request{Action: ActionInstall, Install: &p.opts}, events.Discard())
			var command map[string]any
			for _, e := range net.Events() {
				if e["event"] == "command" {
					command = e["properties"].(map[string]any)
				}
			}
			if command["access"] != choice.access || command["command"] != "install" {
				t.Fatalf("command = %v, want install with Access %s", command, choice.access)
			}
			steps, _ := command["steps"].([]any)
			if len(steps) == 0 {
				t.Fatalf("command has no step outcomes and durations: %v", command)
			}
			var failed bool
			for _, step := range steps {
				fields := step.(map[string]any)
				if fields["id"] == "ntfy/pull" && fields["outcome"] == "failed" && fields["duration_ms"] != nil {
					failed = true
				}
			}
			if !failed {
				t.Fatalf("no timed ntfy/pull failure: %v", steps)
			}
		})
	}
}

func TestWelcomeAnnouncesTelemetryAndLinksTheWiki(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		m := welcomeWithNotice(t, size.width, size.height)
		for _, line := range strings.Split(noticeLines, "\n") {
			if got := strings.Count(screen(m), line); got != 1 {
				t.Fatalf("%dx%d: %q appears %d times, want once\n%s", size.width, size.height, line, got, screen(m))
			}
		}
		for _, banned := range []string{"SELF_HOST_NO_TELEMETRY", "DO_NOT_TRACK", "Turn off"} {
			if strings.Contains(screen(m), banned) {
				t.Fatalf("%dx%d: Welcome names the off switch with %q\n%s", size.width, size.height, banned, screen(m))
			}
		}
		golden(t, "onboarding-welcome-telemetry"+size.suffix, trimLines(screen(m)))
	}
}

func TestOtherStepsDoNotRepeatTheTelemetryNotice(t *testing.T) {
	m := welcomeWithNotice(t, 120, 30)
	m = drive(t, m, press("enter"))
	if !strings.Contains(indicator(t, m), "● What") || strings.Contains(screen(m), "wiki/Telemetry") {
		t.Fatalf("the What step should not carry the notice\n%s", screen(m))
	}
	m = drive(t, m, press("esc"))
	if !strings.Contains(screen(m), "https://github.com/ajnart/selfhost-skills/wiki/Telemetry") {
		t.Fatalf("coming back to Welcome should show the same notice\n%s", screen(m))
	}
}

func TestWelcomeHasNoNoticeOnceItWasShown(t *testing.T) {
	m, _ := freshHost(t)
	if strings.Contains(screen(m), "wiki/Telemetry") {
		t.Fatalf("Welcome carries a notice the backend did not announce\n%s", screen(m))
	}
}

func TestTheServiceBackendAnnouncesTelemetryOnce(t *testing.T) {
	key := telemetry.ProjectKey
	telemetry.ProjectKey = "phc_test"
	t.Cleanup(func() { telemetry.ProjectKey = key })
	deps := systemtest.NewDeps(t)
	deps.Version = "1.2.3"
	deps.HTTP = &http.Client{Transport: &telemetrytest.Transport{}}
	backend := ServiceBackend{Deps: deps, Apps: wizardCatalog()}

	first, second := backend.TelemetryNotice(), backend.TelemetryNotice()

	if first != noticeLines || second != "" {
		t.Fatalf("notices = %q then %q, want %q then nothing", first, second, noticeLines)
	}
}

func TestTheServiceBackendSaysNothingWhereTelemetryIsOff(t *testing.T) {
	deps := systemtest.NewDeps(t)
	backend := ServiceBackend{Deps: deps, Apps: wizardCatalog()}
	if notice := backend.TelemetryNotice(); notice != "" {
		t.Fatalf("a test build announced %q", notice)
	}
}

func TestNoScreenOffersATelemetryToggleOrNamesItsOffSwitch(t *testing.T) {
	goldens, err := filepath.Glob("testdata/*.golden")
	if err != nil || len(goldens) == 0 {
		t.Fatalf("no goldens to scan: %v", err)
	}
	for _, path := range goldens {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		for _, banned := range []string{"SELF_HOST_NO_TELEMETRY", "DO_NOT_TRACK", "Turn off", "opt out", "Opt out"} {
			if strings.Contains(string(data), banned) {
				t.Errorf("%s names or offers an off switch (%q)", path, banned)
			}
		}
	}
}
