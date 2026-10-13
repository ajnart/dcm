package tui

import (
	"strings"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/intro"
)

// introBackgroundWait is how many frames the Intro waits for the terminal's
// background colour before it draws, so a light terminal never sees the dark
// palette.
const introBackgroundWait = 6

// introFramesPerActivity is how many Intro frames play per Activity frame, so
// Activity's motion keeps its own timing underneath.
const introFramesPerActivity = intro.FPS / 12

// introPokeMsg is a click on the Intro, which settles the scene like a key.
type introPokeMsg struct{}

// introScreen is the full-screen scene that opens Onboarding while Doctor
// checks the machine. It keeps only its own clocks and hold; the checks and
// the detected settings come from the Model.
type introScreen struct {
	// frame is the scene clock and wall the frames since the Intro opened.
	frame, wall, waited int
	// exit counts the frames the exit has played, -1 while the scene plays.
	exit int
	// reading is true until Doctor has answered; again is set by a recheck.
	reading, again bool
	// tickFrom is the wall frame the first check ticks into the line.
	tickFrom int
	hold     intro.Hold
}

func newIntroScreen(m Model) *introScreen {
	i := &introScreen{exit: -1, reading: len(m.checks) == 0}
	if m.opts.ReducedMotion {
		i.frame = intro.SceneFrames
	}
	if !i.reading {
		i.tickFrom = intro.TickStart(0, m.opts.ReducedMotion)
	}
	return i
}

func introLevel(l host.Level) intro.Level {
	switch l {
	case host.Warn:
		return intro.Warn
	case host.Fail:
		return intro.Fail
	}
	return intro.OK
}

func (m Model) introDoctor() intro.Doctor {
	i := m.onboarding.intro
	checks := make([]intro.Check, len(m.checks))
	for n, c := range m.checks {
		checks[n] = intro.Check{Title: c.Title, Detail: c.Detail, Hint: c.Hint, Docs: c.Docs, Level: introLevel(c.Level)}
	}
	return intro.Doctor{Checks: checks, Reading: i.reading, Again: i.again,
		SettingsReading: !i.reading && m.defaults == nil, TickFrom: i.tickFrom}
}

func (m Model) introPalette() intro.Palette {
	if m.theme.dark {
		return intro.Dark()
	}
	return intro.Light()
}

func (m Model) introInput() intro.Input {
	i := m.onboarding.intro
	return intro.Input{W: m.width, H: m.height, Frame: i.frame, Wall: i.wall, Doctor: m.introDoctor(),
		Hold: i.hold, Pal: m.introPalette(), NoColor: m.opts.NoColor, Reduced: m.opts.ReducedMotion}
}

// introShown reports that the Intro is on screen.
func (m Model) introShown() bool { return m.onboardingShown() && m.onboarding.intro != nil }

// introReady reports that the Intro may play its exit: the scene is settled,
// every check has ticked and nothing holds it.
func (m Model) introReady() bool {
	i := m.onboarding.intro
	d := m.introDoctor()
	if !intro.Settled(i.frame) || !intro.Ready(i.wall, d) {
		return false
	}
	switch i.hold.Level {
	case intro.Fail:
		return false
	case intro.Warn:
		return i.hold.Out >= 0
	}
	return true
}

// introAnimating reports that the Intro still needs frames.
func (m Model) introAnimating() bool {
	i := m.onboarding.intro
	if i.exit >= 0 || (!m.bgKnown && i.wall == 0) || m.introReady() {
		return true
	}
	d := m.introDoctor()
	reduced := m.opts.ReducedMotion
	if !reduced && (!intro.Settled(i.frame) || i.reading || d.SettingsReading) {
		return true
	}
	if !i.reading && i.wall < i.tickFrom+len(d.Checks)*intro.BeatFrames {
		return true
	}
	if reduced {
		return false
	}
	h := i.hold
	switch {
	case h.Recover >= 0:
		return i.wall-h.Recover < intro.RecoverFrames+intro.CardFrames
	case h.Out >= 0:
		return i.wall-h.Out < intro.CardFrames+1
	case h.Level != intro.Unlit:
		return i.wall-h.Since < intro.RecoverFrames+intro.CardFrames
	}
	return false
}

