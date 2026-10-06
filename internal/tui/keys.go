package tui

import "charm.land/bubbles/v2/key"

type keyMap struct {
	Up, Down, Filter, Clear, Toggle, Stop, Restart, Update, UpdateAll, Setup, Remove, Purge key.Binding
	Open, CopyURL, CopyPassword, Sidebar, SidebarTab, Pin, Follow, PageUp, PageDown         key.Binding
	Refresh, Tasks, Help, Quit, Apps, Catalog, Updates, Doctor, Backups                     key.Binding
	Confirm, Cancel                                                                         key.Binding
}

func newKeyMap() keyMap {
	b := func(keys []string, help, desc string) key.Binding {
		return key.NewBinding(key.WithKeys(keys...), key.WithHelp(help, desc))
	}
	return keyMap{
		Up:           b([]string{"up", "k"}, "↑/k", "up"),
		Down:         b([]string{"down", "j"}, "↓/j", "down"),
		Filter:       b([]string{"/"}, "/", "filter"),
		Clear:        b([]string{"esc"}, "esc", "clear filter"),
		Toggle:       b([]string{"enter", "space"}, "enter", "start/stop"),
		Stop:         b([]string{"s"}, "s", "stop"),
		Restart:      b([]string{"S"}, "S", "restart"),
		Update:       b([]string{"u"}, "u", "update image"),
		UpdateAll:    b([]string{"U"}, "U", "update all"),
		Setup:        b([]string{"e"}, "e", "rerun setup"),
		Remove:       b([]string{"x"}, "x", "remove (keep data)"),
		Purge:        b([]string{"X"}, "X", "remove + delete data"),
		Open:         b([]string{"o"}, "o", "open in browser"),
		CopyURL:      b([]string{"c"}, "c", "copy URL"),
		CopyPassword: b([]string{"p"}, "p", "copy password"),
		Sidebar:      b([]string{"l"}, "l", "toggle sidebar"),
		SidebarTab:   b([]string{"tab"}, "tab", "logs/setup/info"),
		Pin:          b([]string{"L"}, "L", "pin logs"),
		Follow:       b([]string{"f"}, "f", "follow/pause logs"),
		PageUp:       b([]string{"pgup"}, "pgup", "scroll logs up"),
		PageDown:     b([]string{"pgdown"}, "pgdn", "scroll logs down"),
		Refresh:      b([]string{"r"}, "r", "refresh"),
		Tasks:        b([]string{"t"}, "t", "tasks"),
		Help:         b([]string{"?"}, "?", "help"),
		Quit:         b([]string{"q", "ctrl+c"}, "q", "quit"),
		Apps:         b([]string{"1"}, "1", "apps"),
		Catalog:      b([]string{"2"}, "2", "catalog"),
		Updates:      b([]string{"3"}, "3", "updates"),
		Doctor:       b([]string{"4"}, "4", "doctor"),
		Backups:      b([]string{"5"}, "5", "backups"),
		Confirm:      b([]string{"y", "enter"}, "y", "confirm"),
		Cancel:       b([]string{"n", "esc"}, "n", "cancel"),
	}
}

func (k keyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.Toggle, k.Restart, k.Setup, k.Open, k.Filter, k.Tasks, k.Help, k.Quit}
}

func (k keyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{
		{k.Up, k.Down, k.Filter, k.Clear, k.Apps, k.Catalog, k.Updates, k.Doctor, k.Backups},
		{k.Toggle, k.Stop, k.Restart, k.Update, k.UpdateAll, k.Setup, k.Remove, k.Purge},
		{k.Open, k.CopyURL, k.CopyPassword, k.Sidebar, k.SidebarTab, k.Pin, k.Follow, k.PageUp, k.PageDown},
		{k.Refresh, k.Tasks, k.Help, k.Quit},
	}
}
