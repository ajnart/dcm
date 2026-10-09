package tui

import (
	"strconv"
	"strings"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/service"
)

const (
	reasonBusy     = "wait for the running Action"
	reasonNoUpdate = "no update known (checked every 30 minutes)"
	reasonNoApps   = "the Project has no Apps"
)

// menuEntry is one Action in the Action menu: what it is called, the letter
// that highlights it, what it will do, and either the Request enter
// dispatches or the reason it cannot run now.
type menuEntry struct {
	label, mnemonic, preview string
	destructive              bool
	// confirm is what an armed destructive entry says before the second enter.
	confirm string
	req     Request
	// title names the running Action in the status line and Activity.
	title  string
	reason string
}

// appActions are the Actions valid for one App in its current state.
func appActions(app service.AppStatus, update string, busy bool) []menuEntry {
	name, ids := app.Name, []string{app.ID}
	var entries []menuEntry
	if app.State == "running" || app.State == "degraded" {
		entries = append(entries,
			menuEntry{label: "Stop", mnemonic: "s", destructive: true,
				preview: "Stops " + name + "'s containers. Its data, settings and Setup stay.",
				confirm: "Press enter again to stop " + name + ". Its data, settings and Setup stay.",
				req:     Request{Action: ActionStop, IDs: ids}, title: "stop " + app.ID},
			menuEntry{label: "Restart", mnemonic: "t", preview: "Restarts " + name + "'s containers.",
				req: Request{Action: ActionRestart, IDs: ids}, title: "restart " + app.ID})
	} else {
		entries = append(entries, menuEntry{label: "Start", mnemonic: "s", preview: "Starts " + name + "'s containers.",
			req: Request{Action: ActionStart, IDs: ids}, title: "start " + app.ID})
	}
	upd := menuEntry{label: "Update", mnemonic: "u",
		preview: "Pulls " + name + "'s newer images and recreates its containers. Data and Setup stay.",
		req:     Request{Action: ActionUpdate, IDs: ids}, title: "update " + app.ID}
	if update != service.UpdateAvailable {
		upd.reason = reasonNoUpdate
	}
	retry := menuEntry{label: "Retry Setup", mnemonic: "r",
		preview: "Runs " + name + "'s Setup again; steps already done are skipped.",
		req:     Request{Action: ActionSetup, IDs: ids}, title: "setup " + app.ID}
	if !app.Managed {
		retry.reason = "added by hand, no Setup"
	}
	entries = append(entries, upd, retry,
		menuEntry{label: "Backup", mnemonic: "b",
			preview: "Backs up " + name + "'s configuration, databases and secrets into one archive. Media is not included.",
			req:     Request{Action: ActionBackup, IDs: ids}, title: "backup " + app.ID},
		menuEntry{label: "Remove", mnemonic: "m", destructive: true,
			preview: "Removes " + name + "'s containers and Compose file. Its data in apps/" + app.ID + "/ stays.",
			confirm: "Press enter again to remove " + name + ". Its data in apps/" + app.ID + "/ stays.",
			req:     Request{Action: ActionRemove, IDs: ids}, title: "remove " + app.ID})
	if busy {
		for i := range entries {
			entries[i].reason = reasonBusy
		}
	}
	return entries
}

// projectActions are the Actions on the whole Project.
func projectActions(status service.Status, busy bool) []menuEntry {
	var ids, names []string
	for _, a := range status.Apps {
		if a.Update == service.UpdateAvailable {
			ids, names = append(ids, a.ID), append(names, a.Name)
		}
	}
	upd := menuEntry{label: "Update all", mnemonic: "u", preview: "Updates every App with a known update.",
		req: Request{Action: ActionUpdate, IDs: ids}, title: "update " + strings.Join(ids, " ")}
	if len(ids) == 0 {
		upd.reason = reasonNoUpdate
	} else {
		upd.preview = "Updates " + strings.Join(names, ", ") + ": pulls newer images and recreates their containers."
	}
	entries := []menuEntry{
		{label: "Up all", mnemonic: "p", preview: "Starts every App's containers.",
			req: Request{Action: ActionUp}, title: "up Project"},
		{label: "Down all", mnemonic: "d", destructive: true,
			preview: "Removes the Project's containers and networks; volumes, App files and Setup stay.",
			confirm: "Press enter again to take the Project down. Containers and networks go; volumes, App files and Setup stay.",
			req:     Request{Action: ActionDown}, title: "down Project"},
		{label: "Restart all", mnemonic: "r", preview: "Restarts every App's containers.",
			req: Request{Action: ActionRestart}, title: "restart Project"},
		upd,
		{label: "Backup", mnemonic: "b",
			preview: "Backs up every App's configuration, databases and secrets into one archive. Media is not included.",
			req:     Request{Action: ActionBackup}, title: "backup"},
	}
	for i := range entries {
		switch {
		case len(status.Apps) == 0:
			entries[i].reason = reasonNoApps
		case busy:
			entries[i].reason = reasonBusy
		}
	}
	return entries
}

