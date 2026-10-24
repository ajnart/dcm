package tui

import (
	"fmt"
	"strings"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"

	"github.com/ajnart/self-host/internal/service"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

// askKind is what a start-up question is about, asked at most once a session.
type askKind int

const (
	askNetwork askKind = iota
	askResume
	askSetup
	askStopped
	askUpdates
	askQuit
)

// askPrompt is a yes/no question the Dashboard asks once it is idle, about
// something it found on start: a changed network, stopped Apps or App
// updates. Yes runs one Action in the background; no leaves things as they are.
type askPrompt struct {
	kind  askKind
	title string
	body  []string
	query string
	req   Request
	task  string
}

var (
	askYes = key.NewBinding(key.WithKeys("y"), key.WithHelp("y", "yes"))
	askNo  = key.NewBinding(key.WithKeys("n", "esc"), key.WithHelp("n", "not now"))
)

// offerAsk asks the first start-up question that applies and was not asked yet.
func (m Model) offerAsk() Model {
	if m.ask != nil || m.upgrade != nil || m.quitting || m.opts.NoStartupPrompts || !m.statusFresh || !m.idle() || m.status.DockerError != "" {
		return m
	}
	for _, kind := range []askKind{askNetwork, askResume, askSetup, askStopped, askUpdates} {
		if m.asked[kind] {
			continue
		}
		if prompt := startQuestion(kind, m.status); prompt != nil {
			if m.asked == nil {
				m.asked = map[askKind]bool{}
			}
			m.asked[kind] = true
			m.ask = prompt
			return m
		}
	}
	return m
}

func startQuestion(kind askKind, status service.Status) *askPrompt {
	switch kind {
	case askNetwork:
		if !status.LANIPStale || len(status.HostIPs) == 0 {
			return nil
		}
		now := status.HostIPs[0]
		body := []string{fmt.Sprintf("Your Apps use %s, but this machine is now on %s, so their addresses do not work.", status.LANIP, now)}
		if status.Settings["EASY_NAMES"] == "on" {
			body = append(body, "Easy names contain the LAN address, so update bookmarks afterward.")
		}
		return &askPrompt{
			kind:  kind,
			title: "Your network changed",
			body:  body,
			query: fmt.Sprintf("Switch to %s and recreate the Apps that use it?", now),
			req:   Request{Action: ActionConfig, Pairs: []string{"LAN_IP=" + now}},
			task:  "config LAN_IP=" + now,
		}
	case askResume, askSetup:
		want := stepstatus.SetupPending
		if kind == askSetup {
			want = stepstatus.SetupIncomplete
		}
		var ids, names []string
		for _, a := range status.Apps {
			if a.Managed && a.Setup == want {
				ids, names = append(ids, a.ID), append(names, a.Name)
			}
		}
		if len(ids) == 0 {
			return nil
		}
		list := strings.Join(names, ", ")
		if kind == askSetup {
			return &askPrompt{kind: kind, title: "Setup needs another try",
				body:  []string{"Setup did not finish for " + list + "."},
				query: "Retry Setup?", req: Request{Action: ActionSetup, IDs: ids}, task: "setup " + strings.Join(ids, " ")}
		}
		return &askPrompt{kind: kind, title: "An install did not finish",
			body:  []string{list + " was not fully installed. Resuming pulls its images, starts it and runs Setup; steps already done are skipped."},
			query: "Resume the install?",
			req:   Request{Action: ActionInstall, Install: &service.InstallOptions{Targets: ids}}, task: "install " + strings.Join(ids, " ")}
	case askStopped:
		var names []string
		for _, a := range status.Apps {
			if a.Managed && (a.Setup == stepstatus.SetupPending || a.Setup == stepstatus.SetupIncomplete) {
				continue
			}
			if a.State == "exited" || a.Managed && a.State == "missing" {
				names = append(names, a.Name)
			}
		}
		if len(names) == 0 {
			return nil
		}
		line := names[0] + " is stopped."
		if len(names) == len(status.Apps) && len(names) > 1 {
			line = "All your Apps are stopped."
		} else if len(names) > 1 {
			line = fmt.Sprintf("%d of %d Apps are stopped: %s.", len(names), len(status.Apps), strings.Join(names, ", "))
		}
		return &askPrompt{kind: kind, title: "Apps are stopped", body: []string{line},
			query: "Start the Project?", req: Request{Action: ActionUp}, task: "up Project"}
	case askUpdates:
		var ids, names []string
		for _, a := range status.Apps {
			if a.Update == service.UpdateAvailable {
				ids, names = append(ids, a.ID), append(names, a.Name)
			}
		}
		if len(ids) == 0 {
			return nil
		}
		return &askPrompt{
			kind:  kind,
			title: "App updates available",
			body: []string{
				"Newer images for " + strings.Join(names, ", ") + ".",
				"Updating pulls them and recreates those containers; data stays.",
			},
			query: "Update now?",
			req:   Request{Action: ActionUpdate, IDs: ids},
			task:  "update " + strings.Join(ids, " "),
		}
	}
	return nil
}

func (m Model) handleAskKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	prompt := m.ask
	switch {
	case msg.String() == "ctrl+c":
		return m.quit()
	case key.Matches(msg, askYes):
		if prompt.kind == askQuit {
			return m.stopAndQuit()
		}
		m.ask = nil
		return m.run(prompt.req, prompt.task)
	case key.Matches(msg, askNo):
		m.ask = nil
	}
	return m, nil
}

func (m Model) askBar() (string, []key.Binding) {
	return m.theme.fg(m.theme.accentText).Bold(true).Render("ask"), []key.Binding{askYes, askNo}
}

// renderAsk is the question, in the place of the Help overlay.
func (m Model) renderAsk() string {
	t := m.theme
	width := max(min(m.width-6, 70), 20)
	lines := []string{t.title().Render(m.ask.title), ""}
	for _, line := range m.ask.body {
		lines = append(lines, t.body().Render(wrap(line, width-4)))
	}
	lines = append(lines, "", t.body().Render(wrap(m.ask.query, width-4)),
		t.title().Render("y")+t.dim().Render(" yes · ")+t.title().Render("n")+t.dim().Render(" not now"))
	return t.panel(true).Render(clip(strings.Join(lines, "\n"), width))
}
