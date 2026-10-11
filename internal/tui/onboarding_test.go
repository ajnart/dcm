package tui

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/activity"
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
	return m, backend
}

func frames(t *testing.T, m Model, n int) Model {
	t.Helper()
	for range n {
		m = update(t, m, frameMsg{})
	}
	return m
}

// typeText types into the focused input; a typed character needs no
// follow-up message, so the cursor blink it asks for is not waited for.
func typeText(t *testing.T, m Model, text string) Model {
	for _, r := range text {
		m = update(t, m, press(string(r)))
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
	for range 4 {                   // LAN IP, TZ, PUID, PGID keep their defaults
		m = drive(t, m, press("enter"))
	}
	m = drive(t, m, press("enter")) // Access: Home network
	m = drive(t, m, press("enter")) // admin user: admin
	m = typeText(t, m, "hunter2-long")
	m = drive(t, m, press("enter")) // Who -> Look
	return drive(t, m, press("enter"))
}

// atStep opens a step from Welcome with the defaults: Homarr only, the
// detected settings and a generated password.
func atStep(t *testing.T, m Model, name string) Model {
	t.Helper()
	m = drive(t, m, press("enter")) // Welcome -> What
	for _, next := range []struct {
		step   string
		enters int
	}{{"What", 1}, {"Where", 4}, {"Access", 1}, {"Who", 2}, {"Look", 1}} {
		if name == next.step {
			return m
		}
		for range next.enters {
			m = drive(t, m, press("enter"))
		}
	}
	return m
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

	m = frames(t, m, 12)
	out = screen(m)
	for _, want := range []string{"✓ Docker daemon", "✓ Docker Compose", "This machine is ready"} {
		if !strings.Contains(out, want) {
			t.Fatalf("after the reveal the screen lacks %q\n%s", want, out)
		}
	}
	m = frames(t, m, 6)
	if _, cmd := m.Update(frameMsg{}); yieldsFrame(cmd) {
		t.Fatal("frames must stop once the checks have continued to Welcome")
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

	if !strings.Contains(indicator(t, m), "● Welcome") {
		t.Fatalf("a clean recheck should automatically continue\n%s", screen(m))
	}
}

func TestWarningDoesNotBlock(t *testing.T) {
	m, _ := onboardingHost(t, 120, 30, append(readyChecks[:3:3],
		host.Check{ID: "docker-userns", Title: "Container IDs", Level: host.Warn, Detail: "user namespace unknown", Hint: "Inspect docker info."})...)
	m = frames(t, m, 24)
	if out := screen(m); !strings.Contains(out, "! Container IDs") || !strings.Contains(out, "→ Inspect docker info.") {
		t.Fatalf("the warning should show with its hint\n%s", out)
	}

	m = frames(t, m, 6)

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

func TestWelcomeAsksTheExperienceQuestionInPlainWords(t *testing.T) {
	m, _ := freshHost(t)

	out := screen(m)
	for _, want := range []string{"Have you run your own server or used Docker before, or is this all new to you?",
		"● New: this is all new to me", "○ Advanced: I have run a server or used Docker"} {
		if !strings.Contains(flat(out), want) {
			t.Fatalf("Welcome lacks %q\n%s", want, out)
		}
	}
}

func TestSkippingTheExperienceQuestionStoresNewAtApproval(t *testing.T) {
	m, backend := freshHost(t)
	m = toReview(t, m)

	if got := backend.savedExperiences(); len(got) != 0 {
		t.Fatalf("nothing is saved before approval, saved %v", got)
	}
	m = drive(t, m, press("enter"))

	if got := backend.savedExperiences(); len(got) != 1 || got[0] != "new" {
		t.Fatalf("skipping should store new, saved %v", got)
	}
}

func TestChoosingAdvancedAtWelcomeStoresAdvancedAtApproval(t *testing.T) {
	m, backend := freshHost(t)
	m = drive(t, m, press("down"))
	m = drive(t, m, press("space"))
	if out := screen(m); !strings.Contains(out, "● Advanced: I have run a server or used Docker") || !strings.Contains(out, "○ New: this is all new to me") {
		t.Fatalf("down should highlight Advanced\n%s", out)
	}
	m = toReview(t, m)

	m = drive(t, m, press("enter"))

	if got := backend.savedExperiences(); len(got) != 1 || got[0] != "advanced" {
		t.Fatalf("saved %v, want [advanced]", got)
	}
}

func welcomeWithSavedExperience(t *testing.T, level string, width, height int) (Model, *fakeBackend) {
	t.Helper()
	backend := &fakeBackend{catalog: wizardCatalog(), checks: readyChecks, experience: level}
	m := New(backend, Options{Version: "1.0.0"})
	m = update(t, m, windowSize(width, height))
	m = drive(t, m, statusMsgFor(service.ErrNoProject))
	m = update(t, m, doctorMsg{checks: backend.checks})
	m = frames(t, m, 60)
	return m, backend
}

func TestWelcomeSkipsTheExperienceQuestionWhenTheProfileHoldsALevel(t *testing.T) {
	for _, level := range []string{"new", "advanced"} {
		m, _ := welcomeWithSavedExperience(t, level, 120, 40)

		out := screen(m)
		if !strings.Contains(out, "Welcome to self-host") || strings.Contains(out, "Have you run your own server") ||
			strings.Contains(out, "New: this is all new to me") || strings.Contains(out, "Advanced: I have run a server") {
			t.Fatalf("saved %s: Welcome should not ask the Experience question\n%s", level, out)
		}
	}
}

func TestWelcomeKeepsASavedExperienceLevelUntouched(t *testing.T) {
	m, backend := welcomeWithSavedExperience(t, "advanced", 120, 40)
	m = drive(t, m, press("up"))
	m = toReview(t, m)
	m = drive(t, m, press("enter"))

	if got := backend.savedExperiences(); len(got) != 0 {
		t.Fatalf("a saved level is never rewritten, saved %v", got)
	}
	if got := backend.Experience(context.Background()); got != "advanced" {
		t.Fatalf("experience = %q, want advanced", got)
	}
}

func TestWelcomeWithASavedProfileGolden(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		m, _ := welcomeWithSavedExperience(t, "advanced", size.width, size.height)
		golden(t, "onboarding-welcome-saved-profile"+size.suffix, trimLines(screen(m)))
	}
}

func TestStepIndicatorFollowsEveryStep(t *testing.T) {
	m, _ := freshHost(t)
	steps := []string{"Initializing", "Welcome", "What", "Where", "Access", "Who", "Look", "Review"}
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
	for range 4 {
		m = drive(t, m, press("enter"))
	}
	want(4)
	m = drive(t, m, press("enter"))
	want(5)
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter"))
	want(6)
	m = drive(t, m, press("enter"))
	want(7)
}

func TestNarrowStepIndicatorKeepsTheCurrentStep(t *testing.T) {
	m, _ := onboardingHost(t, 60, 24, readyChecks...)

	for _, line := range strings.Split(screen(m), "\n") {
		if ansi.StringWidth(line) > 60 {
			t.Fatalf("line wider than 60 columns: %q", line)
		}
	}
	if !strings.Contains(screen(m), "● Initializing") || !strings.Contains(screen(m), "1 of 8") {
		t.Fatalf("a narrow indicator should still name the current step\n%s", screen(m))
	}
}

func TestEscGoesBackWithoutLosingAnswers(t *testing.T) {
	m, backend := freshHost(t)
	m = toReview(t, m)
	first := screen(m)

	for _, step := range []string{"● Look", "● Who", "● Access", "● Where", "● What", "● Welcome"} {
		m = drive(t, m, press("esc"))
		if !strings.Contains(indicator(t, m), step) {
			t.Fatalf("esc should go back to %s\n%s", step, screen(m))
		}
	}
	m = drive(t, m, press("enter")) // Welcome -> What
	m = drive(t, m, press("enter")) // the selection is kept
	for range 4 {
		m = drive(t, m, press("enter"))
	}
	m = drive(t, m, press("enter")) // Access: Home network is kept
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
		"Access", "Home network — addresses use 192.168.1.20", "Europe/Paris", "admin", "••••••••", "show ntfy in Homarr", "approve", "back"} {
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
	if m.preboot == nil {
		t.Fatalf("approving should show pre-boot first\n%s", screen(m))
	}
	m = drive(t, m, press("enter"))

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
	if m.preboot == nil || strings.Contains(screen(m), "Welcome") {
		t.Fatalf("a refresh before the Project exists must keep pre-boot\n%s", screen(m))
	}
	m = drive(t, m, press("enter"))
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
	m = drive(t, m, press("down"))
	m = drive(t, m, press("x")) // Jellyfin, right after the pre-selected Homarr
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter")) // Jellyfin's server name
	for range 4 {
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
func walkOnboarding(t *testing.T, width, height int, glyphs activity.Glyphs, see func(name string, m Model)) {
	t.Helper()
	loading := update(t, New(&fakeBackend{}, Options{Version: "1.0.0"}), windowSize(width, height))
	see("loading", update(t, loading, appearanceMsg{glyphs: glyphs}))
	m, _ := onboardingHost(t, width, height, readyChecks...)
	m = update(t, m, appearanceMsg{glyphs: glyphs})
	m = frames(t, m, 18)
	see("Initializing", m)
	m = frames(t, m, 6)
	see("Welcome", m)
	m = drive(t, m, press("enter"))
	see("What", m)
	m = drive(t, m, press("enter"))
	see("Where", m)
	m = drive(t, m, press("enter"))
	see("Where host settings", m)
	for range 3 {
		m = drive(t, m, press("enter"))
	}
	for i, id := range []string{"home", "names", "tailscale", "cloudflare", "custom"} {
		suffix := " " + id
		if id == "home" {
			suffix = ""
		}
		if i > 0 {
			m = drive(t, m, press("down"))
		}
		see("Access"+suffix, m)
		m = drive(t, m, press("?"))
		see("Access"+suffix+" help", m)
		m = drive(t, m, press("?"))
	}
	m = drive(t, m, press("space"))
	see("Access Bring your own note", m)
	for range 4 {
		m = drive(t, m, press("up"))
	}
	m = drive(t, m, press("enter"))
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
			golden(t, "onboarding-initializing-done"+size.suffix, trimLines(screen(frames(t, m, 24))))
		})
		t.Run("steps"+size.suffix, func(t *testing.T) {
			walkOnboarding(t, size.width, size.height, activity.Simple, func(name string, m Model) {
				if slices.Contains([]string{"What", "Where", "Where host settings", "Who", "Look"}, name) || strings.HasPrefix(name, "Access") {
					golden(t, "onboarding-"+strings.ReplaceAll(strings.ToLower(name), " ", "-")+size.suffix, trimLines(screen(m)))
				}
			})
		})
		t.Run("welcome-review"+size.suffix, func(t *testing.T) {
			m, _ := onboardingHost(t, size.width, size.height, checks...)
			m = frames(t, m, 60)
			golden(t, "onboarding-welcome"+size.suffix, trimLines(screen(m)))
			golden(t, "onboarding-review"+size.suffix, trimLines(screen(toReview(t, m))))
		})
	}
}

func TestOnboardingDrawsTheBrandThroughTheGlyphSet(t *testing.T) {
	for _, set := range []activity.Glyphs{activity.Simple, activity.NerdFont} {
		walkOnboarding(t, 120, 30, set, func(name string, m Model) {
			if name != "loading" && name != "Welcome" {
				return
			}
			lines := strings.Split(screen(m), "\n")
			body := strings.Join(lines[1:], "\n")
			if !strings.Contains(lines[0], set.Brand()) || !strings.Contains(body, "self-host") && name == "loading" ||
				name == "loading" && !strings.Contains(body, set.Brand()) {
				t.Fatalf("%s at %s should draw the brand %q\n%s", set, name, set.Brand(), screen(m))
			}
		})
	}
	if activity.Simple.Brand() == activity.NerdFont.Brand() {
		t.Fatal("the two glyph sets should draw different brands")
	}
}

func onlyApps(apps ...stubApp) *catalog.Catalog {
	list := make([]app.App, len(apps))
	for i, a := range apps {
		list[i] = a
	}
	return catalog.New(list, nil)
}

func TestWhatExplainsItselfAndShowsTheHoveredDescription(t *testing.T) {
	m, _ := freshHost(t)

	m = atStep(t, m, "What")

	out := screen(m)
	for _, want := range []string{"Pick the Apps you want to run", "Recipe", "add more later", "Homarr", "Watch your movies"} {
		if !strings.Contains(out, want) {
			t.Fatalf("What lacks %q\n%s", want, out)
		}
	}
	if strings.Contains(out, "Media server") {
		t.Fatalf("only the hovered item's description shows\n%s", out)
	}

	m = drive(t, m, press("down"))
	m = drive(t, m, press("down"))

	out = screen(m)
	if !strings.Contains(out, "Media server") || strings.Contains(out, "Dashboard") {
		t.Fatalf("the description should follow the highlight\n%s", out)
	}
	m = drive(t, m, press("up"))
	m = drive(t, m, press("up"))
	if out := screen(m); !strings.Contains(out, "Watch your movies") || !strings.Contains(out, "Jellyfin") {
		t.Fatalf("a Recipe shows its description and its Apps\n%s", out)
	}
}

func TestWhatWrapsALongDescriptionAtWordBoundaries(t *testing.T) {
	long := "A self-hosted media server that streams your movies, shows, music and photos to every device in the house, " +
		"with transcoding, subtitles, watch history for each person and a mobile app for travelling."
	m, backend := onboardingHost(t, 80, 24, readyChecks...)
	backend.catalog = onlyApps(stubApp{info: app.Info{ID: "homarr", Name: "Homarr", Description: long, Image: "x", Port: 1}})
	m = frames(t, m, 60)
	m = atStep(t, m, "What")

	out := screen(m)
	for _, word := range strings.Fields(long)[:24] {
		if !strings.Contains(out, word) {
			t.Fatalf("the description lost or cut the word %q\n%s", word, out)
		}
	}
	for _, line := range strings.Split(out, "\n") {
		if ansi.StringWidth(line) > 80 {
			t.Fatalf("line wider than 80 columns: %q", line)
		}
	}
}

func TestWhatAsksOnlyTheChosenAppsInputs(t *testing.T) {
	m, _ := freshHost(t)
	m = atStep(t, m, "What")

	m = drive(t, m, press("enter"))

	if out := screen(m); strings.Contains(out, "Server name") || !strings.Contains(out, "● Where") {
		t.Fatalf("Homarr needs no inputs, so What should lead straight to Where\n%s", out)
	}

	m = drive(t, m, press("esc"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("x")) // Jellyfin
	m = drive(t, m, press("enter"))

	out := screen(m)
	if !strings.Contains(out, "Server name") || !strings.Contains(out, "Jellyfin") || !strings.Contains(out, "● What") {
		t.Fatalf("a chosen App's inputs follow What\n%s", out)
	}
}

// flat is the screen with every run of whitespace as one space, so a
// sentence wrapped over several lines can be looked for whole.
func flat(s string) string { return strings.Join(strings.Fields(s), " ") }

const (
	lanExplanation   = "Phones, TVs and laptops on the same Wi-Fi or router as this computer can open your Apps at 192.168.1.20. Nobody on the internet can."
	localExplanation = "Your Apps open only in a browser on this computer. Other devices can't reach them."
)

// atAccess is the Access step with Home network highlighted.
func atAccess(t *testing.T, m Model) Model {
	t.Helper()
	return atStep(t, m, "Access")
}

func TestWhereAsksForTheHostSettingsAndNotWhoCanOpenTheApps(t *testing.T) {
	m, _ := freshHost(t)

	m = atStep(t, m, "Where")

	out := screen(m)
	for _, want := range []string{"LAN address", "Time zone", "User ID (PUID)", "Group ID (PGID)", "Detected from this machine"} {
		if !strings.Contains(out, want) {
			t.Fatalf("Where lacks %q\n%s", want, out)
		}
	}
	for _, gone := range []string{"Which devices can open your Apps?", "Only this computer", "Other devices on your network"} {
		if strings.Contains(out, gone) {
			t.Fatalf("Where no longer asks %q\n%s", gone, out)
		}
	}
}

func TestTheAccessStepListsTheSixOptionsIncludingComputerOnly(t *testing.T) {
	m, _ := freshHost(t)

	m = atAccess(t, m)

	out := screen(m)
	if !strings.Contains(out, "How you'll open your Apps") || !strings.Contains(indicator(t, m), "● Access") {
		t.Fatalf("the step is called Access and asks how you'll open your Apps\n%s", out)
	}
	last := -1
	for _, want := range []string{"● Home network (default)", "○ Easy names at home", "○ From anywhere, privately",
		"○ Your own web address", "○ Bring your own", "○ This computer only"} {
		at := strings.Index(out, want)
		if at <= last {
			t.Fatalf("%q should follow the options before it\n%s", want, out)
		}
		last = at
	}
}

func TestTheAccessStepExplainsHomeNetworkWithTheDetectedLANAddressAndItsDiagram(t *testing.T) {
	m, _ := freshHost(t)

	m = atAccess(t, m)

	out := screen(m)
	if !strings.Contains(flat(out), lanExplanation) || !strings.Contains(out, "phones · TVs · laptops ──── router ──── this computer 192.168.1.20") ||
		!strings.Contains(out, "internet ✗") {
		t.Fatalf("the highlighted option shows its explanation and its diagram\n%s", out)
	}
	if strings.Contains(out, "0.0.0.0") || strings.Contains(out, "127.0.0.1") {
		t.Fatalf("the live explanation is plain words, with no bind address\n%s", out)
	}
}

func TestMovingTheAccessHighlightShowsEachOptionsExplanationAndDiagram(t *testing.T) {
	const stays = "It isn't available yet: your Apps stay on your network."
	for _, tc := range []struct {
		downs          int
		words, diagram string
	}{
		{1, "Open each App by name instead of a port number.", "phones · TVs · laptops ──── router ──── Caddy · App name"},
		{2, "Tailscale lets you open each App with its own private HTTPS name", "your phone, anywhere ──── Tailscale ──── this computer private name"},
		{3, "Your own web address, like movies.example.com, opens your chosen Apps from anywhere through Cloudflare Tunnel", "anyone with the address ──── Cloudflare ──── this computer no open port"},
		{4, "Already run your own reverse proxy, such as SWAG, Pangolin, Nginx Proxy Manager, Traefik or Caddy?", "your devices ──── your proxy ──── this computer IP:port"},
	} {
		m, _ := freshHost(t)
		m = atAccess(t, m)
		for range tc.downs {
			m = drive(t, m, press("down"))
		}

		out := screen(m)

		if !strings.Contains(flat(out), tc.words) || accessOptions[tc.downs].soon != strings.Contains(flat(out), stays) || !strings.Contains(out, tc.diagram) {
			t.Fatalf("option %d shows its words, whether it isn't available yet and its diagram\n%s", tc.downs, out)
		}
		if strings.Contains(flat(out), "can open your Apps at 192.168.1.20") {
			t.Fatalf("option %d must not show Home network's explanation\n%s", tc.downs, out)
		}
	}
}

func TestTheAccessStepNamesTheLANAddressChosenAtWhere(t *testing.T) {
	m, _ := freshHost(t)
	m = atStep(t, m, "Where")
	for range len("192.168.1.20") {
		m = drive(t, m, press("backspace"))
	}
	m = typeText(t, m, "10.0.0.7")
	for range 4 {
		m = drive(t, m, press("enter"))
	}

	out := screen(m)

	if m.onboarding.step != stepAccess || !strings.Contains(flat(out), "can open your Apps at 10.0.0.7. Nobody") || strings.Contains(out, "192.168.1.20") {
		t.Fatalf("the explanation names the address that will be used\n%s", out)
	}
}

func TestEnterOnHomeNetworkMovesOnAndKeepsTheStoredValue(t *testing.T) {
	m, _ := freshHost(t)
	m = atAccess(t, m)

	m = drive(t, m, press("enter"))

	if m.onboarding.step != stepWho || m.onboarding.answers.exposure != service.ExposureLAN {
		t.Fatalf("enter on Home network moves on, step %v exposure %q", m.onboarding.step, m.onboarding.answers.exposure)
	}
}

func TestChoosingAnOptionNotBuiltYetChangesNothing(t *testing.T) {
	original := accessOptions
	accessOptions = slices.Clone(original)
	accessOptions[3].soon = true
	defer func() { accessOptions = original }()
	for downs, name := range map[int]string{3: "Your own web address"} {
		m, backend := freshHost(t)
		m = atAccess(t, m)
		for range downs {
			m = drive(t, m, press("down"))
		}

		m = drive(t, m, press("space"))

		if m.onboarding.step != stepAccess || m.onboarding.answers.exposure != service.ExposureLAN {
			t.Fatalf("%s: Space stays on Access with Home network, step %v exposure %q", name, m.onboarding.step, m.onboarding.answers.exposure)
		}
		if note := flat(screen(m)); !strings.Contains(note, name+" is coming soon; your Apps stay on your network") {
			t.Fatalf("%s: Space says it is coming soon\n%s", name, screen(m))
		}
		if len(backend.Actions()) != 0 || len(backend.installs()) != 0 {
			t.Fatalf("%s: nothing is dispatched, actions %v", name, backend.Actions())
		}
		if out := screen(m); !strings.Contains(out, "● Home network (default)") {
			t.Fatalf("%s: Home network stays the selected option\n%s", name, out)
		}
	}
}

func TestChoosingBringYourOwnExplainsAndChangesNothing(t *testing.T) {
	m, backend := freshHost(t)
	m = atAccess(t, m)
	for range 4 {
		m = drive(t, m, press("down"))
	}

	m = drive(t, m, press("space"))

	if m.onboarding.step != stepAccess || m.onboarding.answers.exposure != service.ExposureLAN {
		t.Fatalf("Space stays on Access with Home network, step %v exposure %q", m.onboarding.step, m.onboarding.answers.exposure)
	}
	if note := flat(screen(m)); !strings.Contains(note, "Nothing changes: your Apps stay on your network. Run: self-host access export") {
		t.Fatalf("Space points at the command\n%s", screen(m))
	}
	if len(backend.Actions()) != 0 || len(backend.installs()) != 0 {
		t.Fatalf("nothing is dispatched, actions %v", backend.Actions())
	}
	if out := screen(m); !strings.Contains(out, "● Home network (default)") || strings.Contains(out, "coming soon;") {
		t.Fatalf("Home network stays the selected option and Bring your own is not coming soon\n%s", out)
	}
	m = drive(t, m, press("space"))
	if m.onboarding.step != stepAccess {
		t.Fatalf("still on Access, step %v", m.onboarding.step)
	}
}

func TestEscFromAccessGoesBackToWhereAndFromWhoBackToAccess(t *testing.T) {
	m, _ := freshHost(t)
	m = atStep(t, m, "Who")

	m = drive(t, m, press("esc"))
	if m.onboarding.step != stepAccess {
		t.Fatalf("esc from Who returns to Access, step %v", m.onboarding.step)
	}
	m = drive(t, m, press("esc"))
	if m.onboarding.step != stepWhere {
		t.Fatalf("esc from Access returns to Where, step %v", m.onboarding.step)
	}
}

func TestQuestionMarkOpensAndClosesTheHelpPageOfEveryOption(t *testing.T) {
	for downs, title := range []string{"Home network", "Easy names at home", "From anywhere, privately", "Your own web address", "Bring your own"} {
		m, _ := freshHost(t)
		m = atAccess(t, m)
		for range downs {
			m = drive(t, m, press("down"))
		}

		m = drive(t, m, press("?"))

		page := flat(screen(m))
		for _, want := range []string{title, "╭"} {
			if !strings.Contains(page, want) {
				t.Fatalf("%s: the help page lacks %q\n%s", title, want, screen(m))
			}
		}
		for range 20 {
			m = drive(t, m, press("down"))
		}
		if !strings.Contains(flat(screen(m)), "changed later in Settings, under Access") {
			t.Fatalf("help must say where to change Access\n%s", screen(m))
		}
		m = drive(t, m, press("enter"))
		if !m.showHelp || m.onboarding.step != stepAccess {
			t.Fatalf("%s: keys other than esc and ? must not leave the page or answer the step behind it\n%s", title, screen(m))
		}
		m = drive(t, m, press("esc"))
		if out := screen(m); strings.Contains(out, "changed later in Settings") || m.onboarding.step != stepAccess || m.onboarding.access != downs {
			t.Fatalf("%s: esc closes the page and stays on the option\n%s", title, out)
		}
		m = drive(t, m, press("?"))
		m = drive(t, m, press("?"))
		if strings.Contains(screen(m), "changed later in Settings") {
			t.Fatalf("%s: ? closes the page too\n%s", title, screen(m))
		}
	}
}

func TestTheHomeNetworkHelpPageEndsWithTechnicalDetails(t *testing.T) {
	m, _ := freshHost(t)
	m = atAccess(t, m)

	m = drive(t, m, press("?"))

	page := flat(screen(m))
	for _, want := range []string{"What is a LAN address?", "Nobody on the internet can open your Apps unless your router forwards ports",
		"firewall", "Technical details", "Apps are published on 0.0.0.0", "internet ✗"} {
		if !strings.Contains(page, want) {
			t.Fatalf("the help page lacks %q\n%s", want, screen(m))
		}
	}
}

func TestEveryWhereFieldExplainsItselfWhileFocused(t *testing.T) {
	m, _ := freshHost(t)
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("x")) // Jellyfin
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter")) // its server name
	fields := []struct{ name, explanation string }{
		{"LAN address", "App links use this address, so TVs and phones can open them."},
		{"Time zone", "The clock your Apps use for schedules and logs, for example Europe/Paris."},
		{"User ID", "The user ID that owns the files your Apps write, so you can open them."},
		{"Group ID", "The group ID that owns those files."},
		{"Media folder", "Where movies, shows and music live. The folder must exist or sit inside one that does."},
		{"Downloads folder", "Where downloads land before they move to media. The folder must exist or sit inside one that does."},
	}

	for i, field := range fields {
		out := flat(screen(m))
		if !strings.Contains(out, field.explanation) {
			t.Fatalf("%s should explain itself while focused\n%s", field.name, screen(m))
		}
		for j, other := range fields {
			if j != i && strings.Contains(out, other.explanation) {
				t.Fatalf("%s is focused, but %s is explained too\n%s", field.name, other.name, screen(m))
			}
		}
		m = drive(t, m, press("enter"))
	}
}

func TestQuestionMarkTypesInTextInputsOfTheWizard(t *testing.T) {
	m, _ := freshHost(t)
	m = atStep(t, m, "Where")
	m = drive(t, m, press("?"))
	if got := m.onboarding.answers.lan; got != "192.168.1.20?" || m.showHelp {
		t.Fatalf("? in the LAN address types a question mark, LAN %q, help %v", got, m.showHelp)
	}
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("?"))
	if got := m.onboarding.answers.tz; !strings.HasSuffix(got, "?") || m.showHelp {
		t.Fatalf("? in the time zone types a question mark, TZ %q", got)
	}

	m, _ = freshHost(t)
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("x")) // Jellyfin
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter")) // its server name
	for range 4 {
		m = drive(t, m, press("enter"))
	}
	m = drive(t, m, press("?"))
	if got := m.onboarding.answers.media; got != "/home/alice/media?" || m.showHelp {
		t.Fatalf("? in the media folder types a question mark, folder %q", got)
	}
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("?"))
	if got := m.onboarding.answers.downloads; got != "/home/alice/downloads?" || m.showHelp {
		t.Fatalf("? in the downloads folder types a question mark, folder %q", got)
	}

	m, _ = freshHost(t)
	m = atStep(t, m, "Who")
	m = drive(t, m, press("enter")) // admin user
	m = drive(t, m, press("?"))
	if got := m.onboarding.answers.adminPassword; got != "?" || m.showHelp {
		t.Fatalf("? in the password types a question mark, password %q", got)
	}
}

