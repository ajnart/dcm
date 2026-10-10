package tui

import (
	"errors"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/preboot"
	"github.com/ajnart/self-host/internal/service"
)

// approved is Onboarding's Review approved at width×height, with the install
// Action started but not yet run, so a test plays its events itself.
func approved(t *testing.T, width, height int, opts ...func(*Options)) (Model, *fakeBackend, tea.Cmd) {
	t.Helper()
	backend := &fakeBackend{catalog: wizardCatalog(), checks: readyChecks}
	options := Options{Version: "1.0.0"}
	for _, opt := range opts {
		opt(&options)
	}
	m := New(backend, options)
	m = update(t, m, windowSize(width, height))
	m = drive(t, m, statusMsgFor(service.ErrNoProject))
	m = update(t, m, doctorMsg{checks: backend.checks})
	m = frames(t, m, 60)
	m = drive(t, m, press("enter"))
	m = toReview(t, m)
	next, cmd := m.Update(press("enter"))
	m = next.(Model)
	t.Cleanup(m.tasks.cancelAll)
	return m, backend, cmd
}

func pullStart(count string) events.Event {
	return events.Event{Event: events.StepStart, Step: "pull", Msg: "pull " + count + " images"}
}

func pulledImage(ref string) events.Event {
	return events.Event{Event: events.PullProgress, Image: ref, Status: "Pulled"}
}

func downloading(ref string) events.Event {
	return events.Event{Event: events.PullProgress, Image: ref, Layer: "l1", Status: "Downloading", Current: 50, Total: 100}
}

func play(m Model, evs ...events.Event) {
	task := m.tasks.latest()
	for _, e := range evs {
		task.append(e)
	}
}

// barRow is the screen's row with the pull's count, and countRow its text.
func barRow(t *testing.T, m Model, count string) string {
	t.Helper()
	for _, line := range strings.Split(screen(m), "\n") {
		if strings.Contains(line, count) {
			return line
		}
	}
	t.Fatalf("no row says %q\n%s", count, screen(m))
	return ""
}

func TestApprovingReviewShowsPrebootAndDispatchesTheInstall(t *testing.T) {
	m, backend, cmd := approved(t, 120, 30)

	out := screen(m)
	for _, want := range []string{"s e l f - h o s t", "Warming up the engines…", "Like self-host?", "c Ko-fi", "s GitHub Sponsors", "enter skip"} {
		if !strings.Contains(out, want) {
			t.Fatalf("pre-boot lacks %q\n%s", want, out)
		}
	}
	if strings.Contains(out, "Review") || strings.Contains(out, "3 Activity") {
		t.Fatalf("pre-boot is full screen, no header or bar\n%s", out)
	}
	for _, msg := range runCmd(cmd) {
		m = drive(t, m, msg)
	}
	if got := backend.installs(); len(got) != 1 || strings.Join(got[0].Targets, ",") != "homarr,ntfy" {
		t.Fatalf("the install Action should be dispatched as before, installs %+v", got)
	}
}

func TestPrebootBarAndImageCountFollowThePullEvents(t *testing.T) {
	m, _, _ := approved(t, 120, 30)
	play(m, events.Event{Event: events.RunStart, Msg: "install homarr ntfy"}, pullStart("2"),
		downloading("ghcr.io/homarr-labs/homarr:latest"), downloading("binwiederhier/ntfy:latest"))
	m = frames(t, m, 3)

	before := barRow(t, m, "0 of 2 images")
	if !strings.Contains(screen(m), "Pulling 2 images") {
		t.Fatalf("pre-boot should show the Activity narrative\n%s", screen(m))
	}

	play(m, pulledImage("ghcr.io/homarr-labs/homarr:latest"))
	m = frames(t, m, 3)

	after := barRow(t, m, "1 of 2 images")
	if strings.Count(after, "█") <= strings.Count(before, "█") {
		t.Fatalf("the bar should have grown:\n%s\n%s", before, after)
	}
}

func TestPrebootIsFullScreenAtTheTerminalSize(t *testing.T) {
	for _, size := range []struct{ w, h int }{{120, 30}, {80, 24}, {70, 20}} {
		m, _, _ := approved(t, size.w, size.h)
		play(m, pullStart("2"), downloading("ghcr.io/homarr-labs/homarr:latest"))
		for _, step := range []int{1, 20, 40} {
			m = frames(t, m, step)
			lines := strings.Split(screen(m), "\n")
			if len(lines) != size.h {
				t.Fatalf("%dx%d: %d rows", size.w, size.h, len(lines))
			}
			for _, line := range lines {
				if ansi.StringWidth(line) > size.w {
					t.Fatalf("%dx%d: a row is wider: %q", size.w, size.h, line)
				}
			}
		}
	}
}

