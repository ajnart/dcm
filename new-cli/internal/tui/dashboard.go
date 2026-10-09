package tui

import (
	"fmt"
	"strconv"
	"strings"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/service"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

// dashboardView is the Overview tab, the command center: the Now strip with
// the running or last Action, every App at a glance, and what Needs
// attention, each item naming the chord that resolves it. The Apps pane and
// Needs attention take focus in turn. The App selection and the credential
// picker are the Apps tab's, so both tabs select the same App.
type dashboardView struct {
	apps         *appsView
	needsFocused bool
	needsCursor  int
}

func newDashboardView(apps *appsView) *dashboardView { return &dashboardView{apps: apps} }

var (
	overviewAppsKeys = []key.Binding{hint("↑/↓", "select"), hint("enter", "go to App"), hint("a", "actions"),
		hint("tab", "next pane"), hint("o", "open"), hint("c", "copy"), hint("shift+tab", "previous pane")}
	overviewNeedsKeys = []key.Binding{hint("↑/↓", "select"), hint("a", "resolve"), hint("enter", "go to App"),
		hint("tab", "next pane"), hint("shift+tab", "previous pane")}
)

func (v *dashboardView) Keys() []key.Binding {
	switch {
	case v.apps.copy != nil:
		return copyHelp
	case v.needsFocused:
		return overviewNeedsKeys
	}
	return overviewAppsKeys
}

func (v *dashboardView) Panes() []pane {
	return []pane{{"Apps", overviewAppsKeys}, {"Needs attention", overviewNeedsKeys}}
}

func (v *dashboardView) Capturing() bool { return false }

func (v *dashboardView) Title() string { return "Overview" }

func (v *dashboardView) rows(ctx *viewContext) []service.AppStatus { return ctx.status.Apps }

// selectedApp is the App a opens the Action menu for: the selected App, or
// the App of the selected Needs attention item.
func (v *dashboardView) selectedApp(ctx *viewContext) (service.AppStatus, bool) {
	if !v.needsFocused {
		return v.apps.selectedApp(ctx)
	}
	item, found := v.selectedNeed(ctx)
	if !found || item.app == "" {
		return service.AppStatus{}, false
	}
	return appStatus(ctx, item.app)
}

// suggestedAction is the mnemonic of the Action the selected Needs attention
// item names, which the Action menu highlights.
func (v *dashboardView) suggestedAction(ctx *viewContext) string {
	if !v.needsFocused {
		return ""
	}
	item, _ := v.selectedNeed(ctx)
	return item.action
}

func (v *dashboardView) selectedNeed(ctx *viewContext) (need, bool) {
	items := v.needsAction(ctx)
	if len(items) == 0 {
		return need{}, false
	}
	return items[min(v.needsCursor, len(items)-1)], true
}

func (v *dashboardView) Update(ctx *viewContext, msg tea.Msg) (view, tea.Cmd, nav) {
	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		if v.apps.copy != nil {
			return v, v.apps.copyKey(ctx, msg), nav{}
		}
		return v.key(ctx, msg)
	case clickMsg:
		return v.click(ctx, msg.id)
	}
	return v, nil, nav{}
}

func (v *dashboardView) View(ctx *viewContext, width, height int) string {
	if v.apps.copy != nil {
		return v.apps.copy.view(ctx, width, height)
	}
	main, layers := v.render(ctx, width, height)
	ctx.layers = append(ctx.layers, layers...)
	return main
}

func (v *dashboardView) key(ctx *viewContext, msg tea.KeyPressMsg) (view, tea.Cmd, nav) {
	k := ctx.keys
	items := v.needsAction(ctx)
	if len(items) == 0 {
		v.needsFocused = false
	}
	v.needsCursor = max(min(v.needsCursor, len(items)-1), 0)
	switch {
	case key.Matches(msg, k.NextPane), key.Matches(msg, k.PrevPane):
		v.needsFocused = !v.needsFocused && len(items) > 0
	case key.Matches(msg, k.Up) && v.needsFocused:
		v.needsCursor = max(v.needsCursor-1, 0)
	case key.Matches(msg, k.Down) && v.needsFocused:
		v.needsCursor = min(v.needsCursor+1, len(items)-1)
	case msg.String() == "enter" && v.needsFocused:
		return v.goToApp(ctx, items[v.needsCursor].app)
	case v.needsFocused:
		// The keys below act on the Apps pane.
	case key.Matches(msg, k.Up):
		return v, v.apps.selectApp(ctx, v.apps.cursor-1), nav{}
	case key.Matches(msg, k.Down):
		return v, v.apps.selectApp(ctx, v.apps.cursor+1), nav{}
	case msg.String() == "enter":
		return v.goToApp(ctx, v.apps.selectedID(ctx))
	case key.Matches(msg, k.Copy):
		return v, v.apps.openCopy(ctx), nav{}
	case key.Matches(msg, k.Open):
		return v, v.apps.open(ctx), nav{}
	}
	return v, nil, nav{}
}

