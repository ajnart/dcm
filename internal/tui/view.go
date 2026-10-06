package tui

import (
	"fmt"
	"strconv"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/service"
)

const (
	headerLines    = 2 // title bar + screen tabs
	footerLines    = 1
	minSidebarSize = 110
)

func (m Model) sidebarShown() bool {
	return m.sidebarVisible && m.width >= minSidebarSize && m.screen == screenApps
}

func (m Model) sidebarWidth() int {
	if !m.sidebarShown() {
		return 0
	}
	return max(40, m.width/3)
}

func (m Model) tableWidth() int { return m.width - m.sidebarWidth() }

func (m Model) mainHeight() int { return max(m.height-headerLines-footerLines, 3) }

func (m Model) filterShown() bool { return m.mode == modeFilter || m.filter.Value() != "" }

// tableTop is the screen row of the first App row.
func (m Model) tableTop() int {
	top := headerLines + 1 // column header
	if m.filterShown() {
		top++
	}
	return top
}

func (m Model) visibleRows() int { return max(m.mainHeight()-(m.tableTop()-headerLines), 1) }

func (m Model) scrollOffset() int {
	if visible := m.visibleRows(); m.cursor >= visible {
		return m.cursor - visible + 1
	}
	return 0
}

// rowY returns the screen row of table row i, or -1 when scrolled away.
func (m Model) rowY(i int) int {
	y := m.tableTop() + i - m.scrollOffset()
	if y < m.tableTop() || y >= m.tableTop()+m.visibleRows() {
		return -1
	}
	return y
}

func rowLayerID(i int) string { return "row:" + strconv.Itoa(i) }

func (m *Model) relayout() {
	sw := m.sidebarWidth()
	if sw > 0 {
		m.logs.SetWidth(sw - 4)
		m.logs.SetHeight(max(m.mainHeight()-3, 1))
	}
	m.help.SetWidth(m.width)
	m.filter.SetWidth(max(m.tableWidth()-4, 10))
}

func (m Model) View() tea.View {
	var v tea.View
	v.AltScreen = true
	v.MouseMode = tea.MouseModeCellMotion
	v.ReportFocus = true
	v.WindowTitle = m.windowTitle()
	if m.tasks.running() > 0 {
		v.ProgressBar = tea.NewProgressBar(tea.ProgressBarIndeterminate, 0)
	}
	if m.width == 0 {
		v.SetContent("")
		return v
	}

	layers := []*lipgloss.Layer{}
	base := []string{m.renderHeader()}
	tabs, tabLayers := m.renderTabs()
	base = append(base, tabs)
	layers = append(layers, tabLayers...)

	var main string
	switch {
	case !m.loaded:
		main = m.theme.dim().Render("  " + m.spin.View() + " reading the Project…")
	case m.statusErr != "":
		main = m.renderNoProject()
	default:
		switch m.screen {
		case screenApps:
			var rowLayers []*lipgloss.Layer
			main, rowLayers = m.renderApps()
			layers = append(layers, rowLayers...)
		case screenDoctor:
			main = m.renderDoctor()
		case screenUpdates:
			main = m.renderUpdates()
		case screenCatalog:
			main = m.renderCatalog()
		case screenBackups:
			main = m.renderBackups()
		}
	}
	base = append(base, fit(main, m.width, m.mainHeight()), m.renderFooter())
	content := strings.Join(base, "\n")

	all := append([]*lipgloss.Layer{lipgloss.NewLayer(content)}, layers...)
	if overlay := m.renderOverlay(); overlay != "" {
		w, h := lipgloss.Width(overlay), lipgloss.Height(overlay)
		x, y := max((m.width-w)/2, 0), max((m.height-h)/3, 0)
		all = append(all, lipgloss.NewLayer(overlay).X(x).Y(y).Z(10).ID("overlay"))
	}
	comp := lipgloss.NewCompositor(all...)
	v.SetContent(comp.Render())
	v.OnMouse = func(msg tea.MouseMsg) tea.Cmd {
		click, ok := msg.(tea.MouseClickMsg)
		if !ok {
			return nil
		}
		hit := comp.Hit(click.X, click.Y)
		if hit.Empty() || hit.ID() == "overlay" {
			return nil
		}
		id := hit.ID()
		return func() tea.Msg { return clickMsg{id: id} }
	}
	return v
}

