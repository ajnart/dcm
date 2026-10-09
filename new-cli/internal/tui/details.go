package tui

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/service"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

// detailTab is one sub-tab of App details.
type detailTab int

const (
	tabLogs detailTab = iota
	tabSetup
	tabInfo
	tabCompose
	tabContainers
)

var detailTabs = []string{"logs", "setup", "info", "compose", "containers"}

// appDetails is App details: one App's logs, Setup, info, Compose file and
// containers in sub-tabs over one scrolling viewport. It follows a log stream
// for the App it shows and caches Compose files.
type appDetails struct {
	tab      detailTab
	vp       viewport.Model
	logLines []string
	stream   *logStream
	compose  map[string]string
	// usage is the latest load per Compose service while the usage stream runs.
	usage       map[string]service.ContainerUsage
	usageStream *usageStream
}

func newAppDetails() *appDetails {
	return &appDetails{vp: viewport.New(), compose: map[string]string{}}
}

// sync loads what the sub-tab shows for app, keeping the scroll position.
func (d *appDetails) sync(ctx *viewContext, app service.AppStatus, found bool) tea.Cmd {
	d.content(ctx, app, found)
	switch {
	case !found:
		return nil
	case d.tab == tabCompose:
		return loadComposeCmd(ctx.backend, app.ID)
	case d.tab == tabContainers:
		return loadContainersCmd(ctx.backend)
	}
	return nil
}

// show loads app's sub-tab and starts it where it reads best: logs at the
// end, everything else at the top.
func (d *appDetails) show(ctx *viewContext, app service.AppStatus, found bool) tea.Cmd {
	cmd := d.sync(ctx, app, found)
	if d.tab == tabLogs {
		d.vp.GotoBottom()
	} else {
		d.vp.GotoTop()
	}
	return cmd
}

// step moves to the next (+1) or previous (-1) sub-tab, wrapping around.
func (d *appDetails) step(ctx *viewContext, app service.AppStatus, found bool, delta int) tea.Cmd {
	n := detailTab(len(detailTabs))
	d.tab = (d.tab + detailTab(delta) + n) % n
	return d.show(ctx, app, found)
}

func (d *appDetails) setTab(ctx *viewContext, app service.AppStatus, found bool, tab detailTab) tea.Cmd {
	d.tab = tab
	return d.show(ctx, app, found)
}

func loadComposeCmd(backend Backend, id string) tea.Cmd {
	return func() tea.Msg {
		text, err := backend.Compose(context.Background(), id)
		return composeMsg{id: id, text: text, err: err}
	}
}

// content lays the sub-tab into the viewport, keeping the scroll position so
// a refresh does not move what is being read.
func (d *appDetails) content(ctx *viewContext, app service.AppStatus, found bool) {
	t := ctx.theme
	switch {
	case d.tab == tabLogs:
		d.vp.SetContentLines(d.logLines)
	case d.tab == tabCompose:
		d.vp.SetContent(d.compose[app.ID])
	case !found:
		d.vp.SetContent("")
	case d.tab == tabSetup:
		d.vp.SetContent(renderSetup(t, app, d.vp.Width()))
	case d.tab == tabInfo:
		d.vp.SetContent(renderInfo(t, app, d.vp.Width()))
	case d.tab == tabContainers:
		d.vp.SetContent(renderContainers(ctx, app, d.usage, d.vp.Width()))
	}
}

// resize fits the viewport to a box of width×height and re-lays the
// sub-tab, since text wraps to the width; logs keep following their end.
func (d *appDetails) resize(ctx *viewContext, app service.AppStatus, found bool, width, height int) {
	w, h := max(width-4, 1), max(height-4, 1)
	if d.vp.Width() == w && d.vp.Height() == h {
		return
	}
	following := d.vp.AtBottom()
	d.vp.SetWidth(w)
	d.vp.SetHeight(h)
	d.content(ctx, app, found)
	if d.tab == tabLogs && following {
		d.vp.GotoBottom()
	}
}

