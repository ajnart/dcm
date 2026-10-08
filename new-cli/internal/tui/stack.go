package tui

import (
	"context"
	"fmt"
	"strings"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/service"
)

// stackView is the full-screen Stack surface: every container in the
// Project's Compose project, at a glance.
type stackView struct {
	cursor int
	offset int
}

var stackHelp = []key.Binding{
	hint("↑/↓", "select"), hint("enter", "start/stop"), hint("1", "UP"), hint("2", "DOWN"), hint("3", "restart all"),
	hint("u", "update"), hint("r", "re-check"), hint("esc", "back"),
}

var stackControls = []struct {
	key, label string
	action     Action
}{
	{"1", "UP", ActionUp},
	{"2", "DOWN", ActionDown},
	{"3", "RESTART", ActionRestart},
}

func (v *stackView) Keys() []key.Binding { return stackHelp }

func (v *stackView) Title() string { return "Stack" }

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
	case clickMsg:
		for _, control := range stackControls {
			if msg.id == "stack:"+string(control.action) {
				return v, v.controlProject(ctx, control.action), nav{}
			}
		}
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
	for _, control := range stackControls {
		if msg.String() == control.key {
			return v, v.controlProject(ctx, control.action), nav{}
		}
	}
	switch {
	case msg.String() == "esc":
		return v, nil, nav{kind: navBack}
	case key.Matches(msg, ctx.keys.Quit):
		ctx.tasks.cancelAll()
		return v, tea.Quit, nav{}
	case key.Matches(msg, ctx.keys.Up):
		v.cursor = max(v.cursor-1, 0)
	case key.Matches(msg, ctx.keys.Down):
		v.cursor = min(v.cursor+1, max(len(ctx.containers)-1, 0))
	case key.Matches(msg, ctx.keys.Toggle):
		return v, v.toggleSelected(ctx), nav{}
	case key.Matches(msg, ctx.keys.Update):
		return v, v.updateSelected(ctx), nav{}
	case key.Matches(msg, ctx.keys.Retry):
		return v, loadUpdatesCmd(ctx.backend, ctx.status), nav{}
	}
	return v, nil, nav{}
}

func (v *stackView) controlProject(ctx *viewContext, action Action) tea.Cmd {
	if ctx.status.Project == "" || len(ctx.status.Apps) == 0 {
		ctx.setFlash("the Project has no Apps", levelWarn)
		return nil
	}
	if ctx.tasks.running() > 0 {
		ctx.setFlash("wait for the running action to finish", levelInfo)
		return nil
	}
	return ctx.run(Request{Action: action}, string(action)+" Project")
}

func (v *stackView) toggleSelected(ctx *viewContext) tea.Cmd {
	if v.cursor < 0 || v.cursor >= len(ctx.containers) {
		return nil
	}
	app, found := appStatus(ctx, ctx.containers[v.cursor].App)
	if !found {
		return nil
	}
	if app.State == "running" || app.State == "degraded" {
		return ctx.run(Request{Action: ActionStop, IDs: []string{app.ID}}, "stop "+app.ID)
	}
	return ctx.run(Request{Action: ActionStart, IDs: []string{app.ID}}, "start "+app.ID)
}

func loadUpdatesCmd(backend Backend, status service.Status) tea.Cmd {
	return func() tea.Msg { return updatesMsg{updates: backend.Updates(context.Background(), status)} }
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

func (v *stackView) updateSelected(ctx *viewContext) tea.Cmd {
	if v.cursor >= len(ctx.containers) {
		return nil
	}
	id := ctx.containers[v.cursor].App
	if id == "" {
		ctx.setFlash("this container has no App", levelWarn)
		return nil
	}
	app, found := appStatus(ctx, id)
	if !found {
		return nil
	}
	if appUpdate(ctx, id) != service.UpdateAvailable {
		ctx.setFlash("no update known for "+app.Name+" (press r to re-check)", levelInfo)
		return nil
	}
	return ctx.run(Request{Action: ActionUpdate, IDs: []string{id}}, "update "+id)
}

func (v *stackView) View(ctx *viewContext, width, height int) string {
	t := ctx.theme
	inner := max(width-4, 10)
	showUptime := width >= 96
	showPorts := width >= 118
	showImage := width >= 150
	var lines []string
	lines = append(lines, "  "+stackHeader(ctx), "")
	controls := "  "
	for _, control := range stackControls {
		button := t.chip(control.key+" "+control.label, t.accent)
		ctx.layers = append(ctx.layers, lipgloss.NewLayer(button).X(lipgloss.Width(controls)).Y(3).ID("stack:"+string(control.action)))
		controls += button + "  "
	}
	lines = append(lines, truncate(controls, inner), "")

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

	avail := height - 7
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
		cursor = t.fg(t.accent).Bold(true).Render("> ")
	}
	line := cursor + t.body().Render(pad(c.App, 12)) + t.dim().Render(pad(c.Service, 16)) +
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
