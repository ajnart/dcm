package tui

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"charm.land/bubbles/v2/key"
	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/service"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

// detailTab is one tab of App details.
type detailTab int

const (
	tabLogs detailTab = iota
	tabSetup
	tabInfo
	tabCompose
)

var detailTabs = []string{"logs", "setup", "info", "compose"}

// dashboardView is the Overview tab: every App with its Status, what Needs
// attention, and the selected App's details. The Apps pane and the details
// pane take focus in turn; Needs attention has nothing to navigate.
type dashboardView struct {
	cursor int
	tab    detailTab
	// detailsFocused gives ↑/↓ to the details instead of the App selection.
	detailsFocused bool
	// details scrolls the logs and compose tabs.
	details  viewport.Model
	logLines []string
	stream   *logStream
	compose  map[string]string
	copy     *copyPicker
}

func newDashboardView() *dashboardView {
	return &dashboardView{details: viewport.New(), compose: map[string]string{}}
}

var (
	overviewAppsKeys = []key.Binding{hint("↑/↓", "select"), hint("a", "actions"), hint("enter", "details"),
		hint("tab", "next pane"), hint("[/]", "sub-tab"), hint("o", "open"), hint("c", "copy"), hint("shift+tab", "previous pane")}
	overviewDetailsKeys = []key.Binding{hint("↑/↓", "scroll"), hint("a", "actions"), hint("tab", "next pane"),
		hint("[/]", "sub-tab"), hint("pgup/pgdn", "page"), hint("o", "open"), hint("c", "copy"), hint("shift+tab", "previous pane")}
)

func (v *dashboardView) Keys() []key.Binding {
	switch {
	case v.copy != nil:
		return copyHelp
	case v.detailsFocused:
		return overviewDetailsKeys
	}
	return overviewAppsKeys
}

func (v *dashboardView) Panes() []pane {
	return []pane{{"Apps", overviewAppsKeys}, {"Details", overviewDetailsKeys}, {"Copy picker", copyHelp}}
}

func (v *dashboardView) Capturing() bool { return false }

func (v *dashboardView) Title() string { return "Overview" }

func (v *dashboardView) rows(ctx *viewContext) []service.AppStatus { return ctx.status.Apps }

func (v *dashboardView) selected(ctx *viewContext) (service.AppStatus, bool) {
	rows := v.rows(ctx)
	if v.cursor < 0 || v.cursor >= len(rows) {
		return service.AppStatus{}, false
	}
	return rows[v.cursor], true
}

// selectedApp is the App the Action menu opens for; none while the copy
// picker is open.
func (v *dashboardView) selectedApp(ctx *viewContext) (service.AppStatus, bool) {
	if v.copy != nil {
		return service.AppStatus{}, false
	}
	return v.selected(ctx)
}

func (v *dashboardView) selectedID(ctx *viewContext) string {
	app, _ := v.selected(ctx)
	return app.ID
}

func (v *dashboardView) clampCursor(ctx *viewContext) {
	v.cursor = max(min(v.cursor, len(v.rows(ctx))-1), 0)
}

func (v *dashboardView) Update(ctx *viewContext, msg tea.Msg) (view, tea.Cmd, nav) {
	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		if v.copy != nil {
			return v, v.copyKey(ctx, msg), nav{}
		}
		return v.key(ctx, msg)
	case copyOptionsMsg:
		if v.copy != msg.picker {
			return v, nil, nav{}
		}
		v.copy.loading = false
		v.copy.rows = msg.rows
		if msg.err != nil {
			v.copy = nil
			ctx.setFlash("could not read credentials", levelError)
		}
		return v, nil, nav{}
	case tea.MouseWheelMsg:
		if msg.Button == tea.MouseWheelUp {
			v.details.ScrollUp(3)
		} else {
			v.details.ScrollDown(3)
		}
		return v, nil, nav{}
	case clickMsg:
		cmd, nv := v.click(ctx, msg.id)
		return v, cmd, nv
	case logChunkMsg:
		if msg.stream != v.stream || msg.done {
			return v, nil, nav{}
		}
		v.appendLogs(msg.text)
		return v, waitLog(msg.stream), nav{}
	case composeMsg:
		text := msg.text
		if msg.err != nil {
			text = "could not read the Compose file: " + msg.err.Error()
		}
		v.compose[msg.id] = text
		v.syncDetailsContent(ctx)
		return v, nil, nav{}
	}
	return v, nil, nav{}
}

