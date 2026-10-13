package tui

import (
	"strings"

	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/intro"
	"github.com/ajnart/self-host/internal/project"
)

// welcomeReaction is Welcome's one-shot reaction to a focus move or a
// selection: the previous choice and the frames played so far, -1 when none
// plays.
type welcomeReaction struct {
	prevFocus, prevSelected intro.Choice
	focusAge, selectAge     int
}

func choiceOf(level string) intro.Choice {
	if level == project.ExperienceAdvanced {
		return intro.Advanced
	}
	return intro.New
}

// welcomeReaction is the reaction layer as Welcome draws it now.
func (o *onboarding) welcomeReaction(ctx *viewContext) intro.Reaction {
	var levels [4]intro.Level
	for i, c := range ctx.checks {
		if i < len(levels) {
			levels[i] = introLevel(c.Level)
		}
	}
	return intro.Reaction{Focus: intro.Choice(o.experience), PrevFocus: o.react.prevFocus,
		Selected: choiceOf(o.answers.experience), PrevSelected: o.react.prevSelected,
		FocusAge: o.react.focusAge, SelectAge: o.react.selectAge, Levels: levels,
		Pal: introPalette(ctx.theme), NoColor: ctx.opts.NoColor, Reduced: ctx.opts.ReducedMotion}
}

// reactFocus starts the focus reaction when the focus moved off before, and
// reports that frames are needed.
func (o *onboarding) reactFocus(ctx *viewContext, before int) bool {
	if ctx.opts.ReducedMotion || o.experience == before {
		return false
	}
	o.react.prevFocus, o.react.focusAge = intro.Choice(before), 0
	return true
}

// reactSelect starts the selection reaction when the answer changed, and
// reports that frames are needed.
func (o *onboarding) reactSelect(ctx *viewContext, before string) bool {
	if ctx.opts.ReducedMotion || o.answers.experience == before {
		return false
	}
	o.react.prevSelected, o.react.selectAge = choiceOf(before), 0
	return true
}

// reacting reports that a Welcome reaction still plays.
func (o *onboarding) reacting() bool {
	if o.intro != nil {
		return false
	}
	return o.react.focusAge >= 0 || o.react.selectAge >= 0
}

// advanceReaction plays one frame of Welcome's reaction.
func (o *onboarding) advanceReaction() {
	if !o.reacting() {
		return
	}
	r := &o.react
	if r.focusAge >= 0 {
		if r.focusAge++; r.focusAge >= intro.FocusFrames {
			r.focusAge = -1
		}
	}
	if r.selectAge >= 0 {
		if r.selectAge++; r.selectAge >= intro.SelectFrames {
			r.selectAge = -1
		}
	}
}

// animating reports that the Intro or a Welcome reaction needs frames.
func (o *onboarding) animating(ctx *viewContext) bool {
	return o.intro != nil && o.introAnimating(ctx) || o.reacting()
}

// fast reports that frames play at the Intro's rate rather than Activity's.
func (o *onboarding) fast() bool { return o.intro != nil || o.reacting() }

const welcomeTitle = "Welcome to self-host"

func welcomeRoom(ctx *viewContext) int { return max(ctx.mainHeight()-3, 1) }

// welcomeEmblem reports that Welcome has room for its emblem: the full tier
// with the five rows the emblem and its gap take.
func (o *onboarding) welcomeEmblem(ctx *viewContext, room int) bool {
	return ctx.width >= 100 && ctx.height >= 28 && len(o.welcomeBody(ctx, room, true, true)) <= room
}

// welcomeBody is Welcome's lines, with its emblem and with the caption under
// the choices when asked for.
func (o *onboarding) welcomeBody(ctx *viewContext, room int, caption, emblem bool) []string {
	t := ctx.theme
	r := o.welcomeReaction(ctx)
	var lines []string
	if emblem {
		for _, line := range intro.ReactionEmblem(r) {
			lines = append(lines, "  "+line)
		}
		lines = append(lines, "")
	}
	title := t.title().Render(welcomeTitle)
	if intro.FocusActive(r) {
		title = intro.Title(welcomeTitle, r)
	}
	lines = append(lines, "  "+title, "")
	paragraph := func(text string, style lipgloss.Style) {
		for _, line := range strings.Split(wrap(text, min(max(ctx.width-4, 1), 76)), "\n") {
			lines = append(lines, "  "+style.Render(strings.TrimRight(line, " ")))
		}
	}
	paragraph("self-host runs the Apps you pick on this machine with Docker Compose, and sets them up for you: one Admin login, their API keys and the Links between them.", t.body())
	lines = append(lines, "")
	paragraph("Next you choose what to run, where it lives, who administers it and how it looks. Then you review the plan.", t.body())
	lines = append(lines, "")
	if !o.experienceSaved {
		paragraph(experienceQuestion, t.heading())
		for i, c := range experienceChoices {
			lines = append(lines, "  "+truncate(o.experienceRow(ctx, i, c, r), ctx.width-2))
		}
		if caption {
			lines = append(lines, "      "+intro.Caption(r))
		}
		lines = append(lines, "")
	}
	paragraph("Nothing is written until you approve the plan at Review.", t.active())
	if o.notice != "" {
		lines = append(lines, "")
		for _, line := range strings.Split(o.notice, "\n") {
			lines = append(lines, "  "+t.dim().Render(truncate(line, ctx.width-4)))
		}
	}
	return lines
}

// renderWelcome is Welcome's lines: the emblem when it fits, and the caption
// under the choices unless the lines would overflow without it.
func (o *onboarding) renderWelcome(ctx *viewContext, room int) []string {
	if o.welcomeEmblem(ctx, room) {
		return o.welcomeBody(ctx, room, true, true)
	}
	if lines := o.welcomeBody(ctx, room, true, false); len(lines) <= room {
		return lines
	}
	return o.welcomeBody(ctx, room, false, false)
}

// experienceRow is one choice: the plain radio row at rest, the Ink
// composition while a reaction plays.
func (o *onboarding) experienceRow(ctx *viewContext, i int, c experienceChoice, r intro.Reaction) string {
	t := ctx.theme
	if !intro.FocusActive(r) && !intro.SelectionActive(r) {
		return radioRow(t, i == o.experience, c.level == o.answers.experience, c.label)
	}
	cursor := "  "
	if i == o.experience {
		cursor = t.cursor()
	}
	choice := intro.Choice(i)
	return cursor + intro.Mark(choice, r) + " " + intro.Label(choice, c.label, r)
}

const experienceQuestion = "Have you run your own server or used Docker before, or is this all new to you?"

type experienceChoice struct{ level, label string }

var experienceChoices = []experienceChoice{
	{project.ExperienceNew, "New: this is all new to me"},
	{project.ExperienceAdvanced, "Advanced: I have run a server or used Docker"},
}