// refresh re-lays the sub-tabs drawn from the status (Setup, info and
// containers), for example after a refresh or a resize.
func (d *appDetails) refresh(ctx *viewContext, app service.AppStatus, found bool) {
	if d.tab == tabSetup || d.tab == tabInfo || d.tab == tabContainers {
		d.content(ctx, app, found)
	}
}

func (d *appDetails) stopLogs() {
	if d.stream != nil {
		d.stream.cancel()
		d.stream = nil
	}
}

// syncLogs follows the logs of target, restarting the stream when the App
// changes.
func (d *appDetails) syncLogs(ctx *viewContext, target string) tea.Cmd {
	if target == "" || (d.stream != nil && d.stream.target == target) {
		return nil
	}
	d.stopLogs()
	d.logLines = nil
	d.vp.SetContent("")
	streamCtx, cancel := context.WithCancel(context.Background())
	stream := &logStream{target: target, ch: make(chan string, 64), cancel: cancel}
	d.stream = stream
	backend := ctx.backend
	go func() {
		backend.Logs(streamCtx, target, chanWriter{ctx: streamCtx, ch: stream.ch})
		close(stream.ch)
	}()
	return waitLog(stream)
}

func (d *appDetails) stopUsage() {
	if d.usageStream != nil {
		d.usageStream.cancel()
		d.usageStream = nil
		d.usage = nil
	}
}

// syncUsage follows the Project's containers' load; one stream serves every
// App, so it starts once and keeps running while the sub-tab is shown.
func (d *appDetails) syncUsage(ctx *viewContext) tea.Cmd {
	if d.usageStream != nil {
		return nil
	}
	streamCtx, cancel := context.WithCancel(context.Background())
	stream := &usageStream{ch: make(chan []service.ContainerUsage, 1), cancel: cancel}
	d.usageStream = stream
	backend := ctx.backend
	go func() {
		backend.Usage(streamCtx, func(usage []service.ContainerUsage) {
			select {
			case stream.ch <- usage:
			case <-streamCtx.Done():
			}
		})
		close(stream.ch)
	}()
	return waitUsage(stream)
}

const maxLogLines = 2000

// appendLogs adds lines and keeps following the end unless scrolled up.
func (d *appDetails) appendLogs(text string) {
	following := d.vp.AtBottom()
	for _, line := range strings.Split(strings.TrimRight(text, "\n"), "\n") {
		if strings.TrimSpace(line) != "" {
			d.logLines = append(d.logLines, line)
		}
	}
	if len(d.logLines) > maxLogLines {
		d.logLines = d.logLines[len(d.logLines)-maxLogLines:]
	}
	if d.tab != tabLogs {
		return
	}
	d.vp.SetContentLines(d.logLines)
	if following {
		d.vp.GotoBottom()
	}
}

// update takes the asynchronous log chunks and Compose files.
func (d *appDetails) update(ctx *viewContext, app service.AppStatus, found bool, msg tea.Msg) tea.Cmd {
	switch msg := msg.(type) {
	case logChunkMsg:
		if msg.stream != d.stream || msg.done {
			return nil
		}
		d.appendLogs(msg.text)
		return waitLog(msg.stream)
	case usageMsg:
		if msg.stream != d.usageStream || msg.done {
			return nil
		}
		d.usage = make(map[string]service.ContainerUsage, len(msg.usage))
		for _, u := range msg.usage {
			d.usage[u.Service] = u
		}
		if d.tab == tabContainers {
			d.content(ctx, app, found)
		}
		return waitUsage(msg.stream)
	case composeMsg:
		text := msg.text
		if msg.err != nil {
			text = "could not read the Compose file: " + msg.err.Error()
		}
		d.compose[msg.id] = text
		d.content(ctx, app, found)
	}
	return nil
}