func TestTheMoreChipShowsOnlyWhereQuestionMarkOpensAHelpPage(t *testing.T) {
	m, _ := freshHost(t)
	more := func(m Model) bool {
		return strings.Contains(strings.Join(strings.Fields(lastLine(screen(m))), " "), "? more")
	}

	m = atStep(t, m, "Where")
	for _, field := range []string{"LAN address", "Time zone", "User ID", "Group ID"} {
		if more(m) {
			t.Fatalf("%s is a text input, so no ? more\n%s", field, lastLine(screen(m)))
		}
		m = drive(t, m, press("enter"))
	}
	if !more(m) {
		t.Fatalf("the Access step offers ? more\n%s", lastLine(screen(m)))
	}
	m = drive(t, m, press("enter")) // Who
	m = drive(t, m, press("enter"))
	if more(m) {
		t.Fatalf("Who has no help page, so no ? more\n%s", lastLine(screen(m)))
	}
}

func TestTheAccessStepAndItsHelpPageFitEightyByTwentyFourAndNothingIsCut(t *testing.T) {
	m, _ := onboardingHost(t, 80, 24, readyChecks...)
	m = frames(t, m, 60)
	m = atAccess(t, m)
	if lines := strings.Split(screen(m), "\n"); len(lines) > 24 || !strings.Contains(flat(screen(m)), "internet ✗") || !strings.Contains(flat(lines[23]), "? more") {
		t.Fatalf("the Access step with its explanation and diagram fits 80x24 with its bar, %d lines\n%s", len(lines), screen(m))
	}

	m = drive(t, m, press("?"))
	if lines := strings.Split(screen(m), "\n"); len(lines) > 24 {
		t.Fatalf("the help page fits 80x24, %d lines\n%s", len(lines), screen(m))
	}
	for range 10 {
		m = drive(t, m, pgdownKey())
	}
	if out := flat(screen(m)); !strings.Contains(out, "The LAN address only builds links.") {
		t.Fatalf("scrolling reaches the technical details at the end of the help page\n%s", screen(m))
	}
}

