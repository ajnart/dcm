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

func newIntroScreen(ctx *viewContext) *introScreen {
	i := &introScreen{exit: -1, reading: len(ctx.checks) == 0}
	if ctx.opts.ReducedMotion {
		i.frame = intro.SceneFrames
	}
	if !i.reading {
		i.tickFrom = intro.TickStart(0, ctx.opts.ReducedMotion)
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

func (o *onboarding) introDoctor(ctx *viewContext) intro.Doctor {
	i := o.intro
	checks := make([]intro.Check, len(ctx.checks))
	for n, c := range ctx.checks {
		checks[n] = intro.Check{Title: c.Title, Detail: c.Detail, Hint: c.Hint, Docs: c.Docs, Level: introLevel(c.Level)}
	}
	return intro.Doctor{Checks: checks, Reading: i.reading, Again: i.again,
		SettingsReading: !i.reading && ctx.defaults == nil, TickFrom: i.tickFrom}
}

func introPalette(t theme) intro.Palette {
	if t.dark {
		return intro.Dark()
	}
	return intro.Light()
}

func (o *onboarding) introInput(ctx *viewContext) intro.Input {
	i := o.intro
	return intro.Input{W: ctx.width, H: ctx.height, Frame: i.frame, Wall: i.wall, Doctor: o.introDoctor(ctx),
		Hold: i.hold, Pal: introPalette(ctx.theme), NoColor: ctx.opts.NoColor, Reduced: ctx.opts.ReducedMotion}
}

// introReady reports that the Intro may play its exit: the scene is settled,
// every check has ticked and nothing holds it.
func (o *onboarding) introReady(ctx *viewContext) bool {
	i := o.intro
	d := o.introDoctor(ctx)
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
func (o *onboarding) introAnimating(ctx *viewContext) bool {
	i := o.intro
	if i.exit >= 0 || (!ctx.bgKnown && i.wall == 0) || o.introReady(ctx) {
		return true
	}
	d := o.introDoctor(ctx)
	reduced := ctx.opts.ReducedMotion
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

// advance plays one frame of the Intro, or of Welcome's reaction once the
// Intro is over.
func (o *onboarding) advance(ctx *viewContext) {
	if o.intro != nil {
		o.advanceIntro(ctx)
	}
	o.advanceReaction()
}

// advanceIntro plays one frame of the Intro and moves it on: holding for a
// warning or a failure, starting the exit once ready, and ending it.
func (o *onboarding) advanceIntro(ctx *viewContext) {
	i := o.intro
	if !ctx.bgKnown && i.waited < introBackgroundWait {
		i.waited++
		return
	}
	if ctx.opts.ReducedMotion && i.reading {
		return
	}
	i.wall++
	if i.exit >= 0 {
		i.exit++
		if i.exit >= intro.ExitFrames-1 {
			o.endIntro(ctx)
		}
		return
	}
	if !ctx.opts.ReducedMotion && !intro.Settled(i.frame) {
		i.frame++
	}
	d := o.introDoctor(ctx)
	ticked := !i.reading && len(d.Checks) > 0 && i.wall >= i.tickFrom+len(d.Checks)*intro.BeatFrames
	switch {
	case i.hold.Level == intro.Unlit && ticked && intro.Worst(d) == intro.Fail:
		i.hold = intro.NewHold(intro.Fail, i.wall)
	case i.hold.Level == intro.Unlit && ticked && intro.Worst(d) == intro.Warn && intro.Settled(i.frame):
		i.hold = intro.NewHold(intro.Warn, i.wall)
	case i.hold.Level == intro.Fail && i.hold.Recover >= 0 && i.wall-i.hold.Recover >= intro.RecoverFrames:
		i.hold = intro.Hold{}
	}
	if !o.introReady(ctx) {
		return
	}
	if ctx.opts.ReducedMotion {
		o.endIntro(ctx)
		return
	}
	o.previewNotice(ctx)
	i.exit = 0
}

// endIntro hands the screen to Welcome.
func (o *onboarding) endIntro(ctx *viewContext) {
	o.revealNotice(ctx)
	o.intro = nil
}

// previewNotice lets the exit draw Welcome with the Telemetry notice it will
// show, without recording it as shown: quitting during the exit leaves it
// for the next run.
func (o *onboarding) previewNotice(ctx *viewContext) {
	if !o.noticeRead {
		o.notice = ctx.backend.PendingTelemetryNotice()
	}
}

// checksArrived takes Doctor's answer while the Intro reads: the checks start
// ticking into the line, and a passing answer lifts a failure's hold. It
// reports that frames are needed.
func (o *onboarding) checksArrived(ctx *viewContext) bool {
	i := o.intro
	if i == nil || !i.reading {
		return false
	}
	i.tickFrom = intro.TickStart(i.wall, i.again || ctx.opts.ReducedMotion)
	i.reading, i.again = false, false
	if i.hold.Level == intro.Fail && i.hold.Recover < 0 && host.Worst(ctx.checks) != host.Fail {
		i.hold.Recover = i.wall
		if i.hold.Out < 0 {
			i.hold.Out = i.wall
		}
	}
	return true
}

// recheckOnFocus reads Doctor again when the terminal regains focus while a
// failure holds the Intro, and reports that it does.
func (o *onboarding) recheckOnFocus() bool {
	i := o.intro
	if i == nil || i.hold.Level != intro.Fail || i.reading {
		return false
	}
	i.reading, i.again = true, true
	return true
}

func (o *onboarding) introKey(ctx *viewContext, msg tea.KeyPressMsg) (tea.Cmd, onboardingAsk) {
	i := o.intro
	if s := msg.String(); s == "q" || s == "ctrl+c" {
		return nil, onboardingAsk{quit: true}
	}
	switch {
	case i.exit >= 0:
		o.introSkipped = true
		o.endIntro(ctx)
	case !intro.Settled(i.frame):
		o.introSkipped = true
		i.frame = intro.SceneFrames
		return nil, onboardingAsk{tick: true}
	case i.hold.Level == intro.Fail && msg.String() == "r" && !i.reading:
		i.reading, i.again = true, true
		return nil, onboardingAsk{doctor: true, tick: true}
	case i.hold.Level == intro.Warn && i.hold.Out < 0 && msg.String() == "enter":
		i.hold.Out = i.wall
		return nil, onboardingAsk{tick: true}
	case o.introReady(ctx):
		o.introSkipped = true
		o.endIntro(ctx)
	}
	return nil, onboardingAsk{}
}

// poke settles the scene for a click or a scroll; it never cuts.
func (o *onboarding) poke() onboardingAsk {
	i := o.intro
	if intro.Settled(i.frame) {
		return onboardingAsk{}
	}
	o.introSkipped = true
	i.frame = intro.SceneFrames
	return onboardingAsk{tick: true}
}

// revealNotice reads the Telemetry notice and records it as shown the first
// time Welcome is on screen, so quitting during the Intro leaves it for the
// next run.
func (o *onboarding) revealNotice(ctx *viewContext) {
	if o.noticeRead {
		return
	}
	o.noticeRead = true
	o.notice = ctx.backend.TelemetryNotice()
}

// renderIntro is the whole terminal while the Intro is on screen. The exit
// lands on Welcome as it is drawn right now.
func (o *onboarding) renderIntro(ctx *viewContext, target func() intro.Target) string {
	i := o.intro
	if !ctx.bgKnown && i.wall == 0 {
		return ""
	}
	in := o.introInput(ctx)
	if i.exit < 0 {
		return strings.Join(intro.Render(in), "\n")
	}
	return strings.Join(intro.RenderExit(in, i.exit, target()), "\n")
}

func (m Model) renderIntro() string {
	return m.onboarding.renderIntro(m.ctx(), m.introTarget)
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
	ctx := m.ctx()
	if o.welcomeEmblem(ctx, welcomeRoom(ctx)) {
		w, h := intro.ScaleEmblem.Size()
		tg.Emblem = &intro.Box{X: tg.TitleAt.X, Y: tg.TitleAt.Y - h - 1, W: w, H: h}
	}
	return tg
}
