package tui

import (
	"context"
	"fmt"
	"strings"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"

	"github.com/ajnart/self-host/internal/service"
)

// stackView is the Apps tab for now: every container in the Project's
// Compose project, at a glance. It is a single pane.
type stackView struct {
	cursor int
	offset int
}

// Project-wide controls live in the A menu; a opens the selected
// container's App menu.
var stackHelp = []key.Binding{
	hint("↑/↓", "select"), hint("a", "actions"), hint("r", "check updates"), hint("esc", "back"),
}

func (v *stackView) Keys() []key.Binding { return stackHelp }

func (v *stackView) Panes() []pane { return []pane{{"Containers", stackHelp}} }

func (v *stackView) Capturing() bool { return false }

func (v *stackView) Title() string { return "Apps" }

func (v *stackView) scroll(height, dy int) {
	v.cursor += sign(dy)
	if v.cursor < 0 {
		v.cursor = 0
	}
}

func (v *stackView) Update(ctx *viewContext, msg tea.Msg) (view, tea.Cmd, nav) {
	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		return v.key(ctx, msg)
	case tea.MouseWheelMsg:
		dy := 3
		if msg.Button == tea.MouseWheelUp {
			dy = -3
		}
		v.scroll(ctx.mainHeight(), dy)
		return v, nil, nav{}
	}
	return v, nil, nav{}
}

func (v *stackView) key(ctx *viewContext, msg tea.KeyPressMsg) (view, tea.Cmd, nav) {
	switch {
	case msg.String() == "esc":
		return v, nil, nav{kind: navBack}
	case key.Matches(msg, ctx.keys.Up):
		v.cursor = max(v.cursor-1, 0)
	case key.Matches(msg, ctx.keys.Down):
		v.cursor = min(v.cursor+1, max(len(ctx.containers)-1, 0))
	case msg.String() == "r":
		return v, loadUpdatesCmd(ctx.backend, ctx.status), nav{}
	}
	return v, nil, nav{}
}

func loadUpdatesCmd(backend Backend, status service.Status) tea.Cmd {
	return func() tea.Msg { return updatesMsg{updates: backend.Updates(context.Background(), status)} }
}

// selectedApp is the selected container's App, which a opens the menu for.
func (v *stackView) selectedApp(ctx *viewContext) (service.AppStatus, bool) {
	if v.cursor < 0 || v.cursor >= len(ctx.containers) {
		return service.AppStatus{}, false
	}
	return appStatus(ctx, ctx.containers[v.cursor].App)
}

func appStatus(ctx *viewContext, id string) (service.AppStatus, bool) {
	for _, a := range ctx.status.Apps {
		if a.ID == id {
			return a, true
		}
	}
	return service.AppStatus{}, false
}

// appUpdate is the App's update state, from the checks the model has run.
func appUpdate(ctx *viewContext, id string) string {
	if state, found := ctx.updates[id]; found && state != "" {
		return state
	}
	if app, found := appStatus(ctx, id); found && app.Update != "" {
		return app.Update
	}
	return service.UpdateUnknown
}

func (v *stackView) View(ctx *viewContext, width, height int) string {
	t := ctx.theme
	inner := max(width-4, 10)
	showUptime := width >= 96
	showPorts := width >= 118
	showImage := width >= 150
	var lines []string
	lines = append(lines, "  "+stackHeader(ctx), "")

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

	avail := height - 3
	if avail < 1 {
		avail = 1
	}
	if len(ctx.containers) == 0 {
		msg := "No containers. Is the Project started?"
		if ctx.containersErr != "" {
			msg = "Could not read containers: " + ctx.containersErr
		}
		lines = append(lines, "  "+t.dim().Render(truncate(msg, inner)))
		return strings.Join(lines, "\n")
	}
	v.cursor = max(min(v.cursor, len(ctx.containers)-1), 0)
	if v.cursor < v.offset {
		v.offset = v.cursor
	}
	if v.cursor >= v.offset+avail {
		v.offset = v.cursor - avail + 1
	}
	v.offset = max(min(v.offset, max(len(ctx.containers)-avail, 0)), 0)
	for i := v.offset; i < len(ctx.containers) && i-v.offset < avail; i++ {
		lines = append(lines, v.renderRow(ctx, ctx.containers[i], i, showUptime, showImage, showPorts, inner))
	}
	return strings.Join(lines, "\n")
}

func (v *stackView) renderRow(ctx *viewContext, c service.ContainerStatus, i int, uptime, image, ports bool, width int) string {
	t := ctx.theme
	cursor := "  "
	if i == v.cursor {
		cursor = t.cursor()
	}
	line := cursor + t.dim().Render(categoryIcon(ctx, c.App)) + " " + t.body().Render(pad(c.App, 10)) + t.dim().Render(pad(c.Service, 16)) +
		pad(c.State, 11) + t.dim().Render(pad(c.Health, 11)) + pad(updateMark(ctx, c.App), 11)
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
func updateMark(ctx *viewContext, appID string) string {
	t := ctx.theme
	switch appUpdate(ctx, appID) {
	case service.UpdateAvailable:
		return t.fg(t.warn).Render("⚠ update")
	case service.UpdateCurrent:
		return t.fg(t.ok).Render("✓ current")
	default:
		return t.dim().Render("? unknown")
	}
}

func stackHeader(ctx *viewContext) string {
	running, updates := 0, 0
	for _, c := range ctx.containers {
		if c.State == "running" {
			running++
		}
	}
	for _, a := range ctx.status.Apps {
		if appUpdate(ctx, a.ID) == service.UpdateAvailable {
			updates++
		}
	}
	checked := "checking…"
	if !ctx.updatesAt.IsZero() {
		checked = "checked " + ctx.updatesAt.Format("15:04")
	}
	return fmt.Sprintf("%s · %d running · %s · %s",
		plural(len(ctx.containers), "container", "containers"), running, plural(updates, "App with an update", "Apps with updates"), checked)
}