func TestWhereFoldersFitTheScreenAtEightyByTwentyFour(t *testing.T) {
	m, _ := onboardingHost(t, 80, 24, readyChecks...)
	m = frames(t, m, 60)
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("x")) // Jellyfin
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter")) // its server name
	for range 4 {
		m = drive(t, m, press("enter"))
	}

	out := screen(m)
	for _, want := range []string{"Media folder", "Downloads folder", "/home/alice/downloads"} {
		if !strings.Contains(out, want) {
			t.Fatalf("the Folders page lacks %q at 80x24\n%s", want, out)
		}
	}
}

func TestRecipeIconFollowsTheGlyphSetInTheCatalogAndOnboarding(t *testing.T) {
	for _, set := range []activity.Glyphs{activity.Simple, activity.NerdFont} {
		m := withGlyphs(t, goldenModel(t, 120, 30), set)
		catalog := screen(drive(t, m, press("4")))
		if !strings.Contains(catalog, set.Recipe()+" Media") || strings.Contains(catalog, "📦") {
			t.Errorf("%s: the Catalog should mark the Recipe with %q\n%s", set, set.Recipe(), catalog)
		}

		o, _ := onboardingHost(t, 120, 30, readyChecks...)
		o = withGlyphs(t, o, set)
		o = frames(t, o, 60)
		what := screen(drive(t, o, press("enter")))
		if !strings.Contains(what, set.Recipe()+" Media (Recipe)") || strings.Contains(what, "📦") {
			t.Errorf("%s: What should mark the Recipe with %q\n%s", set, set.Recipe(), what)
		}
	}
}

