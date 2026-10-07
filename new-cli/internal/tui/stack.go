package tui

import (
	"fmt"
	"strings"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"

	"github.com/ajnart/self-host/internal/service"
)

// stackView is the full-screen Stack surface: every container in the
// Project's Compose project, at a glance.
type stackView struct {
	cursor int
	offset int
}

var stackHelp = []key.Binding{
	hint("↑/↓", "select"), hint("u", "update"), hint("r", "re-check"), hint("esc", "back"),
}

func (v *stackView) scroll(height, dy int) {
	v.cursor += sign(dy)
	if v.cursor < 0 {
		v.cursor = 0
	}
}

func (m Model) handleStackKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch {
	case msg.String() == "esc":
		m.surface = surfaceDashboard
		return m, nil
	case key.Matches(msg, m.keys.Quit):
		m.tasks.cancelAll()
		m.stopLogs()
		return m, tea.Quit
	case key.Matches(msg, m.keys.Up):
		m.stack.cursor = max(m.stack.cursor-1, 0)
	case key.Matches(msg, m.keys.Down):
		m.stack.cursor = min(m.stack.cursor+1, max(len(m.containers)-1, 0))
	case key.Matches(msg, m.keys.Update):
		return m.updateSelectedContainer()
	case key.Matches(msg, m.keys.Retry):
		return m, m.loadUpdates()
	}
	return m, nil
}

func (m Model) appStatus(id string) (service.AppStatus, bool) {
	for _, a := range m.status.Apps {
		if a.ID == id {
			return a, true
		}
	}
	return service.AppStatus{}, false
}

// appUpdate is the App's update state, from the checks the model has run.
func (m Model) appUpdate(id string) string {
	if state, found := m.updates[id]; found && state != "" {
		return state
	}
	if app, found := m.appStatus(id); found && app.Update != "" {
		return app.Update
	}
	return service.UpdateUnknown
}

func (m Model) updateSelectedContainer() (tea.Model, tea.Cmd) {
	if m.stack.cursor >= len(m.containers) {
		return m, nil
	}
	id := m.containers[m.stack.cursor].App
	if id == "" {
		m.setFlash("this container has no App", levelWarn)
		return m, nil
	}
	app, found := m.appStatus(id)
	if !found {
		return m, nil
	}
	if m.appUpdate(id) != service.UpdateAvailable {
		m.setFlash("no update known for "+app.Name+" (press r to re-check)", levelInfo)
		return m, nil
	}
	return m.run(Request{Action: ActionUpdate, IDs: []string{id}}, "update "+id)
}

func (m Model) renderStack() string {
	t := m.theme
	inner := max(m.width-4, 10)
	showUptime := m.width >= 96
	showPorts := m.width >= 118
	showImage := m.width >= 150
	var lines []string
	lines = append(lines, "  "+m.stackHeader(), "")

	header := "  " + t.dim().Render(pad("APP", 12)+pad("SERVICE", 16)+pad("STATE", 11)+pad("HEALTH", 11)+pad("UPD", 11))
	if showUptime {
		header += t.dim().Render(pad("UPTIME", 18))
	}
	if showImage {
		header += t.dim().Render(pad("IMAGE", 36))
	}
	if showPorts {
		header += t.dim().Render("PORTS")
	}
	lines = append(lines, truncate(header, inner))

	avail := m.mainHeight() - 5
	if avail < 1 {
		avail = 1
	}
	if len(m.containers) == 0 {
		msg := "No containers. Is the Project started?"
		if m.containersErr != "" {
			msg = "Could not read containers: " + m.containersErr
		}
		lines = append(lines, "  "+t.dim().Render(truncate(msg, inner)))
		return strings.Join(lines, "\n")
	}
	v := m.stack
	v.cursor = max(min(v.cursor, len(m.containers)-1), 0)
	if v.cursor < v.offset {
		v.offset = v.cursor
	}
	if v.cursor >= v.offset+avail {
		v.offset = v.cursor - avail + 1
	}
	v.offset = max(min(v.offset, max(len(m.containers)-avail, 0)), 0)
	for i := v.offset; i < len(m.containers) && i-v.offset < avail; i++ {
		lines = append(lines, m.renderStackRow(m.containers[i], i, showUptime, showImage, showPorts, inner))
	}
	return strings.Join(lines, "\n")
}

func (m Model) renderStackRow(c service.ContainerStatus, i int, uptime, image, ports bool, width int) string {
	t := m.theme
	cursor := "  "
	if i == m.stack.cursor {
		cursor = t.fg(t.accent).Bold(true).Render("> ")
	}
	line := cursor + t.body().Render(pad(c.App, 12)) + t.dim().Render(pad(c.Service, 16)) +
		pad(c.State, 11) + t.dim().Render(pad(c.Health, 11)) + pad(m.updateMark(c.App), 11)
	if uptime {
		line += t.dim().Render(pad(c.Status, 18))
	}
	if image {
		line += t.dim().Render(pad(c.Image, 36))
	}
	if ports {
		line += t.dim().Render(strings.Join(c.Ports, " "))
	}
	return truncate(line, width)
}

// updateMark is one App's update column: an update, current, or unknown.
func (m Model) updateMark(appID string) string {
	t := m.theme
	switch m.appUpdate(appID) {
	case service.UpdateAvailable:
		return t.fg(t.warn).Render("⚠ update")
	case service.UpdateCurrent:
		return t.fg(t.ok).Render("✓ current")
	default:
		return t.dim().Render("? unknown")
	}
}

func (m Model) stackHeader() string {
	running, updates := 0, 0
	for _, c := range m.containers {
		if c.State == "running" {
			running++
		}
	}
	for _, a := range m.status.Apps {
		if m.appUpdate(a.ID) == service.UpdateAvailable {
			updates++
		}
	}
	checked := "checking…"
	if !m.updatesAt.IsZero() {
		checked = "checked " + m.updatesAt.Format("15:04")
	}
	return fmt.Sprintf("%s · %d running · %s · %s",
		plural(len(m.containers), "container", "containers"), running, plural(updates, "App with an update", "Apps with updates"), checked)
}
