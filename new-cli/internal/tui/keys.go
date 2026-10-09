package tui

import "charm.land/bubbles/v2/key"

// keyMap is the Dashboard's whole keyboard
// (docs/adr/0004-tabbed-command-center-action-chords.md): tabs, focus and
// sub-tabs move around, read-only keys act directly, and the legacy
// mutating keys stay only until the Action menu replaces them.
type keyMap struct {
	// Global keys, handled by the Model unless a view is capturing input.
	Tabs, PrevTab, NextTab, Help, Quit key.Binding
	// Pane keys.
	Up, Down, NextPane, PrevPane, PrevSub, NextSub, ScrollUp, ScrollDown key.Binding
	Open, Copy, Search, Apply, Back                                      key.Binding
	// Legacy mutating keys, removed by #133.
	Toggle, Update, Retry, Backup key.Binding
}

func newKeyMap() keyMap {
	b := func(keys []string, help, desc string) key.Binding {
		return key.NewBinding(key.WithKeys(keys...), key.WithHelp(help, desc))
	}
	return keyMap{
		Tabs:       b([]string{"1", "2", "3", "4", "5"}, "1-5", "tabs"),
		PrevTab:    b([]string{"left"}, "←", "previous tab"),
		NextTab:    b([]string{"right"}, "→", "next tab"),
		Help:       b([]string{"?"}, "?", "help"),
		Quit:       b([]string{"q", "ctrl+c"}, "q", "quit"),
		Up:         b([]string{"up", "k"}, "↑/k", "up"),
		Down:       b([]string{"down", "j"}, "↓/j", "down"),
		NextPane:   b([]string{"tab"}, "tab", "next pane"),
		PrevPane:   b([]string{"shift+tab"}, "shift+tab", "previous pane"),
		PrevSub:    b([]string{"["}, "[", "previous sub-tab"),
		NextSub:    b([]string{"]"}, "]", "next sub-tab"),
		ScrollUp:   b([]string{"pgup"}, "pgup", "page up"),
		ScrollDown: b([]string{"pgdown"}, "pgdn", "page down"),
		Open:       b([]string{"o"}, "o", "open"),
		Copy:       b([]string{"c"}, "c", "copy"),
		Search:     b([]string{"/"}, "/", "search"),
		Apply:      b([]string{"ctrl+s"}, "ctrl+s", "apply"),
		Back:       b([]string{"esc"}, "esc", "back"),
		Toggle:     b([]string{"enter"}, "enter", "start/stop"),
		Update:     b([]string{"u"}, "u", "update"),
		Retry:      b([]string{"r"}, "r", "retry Setup"),
		Backup:     b([]string{"b"}, "b", "backup"),
	}
}

// global are the keys that act on every tab, in the order the bar and help
// show them.
func (k keyMap) global() []key.Binding {
	return []key.Binding{k.Tabs, k.PrevTab, k.NextTab, k.Help, k.Quit}
}

func (k keyMap) all() []key.Binding {
	return append(k.global(), k.Up, k.Down, k.NextPane, k.PrevPane, k.PrevSub, k.NextSub, k.ScrollUp, k.ScrollDown,
		k.Open, k.Copy, k.Search, k.Apply, k.Back, k.Toggle, k.Update, k.Retry, k.Backup)
}