func TestWhereAsksForFoldersOnlyWhenAMediaAppIsChosen(t *testing.T) {
	m, _ := freshHost(t)
	m = atStep(t, m, "Where")
	for range 4 {
		if strings.Contains(screen(m), "Media folder") {
			t.Fatalf("Homarr needs no media folder\n%s", screen(m))
		}
		m = drive(t, m, press("enter"))
	}

	m, _ = freshHost(t)
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("x")) // Jellyfin
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter")) // its server name
	for range 4 {
		m = drive(t, m, press("enter"))
	}
	out := screen(m)
	for _, want := range []string{"Media folder", "Downloads folder", "Jellyfin", "/home/alice/media"} {
		if !strings.Contains(out, want) {
			t.Fatalf("a media App should bring its folders with %q\n%s", want, out)
		}
	}
}

func TestWhoExplainsTheSharedLoginAndMasksThePassword(t *testing.T) {
	m, _ := freshHost(t)

	m = atStep(t, m, "Who")

	out := screen(m)
	for _, want := range []string{"One Admin login signs in to every App", "self-host credentials", "never shown"} {
		if !strings.Contains(out, want) {
			t.Fatalf("Who lacks %q\n%s", want, out)
		}
	}
	m = drive(t, m, press("enter"))
	m = typeText(t, m, "hunter2-long")
	if out := screen(m); strings.Contains(out, "hunter2-long") || !strings.Contains(out, "••••") && !strings.Contains(out, "****") {
		t.Fatalf("the password must be masked as it is typed\n%s", out)
	}
}

