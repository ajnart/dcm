package tui

import (
	"strconv"
	"strings"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/service"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

// dashboardView is the Overview tab: every App with its Status, what Needs
// attention, and the selected App's details. The Apps pane and the details
// pane take focus in turn; Needs attention has nothing to navigate. The App
// selection, App details and the credential picker are the Apps tab's, so
// both tabs show the same App.
type dashboardView struct {
	apps *appsView
	// detailsFocused gives ↑/↓ to the details instead of the App selection.
	detailsFocused bool
}

func newDashboardView(apps *appsView) *dashboardView { return &dashboardView{apps: apps} }

var (
	overviewAppsKeys = []key.Binding{hint("↑/↓", "select"), hint("a", "actions"), hint("enter", "go to App"),
		hint("tab", "next pane"), hint("[/]", "sub-tab"), hint("o", "open"), hint("c", "copy"), hint("shift+tab", "previous pane")}
	overviewDetailsKeys = []key.Binding{hint("↑/↓", "scroll"), hint("a", "actions"), hint("tab", "next pane"),
		hint("[/]", "sub-tab"), hint("pgup/pgdn", "page"), hint("o", "open"), hint("c", "copy"), hint("shift+tab", "previous pane")}
)

func (v *dashboardView) Keys() []key.Binding {
	switch {
	case v.apps.copy != nil:
		return copyHelp
	case v.detailsFocused:
		return overviewDetailsKeys
	}
	return overviewAppsKeys
}

func (v *dashboardView) Panes() []pane {
	return []pane{{"Apps", overviewAppsKeys}, {"Details", overviewDetailsKeys}}
}

func (v *dashboardView) Capturing() bool { return false }

func (v *dashboardView) Title() string { return "Overview" }

func (v *dashboardView) rows(ctx *viewContext) []service.AppStatus { return ctx.status.Apps }

func (v *dashboardView) selectedApp(ctx *viewContext) (service.AppStatus, bool) {
	return v.apps.selectedApp(ctx)
}

func (v *dashboardView) Update(ctx *viewContext, msg tea.Msg) (view, tea.Cmd, nav) {
	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		if v.apps.copy != nil {
			return v, v.apps.copyKey(ctx, msg), nav{}
		}
		return v.key(ctx, msg)
	case tea.MouseWheelMsg:
		v.apps.wheel(msg)
	case clickMsg:
		return v, v.apps.click(ctx, msg.id), nav{}
	}
	return v, nil, nav{}
}

func (v *dashboardView) View(ctx *viewContext, width, height int) string {
	if v.apps.copy != nil {
		return v.apps.copy.view(ctx, width, height)
	}
	main, layers := v.render(ctx)
	ctx.layers = append(ctx.layers, layers...)
	return main
}

func (v *dashboardView) key(ctx *viewContext, msg tea.KeyPressMsg) (view, tea.Cmd, nav) {
	k := ctx.keys
	vp := &v.apps.details.vp
	switch {
	case key.Matches(msg, k.Up) && v.detailsFocused:
		vp.ScrollUp(1)
	case key.Matches(msg, k.Down) && v.detailsFocused:
		vp.ScrollDown(1)
	case key.Matches(msg, k.Up):
		return v, v.apps.selectApp(ctx, v.apps.cursor-1), nav{}
	case key.Matches(msg, k.Down):
		return v, v.apps.selectApp(ctx, v.apps.cursor+1), nav{}
	case key.Matches(msg, k.NextPane), key.Matches(msg, k.PrevPane):
		if v.layout(ctx).detailsH > 0 {
			v.detailsFocused = !v.detailsFocused
		}
	case msg.String() == "enter" && !v.detailsFocused:
		if _, found := v.apps.selected(ctx); found {
			v.apps.detailsFocused = true
			return v, nil, nav{kind: navTo, to: surfaceApps}
		}
	case key.Matches(msg, k.NextSub):
		return v, v.apps.stepSubTab(ctx, 1), nav{}
	case key.Matches(msg, k.PrevSub):
		return v, v.apps.stepSubTab(ctx, -1), nav{}
	case key.Matches(msg, k.ScrollUp):
		vp.PageUp()
	case key.Matches(msg, k.ScrollDown):
		vp.PageDown()
	case key.Matches(msg, k.Copy):
		return v, v.apps.openCopy(ctx), nav{}
	case key.Matches(msg, k.Open):
		return v, v.apps.open(ctx), nav{}
	}
	return v, nil, nav{}
}

// Layout

type layout struct {
	wide                    bool
	leftW, rightW           int
	appsH, needsH, detailsH int
	detailsX, detailsY      int
}

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

// relayout returns focus to the Apps pane when the details no longer fit.
func (v *dashboardView) relayout(ctx *viewContext) {
	if v.layout(ctx).detailsH == 0 {
		v.detailsFocused = false
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
	app, found := v.apps.selected(ctx)
	details, tabLayers := v.apps.details.render(ctx, app, found, l.rightW, l.detailsH, l.detailsX, l.detailsY, v.detailsFocused)
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
	offset := max(v.apps.cursor-visible+1, 0)
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
		if i == v.apps.cursor {
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

// appRow is one App after its Status dot: name, URL, state, Setup and
// update marks.
func (v *dashboardView) appRow(ctx *viewContext, a service.AppStatus, width int) string {
	t := ctx.theme
	update := " "
	if a.Update == service.UpdateAvailable {
		update = t.fg(t.warn).Render("↑")
	}
	urlWidth := min(width-27, 26)
	url := ""
	if urlWidth >= 12 {
		url = t.dim().Render(pad(a.URL, urlWidth)) + " "
	}
	return t.body().Render(pad(a.Name, 13)) + " " + url +
		pad(stateLabel(a), 9) + " " + v.setupMark(ctx, a) + update
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