// advanceIntro plays one frame of the Intro and moves it on: holding for a
// warning or a failure, starting the exit once ready, and ending it.
func (m Model) advanceIntro() Model {
	if !m.introShown() {
		return m
	}
	i := m.onboarding.intro
	if !m.bgKnown && i.waited < introBackgroundWait {
		i.waited++
		return m
	}
	i.wall++
	if i.exit >= 0 {
		i.exit++
		if i.exit >= intro.ExitFrames-1 {
			return m.endIntro()
		}
		return m
	}
	if !m.opts.ReducedMotion && !intro.Settled(i.frame) {
		i.frame++
	}
	d := m.introDoctor()
	ticked := !i.reading && len(d.Checks) > 0 && i.wall >= i.tickFrom+len(d.Checks)*intro.BeatFrames
	switch {
	case i.hold.Level == intro.Unlit && ticked && intro.Worst(d) == intro.Fail:
		i.hold = intro.NewHold(intro.Fail, i.wall)
	case i.hold.Level == intro.Unlit && ticked && intro.Worst(d) == intro.Warn && intro.Settled(i.frame):
		i.hold = intro.NewHold(intro.Warn, i.wall)
	case i.hold.Level == intro.Fail && i.hold.Recover >= 0 && i.wall-i.hold.Recover >= intro.RecoverFrames:
		i.hold = intro.Hold{}
	}
	if !m.introReady() {
		return m
	}
	if m.opts.ReducedMotion {
		return m.endIntro()
	}
	m.revealNotice()
	i.exit = 0
	return m
}

// endIntro hands the screen to Welcome.
func (m Model) endIntro() Model {
	m.revealNotice()
	m.onboarding.intro = nil
	return m
}

// introChecksArrived takes Doctor's answer: the checks start ticking into the
// line, and a passing answer lifts a failure's hold.
func (m *Model) introChecksArrived() {
	i := m.onboarding.intro
	i.tickFrom = intro.TickStart(i.wall, i.again || m.opts.ReducedMotion)
	i.reading, i.again = false, false
	if i.hold.Level == intro.Fail && i.hold.Recover < 0 && host.Worst(m.checks) != host.Fail {
		i.hold.Recover = i.wall
		if i.hold.Out < 0 {
			i.hold.Out = i.wall
		}
	}
}

// introRecheck reads Doctor again while a failure holds the Intro.
func (m Model) introRecheck() (Model, tea.Cmd) {
	i := m.onboarding.intro
	i.reading, i.again = true, true
	return m, tea.Batch(m.loadDoctor(), m.startTicking())
}

func (m Model) handleIntroKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	o := m.onboarding
	i := o.intro
	if s := msg.String(); s == "q" || s == "ctrl+c" {
		return m.quit()
	}
	switch {
	case i.exit >= 0:
		o.introSkipped = true
		return m.endIntro(), nil
	case !intro.Settled(i.frame):
		o.introSkipped = true
		i.frame = intro.SceneFrames
		return m, m.startTicking()
	case i.hold.Level == intro.Fail && msg.String() == "r" && !i.reading:
		return m.introRecheck()
	case i.hold.Level == intro.Warn && i.hold.Out < 0 && msg.String() == "enter":
		i.hold.Out = i.wall
		return m, m.startTicking()
	case m.introReady():
		o.introSkipped = true
		return m.endIntro(), nil
	}
	return m, nil
}

// pokeIntro settles the scene for a click or a scroll; it never cuts.
func (m Model) pokeIntro() (tea.Model, tea.Cmd) {
	i := m.onboarding.intro
	if intro.Settled(i.frame) {
		return m, nil
	}
	m.onboarding.introSkipped = true
	i.frame = intro.SceneFrames
	return m, m.startTicking()
}

// revealNotice reads the Telemetry notice the first time Welcome is about to
// be on screen, so quitting during the Intro leaves it for the next run.
func (m Model) revealNotice() {
	o := m.onboarding
	if o.noticeRead {
		return
	}
	o.noticeRead = true
	o.notice = m.backend.TelemetryNotice()
}

// renderIntro is the whole terminal while the Intro is on screen. The exit
// lands on Welcome as it is drawn right now.
func (m Model) renderIntro() string {
	i := m.onboarding.intro
	if !m.bgKnown && i.wall == 0 {
		return ""
	}
	in := m.introInput()
	if i.exit < 0 {
		return strings.Join(intro.Render(in), "\n")
	}
	return strings.Join(intro.RenderExit(in, i.exit, m.introTarget()), "\n")
}

// introTarget is Welcome's first frame with where its title and emblem sit.
func (m Model) introTarget() intro.Target {
	o := *m.onboarding
	o.intro = nil
	m.onboarding = &o
	lines := strings.Split(m.View().Content, "\n")
	header, _, _ := m.renderHeader()
	head := strings.Count(header, "\n") + 1
	tg := intro.Target{Lines: lines, Title: welcomeTitle}
	for y := range head + 2 {
		tg.Chrome = append(tg.Chrome, y)
	}
	tg.Chrome = append(tg.Chrome, len(lines)-2, len(lines)-1)
	for y := head; y < len(lines); y++ {
		line := ansi.Strip(lines[y])
		if x := strings.Index(line, welcomeTitle); x >= 0 {
			tg.TitleAt = intro.Pos{X: ansi.StringWidth(line[:x]), Y: y}
			break
		}
	}
	if m.welcomeEmblem(m.welcomeRoom()) {
		w, h := intro.ScaleEmblem.Size()
		tg.Emblem = &intro.Box{X: tg.TitleAt.X, Y: tg.TitleAt.Y - h - 1, W: w, H: h}
	}
	return tg
}