// actionMenu is the open Action menu: for one App, or for the Project when
// appID is empty. Its entries are rebuilt from the current state every time,
// so they follow a refresh or an Action finishing while it is open.
type actionMenu struct {
	appID  string
	cursor int
	// armed is a destructive entry waiting for its second enter.
	armed bool
}

var (
	menuKeys      = []key.Binding{hint("↑/↓", "select"), hint("enter", "run"), hint("esc", "close")}
	menuHelpKeys  = []key.Binding{hint("letter", "highlight an Action"), hint("↑/↓", "select"), hint("enter", "run; destructive Actions need it twice"), hint("esc", "close")}
	menuBarPrompt = "letters pick an Action"
)

// selectsApp is a view with a selected App, which a opens the menu for.
type selectsApp interface {
	selectedApp(ctx *viewContext) (service.AppStatus, bool)
}

// menuEntries are the open menu's title and entries; false when its App is gone.
func (m Model) menuEntries() (string, []menuEntry, bool) {
	busy := m.tasks.running() > 0
	if m.menu.appID == "" {
		return "Project", projectActions(m.status, busy), true
	}
	for _, app := range m.status.Apps {
		if app.ID == m.menu.appID {
			update := app.Update
			if state, found := m.updates[app.ID]; found && state != "" {
				update = state
			}
			return app.Name, appActions(app, update, busy), true
		}
	}
	return "", nil, false
}

func (m Model) openAppMenu() (tea.Model, tea.Cmd) {
	sel, ok := m.activeView().(selectsApp)
	if !ok {
		return m, nil
	}
	if app, found := sel.selectedApp(m.ctx()); found {
		m.menu = &actionMenu{appID: app.ID}
	}
	return m, nil
}

func (m Model) menuKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	_, entries, ok := m.menuEntries()
	if !ok || len(entries) == 0 {
		m.menu = nil
		return m, nil
	}
	menu := m.menu
	menu.cursor = min(menu.cursor, len(entries)-1)
	switch {
	case msg.String() == "esc":
		m.menu = nil
	case msg.String() == "enter":
		return m.runMenuEntry(entries)
	case key.Matches(msg, m.keys.Up):
		menu.cursor, menu.armed = max(menu.cursor-1, 0), false
	case key.Matches(msg, m.keys.Down):
		menu.cursor, menu.armed = min(menu.cursor+1, len(entries)-1), false
	default:
		for i, e := range entries {
			if msg.String() == e.mnemonic {
				menu.cursor, menu.armed = i, false
			}
		}
	}
	return m, nil
}

// menuClick highlights the clicked entry and runs it like enter.
func (m Model) menuClick(id string) (tea.Model, tea.Cmd) {
	_, entries, ok := m.menuEntries()
	i, err := strconv.Atoi(strings.TrimPrefix(id, "menu:"))
	if !ok || err != nil || i < 0 || i >= len(entries) {
		return m, nil
	}
	if i != m.menu.cursor {
		m.menu.cursor, m.menu.armed = i, false
	}
	return m.runMenuEntry(entries)
}

// runMenuEntry dispatches the highlighted entry; a destructive one is armed
// by the first enter and runs on the second.
func (m Model) runMenuEntry(entries []menuEntry) (tea.Model, tea.Cmd) {
	e := entries[m.menu.cursor]
	switch {
	case e.reason != "":
		return m, nil
	case e.destructive && !m.menu.armed:
		m.menu.armed = true
		return m, nil
	}
	m.menu = nil
	ctxView := m.ctx()
	cmd := ctxView.run(e.req, e.title)
	m.absorb(ctxView)
	return m, cmd
}