// goToApp opens the App on the Apps tab with its details focused.
func (v *dashboardView) goToApp(ctx *viewContext, id string) (view, tea.Cmd, nav) {
	for i, app := range v.rows(ctx) {
		if app.ID == id {
			cmd := v.apps.selectApp(ctx, i)
			v.apps.detailsFocused = true
			return v, cmd, nav{kind: navTo, to: surfaceApps}
		}
	}
	return v, nil, nav{}
}

// click selects an App row or a Needs attention item.
func (v *dashboardView) click(ctx *viewContext, id string) (view, tea.Cmd, nav) {
	var n int
	switch {
	case strings.HasPrefix(id, "need:"):
		fmt.Sscanf(id, "need:%d", &n)
		v.needsFocused, v.needsCursor = true, n
	case strings.HasPrefix(id, "row:"):
		v.needsFocused = false
		return v, v.apps.click(ctx, id), nav{}
	}
	return v, nil, nav{}
}

// Layout

// nowHeight is the Now strip's box: the Action's title, its bar or stages,
// its narrative and the host health.
const nowHeight = 6

type layout struct {
	wide          bool
	leftW, rightW int
	appsH, needsH int
}

// layout puts the Now strip on top; below it Apps and Needs attention sit
// side by side when wide, and stack when narrow.
func (v *dashboardView) layout(ctx *viewContext, width, height int) layout {
	h := max(height-nowHeight, 6)
	if width >= wideWidth {
		left := width * 11 / 20
		return layout{wide: true, leftW: left, rightW: width - left, appsH: h, needsH: h}
	}
	appsH := min(max(len(v.rows(ctx)), 1)+2, max(h/2, 3))
	return layout{leftW: width, rightW: width, appsH: appsH, needsH: h - appsH}
}

// Rendering

func (v *dashboardView) render(ctx *viewContext, width, height int) (string, []*lipgloss.Layer) {
	l := v.layout(ctx, width, height)
	now := v.renderNow(ctx, width)
	apps, layers := v.renderApps(ctx, l.leftW, l.appsH, 1+nowHeight)
	if l.wide {
		needs, needLayers := v.renderNeeds(ctx, l.rightW, l.needsH, l.leftW, 1+nowHeight)
		return now + "\n" + lipgloss.JoinHorizontal(lipgloss.Top, apps, needs), append(layers, needLayers...)
	}
	needs, needLayers := v.renderNeeds(ctx, l.rightW, l.needsH, 0, 1+nowHeight+l.appsH)
	return now + "\n" + apps + "\n" + needs, append(layers, needLayers...)
}

// renderNow is the Now strip: the running Action drawn by the presentation
// renderer, or the last Action's result, with the host health in words. It
// is never empty: before any Action it says so.
func (v *dashboardView) renderNow(ctx *viewContext, width int) string {
	t := ctx.theme
	inner := width - 4
	lines := activity.Strip(ctx.snapshot(), ctx.motion, inner, t.palette())
	if len(lines) == 0 {
		lines = []string{t.dim().Render("No Action yet")}
	}
	label, level := hostHealth(ctx.checks)
	health := t.fg(t.muted).Render("○ Host: " + label)
	if level != "" {
		health = t.dot(level) + " " + t.body().Render("Host: "+label)
	}
	lines = append(lines, health)
	return t.box("Now", "", strings.Join(lines, "\n"), width, nowHeight, false)
}

func (v *dashboardView) renderApps(ctx *viewContext, width, height, y int) (string, []*lipgloss.Layer) {
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
		layers = append(layers, lipgloss.NewLayer(line).X(2).Y(y+1+i-offset).ID(rowLayerID(i)))
	}
	return t.box("Apps", strconv.Itoa(len(rows)), strings.Join(lines, "\n"), width, height, !v.needsFocused), layers
}

// appRow is one App after its Status dot: its category icon and name, category,
// address when it fits, state, Setup mark and update mark. The name cell is
// built in one place.
func (v *dashboardView) appRow(ctx *viewContext, a service.AppStatus, width int) string {
	t := ctx.theme
	update := " "
	if a.Update == service.UpdateAvailable {
		update = t.fg(t.warn).Render("↑")
	}
	name := t.dim().Render(categoryIcon(ctx, a.ID)) + " " + t.body().Render(pad(a.Name, 13)) + " "
	category := t.dim().Render(pad(appCategory(ctx, a.ID), 10)) + " "
	// The address without its scheme: o opens it.
	address := strings.TrimPrefix(strings.TrimPrefix(a.URL, "http://"), "https://")
	urlWidth := min(width-40, 22)
	url := ""
	if urlWidth >= 12 {
		url = t.dim().Render(pad(address, urlWidth)) + " "
	}
	return name + category + url + pad(stateLabel(a), 9) + " " + v.setupMark(ctx, a) + update
}

