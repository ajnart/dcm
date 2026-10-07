package tui

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"charm.land/bubbles/v2/help"
	"charm.land/bubbles/v2/key"
	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/service"
)

// Below wideWidth columns the panels stack instead of sitting side by side.
const wideWidth = 100

// surface is the whole screen the Dashboard, Install, Settings, Stack, Workflow or Help
// view fills; the Dashboard is home.
type surface int

const (
	surfaceDashboard surface = iota
	surfaceInstall
	surfaceSettings
	surfaceStack
	surfaceWorkflow
	surfaceHelp
)

// navKind is what a view asks the Model to do after it handled a message.
type navKind int

const (
	navNone navKind = iota
	navBack
	navTo
)

// nav is the result of a view's Update: stay, go back to the Dashboard, or
// switch to another view.
type nav struct {
	kind navKind
	to   surface
}

// view is one full-screen surface of the Dashboard.
type view interface {
	// Update handles a message; nav asks the Model to switch views (navNone, navBack, navTo(kind)).
	Update(ctx *viewContext, msg tea.Msg) (view, tea.Cmd, nav)
	View(ctx *viewContext, width, height int) string
	// Keys are the view's own bindings: its footer, its help, and the keybind audit.
	Keys() []key.Binding
	Title() string
}

// viewContext is what every view may read or ask for: theme, status, updates,
// checks, containers, the Backend, run(Request, title) for Actions, and flash.
type viewContext struct {
	width, height int
	dark          bool
	theme         theme
	keys          keyMap
	help          help.Model
	spin          spinner.Model

	status    service.Status
	checks    []host.Check
	updates   map[string]string
	updatesAt time.Time
	latest    string
	loaded    bool
	statusErr string
	refreshed time.Time

	containers    []service.ContainerStatus
	containersErr string

	defaults map[string]string

	backend Backend
	tasks   *taskManager
	opts    Options

	flash      string
	flashLevel level

	// layers are the clickable regions a view produced in View; the Model
	// composites them so rows and tabs stay mouse targets.
	layers []*lipgloss.Layer
}

func (ctx *viewContext) mainHeight() int { return max(ctx.height-2, 3) }

func (ctx *viewContext) workflow() WorkflowSnapshot {
	var evs []events.Event
	if ctx.tasks != nil {
		for _, task := range ctx.tasks.snapshots() {
			evs = append(evs, task.events...)
		}
	}
	return Workflow(ctx.status, evs)
}

func (ctx *viewContext) setFlash(text string, l level) { ctx.flash, ctx.flashLevel = text, l }

// run starts a background Action; the footer shows its progress.
func (ctx *viewContext) run(req Request, title string) tea.Cmd {
	t := ctx.tasks.start(title)
	backend := ctx.backend
	run := func() tea.Msg {
		log := events.New(events.SinkFunc(t.append))
		err := backend.Run(t.ctx, req, log)
		return taskDoneMsg{id: t.id, title: title, err: err}
	}
	return tea.Batch(run, ctx.spin.Tick)
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

// clip cuts every line of s to width cells.
func clip(s string, width int) string {
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		lines[i] = truncate(line, width)
	}
	return strings.Join(lines, "\n")
}