func (v *dashboardView) View(ctx *viewContext, width, height int) string {
	if v.copy != nil {
		return v.copy.view(ctx, width, height)
	}
	main, layers := v.render(ctx)
	ctx.layers = append(ctx.layers, layers...)
	return main
}

func (v *dashboardView) key(ctx *viewContext, msg tea.KeyPressMsg) (view, tea.Cmd, nav) {
	k := ctx.keys
	switch {
	case key.Matches(msg, k.Up) && v.detailsFocused:
		v.details.ScrollUp(1)
		return v, nil, nav{}
	case key.Matches(msg, k.Down) && v.detailsFocused:
		v.details.ScrollDown(1)
		return v, nil, nav{}
	case key.Matches(msg, k.Up):
		return v, v.move(ctx, -1), nav{}
	case key.Matches(msg, k.Down):
		return v, v.move(ctx, 1), nav{}
	case key.Matches(msg, k.NextPane), key.Matches(msg, k.PrevPane):
		if v.layout(ctx).detailsH > 0 {
			v.detailsFocused = !v.detailsFocused
		}
		return v, nil, nav{}
	case msg.String() == "enter" && !v.detailsFocused:
		// Going into the App; #135 makes this the jump to the Apps tab.
		if v.layout(ctx).detailsH > 0 {
			v.detailsFocused = true
		}
		return v, nil, nav{}
	case key.Matches(msg, k.NextSub):
		return v, v.showTab(ctx, (v.tab+1)%detailTab(len(detailTabs))), nav{}
	case key.Matches(msg, k.PrevSub):
		return v, v.showTab(ctx, (v.tab+detailTab(len(detailTabs))-1)%detailTab(len(detailTabs))), nav{}
	case key.Matches(msg, k.ScrollUp):
		v.details.PageUp()
		return v, nil, nav{}
	case key.Matches(msg, k.ScrollDown):
		v.details.PageDown()
		return v, nil, nav{}
	case key.Matches(msg, k.Copy):
		return v, v.openCopy(ctx), nav{}
	}
	app, found := v.selected(ctx)
	if !found {
		return v, nil, nav{}
	}
	switch {
	case key.Matches(msg, k.Open):
		if app.URL == "" {
			ctx.setFlash(app.Name+" has no URL", levelWarn)
			return v, nil, nav{}
		}
		backend, url := ctx.backend, app.URL
		return v, func() tea.Msg {
			if err := backend.OpenURL(url); err != nil {
				return flashMsg{text: "could not open a browser: " + err.Error() + " — " + url, level: levelError}
			}
			return flashMsg{text: "opened " + url, level: levelOK}
		}, nav{}
	}
	return v, nil, nav{}
}

func (v *dashboardView) move(ctx *viewContext, delta int) tea.Cmd {
	v.cursor += delta
	v.clampCursor(ctx)
	return v.showDetails(ctx)
}

// showTab switches the details to another sub-tab, from its start.
func (v *dashboardView) showTab(ctx *viewContext, tab detailTab) tea.Cmd {
	v.tab = tab
	return v.showDetails(ctx)
}

func (v *dashboardView) click(ctx *viewContext, id string) (tea.Cmd, nav) {
	var n int
	switch {
	case strings.HasPrefix(id, "row:"):
		fmt.Sscanf(id, "row:%d", &n)
		v.cursor = n
		v.clampCursor(ctx)
		return v.showDetails(ctx), nav{}
	case strings.HasPrefix(id, "tab:"):
		fmt.Sscanf(id, "tab:%d", &n)
		return v.showTab(ctx, detailTab(n)), nav{}
	case strings.HasPrefix(id, "app:"):
		for i, app := range v.rows(ctx) {
			if app.ID == strings.TrimPrefix(id, "app:") {
				v.cursor = i
			}
		}
		return v.showDetails(ctx), nav{}
	}
	return nil, nav{}
}

