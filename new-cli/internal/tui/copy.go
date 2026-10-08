package tui

import (
	"context"
	"sort"
	"strings"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
)

// The picker stores identifiers and labels, never credential values.
type copyChoice struct {
	app, key, label string
}

type copyPicker struct {
	rows    []copyChoice
	cursor  int
	loading bool
}

type copyOptionsMsg struct {
	picker *copyPicker
	rows   []copyChoice
	err    error
}

var copyHelp = []key.Binding{
	hint("↑/↓", "select"), hint("enter", "copy"), hint("esc", "back"),
}

func (v *dashboardView) openCopy(ctx *viewContext) tea.Cmd {
	picker := &copyPicker{loading: true}
	v.copy = picker
	backend := ctx.backend
	app, _ := v.selected(ctx)
	return func() tea.Msg {
		creds, err := backend.Credentials(context.Background())
		if err != nil {
			return copyOptionsMsg{picker: picker, err: err}
		}
		rows := []copyChoice{}
		if creds.Admin.Password != "" {
			rows = append(rows, copyChoice{label: "Admin password"})
		}
		keys := []string{}
		for name, value := range creds.Apps[app.ID] {
			if value != "" && (strings.HasSuffix(name, "_API_KEY") || strings.HasSuffix(name, "_API_TOKEN") || strings.HasSuffix(name, "_ACCESS_TOKEN")) {
				keys = append(keys, name)
			}
		}
		sort.Strings(keys)
		for _, name := range keys {
			label := app.Name + " API key"
			if len(keys) > 1 {
				label += " (" + name + ")"
			}
			rows = append(rows, copyChoice{app: app.ID, key: name, label: label})
		}
		return copyOptionsMsg{picker: picker, rows: rows}
	}
}

func (v *dashboardView) copyKey(ctx *viewContext, msg tea.KeyPressMsg) tea.Cmd {
	if msg.String() == "esc" {
		v.copy = nil
		return nil
	}
	if key.Matches(msg, ctx.keys.Quit) {
		ctx.tasks.cancelAll()
		v.stopLogs()
		return tea.Quit
	}
	if v.copy.loading || len(v.copy.rows) == 0 {
		return nil
	}
	switch {
	case key.Matches(msg, ctx.keys.Up):
		v.copy.cursor = max(v.copy.cursor-1, 0)
	case key.Matches(msg, ctx.keys.Down):
		v.copy.cursor = min(v.copy.cursor+1, len(v.copy.rows)-1)
	case key.Matches(msg, ctx.keys.Toggle):
		choice := v.copy.rows[v.copy.cursor]
		v.copy = nil
		backend := ctx.backend
		return func() tea.Msg {
			creds, err := backend.Credentials(context.Background())
			if err != nil {
				return flashMsg{text: "could not read credentials", level: levelError}
			}
			value := creds.Admin.Password
			if choice.key != "" {
				value = creds.Apps[choice.app][choice.key]
			}
			if value == "" {
				return flashMsg{text: choice.label + " is no longer available", level: levelWarn}
			}
			return clipboardMsg{text: value, what: choice.label}
		}
	}
	return nil
}

func (p *copyPicker) view(ctx *viewContext, width, height int) string {
	t := ctx.theme
	lines := []string{"", "  " + t.heading().Render("Copy credentials"), ""}
	if p.loading {
		lines = append(lines, "  "+t.dim().Render("Reading available credentials…"))
	} else if len(p.rows) == 0 {
		lines = append(lines, "  "+t.dim().Render("No saved password or API key."))
	} else {
		visible := max(height-6, 1)
		start := max(p.cursor-visible+1, 0)
		for i := start; i < len(p.rows) && i-start < visible; i++ {
			line := "  " + p.rows[i].label
			if i == p.cursor {
				line = t.fg(t.accent).Bold(true).Render("> " + p.rows[i].label)
			}
			lines = append(lines, "  "+truncate(line, max(width-4, 1)))
		}
	}
	return strings.Join(lines, "\n")
}
