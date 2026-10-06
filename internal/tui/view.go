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

// Below wideWidth columns the panels stack instead of sitting side by side.
const wideWidth = 100

// layout places the three panels: Apps above Needs action, App details on
// the right (wide) or underneath when there is room (narrow).
type layout struct {
	wide                    bool
	leftW, rightW           int
	appsH, needsH, detailsH int
	detailsX, detailsY      int
}

func (m Model) mainHeight() int { return max(m.height-2, 3) }

func (m Model) layout() layout {
	h := m.mainHeight()
	appsWant := max(len(m.rows()), 1) + 2
	if m.width >= wideWidth {
		left := max(58, m.width*2/5)
		appsH := min(appsWant, max(h-5, 3))
		return layout{wide: true, leftW: left, rightW: m.width - left, appsH: appsH, needsH: h - appsH,
			detailsH: h, detailsX: left, detailsY: 1}
	}
	l := layout{leftW: m.width, rightW: m.width}
	l.appsH = min(appsWant, max(h/2, 3))
	needs, _ := m.needsLines(m.width - 4)
	l.needsH = min(len(needs)+2, h-l.appsH)
	l.detailsH = h - l.appsH - l.needsH
	if l.detailsH < 6 {
		l.needsH += l.detailsH
		l.detailsH = 0
	}
	l.detailsY = 1 + l.appsH + l.needsH
	return l
}

// relayout sizes the details viewport; call it whenever the layout can move.
func (m *Model) relayout() {
	l := m.layout()
	m.details.SetWidth(max(l.rightW-4, 1))
	m.details.SetHeight(max(l.detailsH-4, 1))
	m.help.SetWidth(m.width)
}

func rowLayerID(i int) string { return "row:" + strconv.Itoa(i) }