// fit pads or cuts s to exactly width×height cells.
func fit(s string, width, height int) string {
	lines := strings.Split(s, "\n")
	if len(lines) > height {
		lines = lines[:height]
	}
	for len(lines) < height {
		lines = append(lines, "")
	}
	for i, line := range lines {
		lines[i] = pad(line, width)
	}
	return strings.Join(lines, "\n")
}

func (m Model) health() (string, int) {
	if len(m.checks) == 0 {
		return "checking", -1
	}
	warn, fail := 0, 0
	for _, c := range m.checks {
		switch c.Level {
		case host.Warn:
			warn++
		case host.Fail:
			fail++
		}
	}
	switch {
	case fail > 0:
		return plural(fail, "failing check", "failing checks"), 2
	case warn > 0:
		return plural(warn, "warning", "warnings"), 1
	}
	return "healthy", 0
}

func plural(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return strconv.Itoa(n) + " " + many
}

func (m Model) updatesAvailable() int {
	n := 0
	for _, app := range m.status.Apps {
		if app.Update == service.UpdateAvailable {
			n++
		}
	}
	return n
}

func (m Model) windowTitle() string {
	label, _ := m.health()
	return fmt.Sprintf("self-host · %d apps · %s", len(m.status.Apps), label)
}

func (m Model) renderHeader() string {
	t := m.theme
	parts := []string{t.chip("◆ self-host", t.accent)}
	if m.status.Project != "" {
		parts = append(parts, t.dim().Render(shortHome(m.status.Project)))
	}
	if m.loaded && m.statusErr == "" {
		if m.status.Exposure == service.ExposureLocal {
			parts = append(parts, t.chip("LOCAL ONLY", t.warn))
		} else {
			parts = append(parts, t.chip("LAN "+m.status.LANIP, t.info))
		}
	}
	label, lvl := m.health()
	healthColor := t.muted
	switch lvl {
	case 0:
		healthColor = t.ok
	case 1:
		healthColor = t.warn
	case 2:
		healthColor = t.fail
	}
	parts = append(parts, t.chip("● "+label, healthColor))
	if n := m.updatesAvailable(); n > 0 {
		parts = append(parts, t.fg(t.warn).Bold(true).Render("⚠ "+plural(n, "update", "updates")))
	}
	if running := m.tasks.running(); running > 0 {
		parts = append(parts, t.fg(t.accent).Render(m.spin.View()+" "+plural(running, "task", "tasks")))
	}
	left := strings.Join(parts, " ")
	right := t.dim().Render("v" + strings.TrimPrefix(m.opts.Version, "v"))
	if !m.refreshed.IsZero() {
		right = t.dim().Render(m.refreshed.Format("15:04:05")+" · ") + right
	}
	gap := m.width - lipgloss.Width(left) - lipgloss.Width(right)
	if gap < 1 {
		return truncate(left, m.width)
	}
	return left + strings.Repeat(" ", gap) + right
}

func shortHome(path string) string {
	if i := strings.Index(path, "/self-host"); i > 0 && strings.HasSuffix(path, "/self-host") {
		return "~/self-host"
	}
	return path
}

func (m Model) renderTabs() (string, []*lipgloss.Layer) {
	t := m.theme
	var b strings.Builder
	var layers []*lipgloss.Layer
	x := 0
	for i, name := range screenNames {
		label := fmt.Sprintf(" %d %s ", i+1, name)
		style := t.dim()
		if screenID(i) == m.screen {
			style = lipgloss.NewStyle().Bold(true).Foreground(t.bright).Background(t.selected)
		}
		rendered := style.Render(label)
		layers = append(layers, lipgloss.NewLayer(rendered).X(x).Y(1).ID("tab:"+strconv.Itoa(i)))
		b.WriteString(rendered + " ")
		x += lipgloss.Width(rendered) + 1
	}
	return pad(b.String(), m.width), layers
}

