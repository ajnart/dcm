package tui

import (
	"strings"
	"time"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/preboot"
)

// noPullFrames is how long pre-boot plays when there is nothing to pull.
const noPullFrames = 4 * preboot.FPS

// prebootFramesPerActivity is how many pre-boot frames play per Activity
// frame, so Activity's motion keeps its own timing underneath.
const prebootFramesPerActivity = preboot.FPS / activity.FPS

// prebootScreen is the full-screen scene between approving Onboarding's
// Review and the Dashboard: it plays while the first install pulls its images
// and then lands on Activity. It keeps only its own frame, where the exit is
// and its estimate of the time left; the pull it shows comes from the
// Activity snapshot.
type prebootScreen struct {
	frame int
	// since counts the frames the exit has played, -1 while the pull plays.
	since int
	pace  preboot.Pace
}

func newPrebootScreen() *prebootScreen { return &prebootScreen{since: -1} }

var (
	prebootKoFi    = hint("c", "Ko-fi")
	prebootSponsor = hint("s", "GitHub Sponsors")
	prebootSkip    = hint("enter", "skip")
	prebootKeys    = []key.Binding{prebootKoFi, prebootSponsor, prebootSkip}
)

// framePeriod is the time between frames: the pre-boot screen runs at its
// own rate, everything else at the Activity rate.
func (m Model) framePeriod() time.Duration {
	if m.preboot != nil {
		return time.Second / preboot.FPS
	}
	return time.Second / activity.FPS
}

// advancePreboot plays one frame of pre-boot. The pull ending starts the
// exit; a failure, or the exit ending, lands on Activity.
func (m Model) advancePreboot(s activity.Snapshot) Model {
	p := m.preboot
	if p == nil {
		return m
	}
	p.frame++
	if p.since >= 0 {
		p.since++
	} else {
		p.pace.Observe(p.frame, s.Pull.Fraction)
	}
	switch {
	case s.Pull.Failed || s.Action.Finished && s.Action.Error != "", p.since >= preboot.ExitFrames:
		m.preboot = nil
	case p.since < 0 && pullEnded(s, p.frame):
		p.since = 0
	}
	return m
}

// pullEnded reports that the pull has finished, or that there was nothing to
// pull and the screen has played long enough.
func pullEnded(s activity.Snapshot, frame int) bool {
	if s.Pull.Pulling {
		return false
	}
	return s.Pull.Total > 0 || frame >= noPullFrames
}

func (m Model) handlePrebootKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, m.keys.Quit):
		return m.quit()
	case key.Matches(msg, prebootSkip):
		m.preboot = nil
	case key.Matches(msg, prebootKoFi):
		return m, openLink(m.backend, koFiURL)
	case key.Matches(msg, prebootSponsor):
		return m, openLink(m.backend, sponsorsURL)
	}
	return m, nil
}

// prebootProgress is the pull of the Activity snapshot as the scene shows it.
// Once the exit starts the pull is whole.
func prebootProgress(s activity.Snapshot, p *prebootScreen) preboot.Progress {
	pr := preboot.Progress{Fraction: s.Pull.Fraction, Done: s.Pull.Done, Total: s.Pull.Total,
		Narrative: s.Action.Narrative, Remaining: p.pace.Remaining()}
	if p.since >= 0 {
		pr.Fraction, pr.Done = 1, pr.Total
	}
	return pr
}

// renderPreboot is the whole terminal while pre-boot is on screen. The exit
// opens onto the Dashboard with Activity focused as it is drawn right now.
func (m Model) renderPreboot() string {
	p := m.preboot
	pal := preboot.Dark()
	if !m.theme.dark {
		pal = preboot.Light()
	}
	pr := prebootProgress(m.ctx().snapshot(), p)
	if p.since < 0 {
		if p.frame < preboot.EntranceFrames {
			return strings.Join(preboot.RenderEntrance(p.frame, m.width, m.height, pr, pal, m.opts.NoColor), "\n")
		}
		return strings.Join(preboot.Render(p.frame, m.width, m.height, pr, pal, m.opts.NoColor), "\n")
	}
	m.preboot = nil
	landing := strings.Split(m.View().Content, "\n")
	return strings.Join(preboot.RenderExit(p.frame, p.since, m.width, m.height, pr, pal, m.opts.NoColor, landing), "\n")
}
