package tui

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/service"
)

type stubApp struct {
	info   app.Info
	inputs []app.Input
	links  []app.Link
}

func (s stubApp) Info() app.Info                          { return s.info }
func (s stubApp) Inputs() []app.Input                     { return s.inputs }
func (s stubApp) Compose(app.RenderContext) string        { return "" }
func (s stubApp) Setup(context.Context, *helpers.H) error { return nil }
func (s stubApp) Check(context.Context, *helpers.H) error { return nil }
func (s stubApp) Links() []app.Link                       { return s.links }

func wizardCatalog() *catalog.Catalog {
	return catalog.New([]app.App{
		stubApp{info: app.Info{ID: "homarr", Name: "Homarr", Description: "Dashboard", Image: "ghcr.io/homarr-labs/homarr:latest", Port: 7575}},
		stubApp{info: app.Info{ID: "ntfy", Name: "ntfy", Description: "Notifications", Image: "binwiederhier/ntfy:latest", Port: 2586},
			links: []app.Link{{ID: "homarr-tile", Target: "homarr", Title: "show ntfy in Homarr"}}},
		stubApp{info: app.Info{ID: "jellyfin", Name: "Jellyfin", Description: "Media server", Image: "lscr.io/linuxserver/jellyfin:latest", Port: 8096, UsesMedia: true},
			inputs: []app.Input{{Key: "server_name", Prompt: "Server name", Default: "Home"}}},
	}, []catalog.Recipe{{ID: "media", Name: "Media", Description: "Watch your movies", Apps: []string{"jellyfin"}}})
}

var readyChecks = []host.Check{
	{ID: "docker", Title: "Docker", Level: host.OK, Detail: "docker command found"},
	{ID: "docker-socket", Title: "Docker daemon", Level: host.OK, Detail: "engine 27.3.1"},
	{ID: "compose", Title: "Docker Compose", Level: host.OK, Detail: "compose 2.29.7"},
}

// onboardingHost is a machine without a Project, at the Initializing step
// before any host check has been revealed.
func onboardingHost(t *testing.T, width, height int, checks ...host.Check) (Model, *fakeBackend) {
	t.Helper()
	backend := &fakeBackend{catalog: wizardCatalog(), checks: checks}
	m := New(backend, Options{Version: "1.0.0"})
	m = update(t, m, windowSize(width, height))
	m = drive(t, m, statusMsgFor(service.ErrNoProject))
	m = update(t, m, doctorMsg{checks: backend.checks})
	return m, backend
}

// freshHost is a ready machine without a Project, at the Welcome step.
func freshHost(t *testing.T) (Model, *fakeBackend) {
	t.Helper()
	m, backend := onboardingHost(t, 120, 40, readyChecks...)
	m = frames(t, m, 60)
	m = drive(t, m, press("enter"))
	return m, backend
}

func frames(t *testing.T, m Model, n int) Model {
	t.Helper()
	for range n {
		m = update(t, m, frameMsg{})
	}
	return m
}

func typeText(t *testing.T, m Model, text string) Model {
	for _, r := range text {
		m = drive(t, m, press(string(r)))
	}
	return m
}

// toReview answers every step from Welcome: Homarr (pre-selected) and ntfy,
// the detected settings, and a password of the person's own.
func toReview(t *testing.T, m Model) Model {
	t.Helper()
	m = drive(t, m, press("enter")) // Welcome -> What
	for range 3 {                   // Media, Homarr (pre-selected), Jellyfin, ntfy
		m = drive(t, m, press("down"))
	}
	m = drive(t, m, press("x"))     // toggle ntfy
	m = drive(t, m, press("enter")) // What -> Where
	for range 5 {                   // Exposure, TZ, LAN IP, PUID, PGID keep their defaults
		m = drive(t, m, press("enter"))
	}
	m = drive(t, m, press("enter")) // admin user: admin
	m = typeText(t, m, "hunter2-long")
	m = drive(t, m, press("enter")) // Who -> Look
	return drive(t, m, press("enter"))
}