// menuBarKeys are the open menu's chips; an armed entry asks for confirmation.
func (m Model) menuBarKeys() []key.Binding {
	_, entries, ok := m.menuEntries()
	if ok && m.menu.armed && m.menu.cursor < len(entries) {
		return []key.Binding{hint("enter", "confirm "+entries[m.menu.cursor].label), hint("esc", "cancel")}
	}
	return menuKeys
}

func (m Model) menuBarMode() string {
	t := m.theme
	if m.menu.armed {
		return t.fg(t.fail).Bold(true).Render("confirm") + t.dim().Render(" · enter runs it, esc cancels")
	}
	return t.fg(t.accentText).Bold(true).Render("actions") + t.dim().Render(" · "+menuBarPrompt)
}

// menuEntryTop is the row of the first entry inside the menu box: the
// border, the title and a blank line.
const menuEntryTop = 3

// menuLayers place the open menu over the tab, centred like Help, with each
// entry a mouse target.
func (m Model) menuLayers() []*lipgloss.Layer {
	box := m.renderMenu()
	if box == "" {
		return nil
	}
	_, entries, _ := m.menuEntries()
	w, h := lipgloss.Width(box), lipgloss.Height(box)
	x, y := max((m.width-w)/2, 0), max((m.height-h)/3, 0)
	layers := []*lipgloss.Layer{lipgloss.NewLayer(box).X(x).Y(y).Z(10).ID("overlay")}
	for i := range entries {
		row := strings.Split(box, "\n")[menuEntryTop+i]
		layers = append(layers, lipgloss.NewLayer(row).X(x).Y(y+menuEntryTop+i).Z(11).ID("menu:"+strconv.Itoa(i)))
	}
	return layers
}

// renderMenu draws the open menu as a box: the entries with their mnemonic
// inside the label, unavailable ones greyed with their reason, and the
// highlighted entry's preview or, once armed, its consequence in the fail
// colour.
func (m Model) renderMenu() string {
	title, entries, ok := m.menuEntries()
	if !ok {
		return ""
	}
	t := m.theme
	inner := max(min(m.width-8, 64), 20)
	cursor := min(m.menu.cursor, len(entries)-1)
	lines := []string{t.active().Render(title + " · Actions"), ""}
	for i, e := range entries {
		marker := "  "
		if i == cursor {
			marker = t.cursor()
		}
		line := marker + menuLabel(t, e, i == cursor)
		if e.reason != "" {
			line += strings.Repeat(" ", max(14-lipgloss.Width(e.label), 1)) + t.dim().Render(e.reason)
		}
		lines = append(lines, line)
	}
	lines = append(lines, "", t.fg(t.faint).Render(strings.Repeat("─", inner)))
	e := entries[cursor]
	switch {
	case m.menu.armed:
		lines = append(lines, t.fg(t.fail).Render(wrap(e.confirm, inner)))
	case e.reason != "":
		lines = append(lines, t.dim().Render(wrap(e.preview, inner)))
	default:
		lines = append(lines, t.body().Render(wrap(e.preview, inner)))
	}
	lines = strings.Split(strings.Join(lines, "\n"), "\n")
	for i, line := range lines {
		lines[i] = pad(line, inner)
	}
	return t.panel(true).Render(strings.Join(lines, "\n"))
}

// menuLabel draws an entry's label with its mnemonic bold and underlined:
// red for destructive Actions, faint when unavailable, bright when
// highlighted.
func menuLabel(t theme, e menuEntry, highlighted bool) string {
	style := t.body()
	letter := t.title().Underline(true)
	switch {
	case e.reason != "":
		style = t.disabled()
		letter = t.disabled().Underline(true)
	case highlighted && e.destructive:
		style = t.fg(t.fail).Bold(true)
		letter = style.Underline(true)
	case e.destructive:
		style = t.fg(t.fail)
		letter = t.fg(t.fail).Bold(true).Underline(true)
	case highlighted:
		style = t.active()
		letter = t.active().Underline(true)
	}
	at := strings.Index(strings.ToLower(e.label), e.mnemonic)
	if at < 0 {
		return style.Render(e.label)
	}
	end := at + len(e.mnemonic)
	return style.Render(e.label[:at]) + letter.Render(e.label[at:end]) + style.Render(e.label[end:])
}