type column struct {
	title string
	width int
	value func(service.AppStatus) string
}

func (m Model) columns() []column {
	t := m.theme
	tw := m.tableWidth()
	cols := []column{{title: "APP", width: 18, value: func(a service.AppStatus) string { return a.Name }}}
	if tw >= 76 {
		cols = append(cols, column{title: "URL", width: 28, value: func(a service.AppStatus) string { return a.URL }})
	}
	cols = append(cols, column{title: "STATE", width: 10, value: func(a service.AppStatus) string { return a.State }})
	if tw >= 88 {
		cols = append(cols, column{title: "HEALTH", width: 10, value: func(a service.AppStatus) string {
			if a.Health == "" {
				return "–"
			}
			return a.Health
		}})
	}
	cols = append(cols, column{title: "SETUP", width: 13, value: func(a service.AppStatus) string {
		switch a.Setup {
		case "ok":
			return t.fg(t.ok).Render("✓ ok")
		case "incomplete":
			return t.fg(t.fail).Render("✗ incomplete")
		case "pending":
			return t.fg(t.warn).Render("… pending")
		case "unmanaged":
			return t.dim().Render("unmanaged")
		}
		return a.Setup
	}})
	if m.updatesAvailable() > 0 {
		cols = append(cols, column{title: "UPDATE", width: 8, value: func(a service.AppStatus) string {
			if a.Update == "available" {
				return t.fg(t.warn).Render("⚠ new")
			}
			return ""
		}})
	}
	return cols
}

func (m Model) renderApps() (string, []*lipgloss.Layer) {
	t := m.theme
	tw := m.tableWidth()
	cols := m.columns()
	var lines []string
	if m.filterShown() {
		lines = append(lines, pad(m.filter.View(), tw))
	}
	header := "  "
	for _, c := range cols {
		header += pad(c.title, c.width) + " "
	}
	lines = append(lines, t.dim().Bold(true).Render(pad(header, tw)))

	rows := m.rows()
	var layers []*lipgloss.Layer
	if len(rows) == 0 {
		msg := "No Apps yet. Install one with: self-host install ntfy"
		if m.filter.Value() != "" {
			msg = "No App matches “" + m.filter.Value() + "” (esc clears)"
		}
		lines = append(lines, t.dim().Render("  "+msg))
	}
	offset := m.scrollOffset()
	for i := offset; i < len(rows) && i-offset < m.visibleRows(); i++ {
		app := rows[i]
		line := t.dot(service.Level(app)) + " "
		for _, c := range cols {
			line += pad(c.value(app), c.width) + " "
		}
		line = pad(line, tw)
		if i == m.cursor {
			line = lipgloss.NewStyle().Background(t.selected).Bold(true).Render(pad(ansiStripForSelection(line), tw))
		}
		lines = append(lines, line)
		layers = append(layers, lipgloss.NewLayer(line).X(0).Y(m.rowY(i)).ID(rowLayerID(i)))
	}
	table := fit(strings.Join(lines, "\n"), tw, m.mainHeight())
	if !m.sidebarShown() {
		return table, layers
	}
	sidebar, tabLayers := m.renderSidebar()
	layers = append(layers, tabLayers...)
	return lipgloss.JoinHorizontal(lipgloss.Top, table, sidebar), layers
}

// The selected row is redrawn on one background so per-cell colours do not
// punch holes in the highlight; the dot keeps its colour.
func ansiStripForSelection(line string) string {
	dot, rest, found := strings.Cut(line, "● ")
	if !found {
		return line
	}
	return dot + "● " + stripANSI(rest)
}

