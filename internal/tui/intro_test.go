package tui

import (
	"image/color"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/intro"
	"github.com/ajnart/self-host/internal/service"
)

var (
	warnedChecks = append(readyChecks[:3:3], host.Check{ID: "docker-userns", Title: "Container IDs", Level: host.Warn,
		Detail: "user namespace unknown", Hint: "Inspect docker info."})
	failedChecks = []host.Check{
		{ID: "docker", Title: "Docker", Level: host.OK, Detail: "docker command found"},
		{ID: "docker-socket", Title: "Docker daemon", Level: host.Fail, Detail: "cannot connect", Hint: "Start Docker."},
	}
)

func introModel(t *testing.T, opts Options, checks ...host.Check) (Model, *fakeBackend) {
	t.Helper()
	backend := &fakeBackend{catalog: wizardCatalog(), checks: checks}
	return introModelWith(t, backend, opts), backend
}

func introModelWith(t *testing.T, backend *fakeBackend, opts Options) Model {
	t.Helper()
	opts.Version = "1.0.0"
	m := New(backend, opts)
	m = update(t, m, windowSize(120, 40))
	m = update(t, m, tea.BackgroundColorMsg{Color: color.Black})
	return drive(t, m, statusMsgFor(service.ErrNoProject))
}

func onWelcome(m Model) bool { return m.onboarding.intro == nil }

func TestFreshHostOpensOnTheIntroWithoutChrome(t *testing.T) {
	m, _ := introModel(t, Options{})
	out := screen(m)
	if m.onboarding.intro == nil || m.onboarding.step != stepWelcome {
		t.Fatal("a fresh host opens Onboarding on the Intro")
	}
	if !strings.Contains(out, "Checking this machine…") || strings.Contains(out, "● Welcome") || strings.Contains(out, "v1.0.0") || strings.Contains(out, "q quit") && strings.Contains(out, "enter  continue") {
		t.Fatalf("the Intro is full screen with the Doctor line\n%s", out)
	}
	if got := len(strings.Split(out, "\n")); got != 40 {
		t.Fatalf("the Intro draws %d rows, want 40", got)
	}
}

func TestIntroNeverShowsForAProject(t *testing.T) {
	m, _ := sample(t, 120, 40)
	if m.onboarding != nil {
		t.Fatal("the Dashboard opens without Onboarding")
	}
}

func TestIntroWaitsForTheBackgroundColourBeforeItsFirstFrame(t *testing.T) {
	backend := &fakeBackend{catalog: wizardCatalog()}
	m := update(t, New(backend, Options{}), windowSize(120, 40))
	m = drive(t, m, statusMsgFor(service.ErrNoProject))
	if strings.TrimSpace(screen(m)) != "" {
		t.Fatalf("nothing is drawn before the background colour\n%s", screen(m))
	}
	m = update(t, m, lightBackground())
	if m.theme.dark || strings.TrimSpace(screen(m)) == "" {
		t.Fatal("the first frame draws with the light palette")
	}
	late := update(t, update(t, New(backend, Options{}), windowSize(120, 40)), statusMsgFor(service.ErrNoProject))
	late = frames(t, late, introBackgroundWait+1)
	if strings.TrimSpace(screen(late)) == "" {
		t.Fatal("a terminal that never answers must not hold the Intro")
	}
}

func TestIntroReadsThenTicksChecksThenReachesWelcome(t *testing.T) {
	m, _ := introModel(t, Options{}, readyChecks...)
	m = frames(t, m, 10)
	if out := screen(m); !strings.Contains(out, "Checking this machine…") {
		t.Fatalf("reading\n%s", out)
	}
	m = update(t, m, doctorMsg{checks: readyChecks})
	m = frames(t, m, 11)
	if out := screen(m); !strings.Contains(out, "✓ Docker  docker command found") {
		t.Fatalf("the first check ticks into the line\n%s", out)
	}
	m = frames(t, m, introFrames)
	if !onWelcome(m) || !strings.Contains(screen(m), "Welcome to self-host") {
		t.Fatalf("a ready machine reaches Welcome\n%s", screen(m))
	}
}