// Details

// syncDetails loads what the current tab shows for the selected App.
func (v *dashboardView) syncDetails(ctx *viewContext) tea.Cmd {
	v.syncDetailsContent(ctx)
	switch v.tab {
	case tabLogs:
		return v.syncLogs(ctx)
	case tabCompose:
		if id := v.selectedID(ctx); id != "" {
			return loadComposeCmd(ctx.backend, id)
		}
	}
	return nil
}

func loadComposeCmd(backend Backend, id string) tea.Cmd {
	return func() tea.Msg {
		text, err := backend.Compose(context.Background(), id)
		return composeMsg{id: id, text: text, err: err}
	}
}

// showDetails loads the selected App's sub-tab and starts it where it reads
// best: logs at the end, everything else at the top.
func (v *dashboardView) showDetails(ctx *viewContext) tea.Cmd {
	cmd := v.syncDetails(ctx)
	if v.tab == tabLogs {
		v.details.GotoBottom()
	} else {
		v.details.GotoTop()
	}
	return cmd
}

// syncDetailsContent lays the current sub-tab into the details viewport and
// keeps the scroll position, so a refresh does not move what is being read.
func (v *dashboardView) syncDetailsContent(ctx *viewContext) {
	app, found := v.selected(ctx)
	switch {
	case v.tab == tabLogs:
		v.details.SetContentLines(v.logLines)
	case v.tab == tabCompose:
		v.details.SetContent(v.compose[app.ID])
	case !found:
		v.details.SetContent("")
	case v.tab == tabSetup:
		v.details.SetContent(renderSetup(ctx.theme, app, v.details.Width()))
	case v.tab == tabInfo:
		v.details.SetContent(renderInfo(ctx.theme, app, v.details.Width()))
	}
}

func (v *dashboardView) stopLogs() {
	if v.stream != nil {
		v.stream.cancel()
		v.stream = nil
	}
}

// syncLogs (re)starts the log stream when the selected App changes.
func (v *dashboardView) syncLogs(ctx *viewContext) tea.Cmd {
	target := v.selectedID(ctx)
	if target == "" || (v.stream != nil && v.stream.target == target) {
		return nil
	}
	v.stopLogs()
	v.logLines = nil
	v.details.SetContent("")
	streamCtx, cancel := context.WithCancel(context.Background())
	stream := &logStream{target: target, ch: make(chan string, 64), cancel: cancel}
	v.stream = stream
	backend := ctx.backend
	go func() {
		backend.Logs(streamCtx, target, chanWriter{stream.ch})
		close(stream.ch)
	}()
	return waitLog(stream)
}

const maxLogLines = 2000

// appendLogs adds lines and keeps following the end unless scrolled up.
func (v *dashboardView) appendLogs(text string) {
	following := v.details.AtBottom()
	for _, line := range strings.Split(strings.TrimRight(text, "\n"), "\n") {
		if strings.TrimSpace(line) != "" {
			v.logLines = append(v.logLines, line)
		}
	}
	if len(v.logLines) > maxLogLines {
		v.logLines = v.logLines[len(v.logLines)-maxLogLines:]
	}
	if v.tab != tabLogs {
		return
	}
	v.details.SetContentLines(v.logLines)
	if following {
		v.details.GotoBottom()
	}
}

// Layout

type layout struct {
	wide                    bool
	leftW, rightW           int
	appsH, needsH, detailsH int
	detailsX, detailsY      int
}

func rowLayerID(i int) string { return "row:" + strconv.Itoa(i) }