func indicator(t *testing.T, m Model) string {
	t.Helper()
	for _, line := range strings.Split(screen(m), "\n") {
		if strings.Contains(line, "Welcome") && strings.Contains(line, "Review") {
			return line
		}
	}
	t.Fatalf("no step indicator\n%s", screen(m))
	return ""
}

func TestLoadingScreenShowsTheBrandAndASpinner(t *testing.T) {
	m := New(&fakeBackend{}, Options{Version: "1.0.0"})
	m = update(t, m, windowSize(80, 24))

	out := screen(m)

	for _, want := range []string{"self-host", "⠋ Getting ready…", "q quit"} {
		if !strings.Contains(out, want) {
			t.Fatalf("loading screen lacks %q\n%s", want, out)
		}
	}
	if strings.Contains(out, "1-5 tabs") {
		t.Fatalf("no tab keys before the Project is read\n%s", out)
	}
}

func TestFreshHostOpensOnboardingAtInitializing(t *testing.T) {
	m, _ := onboardingHost(t, 120, 30, readyChecks...)

	out := screen(m)
	if !strings.Contains(indicator(t, m), "● Initializing") || !strings.Contains(out, "Checking this machine") {
		t.Fatalf("Onboarding should open at Initializing\n%s", out)
	}
}

func TestHostChecksRevealOneAtATime(t *testing.T) {
	m, _ := onboardingHost(t, 120, 30, readyChecks...)

	out := screen(m)
	if !strings.Contains(out, "⠋ Docker") || strings.Contains(out, "Docker daemon") {
		t.Fatalf("the first check should spin alone\n%s", out)
	}

	m = frames(t, m, 6)
	out = screen(m)
	if !strings.Contains(out, "✓ Docker ") || !strings.Contains(out, "⠦ Docker daemon") || strings.Contains(out, "compose 2.29.7") {
		t.Fatalf("Docker should be done and the daemon checking\n%s", out)
	}

	m = idle(t, m)
	out = screen(m)
	for _, want := range []string{"✓ Docker daemon", "✓ Docker Compose", "This machine is ready"} {
		if !strings.Contains(out, want) {
			t.Fatalf("after the reveal the screen lacks %q\n%s", want, out)
		}
	}
}

func TestFailingCheckBlocksWithItsHintAndRecheckClearsIt(t *testing.T) {
	m, backend := onboardingHost(t, 120, 30,
		host.Check{ID: "docker", Title: "Docker", Level: host.OK, Detail: "docker command found"},
		host.Check{ID: "docker-socket", Title: "Docker daemon", Level: host.Fail, Detail: "permission denied on the Docker socket",
			Hint: "Add your user to the docker group.", Docs: "https://docs.docker.com/engine/install/linux-postinstall/"})
	m = frames(t, m, 60)

	m = drive(t, m, press("enter"))

	out := screen(m)
	for _, want := range []string{"✗ Docker daemon", "→ Add your user to the docker group.", "linux-postinstall", "Fix the failed check", "r to check again"} {
		if !strings.Contains(out, want) {
			t.Fatalf("a failed check should show %q\n%s", want, out)
		}
	}
	if !strings.Contains(indicator(t, m), "● Initializing") {
		t.Fatalf("a failed check must block continuing\n%s", out)
	}

	backend.checks = readyChecks
	m = drive(t, m, press("r"))
	m = frames(t, m, 60)
	m = drive(t, m, press("enter"))

	if !strings.Contains(indicator(t, m), "● Welcome") {
		t.Fatalf("after a clean recheck enter should continue\n%s", screen(m))
	}
}

func TestWarningDoesNotBlock(t *testing.T) {
	m, _ := onboardingHost(t, 120, 30, append(readyChecks[:3:3],
		host.Check{ID: "docker-userns", Title: "Container IDs", Level: host.Warn, Detail: "user namespace unknown", Hint: "Inspect docker info."})...)
	m = frames(t, m, 60)
	if out := screen(m); !strings.Contains(out, "! Container IDs") || !strings.Contains(out, "→ Inspect docker info.") {
		t.Fatalf("the warning should show with its hint\n%s", out)
	}

	m = drive(t, m, press("enter"))

	if !strings.Contains(indicator(t, m), "● Welcome") {
		t.Fatalf("a warning must not block\n%s", screen(m))
	}
}

