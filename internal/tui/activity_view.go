package tui

import (
	"strings"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/service"
)

type activityView struct {
	cursor    int
	offset    int
	toggled   map[string]bool
	searching bool
	filter    string
	// failures holds the "app/step" failed steps whose error and hint are open.
	failures map[string]bool
}

// activityRow is one navigable line: an App header, or one of its steps.
type activityRow struct {
	app  activity.App
	step *activity.Step
}

func (v *activityView) Title() string { return "Activity" }

var (
	activityKeys = []key.Binding{hint("↑/↓", "select"), hint("a", "actions"), hint("enter", "error/hint"),
		hint("space", "collapse"), hint("/", "search"), hint("pgup/pgdn", "page"), hint("esc", "back")}
	activitySearchKeys = []key.Binding{hint("enter", "done"), hint("esc", "clear")}
)

// Keys puts frequent keys first: a narrow bar cuts the tail.
func (v *activityView) Keys() []key.Binding {
	if v.searching {
		return activitySearchKeys
	}
	return activityKeys
}

func (v *activityView) Panes() []pane {
	return []pane{{"Steps", activityKeys}, {"Errors", errorKeys}, {"Search", activitySearchKeys}}
}

func (v *activityView) Capturing() bool { return v.searching }

// selectedApp is the App of the selected row, which a opens the menu for.
func (v *activityView) selectedApp(ctx *viewContext) (service.AppStatus, bool) {
	rows := v.rows(ctx)
	if v.cursor >= len(rows) {
		return service.AppStatus{}, false
	}
	return appStatus(ctx, rows[v.cursor].app.ID)
}

// expanded reports whether the App's steps are shown: a set-up App starts
// collapsed, everything else starts expanded, and space overrides that.
func (v *activityView) expanded(app activity.App) bool {
	if on, ok := v.toggled[app.ID]; ok {
		return on
	}
	return !app.SetUp
}

func (v *activityView) setExpanded(id string, on bool) {
	if v.toggled == nil {
		v.toggled = map[string]bool{}
	}
	v.toggled[id] = on
}

// apps narrows the Project to the Apps matching the filter on name or id.
func (v *activityView) apps(ctx *viewContext) []activity.App {
	all := ctx.snapshot().Apps
	if v.filter == "" {
		return all
	}
	q := strings.ToLower(v.filter)
	var out []activity.App
	for _, app := range all {
		if strings.Contains(strings.ToLower(app.Name), q) || strings.Contains(strings.ToLower(app.ID), q) {
			out = append(out, app)
		}
	}
	return out
}

func (v *activityView) rows(ctx *viewContext) []activityRow {
	var out []activityRow
	for _, app := range v.apps(ctx) {
		out = append(out, activityRow{app: app})
		if !v.expanded(app) {
			continue
		}
		for i := range app.Steps {
			out = append(out, activityRow{app: app, step: &app.Steps[i]})
		}
	}
	return out
}

func (v *activityView) clamp(ctx *viewContext) {
	v.cursor = max(min(v.cursor, len(v.rows(ctx))-1), 0)
}

func (v *activityView) toggle(ctx *viewContext) {
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
func (v *activityView) toggleFailure(ctx *viewContext) {
	rows := v.rows(ctx)
	if v.cursor >= len(rows) {
		return
	}
	row := rows[v.cursor]
	if row.step == nil || row.step.State != activity.Failed {
		return
	}
	if v.failures == nil {
		v.failures = map[string]bool{}
	}
	id := row.app.ID + "/" + row.step.ID
	v.failures[id] = !v.failures[id]
}

// scroll moves the selection by dy rows; the View keeps it on screen.
func (v *activityView) scroll(ctx *viewContext, dy int) {
	v.cursor += dy
	v.clamp(ctx)
}

func (v *activityView) Update(ctx *viewContext, msg tea.Msg) (view, tea.Cmd, nav) {
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

func (v *activityView) key(ctx *viewContext, press tea.KeyPressMsg) (view, tea.Cmd, nav) {
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
	case press.String() == "enter":
		v.toggleFailure(ctx)
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

func (v *activityView) View(ctx *viewContext, width, height int) string {
	t := ctx.theme
	s := ctx.snapshot()
	rows := v.rows(ctx)
	v.cursor = max(min(v.cursor, len(rows)-1), 0)
	lines := []string{"  " + t.title().Render("Activity") + " · " +
		plural(s.Counts.AppsSetUp, "App fully set up", "Apps fully set up") + " · " +
		plural(s.Counts.StepsFailed, "step failed", "steps failed") + " · " +
		plural(s.Counts.StepsRunning, "step running", "steps running"), ""}
	if !v.searching && v.errorText(ctx) != "" {
		lines[1] = "  " + t.dim().Render("c copies full error · e inspects it · selected failed step, else latest Action")
	}
	// The Action leaves room for a few of every App's remembered steps.
	if block := activity.Render(s, ctx.motion, width-2, ctx.glyphs, t.palette()); len(block) > 0 {
		if limit := max(height-8, 6); len(block) > limit {
			block = append(block[:limit-1], t.dim().Render("…"))
		}
		for _, line := range block {
			lines = append(lines, "  "+line)
		}
		lines = append(lines, "")
	}
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
func (v *activityView) rowLines(ctx *viewContext, row activityRow, cursor string, width int) []string {
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
	line := "    " + cursor + t.stepMark(step.State) + " " + step.Label
	if step.Msg != "" {
		line += t.dim().Render(" · " + firstLine(step.Msg))
	}
	out := []string{line}
	if step.State != activity.Manual && (step.State != activity.Failed || !v.failures[row.app.ID+"/"+step.ID]) {
		return out
	}
	if step.Error != "" {
		out = append(out, strings.Split(indent("        error: ", t.fg(t.fail).Render(step.Error), width), "\n")...)
	}
	if step.Hint != "" {
		out = append(out, strings.Split(indent("        hint: ", t.dim().Render(step.Hint), width), "\n")...)
	}
	return out
}
