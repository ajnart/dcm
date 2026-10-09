package tui

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/service"
)

// appsView is the Apps tab: the App list and the selected App's details in
// sub-tabs, which take focus in turn. It owns the App selection, App details
// and the credential picker; the Overview shares them until #135 reshapes it.
type appsView struct {
	cursor int
	// detailsFocused gives ↑/↓ to the details instead of the App selection.
	detailsFocused bool
	details        *appDetails
	copy           *copyPicker
}

func newAppsView() *appsView { return &appsView{details: newAppDetails()} }

var (
	appsListKeys = []key.Binding{hint("↑/↓", "select"), hint("a", "actions"), hint("tab", "next pane"),
		hint("[/]", "sub-tab"), hint("o", "open"), hint("c", "copy"), hint("r", "refresh"), hint("esc", "back"),
		hint("shift+tab", "previous pane")}
	appsDetailsKeys = []key.Binding{hint("↑/↓", "scroll"), hint("a", "actions"), hint("tab", "next pane"),
		hint("[/]", "sub-tab"), hint("pgup/pgdn", "page"), hint("o", "open"), hint("c", "copy"),
		hint("shift+tab", "previous pane")}
)

func (v *appsView) Keys() []key.Binding {
	switch {
	case v.copy != nil:
		return copyHelp
	case v.detailsFocused:
		return appsDetailsKeys
	}
	return appsListKeys
}

func (v *appsView) Panes() []pane {
	return []pane{{"List", appsListKeys}, {"Details", appsDetailsKeys}, {"Copy picker", copyHelp}}
}

func (v *appsView) Capturing() bool { return false }

func (v *appsView) Title() string { return "Apps" }

func (v *appsView) selected(ctx *viewContext) (service.AppStatus, bool) {
	if v.cursor < 0 || v.cursor >= len(ctx.status.Apps) {
		return service.AppStatus{}, false
	}
	return ctx.status.Apps[v.cursor], true
}

// selectedApp is the App the Action menu opens for; none while the copy
// picker is open.
func (v *appsView) selectedApp(ctx *viewContext) (service.AppStatus, bool) {
	if v.copy != nil {
		return service.AppStatus{}, false
	}
	return v.selected(ctx)
}

func (v *appsView) selectedID(ctx *viewContext) string {
	app, _ := v.selected(ctx)
	return app.ID
}

func (v *appsView) clampCursor(ctx *viewContext) {
	v.cursor = max(min(v.cursor, len(ctx.status.Apps)-1), 0)
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
		return v.key(ctx, msg)
	case tea.MouseWheelMsg:
		v.wheel(msg)
		return v, nil, nav{}
	case clickMsg:
		return v, v.click(ctx, msg.id), nav{}
	case logChunkMsg, composeMsg:
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

// key handles the keys every App pane shares: selection or scrolling by
// focus, sub-tabs, open and copy. The Overview reuses it for its Apps pane.
func (v *appsView) key(ctx *viewContext, msg tea.KeyPressMsg) (view, tea.Cmd, nav) {
	k := ctx.keys
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
	case strings.HasPrefix(id, "app:"):
		for i, app := range ctx.status.Apps {
			if app.ID == strings.TrimPrefix(id, "app:") {
				return v.selectApp(ctx, i)
			}
		}
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
	if v.copy != nil {
		return v.copy.view(ctx, width, height)
	}
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
	visible := max(height-2, 1)
	offset := max(v.cursor-visible+1, 0)
	rows := ctx.status.Apps
	var lines []string
	var layers []*lipgloss.Layer
	if len(rows) == 0 {
		lines = append(lines, t.dim().Render(wrap("No Apps yet. Press 4 to open the Catalog.", inner)))
	}
	for i := offset; i < len(rows) && i-offset < visible; i++ {
		level := service.Level(rows[i])
		row := t.dim().Render(categoryIcon(ctx, rows[i].ID)) + " " + t.body().Render(pad(rows[i].Name, inner-14)) + " " + t.dim().Render(pad(stateLabel(rows[i]), 9))
		line := t.dot(level) + " " + row
		if i == v.cursor {
			glyph, c := t.status(level)
			dot := t.fg(c).Background(t.selected).Bold(true).Render(glyph + " ")
			line = dot + t.selection().Render(pad(stripANSI(row), inner-2))
		}
		lines = append(lines, line)
		layers = append(layers, lipgloss.NewLayer(line).X(2).Y(2+i-offset).ID(rowLayerID(i)))
	}
	return t.box("Apps", strconv.Itoa(len(rows)), strings.Join(lines, "\n"), width, height, !v.detailsFocused), layers
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
