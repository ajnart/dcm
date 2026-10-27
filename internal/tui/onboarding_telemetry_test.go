package tui

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	"github.com/ajnart/self-host/internal/telemetry"
	"github.com/ajnart/self-host/internal/telemetry/telemetrytest"
)

const noticeLines = "Anonymous usage data helps improve self-host: no IP, no personal data.\n" +
	"Details: https://self-host.fyi/telemetry"

func welcomeWithNotice(t *testing.T, width, height int) Model {
	t.Helper()
	backend := &fakeBackend{catalog: wizardCatalog(), checks: readyChecks, telemetryNotice: noticeLines}
	m := New(backend, Options{Version: "1.0.0"})
	m = update(t, m, windowSize(width, height))
	m = drive(t, m, statusMsgFor(service.ErrNoProject))
	m = update(t, m, doctorMsg{checks: backend.checks})
	return frames(t, m, introFrames)
}

type telemetryWorkerRunner struct{}

func (telemetryWorkerRunner) Run(context.Context, system.Cmd) (system.Result, error) {
	panic("synthetic-stream-secret /home/alice alice-laptop")
}

func (telemetryWorkerRunner) Stream(context.Context, system.Cmd, io.Writer) error {
	panic("synthetic-stream-secret /home/alice alice-laptop")
}