func (m Model) renderSidebar() (string, []*lipgloss.Layer) {
	t := m.theme
	sw := m.sidebarWidth()
	inner := sw - 4
	x := m.tableWidth() + 2
	var tabs []string
	var layers []*lipgloss.Layer
	for i, name := range sidebarTabs {
		label := " " + name + " "
		style := t.dim()
		if sidebarTab(i) == m.tab {
			style = lipgloss.NewStyle().Bold(true).Foreground(t.bright).Background(t.selected)
		}
		rendered := style.Render(label)
		layers = append(layers, lipgloss.NewLayer(rendered).X(x).Y(headerLines+1).ID("side:"+strconv.Itoa(i)))
		tabs = append(tabs, rendered)
		x += lipgloss.Width(rendered) + 1
	}
	tabLine := strings.Join(tabs, " ")
	if m.pinned != "" && m.tab == tabLogs {
		tabLine += t.fg(t.accent).Render("  📌 " + m.pinned)
	} else if !m.follow && m.tab == tabLogs {
		tabLine += t.fg(t.warn).Render("  paused")
	}
	var body string
	app, found := m.selected()
	switch {
	case m.tab == tabLogs:
		body = m.logs.View()
		if len(m.logLines) == 0 {
			body = t.dim().Render("waiting for logs…")
		}
	case !found:
		body = t.dim().Render("select an App")
	case m.tab == tabSetup:
		body = m.renderSetup(app, inner)
	default:
		body = m.renderInfo(app, inner)
	}
	content := tabLine + "\n" + fit(body, inner, m.mainHeight()-3)
	return t.panel(true).Width(sw).Render(content), layers
}

func (m Model) renderSetup(app service.AppStatus, width int) string {
	t := m.theme
	if !app.Managed {
		return t.dim().Render(wrap(app.ID+" was added by hand (Unmanaged app). self-host starts, stops, updates and backs it up, but runs no Setup for it.", width))
	}
	if len(app.Steps) == 0 {
		return t.dim().Render("Setup has not run yet. Press e to run it.")
	}
	var lines []string
	for _, step := range app.Steps {
		mark := t.fg(t.ok).Render("✓")
		switch step.Status {
		case "skip":
			mark = t.dim().Render("↷")
		case "fail":
			mark = t.fg(t.fail).Render("✗")
		}
		lines = append(lines, mark+" "+t.body().Render(step.ID)+t.dim().Render("  "+step.Msg))
		if step.Status == "fail" {
			lines = append(lines, t.fg(t.fail).Render(indent("  ", step.Error, width)))
			if step.Hint != "" {
				lines = append(lines, t.fg(t.warn).Render(indent("  → ", step.Hint, width)))
			}
		}
	}
	if app.Setup == "incomplete" {
		lines = append(lines, "", t.dim().Render(wrap("Finish the failed step by hand (or let your agent use agent-browser), then press e to rerun Setup.", width)))
	}
	return strings.Join(lines, "\n")
}

func (m Model) renderInfo(app service.AppStatus, width int) string {
	t := m.theme
	row := func(k, v string) string { return t.dim().Render(pad(k, 10)) + t.body().Render(truncate(v, width-10)) }
	lines := []string{
		t.heading().Render(app.Name),
		row("url", app.URL),
		row("port", strconv.Itoa(app.Port)),
		row("image", app.Image),
		row("services", strings.Join(app.Services, ", ")),
		row("state", app.State+" "+app.Health),
		row("setup", app.Setup),
		row("data", "apps/"+app.ID+"/"),
	}
	if app.Managed {
		lines = append(lines, "", t.dim().Render(wrap("Sign in with the Admin login. p copies the password; self-host credentials shows API keys.", width)))
	}
	return strings.Join(lines, "\n")
}

