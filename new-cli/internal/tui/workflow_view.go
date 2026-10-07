package tui

import (
	"strings"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
)

type workflowView struct {
	cursor    int
	offset    int
	toggled   map[string]bool
	searching bool
	filter    string
}

// workflowRow is one navigable line: an App header, or one of its steps.
type workflowRow struct {
	app  WorkflowApp
	step *WorkflowStep
}

func (v *workflowView) Title() string { return "Workflow" }

func (v *workflowView) Keys() []key.Binding {
	k := newKeyMap()
	return []key.Binding{k.Up, k.Down, k.ScrollUp, k.ScrollDown, k.Search, hint("space", "collapse"), k.Back}
}

// expanded reports whether the App's steps are shown: a set-up App starts
// collapsed, everything else starts expanded, and space overrides that.
func (v *workflowView) expanded(app WorkflowApp) bool {
	if on, ok := v.toggled[app.ID]; ok {
		return on
	}
	return !app.SetUp
}

func (v *workflowView) setExpanded(id string, on bool) {
	if v.toggled == nil {
		v.toggled = map[string]bool{}
	}
	v.toggled[id] = on
}

// apps narrows the Project to the Apps matching the filter on name or id.
func (v *workflowView) apps(ctx *viewContext) []WorkflowApp {
	all := ctx.workflow().Apps
	if v.filter == "" {
		return all
	}
	q := strings.ToLower(v.filter)
	var out []WorkflowApp
	for _, app := range all {
		if strings.Contains(strings.ToLower(app.Name), q) || strings.Contains(strings.ToLower(app.ID), q) {
			out = append(out, app)
		}
	}
	return out
}

func (v *workflowView) rows(ctx *viewContext) []workflowRow {
	var out []workflowRow
	for _, app := range v.apps(ctx) {
		out = append(out, workflowRow{app: app})
		if !v.expanded(app) {
			continue
		}
		for i := range app.Steps {
			out = append(out, workflowRow{app: app, step: &app.Steps[i]})
		}
	}
	return out
}

func (v *workflowView) clamp(ctx *viewContext) {
	v.cursor = max(min(v.cursor, len(v.rows(ctx))-1), 0)
}

func (v *workflowView) toggle(ctx *viewContext) {
	rows := v.rows(ctx)
	if v.cursor >= len(rows) {
		return
	}
	app := rows[v.cursor].app
	v.setExpanded(app.ID, !v.expanded(app))
	for i, row := range v.rows(ctx) {
		if row.app.ID == app.ID {
			v.cursor = i
			return
		}
	}
}

// scroll moves the selection by dy rows; the View keeps it on screen.
func (v *workflowView) scroll(ctx *viewContext, dy int) {
	v.cursor += dy
	v.clamp(ctx)
}

func (v *workflowView) Update(ctx *viewContext, msg tea.Msg) (view, tea.Cmd, nav) {
	switch msg := msg.(type) {
	case tea.MouseWheelMsg:
		dy := 3
		if msg.Button == tea.MouseWheelUp {
			dy = -3
		}
		v.scroll(ctx, dy)
		return v, nil, nav{}
	case tea.KeyPressMsg:
		return v.key(ctx, msg)
	}
	return v, nil, nav{}
}

func (v *workflowView) key(ctx *viewContext, press tea.KeyPressMsg) (view, tea.Cmd, nav) {
	if v.searching {
		switch press.String() {
		case "enter":
			v.searching = false
		case "esc":
			v.searching, v.filter = false, ""
			v.clamp(ctx)
		case "backspace":
			if runes := []rune(v.filter); len(runes) > 0 {
				v.filter = string(runes[:len(runes)-1])
			}
			v.clamp(ctx)
		default:
			v.filter += press.Text
			v.clamp(ctx)
		}
		return v, nil, nav{}
	}
	switch {
	case key.Matches(press, ctx.keys.Back):
		if v.filter != "" {
			v.filter = ""
			v.clamp(ctx)
			return v, nil, nav{}
		}
		return v, nil, nav{kind: navBack}
	case key.Matches(press, ctx.keys.Search):
		v.searching = true
	case press.String() == "space":
		v.toggle(ctx)
	case key.Matches(press, ctx.keys.Up):
		v.cursor = max(v.cursor-1, 0)
	case key.Matches(press, ctx.keys.Down):
		v.cursor = min(v.cursor+1, max(len(v.rows(ctx))-1, 0))
	case key.Matches(press, ctx.keys.ScrollUp):
		v.scroll(ctx, -5)
	case key.Matches(press, ctx.keys.ScrollDown):
		v.scroll(ctx, 5)
	}
	return v, nil, nav{}
}

func (v *workflowView) View(ctx *viewContext, width, height int) string {
	t := ctx.theme
	workflow := ctx.workflow()
	rows := v.rows(ctx)
	v.cursor = max(min(v.cursor, len(rows)-1), 0)
	lines := []string{"  " + t.title().Render("Workflow") + " · " +
		plural(workflow.Counts.AppsSetUp, "App fully set up", "Apps fully set up") + " · " +
		plural(workflow.Counts.StepsFailed, "step failed", "steps failed"), ""}
	if v.filter != "" {
		hint := ""
		if !v.searching {
			hint = "  (esc clears)"
		}
		lines = append(lines, "  "+t.dim().Render("/"+v.filter+hint), "")
	}
	avail := height - len(lines)
	if avail < 1 {
		avail = 1
	}
	if v.cursor < v.offset {
		v.offset = v.cursor
	}
	if v.cursor >= v.offset+avail {
		v.offset = v.cursor - avail + 1
	}
	v.offset = max(min(v.offset, max(len(rows)-avail, 0)), 0)
	for i := v.offset; i < len(rows) && i-v.offset < avail; i++ {
		row := rows[i]
		cursor := "  "
		if i == v.cursor {
			cursor = t.fg(t.accent).Bold(true).Render("> ")
		}
		if row.step == nil {
			chevron := t.dim().Render("▾")
			if !v.expanded(row.app) {
				chevron = t.dim().Render("▸")
			}
			lines = append(lines, "  "+cursor+chevron+" "+t.title().Render(row.app.Name))
			if v.expanded(row.app) {
				if !row.app.Managed {
					lines = append(lines, "      "+t.dim().Render("added by hand, no Setup"))
				} else if len(row.app.Steps) == 0 {
					lines = append(lines, "      "+t.dim().Render("no remembered steps"))
				}
			}
			continue
		}
		mark := t.dim().Render("○")
		switch row.step.State {
		case WorkflowDone:
			mark = t.fg(t.ok).Render("✓")
		case WorkflowSkipped:
			mark = t.fg(t.info).Render("↷")
		case WorkflowFailed:
			mark = t.fg(t.fail).Render("✗")
		}
		line := "  " + cursor + mark + " " + row.step.Label
		if row.step.Msg != "" {
			line += t.dim().Render(" · " + firstLine(row.step.Msg))
		}
		lines = append(lines, line)
	}
	return fit(strings.Join(lines, "\n"), width, height)
}