func TestLookShowsTheSelectedSampleTheQuestionAndTheLink(t *testing.T) {
	m, _ := freshHost(t)

	m = atStep(t, m, "Look")

	out := screen(m)
	for _, want := range []string{"◆ self-host", "▣ Docker", "Choose your symbols; the sample shows your selection.",
		"Nerd Font", "Simple", "https://www.nerdfonts.com"} {
		if !strings.Contains(out, want) {
			t.Fatalf("Look lacks %q\n%s", want, out)
		}
	}
	if !strings.Contains(m.View().Content, "\x1b]8;;https://www.nerdfonts.com") {
		t.Fatal("the Nerd Fonts address should be a terminal link")
	}
}

func TestChoosingNerdFontDrawsReviewWithItAndSavesAtApproval(t *testing.T) {
	m, backend := freshHost(t)
	m = atStep(t, m, "Look")

	m = drive(t, m, press("up"))
	m = drive(t, m, press("space"))
	m = drive(t, m, press("enter"))

	if !strings.Contains(indicator(t, m), "● Review") || !strings.Contains(strings.Split(screen(m), "\n")[0], activity.NerdFont.Brand()) {
		t.Fatalf("Review should draw with the chosen icons\n%s", screen(m))
	}
	if len(backend.savedGlyphs()) != 0 || len(backend.installs()) != 0 {
		t.Fatal("nothing is saved or installed before approval")
	}

	m = drive(t, m, press("enter"))

	if got := backend.savedGlyphs(); len(got) != 1 || got[0] != activity.NerdFont {
		t.Fatalf("approving should save the choice, saved %v", got)
	}
	if len(backend.installs()) != 1 || m.surface != surfaceActivity {
		t.Fatalf("approving should still install and hand over, installs %v", backend.installs())
	}
}

