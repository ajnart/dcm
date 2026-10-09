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
	// failures holds the "app/step" failed steps whose error and hint are open.
	failures map[string]bool
}

// workflowRow is one navigable line: an App header, or one of its steps.
type workflowRow struct {
	app  WorkflowApp
	step *WorkflowStep
}

func (v *workflowView) Title() string { return "Activity" }

// The r key acts until #133's Action menu replaces it.
var (
	activityKeys = []key.Binding{hint("↑/↓", "select"), hint("enter", "error/hint"), hint("space", "collapse"),
		hint("/", "search"), hint("r", "retry Setup"), hint("pgup/pgdn", "page"), hint("esc", "back")}
	activitySearchKeys = []key.Binding{hint("enter", "done"), hint("esc", "clear")}
)

// Keys puts frequent keys first: a narrow bar cuts the tail.
func (v *workflowView) Keys() []key.Binding {
	if v.searching {
		return activitySearchKeys
	}
	return activityKeys
}

func (v *workflowView) Panes() []pane {
	return []pane{{"Steps", activityKeys}, {"Search", activitySearchKeys}}
}

func (v *workflowView) Capturing() bool { return v.searching }

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

// toggleFailure opens or closes the error and hint of the selected failed step.
func (v *workflowView) toggleFailure(ctx *viewContext) {
	rows := v.rows(ctx)
	if v.cursor >= len(rows) {
		return
	}
	row := rows[v.cursor]
	if row.step == nil || row.step.State != WorkflowFailed {
		return
	}
	if v.failures == nil {
		v.failures = map[string]bool{}
	}
	id := row.app.ID + "/" + row.step.ID
	v.failures[id] = !v.failures[id]
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
	case key.Matches(press, ctx.keys.Toggle):
		v.toggleFailure(ctx)
	case key.Matches(press, ctx.keys.Retry):
		rows := v.rows(ctx)
		if v.cursor < len(rows) && rows[v.cursor].app.Managed {
			id := rows[v.cursor].app.ID
			return v, ctx.run(Request{Action: ActionSetup, IDs: []string{id}}, "setup "+id), nav{}
		}
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
	lines := []string{"  " + t.title().Render("Activity") + " · " +
		plural(workflow.Counts.AppsSetUp, "App fully set up", "Apps fully set up") + " · " +
		plural(workflow.Counts.StepsFailed, "step failed", "steps failed") + " · " +
		plural(workflow.Counts.StepsRunning, "step running", "steps running"), ""}
	if v.filter != "" {
		hint := ""
		if !v.searching {
			hint = "  (esc clears)"
		}
		lines = append(lines, "  "+t.dim().Render("/"+v.filter+hint), "")
	}
	// Render every row, then scroll by screen lines so an open failure's
	// error and hint never push the selection off screen.
	var body []string
	first, last := 0, 0
	for i, row := range rows {
		cursor := "  "
		if i == v.cursor {
			cursor = t.cursor()
			first = len(body)
		}
		body = append(body, v.rowLines(ctx, row, cursor, width)...)
		if i == v.cursor {
			last = len(body) - 1
		}
	}
	avail := max(height-len(lines), 1)
	if first < v.offset {
		v.offset = first
	}
	if last >= v.offset+avail {
		v.offset = max(last-avail+1, first)
	}
	v.offset = max(min(v.offset, len(body)-avail), 0)
	end := min(v.offset+avail, len(body))
	lines = append(lines, body[v.offset:end]...)
	return fit(strings.Join(lines, "\n"), width, height)
}

// rowLines renders one row: an App header, or a step plus, when opened, its
// error and hint.
func (v *workflowView) rowLines(ctx *viewContext, row workflowRow, cursor string, width int) []string {
	t := ctx.theme
	if row.step == nil {
		chevron := t.dim().Render("▾")
		if !v.expanded(row.app) {
			chevron = t.dim().Render("▸")
		}
		line := "  " + cursor + chevron + " " + t.title().Render(row.app.Name)
		if !row.app.Managed {
			line += t.dim().Render(" · added by hand, no Setup")
		} else if len(row.app.Steps) == 0 {
			line += t.dim().Render(" · Setup has no recorded steps yet")
		}
		return []string{line}
	}
	step := row.step
	mark := t.dim().Render("○")
	switch step.State {
	case WorkflowDone:
		mark = t.fg(t.ok).Render("✓")
	case WorkflowSkipped:
		mark = t.fg(t.info).Render("↷")
	case WorkflowManual:
		mark = t.fg(t.warn).Render("! manual")
	case WorkflowFailed:
		mark = t.fg(t.fail).Render("✗")
	case WorkflowRunning:
		mark = t.fg(t.accentText).Render("…")
	}
	line := "  " + cursor + mark + " " + step.Label
	if step.Msg != "" {
		line += t.dim().Render(" · " + firstLine(step.Msg))
	}
	out := []string{line}
	if step.State != WorkflowManual && (step.State != WorkflowFailed || !v.failures[row.app.ID+"/"+step.ID]) {
		return out
	}
	if step.Error != "" {
		out = append(out, strings.Split(indent("      error: ", t.fg(t.fail).Render(step.Error), width), "\n")...)
	}
	if step.Hint != "" {
		out = append(out, strings.Split(indent("      hint: ", t.dim().Render(step.Hint), width), "\n")...)
	}
	return out
}