// render draws the details box at (x, y) with clickable sub-tabs.
func (d *appDetails) render(ctx *viewContext, app service.AppStatus, found bool, width, height, x, y int, focused bool) (string, []*lipgloss.Layer) {
	d.resize(ctx, app, found, width, height)
	t := ctx.theme
	inner := width - 4
	strip, layers := subTabStrip(t, detailTabs, int(d.tab), x+2, y+1)
	title, note := "Details", ""
	body := d.vp.View()
	switch {
	case !found:
		body = t.dim().Render("Select an App.")
	case d.tab == tabCompose:
		title, note = app.Name, "apps/"+app.ID+"/compose.yml"
		if d.compose[app.ID] == "" {
			body = t.dim().Render("reading the Compose file…")
		}
	case d.tab == tabLogs:
		title, note = app.Name, "logs"
		if len(d.logLines) == 0 {
			body = t.dim().Render("waiting for logs…")
		}
	default:
		title = app.Name
	}
	content := truncate(strip, inner) + "\n" + t.fg(t.faint).Render(strings.Repeat("─", max(inner, 0))) + "\n" + body
	return t.box(title, note, content, width, height, focused), layers
}

// subTabStrip draws sub-tab names in a row with the active one marked, and
// one clickable layer per name, "tab:<index>", from (x, y).
func subTabStrip(t theme, names []string, active, x, y int) (string, []*lipgloss.Layer) {
	var tabs []string
	var layers []*lipgloss.Layer
	for i, name := range names {
		style := t.inactive()
		if i == active {
			style = t.current()
		}
		rendered := " " + style.Render(name) + " "
		layers = append(layers, lipgloss.NewLayer(rendered).X(x).Y(y).ID("tab:"+strconv.Itoa(i)))
		tabs = append(tabs, rendered)
		x += lipgloss.Width(rendered) + 1
	}
	return strings.Join(tabs, " "), layers
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
	for _, s := range app.Steps {
		lines = append(lines, t.stepMark(setupState(s.Status))+" "+t.body().Render(s.ID)+t.dim().Render("  "+s.Msg))
		if s.Status.NeedsAttention() {
			if s.Error != "" {
				lines = append(lines, t.fg(t.fail).Render(indent("  ", s.Error, width)))
			}
			if s.Hint != "" {
				lines = append(lines, t.fg(t.warn).Render(indent("  → ", s.Hint, width)))
			}
		}
	}
	if app.Setup == stepstatus.SetupIncomplete {
		lines = append(lines, "", t.dim().Render(wrap("Finish the failed step by hand (or let your agent use agent-browser), then press a r to retry Setup.", width)))
	}
	return strings.Join(lines, "\n")
}