func TestEscBackToLookKeepsTheChoice(t *testing.T) {
	m, _ := freshHost(t)
	m = atStep(t, m, "Look")
	m = drive(t, m, press("up"))
	m = drive(t, m, press("space"))
	m = drive(t, m, press("enter"))

	m = drive(t, m, press("esc"))

	out := screen(m)
	if !strings.Contains(indicator(t, m), "● Look") || !strings.Contains(out, "> ● Nerd Font") {
		t.Fatalf("going back should keep the chosen icons highlighted\n%s", out)
	}
}

func TestFailingToSaveTheChoiceOnlyFlashesAWarning(t *testing.T) {
	m, backend := freshHost(t)
	backend.glyphErr = errors.New("read-only file system")
	m = atStep(t, m, "Look")
	m = drive(t, m, press("up"))
	m = drive(t, m, press("space"))
	m = drive(t, m, press("enter"))

	m = drive(t, m, press("enter"))

	if len(backend.installs()) != 1 || m.surface != surfaceActivity {
		t.Fatalf("a failed save must not block the install, installs %v", backend.installs())
	}
	if !strings.Contains(m.flash, "icons") || !strings.Contains(m.flash, "read-only file system") {
		t.Fatalf("a failed save should flash, flash %q", m.flash)
	}
}