func TestBackendStreamAndUpdatePanicsAreFlushedBeforeRethrowing(t *testing.T) {
	key := telemetry.ProjectKey
	telemetry.ProjectKey = "phc_test"
	t.Cleanup(func() { telemetry.ProjectKey = key })
	for _, operation := range []string{"updates", "logs", "usage"} {
		t.Run(operation, func(t *testing.T) {
			deps := systemtest.NewDeps(t)
			deps.Version = "1.2.3"
			net := &telemetrytest.Transport{}
			deps.HTTP = net.Client()
			b := ServiceBackend{Deps: deps, Apps: wizardCatalog()}
			if err := b.Run(context.Background(), Request{Action: ActionInstall, Install: &service.InstallOptions{Targets: []string{"ntfy"}, Exposure: "lan"}}, events.Discard()); err != nil {
				t.Fatal(err)
			}
			deps.Runner = telemetryWorkerRunner{}
			var recovered any
			func() {
				defer func() { recovered = recover() }()
				switch operation {
				case "updates":
					b.Updates(context.Background(), service.Status{Apps: []service.AppStatus{{ID: "ntfy", Image: "ntfy:latest"}}})
				case "logs":
					b.Logs(context.Background(), "ntfy", io.Discard)
				case "usage":
					b.Usage(context.Background(), func([]service.ContainerUsage) {})
				}
			}()
			if recovered != "synthetic-stream-secret /home/alice alice-laptop" {
				t.Fatalf("original panic changed: %v", recovered)
			}
			var exception map[string]any
			for _, e := range net.Events() {
				if e["event"] == "$exception" {
					exception = e["properties"].(map[string]any)
				}
			}
			if exception == nil {
				t.Fatal("stream panic was not flushed before rethrowing")
			}
			for _, payload := range net.Bodies() {
				for _, forbidden := range []string{"synthetic-stream-secret", "/home/alice", "alice-laptop"} {
					if strings.Contains(payload, forbidden) {
						t.Fatalf("stream payload leaks %q", forbidden)
					}
				}
			}
		})
	}
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
			m := New(backend, Options{Version: "1.2.3"})
			p := planFromAnswers(m.backend, &answers{picks: picks{"ntfy": true}, exposure: choice.exposure, adminUser: "admin", inputs: map[string]*string{}})
			backend.Run(context.Background(), Request{Action: ActionInstall, Install: &p.opts}, events.Discard())
			var command map[string]any
			for _, e := range net.Events() {
				if e["event"] == "$exception" {
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
	if !strings.Contains(indicator(t, m), "● What") || strings.Contains(screen(m), "self-host.fyi/telemetry") {
		t.Fatalf("the What step should not carry the notice\n%s", screen(m))
	}
	m = drive(t, m, press("esc"))
	if !strings.Contains(screen(m), "https://self-host.fyi/telemetry") {
		t.Fatalf("coming back to Welcome should show the same notice\n%s", screen(m))
	}
}

func TestWelcomeHasNoNoticeWhileTelemetryIsOff(t *testing.T) {
	m, _ := freshHost(t)
	if strings.Contains(screen(m), "self-host.fyi/telemetry") {
		t.Fatalf("Welcome carries a notice the backend did not give\n%s", screen(m))
	}
}

func TestTheServiceBackendGivesTheNoticeWhileTelemetryIsOn(t *testing.T) {
	key := telemetry.ProjectKey
	telemetry.ProjectKey = "phc_test"
	t.Cleanup(func() { telemetry.ProjectKey = key })
	deps := systemtest.NewDeps(t)
	deps.Version = "1.2.3"
	deps.HTTP = &http.Client{Transport: &telemetrytest.Transport{}}
	backend := ServiceBackend{Deps: deps, Apps: wizardCatalog()}

	if notice := backend.TelemetryNotice(); notice != noticeLines {
		t.Fatalf("notice = %q, want %q", notice, noticeLines)
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

// steppedHost is a fresh machine whose clock is the returned time, which the
// test moves to say how long Onboarding took.
func steppedHost(t *testing.T, backend *fakeBackend) (Model, *time.Time) {
	t.Helper()
	at := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	m := New(backend, Options{Version: "1.0.0", Now: func() time.Time { return at }})
	m = update(t, m, windowSize(120, 40))
	m = drive(t, m, statusMsgFor(service.ErrNoProject))
	m = update(t, m, doctorMsg{checks: backend.checks})
	m = frames(t, m, introFrames)
	if m.onboarding.intro != nil {
		m = drive(t, m, press("enter"))
		m = frames(t, m, introFrames)
	}
	return m, &at
}

func TestApprovingReviewSendsTheOnboardingEvent(t *testing.T) {
	warned := append([]host.Check{{ID: "ids", Title: "Container IDs", Level: host.Warn, Detail: "undetermined"}}, readyChecks...)
	backend := &fakeBackend{catalog: wizardCatalog(), checks: warned, glyphs: activity.NerdFont}
	m, clock := steppedHost(t, backend)
	m = withGlyphs(t, m, activity.NerdFont)
	m = drive(t, m, press("down"))
	m = drive(t, m, press("space"))
	m = toReview(t, m)
	*clock = clock.Add(93500 * time.Millisecond)
	if got := backend.reportedOnboarding(); len(got) != 0 {
		t.Fatalf("reported %v before approval", got)
	}

	m = drive(t, m, press("enter"))

	got := backend.reportedOnboarding()
	if len(got) != 1 {
		t.Fatalf("reported %v, want one onboarding event", got)
	}
	r := got[0]
	if r.Experience != "advanced" || r.Glyphs != "nerd-font" || r.Doctor != "warn" || r.IntroSkipped || r.Duration != 93500*time.Millisecond {
		t.Fatalf("onboarding event = %+v", r)
	}
	if len(r.Apps) == 0 || (r.Access != "home" && r.Access != "local") {
		t.Fatalf("onboarding event = %+v, want the chosen Apps and an Access choice", r)
	}
}

func TestTheOnboardingEventUsesTheSavedExperienceAndPlainDefaults(t *testing.T) {
	backend := &fakeBackend{catalog: wizardCatalog(), checks: readyChecks, experience: "advanced"}
	m, _ := steppedHost(t, backend)
	m = toReview(t, m)

	m = drive(t, m, press("enter"))

	got := backend.reportedOnboarding()
	if len(got) != 1 || got[0].Experience != "advanced" || got[0].Glyphs != "simple" || got[0].Doctor != "ok" {
		t.Fatalf("onboarding event = %+v, want advanced, simple, ok", got)
	}
}

func TestQuittingOnboardingBeforeApprovalSendsNothing(t *testing.T) {
	backend := &fakeBackend{catalog: wizardCatalog(), checks: readyChecks}
	m, _ := steppedHost(t, backend)
	m = toReview(t, m)

	m = drive(t, m, press("ctrl+c"))

	if got := backend.reportedOnboarding(); len(got) != 0 {
		t.Fatalf("reported %v without an approval", got)
	}
}

func TestTheServiceBackendSendsTheAnonymousOnboardingEvent(t *testing.T) {
	key := telemetry.ProjectKey
	telemetry.ProjectKey = "phc_test"
	t.Cleanup(func() { telemetry.ProjectKey = key })
	deps := systemtest.NewDeps(t)
	deps.Version = "1.2.3"
	net := &telemetrytest.Transport{}
	deps.HTTP = net.Client()
	backend := ServiceBackend{Deps: deps, Apps: wizardCatalog()}

	backend.ReportOnboarding(telemetry.Onboarding{Experience: "new", Glyphs: "simple", Doctor: "ok", IntroSkipped: false, Duration: 2 * time.Second})

	events := net.Events()
	if len(events) != 1 || events[0]["event"] != "onboarding" {
		t.Fatalf("events = %v, want one onboarding event", events)
	}
	props := events[0]["properties"].(map[string]any)
	if props["experience"] != "new" || props["duration_ms"] != float64(2000) || props["intro_skipped"] != false || props["$process_person_profile"] != false {
		t.Fatalf("properties = %v", props)
	}
	if _, found := props["$set"]; found {
		t.Fatalf("onboarding sets person properties: %v", props)
	}
}