// indent wraps s with a hanging indent under prefix.
func indent(prefix, s string, width int) string {
	inner := width - lipgloss.Width(prefix)
	lines := strings.Split(wrap(s, inner), "\n")
	hang := strings.Repeat(" ", lipgloss.Width(prefix))
	for i := range lines {
		if i == 0 {
			lines[i] = prefix + lines[i]
		} else {
			lines[i] = hang + lines[i]
		}
	}
	return strings.Join(lines, "\n")
}

func wrap(s string, width int) string {
	if width < 10 {
		return s
	}
	return lipgloss.NewStyle().Width(width).Render(s)
}

func (m Model) renderNoProject() string {
	t := m.theme
	return strings.Join([]string{
		"",
		"  " + t.heading().Render("No Project yet"),
		"",
		"  " + t.body().Render(m.statusErr),
		"",
		"  " + t.dim().Render("Try: self-host install media     (or: self-host apps list)"),
	}, "\n")
}

func (m Model) renderDoctor() string {
	t := m.theme
	lines := []string{"", "  " + t.heading().Render("Doctor") + t.dim().Render("  r rechecks · self-host doctor --json for agents"), ""}
	if len(m.checks) == 0 {
		lines = append(lines, "  "+t.dim().Render(m.spin.View()+" checking…"))
	}
	for _, c := range m.checks {
		subject := c.Title
		if c.App != "" {
			subject = c.App + " › " + c.Title
		}
		lines = append(lines, "  "+t.dot(string(c.Level))+" "+t.body().Render(pad(subject, 30))+" "+t.dim().Render(c.Detail))
		if c.Level != host.OK && c.Hint != "" {
			lines = append(lines, "      "+t.fg(t.warn).Render("→ "+c.Hint))
		}
		if c.Level != host.OK && c.Docs != "" {
			lines = append(lines, "      "+t.dim().Render(c.Docs))
		}
	}
	return strings.Join(lines, "\n")
}

func (m Model) renderUpdates() string {
	t := m.theme
	lines := []string{"", "  " + t.heading().Render("Updates") + t.dim().Render("  U updates every App with a newer image · r checks again · self-host update [app]"), ""}
	for _, app := range m.status.Apps {
		state := app.Update
		if state == "" {
			state = "not checked"
		}
		mark := t.dot("ok")
		if state == "available" {
			mark = t.fg(t.warn).Render("⚠")
		} else if state != "current" {
			mark = t.dim().Render("?")
		}
		lines = append(lines, "  "+mark+" "+pad(app.Name, 20)+" "+t.dim().Render(pad(app.Image, 44))+" "+state)
	}
	return strings.Join(lines, "\n")
}

func (m Model) renderCatalog() string {
	t := m.theme
	return strings.Join([]string{"", "  " + t.heading().Render("Catalog"), "",
		"  " + t.dim().Render("Browse Apps and Recipes: self-host apps list · add one: self-host install <app>")}, "\n")
}

func (m Model) renderBackups() string {
	t := m.theme
	lines := []string{"", "  " + t.heading().Render("Backups") + t.dim().Render("  b backs up every App now · enter restores the selected backup"), ""}
	if len(m.backups) == 0 {
		lines = append(lines, "  "+t.dim().Render("No backups in ~/self-host/backups yet. Press b to make one."))
	}
	width := max(m.width-4, 20)
	for i, f := range m.backups {
		lock := ""
		if f.Encrypted {
			lock = t.fg(t.ok).Render("🔒 encrypted")
		}
		line := pad(f.Name, 40) + " " + pad(f.HumanSize(), 10) + " " + pad(f.Modified.Format("2006-01-02 15:04"), 18) + " " + lock
		if i == m.backupCursor {
			line = lipgloss.NewStyle().Background(t.selected).Bold(true).Render(pad(stripANSI(line), width))
		}
		lines = append(lines, "  "+line)
	}
	lines = append(lines, "", "  "+t.dim().Render("Backups contain passwords. For encrypted or scheduled backups use: self-host backup --encrypt -o FILE"))
	return strings.Join(lines, "\n")
}