func TestEveryStepShowsItsKeysInTheBar(t *testing.T) {
	want := map[string]string{"What": "enter next", "Where": "enter next", "Access": "enter continue", "Who": "enter next", "Look": "enter continue", "Review": "enter approve"}
	walkOnboarding(t, 80, 24, activity.Simple, func(name string, m Model) {
		chips, ok := want[name]
		if !ok {
			return
		}
		lines := strings.Split(screen(m), "\n")
		bar := strings.Join(strings.Fields(lines[len(lines)-1]), " ")
		if !strings.Contains(bar, chips) || !strings.Contains(bar, "esc back") {
			t.Fatalf("%s bar lacks %q and esc back: %q", name, chips, bar)
		}
	})
}

func TestWhatScrollsAFortyAppListAndKeepsTheDescriptionOnScreen(t *testing.T) {
	var apps []stubApp
	for i := range 40 {
		apps = append(apps, stubApp{info: app.Info{ID: fmt.Sprintf("app%02d", i), Name: fmt.Sprintf("App %02d", i), Description: fmt.Sprintf("Description of app %02d.", i)}})
	}
	m, backend := onboardingHost(t, 80, 24, readyChecks...)
	backend.catalog = onlyApps(apps...)
	m = frames(t, m, 60)
	m = atStep(t, m, "What")

	for range 39 {
		m = drive(t, m, press("down"))
	}

	out := screen(m)
	for _, want := range []string{"App 39", "Description of app 39.", "enter  next"} {
		if !strings.Contains(out, want) {
			t.Fatalf("the last of forty Apps should show %q\n%s", want, out)
		}
	}
}

func TestResizingKeepsTheFormInsideTheWindow(t *testing.T) {
	m, _ := freshHost(t)
	m = atStep(t, m, "Where")
	m = drive(t, m, press("enter"))

	m = update(t, m, windowSize(80, 24))

	for _, line := range strings.Split(screen(m), "\n") {
		if ansi.StringWidth(line) > 80 {
			t.Fatalf("line wider than 80 columns after the resize: %q", line)
		}
	}
}
