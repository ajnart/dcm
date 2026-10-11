package tui

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/service"
)

// appsView is the Apps tab: the App list and the selected App's details in
// sub-tabs, which take focus in turn. It owns the App selection, the list
// search, App details and the credential picker; the Overview's Apps pane
// shares them.
type appsView struct {
	// cursor is the selected row of the visible Apps.
	cursor int
	// searching is `/` typing into filter, which narrows the list on name or id.
	searching bool
	filter    string
	// detailsFocused gives ↑/↓ to the details instead of the App selection.
	detailsFocused bool
	details        *appDetails
	copy           *copyPicker
	qr             *qrModal
}

func newAppsView() *appsView { return &appsView{details: newAppDetails()} }

var (
	appsListKeys = []key.Binding{hint("↑/↓", "select"), hint("a", "actions"), hint("enter", "details"), hint("/", "search"),
		hint("[/]", "sub-tab"), hint("tab", "next pane"), hint("o", "open"), hint("c", "copy"), hint("r", "refresh"),
		hint("esc", "back"), hint("shift+tab", "previous pane")}
	appsDetailsKeys = []key.Binding{hint("↑/↓", "scroll"), hint("a", "actions"), hint("tab", "next pane"),
		hint("[/]", "sub-tab"), hint("pgup/pgdn", "page"), hint("o", "open"), hint("c", "copy"),
		hint("shift+tab", "previous pane")}
	appsSearchKeys = []key.Binding{hint("enter", "done"), hint("esc", "clear")}
)

func (v *appsView) Keys() []key.Binding {
	switch {
	case v.copy != nil:
		return copyHelp
	case v.qr != nil:
		return qrKeys
	case v.searching:
		return appsSearchKeys
	case v.detailsFocused:
		return appsDetailsKeys
	}
	return appsListKeys
}

func (v *appsView) Panes() []pane {
	return []pane{{"List", appsListKeys}, {"Details", appsDetailsKeys}, {"Search", appsSearchKeys}, {"Copy picker", copyHelp}, {"QR code", qrKeys}}
}

// overlayOpen is a modal over the Apps list: the copy picker or the QR code.
func (v *appsView) overlayOpen() bool { return v.copy != nil || v.qr != nil }

func (v *appsView) Capturing() bool { return v.searching || v.overlayOpen() }

func (v *appsView) BarMode(t theme) string {
	if v.copy != nil {
		return t.fg(t.accentText).Bold(true).Render("copy credentials")
	}
	return ""
}

func (v *appsView) Title() string { return "Apps" }

// visible narrows the Project's Apps to the ones matching the search on
// name or id.
func (v *appsView) visible(ctx *viewContext) []service.AppStatus {
	if v.filter == "" {
		return ctx.status.Apps
	}
	q := strings.ToLower(v.filter)
	var out []service.AppStatus
	for _, app := range ctx.status.Apps {
		if strings.Contains(strings.ToLower(app.Name), q) || strings.Contains(strings.ToLower(app.ID), q) {
			out = append(out, app)
		}
	}
	return out
}

func (v *appsView) selected(ctx *viewContext) (service.AppStatus, bool) {
	apps := v.visible(ctx)
	if v.cursor < 0 || v.cursor >= len(apps) {
		return service.AppStatus{}, false
	}
	return apps[v.cursor], true
}

// selectedApp is the App the Action menu opens for; none while the copy
// picker is open.
func (v *appsView) selectedApp(ctx *viewContext) (service.AppStatus, bool) {
	if v.overlayOpen() {
		return service.AppStatus{}, false
	}
	return v.selected(ctx)
}

func (v *appsView) selectedID(ctx *viewContext) string {
	app, _ := v.selected(ctx)
	return app.ID
}

func (v *appsView) clampCursor(ctx *viewContext) {
	v.cursor = max(min(v.cursor, len(v.visible(ctx))-1), 0)
}

// searchLine is the search shown above the list while one is active.
func (v *appsView) searchLine(t theme) (string, bool) {
	switch {
	case v.searching:
		return t.dim().Render("/" + v.filter + "▏"), true
	case v.filter != "":
		return t.dim().Render("/" + v.filter + "  (esc clears)"), true
	}
	return "", false
}

// searchKey types into the search: enter keeps the filter and stops typing,
// esc clears it. The App selected before stays selected while it still
// matches; otherwise the first match is.
func (v *appsView) searchKey(ctx *viewContext, press tea.KeyPressMsg) tea.Cmd {
	keep := v.selectedID(ctx)
	switch press.String() {
	case "enter":
		v.searching = false
		return nil
	case "esc":
		v.searching, v.filter = false, ""
	case "backspace":
		if runes := []rune(v.filter); len(runes) > 0 {
			v.filter = string(runes[:len(runes)-1])
		}
	default:
		v.filter += press.Text
	}
	return v.reselect(ctx, keep)
}

// clearFilter drops a kept filter, as the first esc after enter does.
func (v *appsView) clearFilter(ctx *viewContext) tea.Cmd {
	keep := v.selectedID(ctx)
	v.filter = ""
	return v.reselect(ctx, keep)
}