// appCategory is the App's Catalog category; an Unmanaged app has none.
func appCategory(ctx *viewContext, id string) string {
	if ctx.backend == nil {
		return ""
	}
	if a, found := ctx.backend.Catalog().App(id); found {
		return a.Info().Category
	}
	return ""
}

// categoryIcon is the App's category icon in the chosen glyph set; an App
// outside the Catalog gets the set's fallback.
func categoryIcon(ctx *viewContext, id string) string {
	return ctx.glyphs.Category(appCategory(ctx, id))
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

// need is one Needs attention item: the App it points at, and the chord of
// the Action that resolves it (a and its mnemonic), or another key, or the
// command to run when no Action exists.
type need struct {
	broken bool
	text   string
	// action is the Action's mnemonic in the App's Action menu.
	action             string
	key, desc, command string
	app                string
}

func appNeed(broken bool, text, action, desc, app string) need {
	return need{broken: broken, text: text, action: action, key: "a " + action, desc: desc, app: app}
}

func (v *dashboardView) needsAction(ctx *viewContext) []need {
	var items []need
	for _, a := range v.rows(ctx) {
		for _, s := range a.Steps {
			// Setup cannot retry a failed install stage; "is stopped" or an
			// update below names the Action that can.
			if s.Status == stepstatus.StepManual && !service.IsStage(s.ID) {
				items = append(items, appNeed(false, a.Name+": "+s.ID+" manual · "+s.Hint, "r", "retry Setup", a.ID))
			}
			if s.Status == stepstatus.StepFail && !service.IsStage(s.ID) {
				items = append(items, appNeed(true, a.Name+": "+s.ID+" failed", "r", "retry Setup", a.ID))
			}
		}
	}
	for _, a := range v.rows(ctx) {
		if a.State != "running" && a.State != "degraded" && a.State != "unknown" {
			items = append(items, appNeed(true, a.Name+" is stopped", "s", "start", a.ID))
		}
	}
	if ctx.status.LANIPStale {
		items = append(items, need{broken: true, text: "LAN IP " + ctx.status.LANIP + " is not on this machine", key: "5", desc: "Host settings"})
	}
	for _, a := range v.rows(ctx) {
		if a.Update == service.UpdateAvailable {
			items = append(items, appNeed(false, a.Name+" has an update", "u", "update", a.ID))
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

// needsLines renders Needs attention and returns the item each line
// belongs to; the selected item is highlighted while the pane has focus.
func (v *dashboardView) needsLines(ctx *viewContext, width int) ([]string, []int) {
	t := ctx.theme
	items := v.needsAction(ctx)
	if len(items) == 0 {
		return []string{t.fg(t.ok).Render("✓ Nothing needs your attention")}, []int{-1}
	}
	var lines []string
	var owners []int
	for i, it := range items {
		icon := t.fg(t.warn).Render("!")
		if it.broken {
			icon = t.fg(t.fail).Render("✗")
		}
		text := t.body().Render(it.text)
		if v.needsFocused && i == v.needsCursor {
			text = t.selection().Render(it.text)
		}
		head := icon + " " + text
		var item []string
		switch {
		case it.key != "":
			action := t.title().Render(it.key) + t.dim().Render(" "+it.desc)
			if gap := width - lipgloss.Width(head) - lipgloss.Width(action); gap >= 2 {
				item = []string{head + strings.Repeat(" ", gap) + action}
			} else {
				item = []string{truncate(head, width), "  " + action}
			}
		default:
			item = []string{truncate(head, width), t.dim().Render(truncate("  → "+it.command, width))}
		}
		for _, line := range item {
			lines, owners = append(lines, line), append(owners, i)
		}
	}
	return lines, owners
}

func (v *dashboardView) renderNeeds(ctx *viewContext, width, height, x, y int) (string, []*lipgloss.Layer) {
	t := ctx.theme
	lines, owners := v.needsLines(ctx, width-4)
	visible := max(height-2, 1)
	offset := 0
	for i, owner := range owners {
		if owner == v.needsCursor && i >= offset+visible {
			offset = i - visible + 1
		}
	}
	var layers []*lipgloss.Layer
	for i := offset; i < len(lines) && i-offset < visible; i++ {
		if owners[i] >= 0 {
			layers = append(layers, lipgloss.NewLayer(lines[i]).X(x+2).Y(y+1+i-offset).ID("need:"+strconv.Itoa(owners[i])))
		}
	}
	note := ""
	if n := len(v.needsAction(ctx)); n > 0 {
		note = strconv.Itoa(n)
	}
	return t.box("Needs attention", note, strings.Join(lines[offset:], "\n"), width, height, v.needsFocused), layers
}