func TestEnterDuringTheRevealShowsEveryCheckFirst(t *testing.T) {
	m, _ := onboardingHost(t, 120, 30, readyChecks...)

	m = drive(t, m, press("enter"))

	if out := screen(m); !strings.Contains(out, "✓ Docker Compose") || !strings.Contains(indicator(t, m), "● Initializing") {
		t.Fatalf("enter should finish the reveal, not skip it\n%s", out)
	}
}

func TestWelcomeSaysNothingIsWrittenUntilReview(t *testing.T) {
	m, _ := freshHost(t)

	out := screen(m)
	if !strings.Contains(out, "Welcome to self-host") || !strings.Contains(out, "Nothing is written until you approve the plan at Review") {
		t.Fatalf("Welcome should promise nothing is written before Review\n%s", out)
	}
}

func TestStepIndicatorFollowsEveryStep(t *testing.T) {
	m, _ := freshHost(t)
	steps := []string{"Initializing", "Welcome", "What", "Where", "Who", "Look", "Review"}
	want := func(current int) {
		t.Helper()
		line := indicator(t, m)
		for i, name := range steps {
			mark := "○ "
			switch {
			case i < current:
				mark = "✓ "
			case i == current:
				mark = "● "
			}
			if !strings.Contains(line, mark+name) {
				t.Fatalf("at %s the indicator should show %q: %q", steps[current], mark+name, line)
			}
		}
	}

	want(1)
	m = drive(t, m, press("enter"))
	want(2)
	m = drive(t, m, press("enter"))
	want(3)
	for range 5 {
		m = drive(t, m, press("enter"))
	}
	want(4)
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter"))
	want(5)
	m = drive(t, m, press("enter"))
	want(6)
}

func TestNarrowStepIndicatorKeepsTheCurrentStep(t *testing.T) {
	m, _ := onboardingHost(t, 60, 24, readyChecks...)

	for _, line := range strings.Split(screen(m), "\n") {
		if ansi.StringWidth(line) > 60 {
			t.Fatalf("line wider than 60 columns: %q", line)
		}
	}
	if !strings.Contains(screen(m), "● Initializing") || !strings.Contains(screen(m), "1 of 7") {
		t.Fatalf("a narrow indicator should still name the current step\n%s", screen(m))
	}
}

func TestEscGoesBackWithoutLosingAnswers(t *testing.T) {
	m, backend := freshHost(t)
	m = toReview(t, m)
	first := screen(m)

	for _, step := range []string{"● Look", "● Who", "● Where", "● What", "● Welcome"} {
		m = drive(t, m, press("esc"))
		if !strings.Contains(indicator(t, m), step) {
			t.Fatalf("esc should go back to %s\n%s", step, screen(m))
		}
	}
	m = drive(t, m, press("enter")) // Welcome -> What
	m = drive(t, m, press("enter")) // the selection is kept
	for range 5 {
		m = drive(t, m, press("enter"))
	}
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter")) // the password is kept
	m = drive(t, m, press("enter")) // Look -> Review

	if screen(m) != first {
		t.Fatalf("going back and forward changed the plan\nbefore:\n%s\nafter:\n%s", first, screen(m))
	}
	m = drive(t, m, press("enter"))
	if got := backend.installs(); len(got) != 1 || got[0].AdminPassword != "hunter2-long" || strings.Join(got[0].Targets, ",") != "homarr,ntfy" {
		t.Fatalf("installs %+v", got)
	}
}