// reselect keeps the App id selected in the list as it is now filtered; the
// details reload only when the selection moved to another App.
func (v *appsView) reselect(ctx *viewContext, id string) tea.Cmd {
	v.cursor = max(slices.IndexFunc(v.visible(ctx), func(a service.AppStatus) bool { return a.ID == id }), 0)
	if v.selectedID(ctx) == id {
		return nil
	}
	app, found := v.selected(ctx)
	return v.details.show(ctx, app, found)
}

// selectApp moves the selection and shows the new App's details.
func (v *appsView) selectApp(ctx *viewContext, i int) tea.Cmd {
	v.cursor = i
	v.clampCursor(ctx)
	app, found := v.selected(ctx)
	return v.details.show(ctx, app, found)
}

// syncDetails reloads the selected App's details, keeping the scroll.
func (v *appsView) syncDetails(ctx *viewContext) tea.Cmd {
	app, found := v.selected(ctx)
	return v.details.sync(ctx, app, found)
}

func (v *appsView) refreshDetails(ctx *viewContext) {
	app, found := v.selected(ctx)
	v.details.refresh(ctx, app, found)
}

func (v *appsView) stepSubTab(ctx *viewContext, delta int) tea.Cmd {
	app, found := v.selected(ctx)
	return v.details.step(ctx, app, found, delta)
}

func (v *appsView) Update(ctx *viewContext, msg tea.Msg) (view, tea.Cmd, nav) {
	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		if v.copy != nil {
			return v, v.copyKey(ctx, msg), nav{}
		}
		if v.qr != nil {
			v.qrKey(msg)
			return v, nil, nav{}
		}
		return v.key(ctx, msg)
	case tea.MouseWheelMsg:
		if v.overlayOpen() {
			return v, nil, nav{}
		}
		v.wheel(msg)
		return v, nil, nav{}
	case clickMsg:
		if v.overlayOpen() {
			return v, nil, nav{}
		}
		return v, v.click(ctx, msg.id), nav{}
	case logChunkMsg, composeMsg, usageMsg:
		app, found := v.selected(ctx)
		return v, v.details.update(ctx, app, found, msg), nav{}
	case copyOptionsMsg:
		v.copyOptions(ctx, msg)
	}
	return v, nil, nav{}
}

func (v *appsView) wheel(msg tea.MouseWheelMsg) {
	if msg.Button == tea.MouseWheelUp {
		v.details.vp.ScrollUp(3)
	} else {
		v.details.vp.ScrollDown(3)
	}
}

// key handles the Apps tab's keys: selection or scrolling by focus, search,
// sub-tabs, open and copy.
func (v *appsView) key(ctx *viewContext, msg tea.KeyPressMsg) (view, tea.Cmd, nav) {
	k := ctx.keys
	if v.searching {
		return v, v.searchKey(ctx, msg), nav{}
	}
	switch {
	case key.Matches(msg, k.Up) && v.detailsFocused:
		v.details.vp.ScrollUp(1)
	case key.Matches(msg, k.Down) && v.detailsFocused:
		v.details.vp.ScrollDown(1)
	case key.Matches(msg, k.Up):
		return v, v.selectApp(ctx, v.cursor-1), nav{}
	case key.Matches(msg, k.Down):
		return v, v.selectApp(ctx, v.cursor+1), nav{}
	case key.Matches(msg, k.NextPane), key.Matches(msg, k.PrevPane):
		v.detailsFocused = !v.detailsFocused
	case key.Matches(msg, k.Search) && !v.detailsFocused:
		v.searching = true
	case msg.String() == "enter" && !v.detailsFocused:
		v.detailsFocused = true
	case key.Matches(msg, k.NextSub):
		return v, v.stepSubTab(ctx, 1), nav{}
	case key.Matches(msg, k.PrevSub):
		return v, v.stepSubTab(ctx, -1), nav{}
	case key.Matches(msg, k.ScrollUp):
		v.details.vp.PageUp()
	case key.Matches(msg, k.ScrollDown):
		v.details.vp.PageDown()
	case key.Matches(msg, k.Copy):
		return v, v.openCopy(ctx), nav{}
	case key.Matches(msg, k.Open):
		return v, v.open(ctx), nav{}
	case msg.String() == "r":
		return v, tea.Batch(loadUpdatesCmd(ctx.backend, ctx.status), loadContainersCmd(ctx.backend)), nav{}
	case msg.String() == "esc" && v.filter != "":
		return v, v.clearFilter(ctx), nav{}
	case msg.String() == "esc":
		return v, nil, nav{kind: navBack}
	}
	return v, nil, nav{}
}