func TestIntroWaitsForHostSettings(t *testing.T) {
	m, _ := introModel(t, Options{}, readyChecks...)
	m.defaults = nil
	m = update(t, m, doctorMsg{checks: readyChecks})
	m = frames(t, m, introFrames)
	if onWelcome(m) || !strings.Contains(screen(m), "Reading this machine's settings…") {
		t.Fatalf("Doctor alone cannot continue without the settings\n%s", screen(m))
	}
	m = update(t, m, defaultsMsg{settings: map[string]string{"LAN_IP": "192.168.1.20"}})
	m = frames(t, m, introFrames)
	if !onWelcome(m) {
		t.Fatal("late settings release the Intro")
	}
}

func TestFirstKeySettlesAndSecondKeyCuts(t *testing.T) {
	m, backend := introModel(t, Options{}, readyChecks...)
	m = update(t, m, doctorMsg{checks: readyChecks})
	m = frames(t, m, 3)
	m = drive(t, m, press("x"))
	if m.onboarding.intro == nil || !intro.Settled(m.onboarding.intro.frame) || !m.onboarding.introSkipped {
		t.Fatal("the first key settles the scene and marks the skip")
	}
	m = drive(t, m, press("x"))
	if m.onboarding.intro == nil {
		t.Fatal("a key before the checks are done never skips them")
	}
	m = frames(t, m, intro.TickFromFrame+3*intro.BeatFrames+1)
	m = drive(t, m, press("x"))
	if !onWelcome(m) {
		t.Fatalf("a key once settled and ready cuts to Welcome\n%s", screen(m))
	}
	m = toReview(t, m)
	drive(t, m, press("enter"))
	if got := backend.reportedOnboarding(); len(got) != 1 || !got[0].IntroSkipped {
		t.Fatalf("the onboarding event must say the Intro was skipped: %+v", got)
	}
}

func TestAKeyDuringTheExitCutsToWelcome(t *testing.T) {
	m, _ := introModel(t, Options{}, readyChecks...)
	m = update(t, m, doctorMsg{checks: readyChecks})
	for m.onboarding.intro != nil && m.onboarding.intro.exit < 0 {
		m = update(t, m, frameMsg{})
	}
	m = update(t, m, frameMsg{})
	m = drive(t, m, press("x"))
	if !onWelcome(m) {
		t.Fatal("a key cuts the exit")
	}
}

func TestClickAndScrollSettleTheScene(t *testing.T) {
	for _, msg := range []tea.Msg{introPokeMsg{}, tea.MouseWheelMsg{Button: tea.MouseWheelDown}} {
		m, _ := introModel(t, Options{}, readyChecks...)
		m = drive(t, m, msg)
		if !intro.Settled(m.onboarding.intro.frame) || !m.onboarding.introSkipped {
			t.Fatalf("%T settles the scene", msg)
		}
	}
}

func TestWarningHoldsUntilEnter(t *testing.T) {
	m, _ := introModel(t, Options{}, warnedChecks...)
	m = update(t, m, doctorMsg{checks: warnedChecks})
	m = frames(t, m, 300)
	out := screen(m)
	for _, want := range []string{"! Container IDs", "→ Inspect docker info.", "enter continue · q quit"} {
		if !strings.Contains(out, want) {
			t.Fatalf("the held warning shows %q\n%s", want, out)
		}
	}
	if onWelcome(m) {
		t.Fatal("a warning holds the Intro")
	}
	if _, cmd := m.Update(frameMsg{}); yieldsFrame(cmd) {
		t.Fatal("a held warning needs no frames")
	}
	m = drive(t, m, press("x"))
	if onWelcome(m) {
		t.Fatal("only enter continues past a warning")
	}
	m = drive(t, m, press("enter"))
	m = frames(t, m, introFrames)
	if !onWelcome(m) || m.onboarding.introSkipped {
		t.Fatal("enter plays the exit to Welcome without marking a skip")
	}
}

