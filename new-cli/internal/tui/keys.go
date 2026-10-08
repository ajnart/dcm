package tui

import "charm.land/bubbles/v2/key"

// keyMap is the Dashboard's whole keyboard (docs/adr/0002). Every binding
// triggers a frequent Action or moves around; nothing else gets a key.
type keyMap struct {
	Up, Down, Tab, Toggle, Open, Copy, Update, Retry, Install, Backup, Help, Quit key.Binding
	ScrollUp, ScrollDown, Settings, Stack, Search, Apply, Back                    key.Binding
	Workflow                                                                      key.Binding
}

func newKeyMap() keyMap {
	b := func(keys []string, help, desc string) key.Binding {
		return key.NewBinding(key.WithKeys(keys...), key.WithHelp(help, desc))
	}
	return keyMap{
		Up:         b([]string{"up", "k"}, "↑/k", "select up"),
		Down:       b([]string{"down", "j"}, "↓/j", "select down"),
		Tab:        b([]string{"tab"}, "tab", "next tab"),
		Toggle:     b([]string{"enter"}, "enter", "start/stop"),
		Open:       b([]string{"o"}, "o", "open"),
		Copy:       b([]string{"c"}, "c", "copy"),
		Update:     b([]string{"u"}, "u", "update"),
		Retry:      b([]string{"r"}, "r", "retry Setup"),
		Install:    b([]string{"i"}, "i", "install"),
		Backup:     b([]string{"b"}, "b", "backup"),
		Help:       b([]string{"?"}, "?", "help"),
		Quit:       b([]string{"q", "ctrl+c"}, "q", "quit"),
		ScrollUp:   b([]string{"pgup"}, "pgup", "scroll up"),
		ScrollDown: b([]string{"pgdown"}, "pgdn", "scroll down"),
		Settings:   b([]string{"s"}, "s", "settings"),
		Stack:      b([]string{"d"}, "d", "stack"),
		Workflow:   b([]string{"w"}, "w", "workflow"),
		Search:     b([]string{"/"}, "/", "search"),
		Apply:      b([]string{"ctrl+s"}, "ctrl+s", "apply"),
		Back:       b([]string{"esc"}, "esc", "back"),
	}
}

func (k keyMap) all() []key.Binding {
	return []key.Binding{k.Up, k.Down, k.Tab, k.Toggle, k.Open, k.Copy, k.Update, k.Retry, k.Install, k.Backup,
		k.Help, k.Quit, k.ScrollUp, k.ScrollDown, k.Settings, k.Stack, k.Workflow, k.Search, k.Apply, k.Back}
}

func (k keyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.Toggle, k.Open, k.Copy, k.Update, k.Retry, k.Install, k.Settings, k.Stack, k.Help, k.Quit}
}

func (k keyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{
		{k.Up, k.Down, k.Tab, k.ScrollUp, k.ScrollDown},
		{k.Toggle, k.Open, k.Copy, k.Update, k.Retry},
		{k.Install, k.Settings, k.Stack, k.Workflow, k.Backup, k.Help, k.Quit},
	}
}
