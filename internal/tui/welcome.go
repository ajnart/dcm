package tui

import (
	tea "charm.land/bubbletea/v2"

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
func (m Model) welcomeReaction() intro.Reaction {
	o := m.onboarding
	var levels [4]intro.Level
	for i, c := range m.checks {
		if i < len(levels) {
			levels[i] = introLevel(c.Level)
		}
	}
	return intro.Reaction{Focus: intro.Choice(o.experience), PrevFocus: o.react.prevFocus,
		Selected: choiceOf(o.answers.experience), PrevSelected: o.react.prevSelected,
		FocusAge: o.react.focusAge, SelectAge: o.react.selectAge, Levels: levels,
		Pal: m.introPalette(), NoColor: m.opts.NoColor, Reduced: m.opts.ReducedMotion}
}

// reactFocus starts the focus reaction when the focus moved off before.
func (m *Model) reactFocus(before int) tea.Cmd {
	o := m.onboarding
	if m.opts.ReducedMotion || o.experience == before {
		return nil
	}
	o.react.prevFocus, o.react.focusAge = intro.Choice(before), 0
	return m.startTicking()
}

// reactSelect starts the selection reaction when the answer changed.
func (m *Model) reactSelect(before string) tea.Cmd {
	o := m.onboarding
	if m.opts.ReducedMotion || o.answers.experience == before {
		return nil
	}
	o.react.prevSelected, o.react.selectAge = choiceOf(before), 0
	return m.startTicking()
}

// welcomeReacting reports that a reaction still plays.
func (m Model) welcomeReacting() bool {
	if !m.onboardingShown() || m.onboarding.intro != nil {
		return false
	}
	r := m.onboarding.react
	return r.focusAge >= 0 || r.selectAge >= 0
}

// advanceReaction plays one frame of Welcome's reaction.
func (m Model) advanceReaction() Model {
	if !m.welcomeReacting() {
		return m
	}
	r := &m.onboarding.react
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
	return m
}

// onboardingAnimating reports that the Intro or a Welcome reaction needs frames.
func (m Model) onboardingAnimating() bool {
	return m.introShown() && m.introAnimating() || m.welcomeReacting()
}

// fastFrames reports that frames play at the Intro's rate rather than Activity's.
func (m Model) fastFrames() bool { return m.introShown() || m.welcomeReacting() }
