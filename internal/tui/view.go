package tui

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/service"
)

// Below wideWidth columns the panels stack instead of sitting side by side.
const wideWidth = 100

// surface is the Dashboard tab a view fills, in tab order: Overview
// (dashboardView), Apps (appsView), Activity (activityView), Catalog
// (installView) and Settings.
type surface int

const (
	surfaceDashboard surface = iota
	surfaceApps
	surfaceActivity
	surfaceInstall
	surfaceSettings
)

var tabs = []struct {
	name, label string
}{
	surfaceDashboard: {"dashboard", "Overview"},
	surfaceApps:      {"apps", "Apps"},
	surfaceActivity:  {"activity", "Activity"},
	surfaceInstall:   {"install", "Catalog"},
	surfaceSettings:  {"settings", "Settings"},
}

// navKind is what a view asks the Model to do after it handled a message.
type navKind int

const (
	navNone navKind = iota
	// navBack returns to the Overview and keeps the view as it is.
	navBack
	// navDone returns to the Overview after the view finished its job (an
	// install or a Settings change was approved, or changes were discarded),
	// so the tab starts afresh next time.
	navDone
	// navTo switches to another tab.
	navTo
)

type nav struct {
	kind navKind
	to   surface
	app  string
}

// pane is one focusable part of a tab and the keys that act in it.
type pane struct {
	name string
	keys []key.Binding
}

// view is one tab of the Dashboard.
type view interface {
	Update(ctx *viewContext, msg tea.Msg) (view, tea.Cmd, nav)
	View(ctx *viewContext, width, height int) string
	// Keys are the keys that act in the focused pane right now: the bar's chips.
	Keys() []key.Binding
	// Panes are every pane of the view with its keys, for help and the keybind audit.
	Panes() []pane
	// Capturing reports that the view is taking text input: every key goes
	// to it, and the global keys are text.
	Capturing() bool
	Title() string
}

// viewContext is what every view may read or ask for: theme, status, updates,
// checks, containers, the Backend, run(Request, title) for Actions, and flash.
type viewContext struct {
	width, height int
	theme         theme
	glyphs        activity.Glyphs
	keys          keyMap
	// motion is the frame at which each row of the Action last changed.
	motion activity.Motion

	status    service.Status
	checks    []host.Check
	updates   map[string]string
	updatesAt time.Time
	latest    string
	// releaseChecked is whether the release check found the newest release.
	releaseChecked bool
	version        string

	containers    []service.ContainerStatus
	containersErr string

	backend Backend
	tasks   *taskManager

	flash      string
	flashLevel level
	// flashed is set when a view set a flash, even the same text again.
	flashed bool
	// headerFacts are the LAN address and time the header had no room for;
	// the Overview's Now strip restates them.
	headerFacts []string

	// shared marks a context a Model hands out: it builds the snapshot once,
	// so the tracker, the status line, the Now strip and the Activity tab
	// read the same one.
	shared bool
	snap   *activity.Snapshot

	// layers are the clickable regions a view produced in View; the Model
	// composites them so rows and tabs stay mouse targets.
	layers []*lipgloss.Layer
}

// mainHeight leaves the header row above and the status line and bar below.
func (ctx *viewContext) mainHeight() int { return max(ctx.height-3, 3) }

// snapshot is every App's remembered steps overlaid with the events of the
// tasks a status refresh has not read yet, and the Action of the latest
// task, which stays until the next one starts.
func (ctx *viewContext) snapshot() activity.Snapshot {
	if !ctx.shared {
		return ctx.buildSnapshot()
	}
	if ctx.snap == nil {
		s := ctx.buildSnapshot()
		ctx.snap = &s
	}
	return *ctx.snap
}

func (ctx *viewContext) buildSnapshot() activity.Snapshot {
	var evs, latest []events.Event
	if ctx.tasks != nil {
		for _, task := range ctx.tasks.snapshots() {
			if task.persisted {
				continue
			}
			evs = append(evs, task.events...)
		}
		if task := ctx.tasks.latest(); task != nil {
			latest = actionEvents(task.snapshot())
		}
	}
	s := activity.Build(ctx.status, evs)
	action := activity.Build(ctx.status, latest)
	s.Action, s.Pull = action.Action, action.Pull
	return s
}