func TestReviewShowsThePlanAndInstallsNothingBeforeApproval(t *testing.T) {
	m, backend := freshHost(t)
	m = toReview(t, m)

	out := screen(m)
	for _, want := range []string{"Review", "Homarr", "ghcr.io/homarr-labs/homarr:latest", "7575", "ntfy", "binwiederhier/ntfy:latest",
		"local network", "192.168.1.20", "Europe/Paris", "admin", "••••••••", "show ntfy in Homarr", "approve", "back"} {
		if !strings.Contains(out, want) {
			t.Fatalf("review lacks %q\n%s", want, out)
		}
	}
	if strings.Contains(out, "hunter2-long") {
		t.Fatalf("the review must never show the password\n%s", out)
	}
	if len(backend.Actions()) != 0 {
		t.Fatal("nothing may be installed before the review is approved")
	}
}

func TestOnboardingInstallsTheSelectionWithReviewedSettings(t *testing.T) {
	m, backend := freshHost(t)
	m = toReview(t, m)

	m = drive(t, m, press("enter"))

	got := backend.installs()
	if len(got) != 1 {
		t.Fatalf("installs %v", got)
	}
	opts := got[0]
	if strings.Join(opts.Targets, ",") != "homarr,ntfy" || opts.Exposure != "lan" || opts.AdminPassword != "hunter2-long" || opts.Settings["TZ"] == "" {
		t.Fatalf("install options %+v", opts)
	}
}

func TestApprovingHandsOverToActivity(t *testing.T) {
	m, backend := freshHost(t)
	m = toReview(t, m)

	next, cmd := m.Update(press("enter"))
	m = next.(Model)

	out := screen(m)
	if m.surface != surfaceActivity || !strings.Contains(out, "3 Activity") || strings.Contains(out, "Review") {
		t.Fatalf("approving should hand over to the Dashboard with Activity focused\n%s", out)
	}
	if !strings.Contains(out, "install homarr ntfy") {
		t.Fatalf("Activity should show the install\n%s", out)
	}
	for _, msg := range runCmd(cmd) {
		m = drive(t, m, msg)
	}
	if got := backend.Actions(); len(got) != 1 || got[0] != "install" {
		t.Fatalf("the install Action should be dispatched, actions %v", got)
	}
	if m.surface != surfaceActivity || strings.Contains(screen(m), "Welcome") {
		t.Fatalf("the Dashboard should stay once the install ends\n%s", screen(m))
	}
}

func TestNoProjectYetDuringTheInstallKeepsTheDashboard(t *testing.T) {
	m, _ := freshHost(t)
	m = toReview(t, m)
	next, _ := m.Update(press("enter"))
	m = next.(Model)
	t.Cleanup(m.tasks.cancelAll)

	m = drive(t, m, statusMsgFor(service.ErrNoProject))

	out := screen(m)
	if m.surface != surfaceActivity || !strings.Contains(out, "3 Activity") || strings.Contains(out, "Welcome") || strings.Contains(out, "Initializing") {
		t.Fatalf("a refresh before the Project exists must not reopen Onboarding\n%s", out)
	}
}

func TestEarlyFailureReturnsToReviewWithAnswersKept(t *testing.T) {
	m, backend := freshHost(t)
	m = toReview(t, m)
	backend.fail = errors.New("cannot create the Project folder: permission denied")
	backend.statusErr = service.ErrNoProject

	m = drive(t, m, press("enter"))

	out := screen(m)
	for _, want := range []string{"● Review", "cannot create the Project folder: permission denied", "Homarr", "ntfy", "show ntfy in Homarr"} {
		if !strings.Contains(out, want) {
			t.Fatalf("an early failure should return to Review showing %q\n%s", want, out)
		}
	}

	backend.fail, backend.statusErr = nil, nil
	m = drive(t, m, press("enter"))

	got := backend.installs()
	if len(got) != 2 || got[1].AdminPassword != "hunter2-long" || strings.Join(got[1].Targets, ",") != "homarr,ntfy" {
		t.Fatalf("approving again should install the same answers, installs %+v", got)
	}
	if m.surface != surfaceActivity || strings.Contains(screen(m), "● Review") {
		t.Fatalf("the second approval should hand over again\n%s", screen(m))
	}
}

