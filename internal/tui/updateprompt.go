package tui

import (
	"context"
	"fmt"
	"strings"
	"time"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
)

// updateTimeout bounds the download, as the self-update command does.
const updateTimeout = 6 * time.Minute

type updateState int

const (
	updateAsking updateState = iota
	updateRunning
	updateFailed
)

// updatePrompt is the "Update now?" question over the dashboard, the progress
// of the update it starts and, if that fails, the reason.
type updatePrompt struct {
	version string
	state   updateState
	err     string
}

// updateDoneMsg is the end of the update the prompt started.
type updateDoneMsg struct {
	version string
	err     error
}

var (
	updateYes = key.NewBinding(key.WithKeys("y"), key.WithHelp("y", "update now"))
	updateNo  = key.NewBinding(key.WithKeys("n", "esc"), key.WithHelp("n", "not now"))
)

func releaseVersion(tag string) string {
	return strings.TrimPrefix(strings.TrimPrefix(tag, "new-cli-"), "v")
}

// idle is true when nothing should be interrupted: the Project is read, no
// Onboarding or pre-boot is on screen, no Action runs, and no overlay, menu
// or text input holds the keys.
func (m Model) idle() bool {
	return m.loaded && m.statusErr == "" && m.onboarding == nil && m.preboot == nil &&
		m.tasks.running() == 0 && !m.showHelp && m.menu == nil && !m.activeView().Capturing()
}

// offerUpdate asks about the newest release the first time the dashboard is
// idle, unless the person already skipped that release. Once a session.
func (m Model) offerUpdate() Model {
	if m.upgrade != nil || m.offered || m.quitting || m.latest == "" || m.opts.NoUpdatePrompt {
		return m
	}
	version := releaseVersion(m.latest)
	if version == m.skipped || !m.idle() {
		return m
	}
	m.offered = true
	m.upgrade = &updatePrompt{version: version}
	return m
}

func (m Model) handleUpdateKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	prompt := m.upgrade
	if msg.String() == "ctrl+c" {
		return m.quit()
	}
	switch prompt.state {
	case updateAsking:
		switch {
		case key.Matches(msg, updateYes):
			prompt.state = updateRunning
			backend := m.backend
			return m, func() tea.Msg {
				ctx, cancel := context.WithTimeout(context.Background(), updateTimeout)
				defer cancel()
				version, err := backend.SelfUpdate(ctx)
				return updateDoneMsg{version: version, err: err}
			}
		case key.Matches(msg, updateNo):
			version, backend := prompt.version, m.backend
			m.upgrade, m.skipped = nil, version
			return m, func() tea.Msg {
				backend.SkipUpdate(version)
				return nil
			}
		}
	case updateFailed:
		m.upgrade = nil
	}
	return m, nil
}

func (m Model) handleUpdateDone(msg updateDoneMsg) (tea.Model, tea.Cmd) {
	if m.upgrade == nil {
		return m, nil
	}
	if msg.err != nil {
		m.upgrade.state, m.upgrade.err = updateFailed, msg.err.Error()
		return m, nil
	}
	if msg.version != "" {
		m.upgrade.version = msg.version
	}
	m.restart, m.updatedTo = true, m.upgrade.version
	return m.quit()
}

// restartIfUpdated starts the new binary in this one's place once the
// dashboard has closed and the terminal is back to normal. It returns only
// when the restart failed.
func restartIfUpdated(final Model, backend Backend) error {
	if !final.restart {
		return nil
	}
	if err := backend.Restart(); err != nil {
		return fmt.Errorf("updated to %s, but could not restart (%v); run self-host again", final.updatedTo, err)
	}
	return nil
}

func (m Model) updateBar() (string, []key.Binding) {
	return m.theme.fg(m.theme.accentText).Bold(true).Render("update"), []key.Binding{updateYes, updateNo}
}

// renderUpdate is the prompt, in the place of the Help overlay.
func (m Model) renderUpdate() string {
	t := m.theme
	prompt := m.upgrade
	width := max(min(m.width-6, 70), 20)
	var lines []string
	switch prompt.state {
	case updateAsking:
		lines = []string{
			t.title().Render("Update available"), "",
			t.body().Render(fmt.Sprintf("self-host %s is available (you have %s).", prompt.version, m.opts.Version)),
			"",
			t.body().Render("Update now? ") + t.title().Render("y") + t.dim().Render(" yes · ") + t.title().Render("n") + t.dim().Render(" not now"),
		}
	case updateRunning:
		lines = []string{
			t.title().Render("Updating to " + prompt.version), "",
			t.body().Render("Downloading, checking the checksum and replacing the binary…"),
			t.dim().Render("self-host restarts into the new version when this is done."),
		}
	default:
		lines = []string{
			t.title().Render("Update failed"), "",
			t.fg(t.fail).Render(wrap(prompt.err, width-4)), "",
			t.body().Render("Still running " + m.opts.Version + "."),
			t.dim().Render("Press any key to continue."),
		}
	}
	return t.panel(true).Render(clip(strings.Join(lines, "\n"), width))
}