func (m Model) View() tea.View {
	var v tea.View
	v.AltScreen = true
	v.MouseMode = tea.MouseModeCellMotion
	v.ReportFocus = true
	v.WindowTitle = m.windowTitle()
	if pct, ok := m.installProgress(); ok {
		v.ProgressBar = tea.NewProgressBar(tea.ProgressBarDefault, pct)
	} else if m.tasks.running() > 0 {
		v.ProgressBar = tea.NewProgressBar(tea.ProgressBarIndeterminate, 0)
	}
	if m.width == 0 {
		v.SetContent("")
		return v
	}

	var main string
	var layers []*lipgloss.Layer
	switch {
	case m.wizard != nil:
		main = m.renderWizard()
	case !m.loaded:
		main = m.theme.dim().Render("  " + m.spin.View() + " reading the Project…")
	case m.statusErr != "":
		main = m.renderStatusError()
	default:
		main, layers = m.renderDashboard()
	}
	content := m.renderHeader() + "\n" + fit(main, m.width, m.mainHeight()) + "\n" + m.renderFooter()

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

// Header

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
	if m.status.Project != "" && m.width >= wideWidth {
		parts = append(parts, t.dim().Render(shortHome(m.status.Project)))
	}
	if m.loaded && m.statusErr == "" && m.status.Project != "" {
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
	if m.latest != "" {
		parts = append(parts, t.fg(t.info).Render("↑ v"+strings.TrimPrefix(m.latest, "v")))
	}
	if n := m.updatesAvailable(); n > 0 {
		parts = append(parts, t.fg(t.warn).Bold(true).Render("⚠ "+plural(n, "update", "updates")))
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

func (m Model) renderStatusError() string {
	t := m.theme
	return strings.Join([]string{
		"",
		"  " + t.heading().Render("Cannot read the Project"),
		"",
		"  " + t.body().Render(m.statusErr),
		"",
		"  " + t.dim().Render("Run self-host doctor for details."),
	}, "\n")
}

// Panels

func (m Model) renderDashboard() (string, []*lipgloss.Layer) {
	l := m.layout()
	apps, layers := m.renderApps(l.leftW, l.appsH)
	needs, needLayers := m.renderNeeds(l.leftW, l.needsH, 1+l.appsH)
	layers = append(layers, needLayers...)
	if l.detailsH == 0 {
		return apps + "\n" + needs, layers
	}
	details, tabLayers := m.renderDetails(l.rightW, l.detailsH, l.detailsX, l.detailsY)
	layers = append(layers, tabLayers...)
	if l.wide {
		return lipgloss.JoinHorizontal(lipgloss.Top, apps+"\n"+needs, details), layers
	}
	return apps + "\n" + needs + "\n" + details, layers
}

func (m Model) renderApps(width, height int) (string, []*lipgloss.Layer) {
	t := m.theme
	inner := width - 4
	visible := max(height-2, 1)
	offset := max(m.cursor-visible+1, 0)
	rows := m.rows()
	var lines []string
	var layers []*lipgloss.Layer
	if len(rows) == 0 {
		lines = append(lines, t.dim().Render("No Apps yet. Press i to install one."))
	}
	for i := offset; i < len(rows) && i-offset < visible; i++ {
		line := m.appRow(rows[i], inner)
		if i == m.cursor {
			line = lipgloss.NewStyle().Background(t.selected).Bold(true).Render(pad(keepDot(line), inner))
		}
		lines = append(lines, line)
		layers = append(layers, lipgloss.NewLayer(line).X(2).Y(2+i-offset).ID(rowLayerID(i)))
	}
	title := t.heading().Render("Apps") + t.dim().Render(" "+strconv.Itoa(len(rows)))
	return t.box(title, strings.Join(lines, "\n"), width, height), layers
}

// appRow is one App: Status dot, name, URL, state, Setup and update marks.
func (m Model) appRow(a service.AppStatus, width int) string {
	t := m.theme
	update := " "
	if a.Update == service.UpdateAvailable {
		update = t.fg(t.warn).Render("↑")
	}
	urlWidth := min(width-29, 26)
	url := ""
	if urlWidth >= 12 {
		url = t.dim().Render(pad(a.URL, urlWidth)) + " "
	}
	return t.dot(service.Level(a)) + " " + t.body().Render(pad(a.Name, 13)) + " " + url +
		pad(stateLabel(a), 9) + " " + m.setupMark(a) + update
}

func stateLabel(a service.AppStatus) string {
	switch {
	case a.State == "running" && a.Health != "" && a.Health != "healthy":
		return a.Health
	case a.State == "exited" || a.State == "created":
		return "stopped"
	}
	return a.State
}

func (m Model) setupMark(a service.AppStatus) string {
	t := m.theme
	switch a.Setup {
	case "ok":
		return t.fg(t.ok).Render("✓")
	case "incomplete":
		return t.fg(t.fail).Render("✗")
	case "pending":
		return t.fg(t.warn).Render("…")
	}
	return t.dim().Render("–")
}

// The selected row is redrawn on one background so per-cell colours do not
// punch holes in the highlight; the dot keeps its colour.
func keepDot(line string) string {
	dot, rest, found := strings.Cut(line, "● ")
	if !found {
		return line
	}
	return dot + "● " + stripANSI(rest)
}

// need is one Needs action item and the Action that resolves it.
type need struct {
	broken bool
	text   string
	// key and desc name the Action; command is used when no key exists.
	key, desc, command string
	app                string
}

func (m Model) needsAction() []need {
	var items []need
	for _, a := range m.rows() {
		for _, s := range a.Steps {
			if s.Status == "fail" {
				items = append(items, need{broken: true, text: a.Name + ": " + s.ID + " failed", key: "r", desc: "retry Setup", app: a.ID})
			}
		}
	}
	for _, a := range m.rows() {
		if a.State != "running" && a.State != "degraded" && a.State != "unknown" {
			items = append(items, need{broken: true, text: a.Name + " is stopped", key: "enter", desc: "start", app: a.ID})
		}
	}
	for _, a := range m.rows() {
		if a.Update == service.UpdateAvailable {
			items = append(items, need{text: a.Name + " has an update", key: "u", desc: "update", app: a.ID})
		}
	}
	for _, c := range m.checks {
		// Stopped containers are already listed above.
		if c.Level == host.OK || c.ID == "running" {
			continue
		}
		command := c.Hint
		if command == "" {
			command = "self-host doctor"
		}
		items = append(items, need{broken: c.Level == host.Fail, text: c.Title + ": " + c.Detail, command: command, app: c.App})
	}
	return items
}

// needsLines renders Needs action and returns the App each line points at.
func (m Model) needsLines(width int) ([]string, []string) {
	t := m.theme
	items := m.needsAction()
	if len(items) == 0 {
		return []string{t.fg(t.ok).Render("✓ Nothing needs your attention")}, []string{""}
	}
	var lines, apps []string
	for _, it := range items {
		icon := t.fg(t.warn).Render("!")
		if it.broken {
			icon = t.fg(t.fail).Render("✗")
		}
		head := icon + " " + t.body().Render(it.text)
		if it.key != "" {
			action := t.fg(t.accent).Bold(true).Render(it.key) + t.dim().Render(" "+it.desc)
			if gap := width - lipgloss.Width(head) - lipgloss.Width(action); gap >= 2 {
				lines, apps = append(lines, head+strings.Repeat(" ", gap)+action), append(apps, it.app)
				continue
			}
			lines, apps = append(lines, truncate(head, width), "  "+action), append(apps, it.app, it.app)
			continue
		}
		lines = append(lines, truncate(head, width), t.dim().Render(truncate("  → "+it.command, width)))
		apps = append(apps, it.app, it.app)
	}
	return lines, apps
}

func (m Model) renderNeeds(width, height, y int) (string, []*lipgloss.Layer) {
	t := m.theme
	lines, apps := m.needsLines(width - 4)
	var layers []*lipgloss.Layer
	for i, app := range apps {
		if app != "" && i < height-2 {
			layers = append(layers, lipgloss.NewLayer(lines[i]).X(2).Y(y+1+i).ID("app:"+app))
		}
	}
	title := t.heading().Render("Needs action")
	if n := len(m.needsAction()); n > 0 {
		title += t.dim().Render(" " + strconv.Itoa(n))
	}
	return t.box(title, strings.Join(lines, "\n"), width, height), layers
}

func (m Model) renderDetails(width, height, x, y int) (string, []*lipgloss.Layer) {
	t := m.theme
	inner := width - 4
	var tabs []string
	var layers []*lipgloss.Layer
	tx := x + 2
	for i, name := range detailTabs {
		style := t.dim()
		if detailTab(i) == m.tab {
			style = lipgloss.NewStyle().Bold(true).Foreground(t.bright).Background(t.selected)
		}
		rendered := style.Render(" " + name + " ")
		layers = append(layers, lipgloss.NewLayer(rendered).X(tx).Y(y+1).ID("tab:"+strconv.Itoa(i)))
		tabs = append(tabs, rendered)
		tx += lipgloss.Width(rendered) + 1
	}
	app, found := m.selected()
	title := t.heading().Render("Details")
	var body string
	switch {
	case !found:
		body = t.dim().Render("Select an App.")
	case m.tab == tabSetup:
		title = t.heading().Render(app.Name)
		body = m.renderSetup(app, inner)
	case m.tab == tabInfo:
		title = t.heading().Render(app.Name)
		body = m.renderInfo(app, inner)
	case m.tab == tabCompose:
		title = t.heading().Render(app.Name) + t.dim().Render(" apps/"+app.ID+"/compose.yml")
		body = m.details.View()
		if m.compose[app.ID] == "" {
			body = t.dim().Render("reading the Compose file…")
		}
	default:
		title = t.heading().Render(app.Name) + t.dim().Render(" logs")
		body = m.details.View()
		if len(m.logLines) == 0 {
			body = t.dim().Render("waiting for logs…")
		}
	}
	content := strings.Join(tabs, " ") + "\n" + t.fg(t.faint).Render(strings.Repeat("─", max(inner, 0))) + "\n" + body
	return t.box(title, content, width, height), layers
}

func (m Model) renderSetup(app service.AppStatus, width int) string {
	t := m.theme
	if !app.Managed {
		return t.dim().Render(wrap(app.Name+" was added by hand (Unmanaged app). self-host starts, stops, updates and backs it up, but runs no Setup for it.", width))
	}
	if len(app.Steps) == 0 {
		if app.Setup == "ok" {
			return t.fg(t.ok).Render("✓ ") + t.body().Render("Setup has finished.")
		}
		return t.dim().Render("Setup has not run yet. Press r to run it.")
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
		lines = append(lines, "", t.dim().Render(wrap("Finish the failed step by hand (or let your agent use agent-browser), then press r to retry Setup.", width)))
	}
	return strings.Join(lines, "\n")
}

func (m Model) renderInfo(app service.AppStatus, width int) string {
	t := m.theme
	row := func(k, v string) string { return t.dim().Render(pad(k, 10)) + t.body().Render(truncate(v, width-10)) }
	lines := []string{
		row("url", app.URL),
		row("port", strconv.Itoa(app.Port)),
		row("image", app.Image),
		row("services", strings.Join(app.Services, ", ")),
		row("state", strings.TrimSpace(app.State+" "+app.Health)),
		row("setup", app.Setup),
		row("data", "apps/"+app.ID+"/"),
	}
	if app.Managed {
		lines = append(lines, "", t.dim().Render(wrap("Sign in with the Admin login: c copies the password, self-host credentials shows API keys.", width)))
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

// Footer and overlays

// renderFooter shows the running Action's latest event, else the last
// result, with the key hints on the right.
func (m Model) renderFooter() string {
	t := m.theme
	left := m.footerStatus()
	if m.wizard != nil {
		return pad(left, m.width)
	}
	h := m.help
	h.SetWidth(max(m.width-lipgloss.Width(left)-2, 0))
	right := h.ShortHelpView(m.keys.ShortHelp())
	gap := m.width - lipgloss.Width(left) - lipgloss.Width(right)
	if gap < 2 {
		return pad(left, m.width)
	}
	return left + strings.Repeat(" ", gap) + t.dim().Render(right)
}

func (m Model) footerStatus() string {
	t := m.theme
	if task := m.tasks.get(m.lastTask); task != nil {
		if s := task.snapshot(); s.state == taskRunning {
			line := t.fg(t.accent).Render(m.spin.View() + " " + s.title)
			if n := len(s.events); n > 0 {
				line += t.dim().Render(" · ") + formatEvent(t, s.events[n-1])
			}
			return truncate(line, m.width)
		}
	}
	style := t.dim()
	switch m.flashLevel {
	case levelOK:
		style = t.fg(t.ok)
	case levelWarn:
		style = t.fg(t.warn)
	case levelError:
		style = t.fg(t.fail)
	}
	return truncate(style.Render(m.flash), m.width)
}

func (m Model) renderOverlay() string {
	t := m.theme
	width := max(min(m.width-6, 100), 20)
	switch {
	case m.picker != nil:
		return t.panel(true).Render(clip(m.renderPicker(width, max(m.height-8, 5)), width))
	case m.showHelp:
		h := m.help
		h.SetWidth(width)
		body := t.title().Render("Keys") + "\n\n" + h.FullHelpView(m.keys.FullHelp()) + "\n\n" +
			t.dim().Render("More: self-host --help (remove, restore, config, credentials…)")
		if m.latest != "" {
			body += "\n\n" + t.fg(t.info).Render("↑ "+m.releaseNotice())
		}
		return t.panel(true).Render(clip(body+"\n\n"+t.dim().Render("any key closes"), width))
	}
	return ""
}

// clip cuts every line of s to width cells.
func clip(s string, width int) string {
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		lines[i] = truncate(line, width)
	}
	return strings.Join(lines, "\n")
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