// actionEvents are a task's events as one Action: opened with a run.start
// named after the task when the Service has not sent one yet, and closed
// with a run.end when the task ended without one, as an Action that fails
// outside the Service's own finish does.
func actionEvents(t taskSnapshot) []events.Event {
	evs := t.events
	if !slices.ContainsFunc(evs, func(e events.Event) bool { return e.Event == events.RunStart }) {
		evs = append([]events.Event{{Event: events.RunStart, Msg: t.title}}, evs...)
	}
	if t.state == taskRunning {
		return evs
	}
	for i := len(evs) - 1; i >= 0 && evs[i].Event != events.RunStart; i-- {
		if evs[i].Event == events.RunEnd {
			return evs
		}
	}
	end := events.Event{Event: events.RunEnd, Error: t.err}
	if t.state == taskCancelled {
		end.Error = "cancelled"
	}
	return append(evs, end)
}

// pullProgress is the running Action's overall pull, as a whole number out
// of 100 for the terminal's own progress indicator.
func (m Model) pullProgress(ctx *viewContext) (int, bool) {
	task := m.tasks.latest()
	if task == nil || task.snapshot().state != taskRunning {
		return 0, false
	}
	pull := ctx.snapshot().Pull
	if !pull.Pulling || pull.Total == 0 {
		return 0, false
	}
	return int(pull.Fraction * 100), true
}

func (ctx *viewContext) setFlash(text string, l level) {
	ctx.flash, ctx.flashLevel, ctx.flashed = text, l, true
}

// run starts a background Action; the status line shows its progress.
func (ctx *viewContext) run(req Request, title string, pendingSecrets ...string) tea.Cmd {
	t := ctx.tasks.start(title)
	backend := ctx.backend
	return func() tea.Msg {
		log := events.New(events.SinkFunc(t.append))
		log.Secret(pendingSecrets...)
		log.Secret(req.Passphrase)
		if req.Install != nil {
			log.Secret(req.Install.AdminPassword)
			for _, inputs := range req.Install.PrivateInputs {
				for _, value := range inputs {
					log.Secret(value)
				}
			}
		}
		if req.Cloudflare != nil {
			log.Secret(req.Cloudflare.APIToken)
		}
		err := log.RedactError(backend.Run(t.ctx, req, log))
		return taskDoneMsg{id: t.id, title: title, action: req.Action, err: err}
	}
}

// scrolled keeps cursor inside a window of size rows starting at offset.
func scrolled(cursor, offset, size, total int) int {
	if cursor < offset {
		offset = cursor
	}
	if cursor >= offset+size {
		offset = cursor - size + 1
	}
	return max(min(offset, total-size), 0)
}