func TestLateFailureStaysOnTheDashboard(t *testing.T) {
	m, backend := freshHost(t)
	m = toReview(t, m)
	backend.fail = errors.New("homarr did not become healthy")

	m = drive(t, m, press("enter"))

	out := screen(m)
	if m.surface != surfaceActivity || strings.Contains(out, "● Review") || !strings.Contains(out, "homarr did not become healthy") {
		t.Fatalf("a failure once the Project exists should stay on Activity\n%s", out)
	}
}

func TestIncompleteInstallLandsOnTheDashboardWithAttention(t *testing.T) {
	for _, err := range []error{service.ErrIncomplete, service.ErrManual} {
		m, backend := freshHost(t)
		m = toReview(t, m)
		backend.fail = err

		m = drive(t, m, press("enter"))

		if m.surface != surfaceActivity || strings.Contains(screen(m), "● Review") || m.flashLevel != levelWarn {
			t.Fatalf("%v should land on the Dashboard with attention, flash %q\n%s", err, m.flash, screen(m))
		}
	}
}

func TestOnboardingAsksForMediaFoldersOnlyWhenNeeded(t *testing.T) {
	m, _ := freshHost(t)
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("x")) // Jellyfin, right after the pre-selected Homarr
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter")) // Jellyfin's server name
	for range 5 {
		m = drive(t, m, press("enter"))
	}

	if !strings.Contains(screen(m), "Media folder") {
		t.Fatalf("media folders not asked\n%s", screen(m))
	}
}

func TestCancellingTheFormWritesNothing(t *testing.T) {
	m, backend := freshHost(t)
	m = drive(t, m, press("enter"))

	m = drive(t, m, ctrlC())

	if len(backend.Actions()) != 0 || !strings.Contains(indicator(t, m), "● Welcome") {
		t.Fatalf("cancel should return to the welcome step without installing\n%s", screen(m))
	}
}

// walkOnboarding shows every Onboarding screen at the given size to see,
// in order, as the person reaches it.
func walkOnboarding(t *testing.T, width, height int, see func(name string, m Model)) {
	t.Helper()
	see("loading", update(t, New(&fakeBackend{}, Options{Version: "1.0.0"}), windowSize(width, height)))
	m, _ := onboardingHost(t, width, height, readyChecks...)
	m = frames(t, m, 60)
	see("Initializing", m)
	m = drive(t, m, press("enter"))
	see("Welcome", m)
	m = drive(t, m, press("enter"))
	see("What", m)
	m = drive(t, m, press("enter"))
	see("Where", m)
	for range 5 {
		m = drive(t, m, press("enter"))
	}
	see("Who", m)
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter"))
	see("Look", m)
	see("Review", drive(t, m, press("enter")))
}

func TestGoldenOnboarding(t *testing.T) {
	warning := host.Check{ID: "docker-userns", Title: "Container IDs", Level: host.Warn,
		Detail: "Docker user namespace could not be determined: docker info timed out",
		Hint:   "Inspect docker info before choosing PUID/PGID for bind-mounted folders.",
		Docs:   "https://docs.docker.com/engine/security/rootless/"}
	checks := append(readyChecks[:3:3], warning)
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		t.Run("loading"+size.suffix, func(t *testing.T) {
			m := New(&fakeBackend{}, Options{Version: "1.0.0"})
			m = update(t, m, windowSize(size.width, size.height))
			golden(t, "onboarding-loading"+size.suffix, trimLines(screen(m)))
		})
		t.Run("initializing"+size.suffix, func(t *testing.T) {
			m, _ := onboardingHost(t, size.width, size.height, checks...)
			golden(t, "onboarding-initializing-reveal"+size.suffix, trimLines(screen(frames(t, m, 14))))
			golden(t, "onboarding-initializing-done"+size.suffix, trimLines(screen(frames(t, m, 60))))
		})
		t.Run("welcome-review"+size.suffix, func(t *testing.T) {
			m, _ := onboardingHost(t, size.width, size.height, checks...)
			m = drive(t, frames(t, m, 60), press("enter"))
			golden(t, "onboarding-welcome"+size.suffix, trimLines(screen(m)))
			golden(t, "onboarding-review"+size.suffix, trimLines(screen(toReview(t, m))))
		})
	}
}