func TestFailureHoldsRechecksAndRecovers(t *testing.T) {
	m, backend := introModel(t, Options{}, failedChecks...)
	m = update(t, m, doctorMsg{checks: failedChecks})
	m = frames(t, m, 300)
	out := screen(m)
	for _, want := range []string{"✗ Docker daemon", "→ Start Docker, then press r.", "Onboarding cannot continue while a check fails.", "r check again · q quit"} {
		if !strings.Contains(out, want) {
			t.Fatalf("the held failure shows %q\n%s", want, out)
		}
	}
	m = drive(t, m, press("enter"))
	if onWelcome(m) {
		t.Fatal("a failure never continues")
	}
	if _, cmd := m.Update(frameMsg{}); yieldsFrame(cmd) {
		t.Fatal("a held failure needs no frames")
	}

	m = update(t, m, press("r"))
	if !strings.Contains(screen(m), "Checking again…") {
		t.Fatalf("r checks again\n%s", screen(m))
	}
	m = update(t, m, doctorMsg{checks: failedChecks})
	m = frames(t, m, 150)
	if onWelcome(m) || !strings.Contains(screen(m), "✗ Docker daemon") {
		t.Fatal("a failing recheck keeps holding")
	}

	backend.checks, backend.statusErr = readyChecks, service.ErrNoProject
	next, cmd := m.Update(tea.FocusMsg{})
	m = next.(Model)
	if !strings.Contains(screen(m), "Checking again…") {
		t.Fatal("regaining focus checks again")
	}
	var sawDoctor bool
	for _, msg := range runCmd(cmd) {
		if _, ok := msg.(doctorMsg); ok {
			sawDoctor = true
		}
		m = update(t, m, msg)
	}
	if !sawDoctor {
		t.Fatal("focus reads Doctor")
	}
	m = frames(t, m, introFrames)
	if !onWelcome(m) {
		t.Fatalf("a passing recheck recovers and reaches Welcome\n%s", screen(m))
	}
}

func TestFocusDuringAnOrdinaryIntroDoesNotRecheck(t *testing.T) {
	m, _ := introModel(t, Options{}, readyChecks...)
	m = update(t, m, doctorMsg{checks: readyChecks})
	m = update(t, m, tea.FocusMsg{})
	if m.onboarding.intro.reading {
		t.Fatal("focus only rechecks a held failure")
	}
}

func TestReducedMotionShowsTheSettledFrameThenWelcomeWithoutExitOrReactions(t *testing.T) {
	m, _ := introModel(t, Options{ReducedMotion: true}, readyChecks...)
	if !intro.Settled(m.onboarding.intro.frame) {
		t.Fatal("the settled frame shows from the start")
	}
	before := screen(m)
	m = frames(t, m, 30)
	if screen(m) != before {
		t.Fatal("the settled frame is static while Doctor reads")
	}
	if _, cmd := m.Update(frameMsg{}); yieldsFrame(cmd) {
		t.Fatal("no frames while Doctor reads under reduced motion")
	}
	m = update(t, m, doctorMsg{checks: readyChecks})
	for range 20 {
		m = update(t, m, frameMsg{})
		if m.onboarding.intro != nil && m.onboarding.intro.exit >= 0 {
			t.Fatal("reduced motion plays no exit")
		}
	}
	if !onWelcome(m) {
		t.Fatalf("Welcome follows\n%s", screen(m))
	}
	next, cmd := m.Update(press("down"))
	m = next.(Model)
	if yieldsFrame(cmd) || m.onboarding.react.focusAge >= 0 {
		t.Fatal("reduced motion plays no reaction")
	}
}

func TestQuittingDuringTheIntroCancelsFrames(t *testing.T) {
	m, _ := introModel(t, Options{}, readyChecks...)
	next, cmd := m.Update(press("q"))
	m = next.(Model)
	if !m.quitting || m.frameContext.Err() == nil {
		t.Fatal("q quits and cancels the frame chain")
	}
	if cmd == nil {
		t.Fatal("q asks Bubble Tea to quit")
	}
	if _, cmd := m.Update(frameMsg{}); yieldsFrame(cmd) {
		t.Fatal("no frame after quitting")
	}
}