func TestPrebootPlaysTheExitThenLandsOnActivity(t *testing.T) {
	m, _, _ := approved(t, 120, 30)
	play(m, pullStart("1"), downloading("ghcr.io/homarr-labs/homarr:latest"))
	m = frames(t, m, 10)
	play(m, pulledImage("ghcr.io/homarr-labs/homarr:latest"), events.Event{Event: events.StepOK, Step: "pull", Msg: "pulled homarr"})

	m = frames(t, m, 36)

	if out := screen(m); !strings.Contains(out, "▓") || strings.Contains(out, "Like self-host?") {
		t.Fatalf("the iris should be opening onto the Dashboard\n%s", out)
	}
	m = frames(t, m, preboot.ExitFrames)

	out := screen(m)
	if m.surface != surfaceActivity || !strings.Contains(out, "3 Activity") || strings.Contains(out, "Like self-host?") {
		t.Fatalf("the exit should land on the Dashboard with Activity focused\n%s", out)
	}
	if !strings.Contains(out, "install homarr ntfy") {
		t.Fatalf("Activity should show the install\n%s", out)
	}
}

func TestPrebootWarmsUpThenComparesTheTimeLeft(t *testing.T) {
	m, _, _ := approved(t, 120, 30)
	play(m, pullStart("2"), downloading("ghcr.io/homarr-labs/homarr:latest"), downloading("binwiederhier/ntfy:latest"))

	m = frames(t, m, 2*preboot.FPS)

	if out := screen(m); !strings.Contains(out, "Warming up the engines…") || strings.Contains(out, "as long as") {
		t.Fatalf("with no estimate yet pre-boot warms up\n%s", out)
	}
	m = frames(t, m, 3*preboot.FPS)

	out := screen(m)
	if !strings.Contains(out, "This should take about as long as") || strings.Contains(out, "Warming up") || strings.Contains(out, "%") {
		t.Fatalf("once the pull has moved pre-boot compares the time left to something\n%s", out)
	}
}

func TestAFailedPullLandsOnActivityAtOnce(t *testing.T) {
	m, _, _ := approved(t, 120, 30)
	play(m, pullStart("1"), downloading("ghcr.io/homarr-labs/homarr:latest"),
		events.Event{Event: events.StepFail, Step: "pull", Msg: "could not pull homarr", Error: "toomanyrequests"})

	m = frames(t, m, 1)

	out := screen(m)
	if m.surface != surfaceActivity || !strings.Contains(out, "3 Activity") || strings.Contains(out, "Like self-host?") {
		t.Fatalf("a failed pull should land on Activity at once\n%s", out)
	}
}

func TestAFailedInstallLandsOnActivityWithoutWaitingForAFrame(t *testing.T) {
	m, backend, cmd := approved(t, 120, 30)
	backend.fail = errors.New("homarr did not become healthy")

	for _, msg := range runCmd(cmd) {
		m = drive(t, m, msg)
	}

	out := screen(m)
	if strings.Contains(out, "Like self-host?") || !strings.Contains(out, "homarr did not become healthy") {
		t.Fatalf("a failed install should land on Activity\n%s", out)
	}
}

func TestPrebootPlaysAboutFourSecondsWithNothingToPull(t *testing.T) {
	m, _, cmd := approved(t, 120, 30)
	for _, msg := range runCmd(cmd) {
		m = drive(t, m, msg)
	}

	m = frames(t, m, 3*preboot.FPS+preboot.FPS/2)

	if !strings.Contains(screen(m), "Like self-host?") {
		t.Fatalf("pre-boot should still play after 3.5 s\n%s", screen(m))
	}
	m = frames(t, m, preboot.FPS)
	if strings.Contains(screen(m), "3 Activity") || strings.Contains(screen(m), "Like self-host?") {
		t.Fatalf("the exit should play after 4 s\n%s", screen(m))
	}
	m = frames(t, m, preboot.ExitFrames)

	if out := screen(m); m.surface != surfaceActivity || !strings.Contains(out, "3 Activity") {
		t.Fatalf("pre-boot should end on Activity\n%s", out)
	}
}

func TestEnterSkipsPrebootToActivity(t *testing.T) {
	m, _, _ := approved(t, 120, 30)

	m = drive(t, m, press("enter"))

	out := screen(m)
	if m.surface != surfaceActivity || !strings.Contains(out, "3 Activity") || strings.Contains(out, "Like self-host?") {
		t.Fatalf("enter should skip to Activity\n%s", out)
	}
}

func TestPrebootOpensTheDonationPages(t *testing.T) {
	m, backend, _ := approved(t, 120, 30)

	m = drive(t, m, press("c"))
	m = drive(t, m, press("s"))

	if got := strings.Join(backend.opened, " "); got != koFiURL+" "+sponsorsURL {
		t.Fatalf("opened %q", got)
	}
	if !strings.Contains(screen(m), "Like self-host?") {
		t.Fatalf("opening a page should leave pre-boot on screen\n%s", screen(m))
	}
}

func TestQuitsFromPreboot(t *testing.T) {
	m, _, _ := approved(t, 120, 30)

	next, cmd := m.Update(press("q"))
	m = next.(Model)

	if !m.quitting || cmd == nil {
		t.Fatal("q should quit as on the Dashboard")
	}
}