func (m Model) renderFooter() string {
	t := m.theme
	flash := m.flash
	style := t.dim()
	switch m.flashLevel {
	case levelOK:
		style = t.fg(t.ok)
	case levelWarn:
		style = t.fg(t.warn)
	case levelError:
		style = t.fg(t.fail)
	}
	left := style.Render(flash)
	right := m.help.ShortHelpView(m.keys.ShortHelp())
	gap := m.width - lipgloss.Width(left) - lipgloss.Width(right)
	if gap < 2 {
		return pad(left, m.width)
	}
	return left + strings.Repeat(" ", gap) + right
}

func (m Model) renderOverlay() string {
	t := m.theme
	switch m.mode {
	case modeHelp:
		h := m.help
		h.SetWidth(min(m.width-6, 110))
		return t.panel(true).Render(t.title().Render("Keys") + "\n\n" + h.FullHelpView(m.keys.FullHelp()) + "\n\n" + t.dim().Render("esc closes"))
	case modeConfirm:
		if m.confirm == nil {
			return ""
		}
		body := t.heading().Render(m.confirm.question) + "\n" + t.dim().Render(m.confirm.detail) + "\n\n" +
			t.fg(t.fail).Bold(true).Render("y") + t.dim().Render(" confirm   ") + t.body().Bold(true).Render("n") + t.dim().Render(" cancel")
		return t.panel(true).BorderForeground(t.fail).Render(body)
	case modeTasks:
		return m.renderTasks()
	}
	return ""
}

func (m Model) renderTasks() string {
	t := m.theme
	snaps := m.tasks.snapshots()
	width := min(m.width-6, 100)
	lines := []string{t.title().Render("Tasks") + t.dim().Render("  ↑/↓ select · x cancel · esc close"), ""}
	if len(snaps) == 0 {
		lines = append(lines, t.dim().Render("No tasks yet."))
	}
	for i, s := range snaps {
		icon := t.fg(t.accent).Render(m.spin.View())
		switch s.state {
		case taskOK:
			icon = t.fg(t.ok).Render("✓")
		case taskFailed:
			icon = t.fg(t.fail).Render("✗")
		case taskCancelled:
			icon = t.dim().Render("⊘")
		}
		line := icon + " " + s.title
		if i == m.taskCursor {
			line = lipgloss.NewStyle().Background(t.selected).Bold(true).Render(pad(line, width))
		}
		lines = append(lines, line)
	}
	if m.taskCursor < len(snaps) {
		s := snaps[m.taskCursor]
		lines = append(lines, "", t.rule(s.title, width))
		evs := s.events
		if len(evs) > 14 {
			evs = evs[len(evs)-14:]
		}
		for _, e := range evs {
			lines = append(lines, truncate(formatEvent(t, e), width))
		}
		if s.err != "" {
			lines = append(lines, t.fg(t.fail).Render(wrap(s.err, width)))
		}
	}
	return t.panel(true).Width(width + 4).Render(strings.Join(lines, "\n"))
}

func formatEvent(t theme, e events.Event) string {
	subject := e.Step
	if e.App != "" {
		subject = e.App + " › " + e.Step
	}
	switch e.Event {
	case events.StepOK:
		return t.fg(t.ok).Render("✓ ") + subject + " " + t.dim().Render(e.Msg)
	case events.StepSkip:
		return t.dim().Render("↷ " + subject + " " + e.Msg)
	case events.StepWarn:
		return t.fg(t.warn).Render("! ") + subject + " " + e.Msg
	case events.StepFail:
		return t.fg(t.fail).Render("✗ ") + subject + " " + e.Error + t.fg(t.warn).Render(" → "+e.Hint)
	case events.Command:
		return t.dim().Render("$ " + e.Command)
	case events.StepStart:
		return t.dim().Render("… " + subject + " " + e.Msg)
	}
	return t.dim().Render(e.Msg)
}