// radioRow is one choice of a list: the cursor, a mark that is filled for the
// selected choice, and the label, bright for the selected one.
func radioRow(t theme, atCursor, selected bool, label string) string {
	cursor, mark, style := "  ", t.dim().Render("○"), t.body()
	if atCursor {
		cursor = t.cursor()
	}
	if selected {
		mark, style = t.fg(t.accentText).Render("●"), t.active()
	}
	return cursor + mark + " " + style.Render(label)
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

func (m Model) health() (label, level string) { return hostHealth(m.checks) }

// hostHealth sums up the host checks: a label and its Status level, or no
// level while the checks are still running.
func hostHealth(checks []host.Check) (label, level string) {
	if len(checks) == 0 {
		return "checking", ""
	}
	warn, fail := 0, 0
	for _, c := range checks {
		switch c.Level {
		case host.Warn:
			warn++
		case host.Fail:
			fail++
		}
	}
	switch {
	case fail > 0:
		return plural(fail, "failing check", "failing checks"), checkLevel(host.Fail)
	case warn > 0:
		return plural(warn, "warning", "warnings"), checkLevel(host.Warn)
	}
	return "healthy", checkLevel(host.OK)
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

// headerPiece is one piece of the header's context: what it says, how it
// looks, and whether the Overview's Now strip says it again when the header
// has no room for it (the LAN address and the time).
type headerPiece struct {
	text, styled string
	restated     bool
}

func piece(text, styled string) headerPiece { return headerPiece{text: text, styled: styled} }

// renderHeader is the one header row: the brand, the five tabs once the
// Project is read, and on the right as much context as fits, most important
// first. The brand's name shrinks to its mark only when that lets more of
// the essential context fit, so it does not flicker with the rest. It also
// returns what the Now strip should restate: the pieces that did not fit.
func (m Model) renderHeader() (string, []*lipgloss.Layer, []string) {
	t := m.theme
	showTabs := !m.onboardingShown() && m.loaded && m.statusErr == ""
	var labels []string
	tabsWidth := 0
	if showTabs {
		for i, tab := range tabs {
			labels = append(labels, strconv.Itoa(i+1)+" "+tab.label)
			tabsWidth += lipgloss.Width(labels[i])
		}
		tabsWidth += 2 * (len(labels) - 1)
	}
	essential, extra := m.headerContext()
	brand := t.brand(m.glyphs)
	mark := " " + t.title().Render(m.glyphs.Brand()) + " "
	withMark, _ := fitContext(essential, m.width-lipgloss.Width(mark)-tabsWidth)
	withBrand, _ := fitContext(essential, m.width-lipgloss.Width(brand)-tabsWidth)
	if lipgloss.Width(withMark) > lipgloss.Width(withBrand) {
		brand = mark
	}
	right, hidden := fitContext(append(essential, extra...), m.width-lipgloss.Width(brand)-tabsWidth)
	var restated []string
	for _, p := range hidden {
		if p.restated {
			restated = append(restated, p.text)
		}
	}
	left := brand
	var layers []*lipgloss.Layer
	for i, label := range labels {
		style := t.inactive()
		if surface(i) == m.surface {
			style = t.current()
		}
		if i > 0 {
			left += "  "
		}
		rendered := style.Render(label)
		layers = append(layers, lipgloss.NewLayer(rendered).X(lipgloss.Width(left)).Y(0).ID("nav:"+tabs[i].name))
		left += rendered
	}
	gap := m.width - lipgloss.Width(left) - lipgloss.Width(right)
	if gap < 1 {
		return truncate(left, m.width), layers, restated
	}
	return left + strings.Repeat(" ", gap) + right, layers, restated
}

// fitContext joins the context pieces that fit in width after a one-cell
// gap, in order of importance, skipping any that do not; those are returned.
func fitContext(pieces []headerPiece, width int) (string, []headerPiece) {
	right := ""
	var hidden []headerPiece
	for _, p := range pieces {
		next := p.styled
		if right != "" {
			next = right + " " + p.styled
		}
		if 1+lipgloss.Width(next) <= width {
			right = next
		} else {
			hidden = append(hidden, p)
		}
	}
	return right, hidden
}

// projectLabel names the Project in the header: its folder, short.
func projectLabel(path string) string {
	if home, err := os.UserHomeDir(); err == nil && home != "" && strings.HasPrefix(path, home+"/") {
		return "~/" + strings.TrimPrefix(path, home+"/")
	}
	return filepath.Base(path)
}

// headerContext is the right side of the header, most important first: the
// essential host health, LAN address, newer release and Project, then the
// extra last refresh, known updates and version.
func (m Model) headerContext() (essential, extra []headerPiece) {
	t := m.theme
	if !m.onboardingShown() {
		label, level := m.health()
		health := piece(label, t.chip("○ "+label, t.muted))
		if level != "" {
			glyph, c := t.status(level)
			health = piece(label, t.chip(glyph+" "+label, c))
		}
		essential = []headerPiece{health}
	}
	if m.loaded && m.statusErr == "" && m.status.Project != "" {
		var lan headerPiece
		switch {
		case m.status.Exposure == service.ExposureLocal:
			lan = piece("LOCAL ONLY", t.chip("LOCAL ONLY", t.warn))
		case m.status.LANIPStale:
			lan = piece("⚠ LAN "+m.status.LANIP, t.chip("⚠ LAN "+m.status.LANIP, t.warn))
		default:
			lan = piece("LAN "+m.status.LANIP, t.chip("LAN "+m.status.LANIP, t.info))
		}
		lan.restated = true
		essential = append(essential, lan)
	}
	if m.latest != "" {
		release := "↑ v" + strings.TrimPrefix(m.latest, "v")
		essential = append(essential, piece(release, t.fg(t.info).Render(release)))
	}
	if m.loaded && m.statusErr == "" && m.status.Project != "" {
		project := projectLabel(m.status.Project)
		essential = append(essential, piece(project, t.dim().Render(project)))
	}
	if !m.refreshed.IsZero() {
		clock := m.refreshed.Format("15:04:05")
		extra = append(extra, headerPiece{text: clock, styled: t.dim().Render(clock), restated: true})
	}
	if n := m.updatesAvailable(); n > 0 {
		updates := "⚠ " + plural(n, "update", "updates")
		extra = append(extra, piece(updates, t.fg(t.warn).Bold(true).Render(updates)))
	}
	version := "v" + strings.TrimPrefix(m.opts.Version, "v")
	return essential, append(extra, piece(version, t.dim().Render(version)))
}

// renderBar is the last row: the global keys on the left and the focused
// pane's keys as chips on the right. Chips that do not fit are cut from the
// right and marked "…"; the global keys always stay. A mode (typing, help)
// replaces the global keys while they do not act.
func (m Model) renderBar(mode string, chips []key.Binding) string {
	t := m.theme
	left := mode
	if left == "" {
		k := m.keys
		left = barKey(t, k.Tabs.Help().Key, k.Tabs.Help().Desc) + "  " + t.title().Render("←/→") + "  " +
			barKey(t, k.ProjectMenu.Help().Key, k.ProjectMenu.Help().Desc) + "  "
		// A chip on ? says what it opens here, so ? is not listed twice.
		if !slices.ContainsFunc(chips, func(b key.Binding) bool { return slices.Contains(b.Keys(), k.Help.Keys()[0]) }) {
			left += barKey(t, k.Help.Help().Key, k.Help.Help().Desc) + "  "
		}
		left += barKey(t, k.Quit.Help().Key, k.Quit.Help().Desc)
	}
	left = " " + left
	var rendered []string
	total := 0
	for i, b := range chips {
		chip := t.chip(b.Help().Key, t.bright) + " " + t.dim().Render(b.Help().Desc)
		rendered = append(rendered, chip)
		if i > 0 {
			total += 2
		}
		total += lipgloss.Width(chip)
	}
	avail := m.width - lipgloss.Width(left) - 3
	right := strings.Join(rendered, "  ")
	if total > avail {
		ellipsis := " " + t.dim().Render("…")
		var fitted []string
		used := 0
		for _, chip := range rendered {
			w := lipgloss.Width(chip)
			if len(fitted) > 0 {
				w += 2
			}
			if used+w+lipgloss.Width(ellipsis) > avail {
				break
			}
			fitted = append(fitted, chip)
			used += w
		}
		right = strings.Join(fitted, "  ") + ellipsis
	}
	gap := m.width - lipgloss.Width(left) - lipgloss.Width(right) - 1
	if gap < 2 {
		return pad(left, m.width)
	}
	return pad(left+strings.Repeat(" ", gap)+right, m.width)
}

func barKey(t theme, k, desc string) string {
	return t.title().Render(k) + " " + t.dim().Render(desc)
}

// View composes the header, the active tab, the status line and the bar,
// then the Help overlay when it is open.
func (m Model) View() tea.View {
	var v tea.View
	v.AltScreen = true
	v.MouseMode = tea.MouseModeCellMotion
	v.ReportFocus = true
	v.WindowTitle = m.windowTitle()
	ctxView := m.ctx()
	if pct, ok := m.pullProgress(ctxView); ok {
		v.ProgressBar = tea.NewProgressBar(tea.ProgressBarDefault, pct)
	} else if m.tasks.running() > 0 {
		v.ProgressBar = tea.NewProgressBar(tea.ProgressBarIndeterminate, 0)
	}
	if m.width == 0 {
		v.SetContent("")
		return v
	}
	if m.preboot != nil {
		v.SetContent(m.renderPreboot())
		return v
	}

	header, layers, restated := m.renderHeader()
	ctxView.headerFacts = restated
	status := pad(m.footerStatus(ctxView), m.width)
	var content string
	if m.onboardingShown() {
		mode, chips := m.onboardingBar()
		if m.showHelp {
			mode, chips = m.helpBar()
		}
		main := m.renderOnboarding()
		if m.showHelp && m.helpView.page != nil {
			main = m.helpView.pageView(ctxView)
		}
		content = header + "\n" + fit(main, m.width, m.mainHeight()) + "\n" + status + "\n" + m.renderBar(mode, chips)
	} else {
		var main, mode string
		var chips []key.Binding
		switch {
		case !m.loaded:
			main = m.renderLoading()
			mode = barKey(m.theme, m.keys.Quit.Help().Key, m.keys.Quit.Help().Desc)
		case m.statusErr != "":
			main = m.renderStatusError()
		default:
			active := m.activeView()
			main = active.View(ctxView, m.width, m.mainHeight())
			layers = append(layers, ctxView.layers...)
			if m.showHelp && m.helpView.page != nil {
				main, layers = m.helpView.pageView(ctxView), nil
			}
			chips = active.Keys()
			if m.surface == surfaceActivity && !active.Capturing() && m.activity.errorText(ctxView) != "" {
				chips = append(slices.Clone(errorKeys), chips...)
			}
			if active.Capturing() {
				mode = m.theme.fg(m.theme.accentText).Bold(true).Render("typing") + m.theme.dim().Render(" · keys go to the input")
				if chooser, ok := active.(interface{ BarMode(theme) string }); ok && chooser.BarMode(m.theme) != "" {
					mode = chooser.BarMode(m.theme)
				}
			}
		}
		if m.showHelp {
			mode, chips = m.helpBar()
		}
		if m.menu != nil {
			mode, chips = m.menuBarMode(), m.menuBarKeys()
		}
		if m.upgrade != nil && m.upgrade.state == updateAsking {
			mode, chips = m.updateBar()
		}
		content = header + "\n" + fit(main, m.width, m.mainHeight()) + "\n" + status + "\n" + m.renderBar(mode, chips)
	}

	all := append([]*lipgloss.Layer{lipgloss.NewLayer(content)}, layers...)
	if overlay := m.renderOverlay(); overlay != "" {
		w, h := lipgloss.Width(overlay), lipgloss.Height(overlay)
		x, y := max((m.width-w)/2, 0), max((m.height-h)/3, 0)
		all = append(all, lipgloss.NewLayer(overlay).X(x).Y(y).Z(10).ID("overlay"))
	}
	if m.menu != nil && !m.onboardingShown() {
		all = append(all, m.menuLayers()...)
	}
	if !m.onboardingShown() && (m.surface == surfaceDashboard || m.surface == surfaceApps) {
		var box string
		switch {
		case m.apps.copy != nil:
			box = m.apps.copy.view(ctxView, m.width, m.mainHeight())
		case m.apps.qr != nil:
			box = m.apps.qr.view(ctxView, m.width, m.mainHeight())
		}
		if box != "" {
			w, h := lipgloss.Width(box), lipgloss.Height(box)
			x, y := max((m.width-w)/2, 0), max((m.height-h)/3, 0)
			all = append(all, lipgloss.NewLayer(box).X(x).Y(y).Z(10).ID("overlay"))
		}
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

// helpBar is the bar while Help is open: the key reference closes on any
// other key, a help page only on esc or ?.
func (m Model) helpBar() (string, []key.Binding) {
	closing := " · any other key closes"
	if m.helpView.page != nil {
		closing = " · esc or ? closes"
	}
	return m.theme.fg(m.theme.accentText).Bold(true).Render("help") + m.theme.dim().Render(closing), m.helpView.Keys()
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

// footerStatus is the status line above the bar: the running Action's
// latest event, else the last result or flash message. On the Overview the
// Now strip shows the Action and its result, so the line keeps only the
// other messages.
func (m Model) footerStatus(ctx *viewContext) string {
	t := m.theme
	overview := !m.onboardingShown() && m.surface == surfaceDashboard
	if overview && m.flash == m.resultFlash {
		return ""
	}
	if task := m.tasks.latest(); task != nil && !overview && !m.flashHeld {
		if s := task.snapshot(); s.state == taskRunning {
			line := t.fg(t.accentText).Render(activity.Spinner(m.frame) + " " + s.title)
			if snapshot := ctx.snapshot(); snapshot.Pull.Pulling {
				line += t.dim().Render(" · ")
				line += activity.Compact(snapshot, m.width-lipgloss.Width(line), t.palette())
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