func (v *dashboardView) layout(ctx *viewContext) layout {
	h := ctx.mainHeight()
	appsWant := max(len(v.rows(ctx)), 1) + 2
	if ctx.width >= wideWidth {
		left := max(58, ctx.width*2/5)
		appsH := min(appsWant, max(h-5, 3))
		return layout{wide: true, leftW: left, rightW: ctx.width - left, appsH: appsH, needsH: h - appsH,
			detailsH: h, detailsX: left, detailsY: 1}
	}
	l := layout{leftW: ctx.width, rightW: ctx.width}
	l.appsH = min(appsWant, max(h/2, 3))
	needs, _ := v.needsLines(ctx, ctx.width-4)
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
func (v *dashboardView) relayout(ctx *viewContext) {
	l := v.layout(ctx)
	v.details.SetWidth(max(l.rightW-4, 1))
	v.details.SetHeight(max(l.detailsH-4, 1))
	if l.detailsH == 0 {
		v.detailsFocused = false
	}
	if v.tab == tabSetup || v.tab == tabInfo {
		v.syncDetailsContent(ctx)
	}
}

// Rendering

func (v *dashboardView) render(ctx *viewContext) (string, []*lipgloss.Layer) {
	l := v.layout(ctx)
	apps, layers := v.renderApps(ctx, l.leftW, l.appsH)
	needs, needLayers := v.renderNeeds(ctx, l.leftW, l.needsH, 1+l.appsH)
	layers = append(layers, needLayers...)
	if l.detailsH == 0 {
		return apps + "\n" + needs, layers
	}
	details, tabLayers := v.renderDetails(ctx, l.rightW, l.detailsH, l.detailsX, l.detailsY)
	layers = append(layers, tabLayers...)
	if l.wide {
		return lipgloss.JoinHorizontal(lipgloss.Top, apps+"\n"+needs, details), layers
	}
	return apps + "\n" + needs + "\n" + details, layers
}

func (v *dashboardView) renderApps(ctx *viewContext, width, height int) (string, []*lipgloss.Layer) {
	t := ctx.theme
	inner := width - 4
	visible := max(height-2, 1)
	offset := max(v.cursor-visible+1, 0)
	rows := v.rows(ctx)
	var lines []string
	var layers []*lipgloss.Layer
	if len(rows) == 0 {
		lines = append(lines, t.dim().Render("No Apps yet. Press 4 to open the Catalog."))
	}
	for i := offset; i < len(rows) && i-offset < visible; i++ {
		level := service.Level(rows[i])
		row := v.appRow(ctx, rows[i], inner-2)
		line := t.dot(level) + " " + row
		if i == v.cursor {
			// One background under the whole row so per-cell colours do not
			// punch holes in it; the Status glyph keeps its colour.
			glyph, c := t.status(level)
			dot := t.fg(c).Background(t.selected).Bold(true).Render(glyph + " ")
			line = dot + t.selection().Render(pad(stripANSI(row), inner-2))
		}
		lines = append(lines, line)
		layers = append(layers, lipgloss.NewLayer(line).X(2).Y(2+i-offset).ID(rowLayerID(i)))
	}
	return t.box("Apps", strconv.Itoa(len(rows)), strings.Join(lines, "\n"), width, height, !v.detailsFocused), layers
}

// appRow is one App after its Status dot: category icon, name, URL, state,
// Setup and update marks.
func (v *dashboardView) appRow(ctx *viewContext, a service.AppStatus, width int) string {
	t := ctx.theme
	update := " "
	if a.Update == service.UpdateAvailable {
		update = t.fg(t.warn).Render("↑")
	}
	urlWidth := min(width-28, 26)
	url := ""
	if urlWidth >= 12 {
		url = t.dim().Render(pad(a.URL, urlWidth)) + " "
	}
	return t.dim().Render(categoryIcon(ctx, a.ID)) + " " + t.body().Render(pad(a.Name, 12)) + " " + url +
		pad(stateLabel(a), 9) + " " + v.setupMark(ctx, a) + update
}

// categoryIcon is the App's category icon in the chosen glyph set; an App
// outside the Catalog gets the set's fallback.
func categoryIcon(ctx *viewContext, id string) string {
	category := ""
	if a, found := ctx.backend.Catalog().App(id); found {
		category = a.Info().Category
	}
	return ctx.glyphs.Category(category)
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

func (v *dashboardView) setupMark(ctx *viewContext, a service.AppStatus) string {
	t := ctx.theme
	switch a.Setup {
	case stepstatus.SetupOK:
		return t.fg(t.ok).Render("✓")
	case stepstatus.SetupIncomplete:
		return t.fg(t.fail).Render("✗")
	case stepstatus.SetupPending:
		return t.fg(t.warn).Render("…")
	}
	return t.disabled().Render("–")
}

// need is one Needs attention item and the Action that resolves it.
type need struct {
	broken bool
	text   string
	// key and desc name the Action; command is used when no key exists.
	key, desc, command string
	app                string
}

func (v *dashboardView) needsAction(ctx *viewContext) []need {
	var items []need
	for _, a := range v.rows(ctx) {
		for _, s := range a.Steps {
			// Setup cannot retry a failed install stage; "is stopped" or an
			// update below names the Action that can.
			if s.Status == stepstatus.StepManual && !service.IsStage(s.ID) {
				items = append(items, need{text: a.Name + ": " + s.ID + " manual · " + s.Hint, key: "a r", desc: "retry Setup", app: a.ID})
			}
			if s.Status == stepstatus.StepFail && !service.IsStage(s.ID) {
				items = append(items, need{broken: true, text: a.Name + ": " + s.ID + " failed", key: "a r", desc: "retry Setup", app: a.ID})
			}
		}
	}
	for _, a := range v.rows(ctx) {
		if a.State != "running" && a.State != "degraded" && a.State != "unknown" {
			items = append(items, need{broken: true, text: a.Name + " is stopped", key: "a s", desc: "start", app: a.ID})
		}
	}
	if ctx.status.LANIPStale {
		items = append(items, need{broken: true, text: "LAN IP " + ctx.status.LANIP + " is not on this machine", key: "5", desc: "Host settings"})
	}
	for _, a := range v.rows(ctx) {
		if a.Update == service.UpdateAvailable {
			items = append(items, need{text: a.Name + " has an update", key: "a u", desc: "update", app: a.ID})
		}
	}
	for _, c := range ctx.checks {
		// Stopped containers and a stale LAN IP are already listed above.
		if c.Level == host.OK || c.ID == "running" || c.ID == "lan-ip" {
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

// needsLines renders Needs attention and returns the App each line points at.
func (v *dashboardView) needsLines(ctx *viewContext, width int) ([]string, []string) {
	t := ctx.theme
	items := v.needsAction(ctx)
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
			action := t.title().Render(it.key) + t.dim().Render(" "+it.desc)
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

func (v *dashboardView) renderNeeds(ctx *viewContext, width, height, y int) (string, []*lipgloss.Layer) {
	t := ctx.theme
	lines, apps := v.needsLines(ctx, width-4)
	var layers []*lipgloss.Layer
	for i, app := range apps {
		if app != "" && i < height-2 {
			layers = append(layers, lipgloss.NewLayer(lines[i]).X(2).Y(y+1+i).ID("app:"+app))
		}
	}
	note := ""
	if n := len(v.needsAction(ctx)); n > 0 {
		note = strconv.Itoa(n)
	}
	return t.box("Needs attention", note, strings.Join(lines, "\n"), width, height, false), layers
}

func (v *dashboardView) renderDetails(ctx *viewContext, width, height, x, y int) (string, []*lipgloss.Layer) {
	t := ctx.theme
	inner := width - 4
	var tabs []string
	var layers []*lipgloss.Layer
	tx := x + 2
	for i, name := range detailTabs {
		style := t.inactive()
		if detailTab(i) == v.tab {
			style = t.current()
		}
		rendered := " " + style.Render(name) + " "
		layers = append(layers, lipgloss.NewLayer(rendered).X(tx).Y(y+1).ID("tab:"+strconv.Itoa(i)))
		tabs = append(tabs, rendered)
		tx += lipgloss.Width(rendered) + 1
	}
	app, found := v.selected(ctx)
	title, note := "Details", ""
	var body string
	switch {
	case !found:
		body = t.dim().Render("Select an App.")
	case v.tab == tabSetup, v.tab == tabInfo:
		title = app.Name
		body = v.details.View()
	case v.tab == tabCompose:
		title, note = app.Name, "apps/"+app.ID+"/compose.yml"
		body = v.details.View()
		if v.compose[app.ID] == "" {
			body = t.dim().Render("reading the Compose file…")
		}
	default:
		title, note = app.Name, "logs"
		body = v.details.View()
		if len(v.logLines) == 0 {
			body = t.dim().Render("waiting for logs…")
		}
	}
	content := strings.Join(tabs, " ") + "\n" + t.fg(t.faint).Render(strings.Repeat("─", max(inner, 0))) + "\n" + body
	return t.box(title, note, content, width, height, v.detailsFocused), layers
}

func renderSetup(t theme, app service.AppStatus, width int) string {
	if !app.Managed {
		return t.dim().Render(wrap(app.Name+" was added by hand (Unmanaged app). self-host starts, stops, updates and backs it up, but runs no Setup for it.", width))
	}
	if len(app.Steps) == 0 {
		if app.Setup == stepstatus.SetupOK {
			return t.fg(t.ok).Render("✓ ") + t.body().Render("Setup has finished.")
		}
		return t.dim().Render("Setup has not run yet. Press a, then r, to run it.")
	}
	var lines []string
	for _, step := range app.Steps {
		mark := t.fg(t.ok).Render("✓")
		switch step.Status {
		case stepstatus.StepSkip:
			mark = t.dim().Render("↷")
		case stepstatus.StepManual:
			mark = t.fg(t.warn).Render("! manual")
		case stepstatus.StepFail:
			mark = t.fg(t.fail).Render("✗")
		}
		lines = append(lines, mark+" "+t.body().Render(step.ID)+t.dim().Render("  "+step.Msg))
		if step.Status.NeedsAttention() {
			if step.Error != "" {
				lines = append(lines, t.fg(t.fail).Render(indent("  ", step.Error, width)))
			}
			if step.Hint != "" {
				lines = append(lines, t.fg(t.warn).Render(indent("  → ", step.Hint, width)))
			}
		}
	}
	if app.Setup == stepstatus.SetupIncomplete {
		lines = append(lines, "", t.dim().Render(wrap("Finish the failed step by hand (or let your agent use agent-browser), then press a r to retry Setup.", width)))
	}
	return strings.Join(lines, "\n")
}

func renderInfo(t theme, app service.AppStatus, width int) string {
	row := func(k, val string) string {
		return t.dim().Render(pad(k, 10)) + t.body().Render(truncate(val, width-10))
	}
	lines := []string{
		row("url", app.URL),
		row("port", strconv.Itoa(app.Port)),
		row("image", app.Image),
		row("services", strings.Join(app.Services, ", ")),
		row("state", strings.TrimSpace(app.State+" "+app.Health)),
		row("setup", string(app.Setup)),
		row("data", "apps/"+app.ID+"/"),
	}
	if app.Managed {
		lines = append(lines, "", t.dim().Render(wrap("Sign in with the Admin login: c copies the password, self-host credentials shows API keys.", width)))
	}
	return strings.Join(lines, "\n")
}

type logStream struct {
	target string
	ch     chan string
	cancel context.CancelFunc
}

type chanWriter struct{ ch chan string }

func (w chanWriter) Write(p []byte) (int, error) {
	w.ch <- string(p)
	return len(p), nil
}

func waitLog(stream *logStream) tea.Cmd {
	return func() tea.Msg {
		text, ok := <-stream.ch
		return logChunkMsg{stream: stream, text: text, done: !ok}
	}
}