// open opens the selected App's URL in the browser.
func (v *appsView) open(ctx *viewContext) tea.Cmd {
	app, found := v.selected(ctx)
	if !found {
		return nil
	}
	if app.URL == "" {
		ctx.setFlash(app.Name+" has no URL", levelWarn)
		return nil
	}
	backend, url := ctx.backend, app.URL
	return func() tea.Msg {
		if err := backend.OpenURL(url); err != nil {
			return flashMsg{text: "could not open a browser: " + err.Error() + " — " + url, level: levelError}
		}
		return flashMsg{text: "opened " + url, level: levelOK}
	}
}

// click selects an App row or a sub-tab.
func (v *appsView) click(ctx *viewContext, id string) tea.Cmd {
	var n int
	switch {
	case strings.HasPrefix(id, "row:"):
		fmt.Sscanf(id, "row:%d", &n)
		return v.selectApp(ctx, n)
	case strings.HasPrefix(id, "tab:"):
		fmt.Sscanf(id, "tab:%d", &n)
		app, found := v.selected(ctx)
		return v.details.setTab(ctx, app, found, detailTab(n))
	}
	return nil
}

func loadUpdatesCmd(backend Backend, status service.Status) tea.Cmd {
	return func() tea.Msg { return updatesMsg{updates: backend.Updates(context.Background(), status)} }
}

func loadContainersCmd(backend Backend) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		containers, err := backend.Containers(ctx)
		return containersMsg{containers: containers, err: err}
	}
}

func appStatus(ctx *viewContext, id string) (service.AppStatus, bool) {
	for _, a := range ctx.status.Apps {
		if a.ID == id {
			return a, true
		}
	}
	return service.AppStatus{}, false
}

// appUpdate is the App's update state, from the checks the model has run.
func appUpdate(ctx *viewContext, id string) string {
	if state, found := ctx.updates[id]; found && state != "" {
		return state
	}
	if app, found := appStatus(ctx, id); found && app.Update != "" {
		return app.Update
	}
	return service.UpdateUnknown
}

// appsListWidth leaves the details as much room as a compact list allows.
func appsListWidth(width int) int {
	if width >= wideWidth {
		return 34
	}
	return 30
}

func (v *appsView) View(ctx *viewContext, width, height int) string {
	listW := appsListWidth(width)
	list, layers := v.renderList(ctx, listW, height)
	app, found := v.selected(ctx)
	details, tabLayers := v.details.render(ctx, app, found, width-listW, height, listW, 1, v.detailsFocused)
	ctx.layers = append(ctx.layers, append(layers, tabLayers...)...)
	return lipgloss.JoinHorizontal(lipgloss.Top, list, details)
}

// renderList is the compact App list: Status glyph, category icon, name and state.
func (v *appsView) renderList(ctx *viewContext, width, height int) (string, []*lipgloss.Layer) {
	t := ctx.theme
	inner := width - 4
	rows := v.visible(ctx)
	var lines []string
	if line, ok := v.searchLine(t); ok {
		lines = append(lines, line)
	}
	top := len(lines)
	visible := max(height-2-top, 1)
	offset := max(v.cursor-visible+1, 0)
	var layers []*lipgloss.Layer
	switch {
	case len(ctx.status.Apps) == 0:
		lines = append(lines, t.dim().Render(wrap("No Apps yet. Press 4 to open the Catalog.", inner)))
	case len(rows) == 0:
		lines = append(lines, t.dim().Render("No Apps match."))
	}
	for i := offset; i < len(rows) && i-offset < visible; i++ {
		row := t.dim().Render(categoryIcon(ctx, rows[i].ID)) + " " + t.body().Render(pad(rows[i].Name, inner-14)) + " " + t.dim().Render(pad(stateLabel(rows[i]), 9))
		line := appListRow(t, service.Level(rows[i]), row, "", "", i == v.cursor, inner)
		lines = append(lines, line)
		layers = append(layers, lipgloss.NewLayer(line).X(2).Y(2+top+i-offset).ID(rowLayerID(i)))
	}
	return t.box("Apps", strconv.Itoa(len(rows)), strings.Join(lines, "\n"), width, height, !v.detailsFocused), layers
}

// appListRow is one App row after its Status dot, shared by the Apps tab's
// list and the Overview's Apps pane. The selected row has one background
// under its whole width so per-cell colours do not punch holes in it; the
// Status glyph keeps its colour.
func appListRow(t theme, level, row, address, url string, selected bool, inner int) string {
	if !selected {
		return t.dot(level) + " " + row
	}
	glyph, c := t.status(level)
	dot := t.fg(c).Background(t.selected).Bold(true).Render(glyph + " ")
	text := pad(stripANSI(row), inner-2)
	before, after, found := strings.Cut(text, address)
	if address == "" || url == "" || !found {
		return dot + t.selection().Render(text)
	}
	return dot + t.selection().Render(before) + hyperlink(url, t.selection().Render(address)) + t.selection().Render(after)
}

func rowLayerID(i int) string { return "row:" + strconv.Itoa(i) }

func stateLabel(a service.AppStatus) string {
	switch {
	case a.State == "running" && a.Health != "" && a.Health != "healthy":
		return a.Health
	case a.State == "exited" || a.State == "created":
		return "stopped"
	}
	return a.State
}