// setupState is the activity state of a remembered Setup step.
func setupState(s stepstatus.Step) activity.State {
	switch s {
	case stepstatus.StepSkip:
		return activity.Skipped
	case stepstatus.StepManual:
		return activity.Manual
	case stepstatus.StepFail:
		return activity.Failed
	}
	return activity.Done
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

// renderContainers is the App's containers and images: a summary with the
// update state, then per container its service, state, health and, when
// they fit, uptime and ports, with its image on the line below.
func renderContainers(ctx *viewContext, app service.AppStatus, usage map[string]service.ContainerUsage, width int) string {
	t := ctx.theme
	var mine []service.ContainerStatus
	running := 0
	for _, c := range ctx.containers {
		if c.App != app.ID {
			continue
		}
		mine = append(mine, c)
		if c.State == "running" {
			running++
		}
	}
	checked := "checking…"
	if !ctx.updatesAt.IsZero() {
		checked = "checked " + ctx.updatesAt.Format("15:04")
	}
	lines := []string{t.body().Render(fmt.Sprintf("%s · %d running", plural(len(mine), "container", "containers"), running)) +
		t.dim().Render(" · ") + updateMark(ctx, app.ID) + t.dim().Render(" · "+checked), ""}
	if len(mine) == 0 {
		msg := "No containers for " + app.Name + ". Is it started?"
		if ctx.containersErr != "" {
			msg = "Could not read containers: " + ctx.containersErr
		}
		return strings.Join(append(lines, t.dim().Render(wrap(msg, width))), "\n")
	}
	showUptime := width >= 64
	showPorts := width >= 80
	header := pad("SERVICE", 22) + pad("STATE", 10) + pad("HEALTH", 10)
	if showUptime {
		header += pad("UPTIME", 22)
	}
	if showPorts {
		header += "PORTS"
	}
	lines = append(lines, t.dim().Render(truncate(header, width)))
	for _, c := range mine {
		line := t.body().Render(pad(truncate(c.Service, 21), 22)) + pad(c.State, 10) + t.dim().Render(pad(c.Health, 10))
		if showUptime {
			line += t.dim().Render(pad(c.Status, 22))
		}
		if showPorts {
			line += t.dim().Render(strings.Join(c.Ports, " "))
		}
		lines = append(lines, truncate(line, width))
		if u, ok := usage[c.Service]; ok && c.State == "running" {
			lines = append(lines, usageLine(ctx, u, width))
		}
		image := c.Image
		if image == "" {
			image = app.Image
		}
		if image != "" {
			lines = append(lines, t.dim().Render(truncate("  image "+image, width)))
		}
	}
	return strings.Join(lines, "\n")
}

const (
	usageBarMax = 12
	usageBarMin = 4
)

// usageLine is a container's CPU and memory bars under its row, then the
// MiB in use. The bars share the width left after their labels and the MiB,
// at most usageBarMax cells each; when they would be narrower than
// usageBarMin they are dropped and only the MiB stay, so the row's own
// columns are never cut for them.
func usageLine(ctx *viewContext, u service.ContainerUsage, width int) string {
	t := ctx.theme
	mib := fmt.Sprintf("%d MiB", u.MemBytes>>20)
	cells := min((width-len("  cpu ")-len("  mem ")-len("  ")-len(mib))/2, usageBarMax)
	if cells < usageBarMin {
		return truncate(t.dim().Render("  "+mib), width)
	}
	p := t.palette()
	return t.dim().Render("  cpu ") + activity.SlimBar(u.CPU, cells, p) +
		t.dim().Render("  mem ") + activity.SlimBar(u.Mem, cells, p) + t.dim().Render("  "+mib)
}

// updateMark is one App's update state.
func updateMark(ctx *viewContext, appID string) string {
	t := ctx.theme
	switch appUpdate(ctx, appID) {
	case service.UpdateAvailable:
		return t.fg(t.warn).Render("⚠ update available")
	case service.UpdateCurrent:
		return t.fg(t.ok).Render("✓ up to date")
	default:
		return t.dim().Render("? update unknown")
	}
}

type logStream struct {
	target string
	ch     chan string
	cancel context.CancelFunc
}

// chanWriter feeds a log stream's channel until the stream stops, so a full
// channel never holds the Logs goroutine after the view stopped reading.
type chanWriter struct {
	ctx context.Context
	ch  chan string
}

func (w chanWriter) Write(p []byte) (int, error) {
	select {
	case w.ch <- string(p):
		return len(p), nil
	case <-w.ctx.Done():
		return 0, w.ctx.Err()
	}
}

// usageStream carries one Usage run's samples; the channel closes when the
// run ends.
type usageStream struct {
	ch     chan []service.ContainerUsage
	cancel context.CancelFunc
}

func waitUsage(stream *usageStream) tea.Cmd {
	return func() tea.Msg {
		usage, ok := <-stream.ch
		return usageMsg{stream: stream, usage: usage, done: !ok}
	}
}

func waitLog(stream *logStream) tea.Cmd {
	return func() tea.Msg {
		text, ok := <-stream.ch
		return logChunkMsg{stream: stream, text: text, done: !ok}
	}
}