func TestFramesStopOnceTheIntroIsDone(t *testing.T) {
	m, _ := introModel(t, Options{}, readyChecks...)
	m = update(t, m, doctorMsg{checks: readyChecks})
	if _, cmd := m.Update(frameMsg{}); !yieldsFrame(cmd) {
		t.Fatal("the Intro ticks while it plays")
	}
	m = frames(t, m, introFrames)
	if _, cmd := m.Update(frameMsg{}); yieldsFrame(cmd) {
		t.Fatal("frames stop once Welcome shows")
	}
}

func TestTheNoticeShowsOnlyOnWelcome(t *testing.T) {
	m := introModelWith(t, &fakeBackend{catalog: wizardCatalog(), checks: readyChecks, telemetryNotice: noticeLines}, Options{})
	m = update(t, m, doctorMsg{checks: readyChecks})
	m = frames(t, m, 60)
	if strings.Contains(screen(m), "self-host.fyi/telemetry") {
		t.Fatal("the Intro must not show the Telemetry notice")
	}
	m = frames(t, m, introFrames)
	if !strings.Contains(screen(m), "self-host.fyi/telemetry") {
		t.Fatalf("Welcome shows the Telemetry notice\n%s", screen(m))
	}
}

func TestWelcomeRevisitHasNoIntro(t *testing.T) {
	m, _ := freshHost(t)
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("esc"))
	if m.onboarding.intro != nil || m.onboarding.step != stepWelcome {
		t.Fatal("esc from What returns to a settled Welcome")
	}
	m = drive(t, m, press("esc"))
	if m.onboarding.step != stepWelcome {
		t.Fatal("esc on Welcome does nothing")
	}
	if strings.Contains(m.onboardingBarText(), "esc") {
		t.Fatal("Welcome's bar has no esc back chip")
	}
}

func (m Model) onboardingBarText() string {
	mode, chips := m.onboarding.bar(m.ctx())
	out := mode
	for _, c := range chips {
		out += " " + c.Help().Key
	}
	return out
}

func TestWelcomeReactionsPlayOnlyWhileTheyRun(t *testing.T) {
	m, _ := freshHost(t)
	next, cmd := m.Update(press("down"))
	m = next.(Model)
	if !yieldsFrame(cmd) || m.onboarding.react.focusAge != 0 {
		t.Fatal("a focus move starts a reaction and its frames")
	}
	for range intro.FocusFrames - 1 {
		m = update(t, m, frameMsg{})
	}
	if _, cmd := m.Update(frameMsg{}); yieldsFrame(cmd) {
		t.Fatal("frames stop between reactions")
	}
	m = drive(t, m, press("space"))
	if m.onboarding.react.selectAge < 0 {
		t.Fatal("space starts the selection reaction")
	}
	m = frames(t, m, reactionFrames)
	if m.onboarding.react.selectAge >= 0 || m.onboarding.react.focusAge >= 0 {
		t.Fatal("reactions come to rest")
	}
}

func TestSavedExperienceHasNoQuestionAndNoReaction(t *testing.T) {
	m, _ := welcomeWithSavedExperience(t, "advanced", 120, 40)
	next, cmd := m.Update(press("down"))
	m = next.(Model)
	if yieldsFrame(cmd) || m.onboarding.react.focusAge >= 0 || strings.Contains(screen(m), "Have you run") {
		t.Fatal("a saved level means no question and no reaction")
	}
}

func TestTheLastExitFrameIsWelcomesFirstFrame(t *testing.T) {
	for _, size := range []struct{ width, height int }{{120, 40}, {120, 30}, {80, 24}, {70, 20}} {
		m, _ := introModel(t, Options{}, readyChecks...)
		m = update(t, m, windowSize(size.width, size.height))
		m = update(t, m, doctorMsg{checks: readyChecks})
		for m.onboarding.intro.exit < 0 {
			m = update(t, m, frameMsg{})
		}
		last := strings.Join(intro.RenderExit(m.onboarding.introInput(m.ctx()), intro.ExitFrames-1, m.introTarget()), "\n")
		m.onboarding.endIntro()
		welcome := m
		if trimLines(ansi.Strip(last)) != trimLines(screen(welcome)) {
			t.Fatalf("%dx%d: the exit must land on Welcome\n%s\n---\n%s", size.width, size.height, ansi.Strip(last), screen(welcome))
		}
	}
}