func wrap(s string, width int) string {
	if width < 10 {
		return s
	}
	return lipgloss.NewStyle().Width(width).Render(s)
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

func sign(n int) int {
	if n < 0 {
		return -1
	}
	if n > 0 {
		return 1
	}
	return 0
}

func firstLine(s string) string {
	line, _, _ := strings.Cut(s, "\n")
	return line
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
		switch {
		case m.status.Exposure == service.ExposureLocal:
			parts = append(parts, t.chip("LOCAL ONLY", t.warn))
		case m.status.LANIPStale:
			parts = append(parts, t.chip("⚠ LAN "+m.status.LANIP, t.warn))
		default:
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

var navItems = []struct {
	name  string
	label string
	// Help is a view too but it opens as an overlay, not a top-bar tab.
	surface surface
}{
	{"dashboard", "Dashboard", surfaceDashboard},
	{"stack", "Stack", surfaceStack},
	{"workflow", "Workflow", surfaceWorkflow},
	{"install", "Install", surfaceInstall},
	{"settings", "Settings", surfaceSettings},
}

// renderNav is the top bar of the full-screen views: the brand, the five
// surfaces with the active one highlighted, and the version on the right.
func (m Model) renderNav(active surface) (string, []*lipgloss.Layer) {
	t := m.theme
	left := t.chip("◆ self-host", t.accent) + "  "
	x := lipgloss.Width(left)
	var layers []*lipgloss.Layer
	for i, item := range navItems {
		if i > 0 {
			sep := t.dim().Render(" · ")
			left += sep
			x += lipgloss.Width(sep)
		}
		style := t.dim()
		if item.surface == active {
			style = lipgloss.NewStyle().Bold(true).Foreground(t.bright).Background(t.selected)
		}
		rendered := style.Render(item.label)
		left += rendered
		layers = append(layers, lipgloss.NewLayer(rendered).X(x).Y(0).ID("nav:"+item.name))
		x += lipgloss.Width(rendered)
	}
	right := t.dim().Render("v" + strings.TrimPrefix(m.opts.Version, "v"))
	gap := m.width - lipgloss.Width(left) - lipgloss.Width(right)
	if gap < 2 {
		return truncate(left, m.width), layers
	}
	return left + strings.Repeat(" ", gap) + right, layers
}

// View composes the top bar, the active view and the footer, then the Help
// overlay when it is open.
func (m Model) View() tea.View {
	var v tea.View
	v.AltScreen = true
	v.MouseMode = tea.MouseModeCellMotion
	v.ReportFocus = true
	v.WindowTitle = m.windowTitle()
	if pct, ok := m.installProgress(); ok {
		v.ProgressBar = tea.NewProgressBar(tea.ProgressBarDefault, pct)
	} else if pct, ok := m.pullPercent(); ok {
		v.ProgressBar = tea.NewProgressBar(tea.ProgressBarDefault, pct)
	} else if m.tasks.running() > 0 {
		v.ProgressBar = tea.NewProgressBar(tea.ProgressBarIndeterminate, 0)
	}
	if m.width == 0 {
		v.SetContent("")
		return v
	}

	ctxView := m.ctx()
	var main string
	var layers []*lipgloss.Layer
	header := m.renderHeader()
	footer := m.renderFooter()
	switch {
	case m.wizard != nil:
		main = m.renderWizard()
	case !m.loaded:
		main = m.theme.dim().Render("  " + m.spin.View() + " reading the Project…")
	case m.statusErr != "":
		main = m.renderStatusError()
	default:
		active := m.activeView()
		if m.surface != surfaceDashboard {
			header, layers = m.renderNav(m.surface)
			footer = m.footerWith(active.Keys())
		}
		main = active.View(ctxView, m.width, m.mainHeight())
		layers = append(layers, ctxView.layers...)
	}
	content := header + "\n" + fit(main, m.width, m.mainHeight()) + "\n" + footer

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

// Footer

// renderFooter shows the running Action's latest event, else the last
// result, with the key hints on the right.
func (m Model) renderFooter() string {
	return m.footerWith(m.keys.ShortHelp())
}

// footerWith is renderFooter with the given key hints, used by each view's
// own footer.
func (m Model) footerWith(bindings []key.Binding) string {
	t := m.theme
	left := m.footerStatus()
	if m.wizard != nil {
		return pad(left, m.width)
	}
	h := m.help
	h.SetWidth(max(m.width-lipgloss.Width(left)-2, 0))
	right := h.ShortHelpView(bindings)
	gap := m.width - lipgloss.Width(left) - lipgloss.Width(right)
	if gap < 2 {
		return pad(left, m.width)
	}
	return left + strings.Repeat(" ", gap) + t.dim().Render(right)
}

func (m Model) footerStatus() string {
	t := m.theme
	if task := m.tasks.latest(); task != nil {
		if s := task.snapshot(); s.state == taskRunning {
			line := t.fg(t.accent).Render(m.spin.View() + " " + s.title)
			if n, pct, current, total, ok := pullTotals(s.events); ok {
				line += t.dim().Render(fmt.Sprintf(" · pulling %d images · %d%% · %s/%s", n, pct, pullMB(current), pullMB(total)))
			} else if n := len(s.events); n > 0 {
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