func TestOtherKeysDoNothingInPreboot(t *testing.T) {
	m, backend, _ := approved(t, 120, 30)
	before := screen(m)

	for _, k := range []string{"3", "a", "A", "?", "tab", "esc", "x"} {
		m = drive(t, m, press(k))
	}

	if screen(m) != before || len(backend.opened) != 0 {
		t.Fatalf("other keys must be inert\n%s", screen(m))
	}
}

func TestACatalogInstallNeverShowsPreboot(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.catalog = wizardCatalog()

	m = drive(t, m, press("4"))
	m = drive(t, m, press("/"))
	m = typeText(t, m, "ntfy")
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("space"))
	m = drive(t, m, press("enter"))
	next, cmd := m.Update(press("enter"))
	m = next.(Model)
	t.Cleanup(m.tasks.cancelAll)
	play(m, pullStart("1"), downloading("binwiederhier/ntfy:latest"))
	m = frames(t, m, 5)

	if out := screen(m); m.preboot != nil || strings.Contains(out, "Like self-host?") || !strings.Contains(out, "3 Activity") {
		t.Fatalf("a Catalog install belongs on Activity\n%s", out)
	}
	for _, msg := range runCmd(cmd) {
		m = drive(t, m, msg)
	}
	if out := frames(t, m, 100); strings.Contains(screen(out), "Like self-host?") {
		t.Fatal("a Catalog install must not show pre-boot later either")
	}
}

func TestFramesTickOnlyWhileSomethingAnimates(t *testing.T) {
	m, _ := sample(t, 120, 30)
	if _, cmd := m.nextFrame(); cmd != nil {
		t.Fatal("an idle Dashboard must not tick")
	}

	m, _, _ = approved(t, 120, 30)
	next, cmd := m.nextFrame()
	if cmd == nil || next.(Model).framePeriod() != time.Second/preboot.FPS {
		t.Fatalf("pre-boot ticks at %d fps, period %v", preboot.FPS, next.(Model).framePeriod())
	}

	m = drive(t, m, press("enter"))
	m.tasks.cancelAll()
	m.tasks.finish(m.tasks.latest().id, nil)
	for range 100 {
		next, cmd = m.nextFrame()
		m = next.(Model)
		if cmd == nil {
			break
		}
	}
	if cmd != nil {
		t.Fatal("ticking must stop once pre-boot and the Action are done")
	}
	if m.framePeriod() != time.Second/12 {
		t.Fatalf("other frames tick at 12 fps, period %v", m.framePeriod())
	}
}

func TestActivityMotionKeepsItsOwnRateWhilePrebootPlays(t *testing.T) {
	m, _, _ := approved(t, 120, 30)
	play(m, pullStart("2"), downloading("ghcr.io/homarr-labs/homarr:latest"))
	start := m.frame

	m = frames(t, m, preboot.FPS)

	if m.preboot == nil {
		t.Fatal("pre-boot should still play after one second")
	}
	if got := m.frame - start; got != activity.FPS {
		t.Fatalf("one second of pre-boot should advance Activity by %d frames, got %d", activity.FPS, got)
	}
}

func TestPrebootHonoursNoColourAndTheLightPalette(t *testing.T) {
	m, _, _ := approved(t, 120, 30, func(o *Options) { o.NoColor = true })
	play(m, pullStart("1"), downloading("ghcr.io/homarr-labs/homarr:latest"))
	m = frames(t, m, 5)

	out := m.View().Content
	if strings.Contains(out, "38;2") || strings.Contains(out, "38;5") || !strings.Contains(out, "\x1b[1m") {
		t.Fatalf("NO_COLOR pre-boot is bold and faint only: %q", out)
	}

	dark, _, _ := approved(t, 120, 30)
	light := update(t, dark, lightBackground())
	if dark.View().Content == light.View().Content || !strings.Contains(light.View().Content, "38;2;29;26;43") {
		t.Fatal("a light terminal should get the light palette")
	}
}

func TestSmallTerminalsGetTheSmallSceneWithWholeText(t *testing.T) {
	m, _, _ := approved(t, 70, 20)

	out := screen(m)

	for _, want := range []string{"s e l f - h o s t", "Warming up the engines…", "Like self-host?", "c Ko-fi", "s GitHub Sponsors", "enter skip"} {
		if !strings.Contains(out, want) {
			t.Fatalf("the small scene lacks %q\n%s", want, out)
		}
	}
}

func TestAnEarlyFailureReturnsToReviewFromPreboot(t *testing.T) {
	m, backend, cmd := approved(t, 120, 30)
	backend.fail = errors.New("cannot create the Project folder: permission denied")
	backend.statusErr = service.ErrNoProject

	for _, msg := range runCmd(cmd) {
		m = drive(t, m, msg)
	}

	if out := screen(m); m.preboot != nil || !strings.Contains(out, "● Review") || !strings.Contains(out, "permission denied") {
		t.Fatalf("an early failure should return to Review\n%s", out)
	}
}
