package tui

import (
	"strings"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"

	"github.com/ajnart/self-host/internal/activity"
)

var errorKeys = []key.Binding{hint("c", "copy error"), hint("e", "full error")}

func copyError(text string) tea.Cmd {
	return func() tea.Msg { return clipboardMsg{text: text, what: "error"} }
}

func (m Model) openError(text string) (tea.Model, tea.Cmd) {
	m.showHelp = true
	m.helpView.openPage(m.ctx(), helpPage{title: "Full error", copyText: text, lines: func(t theme, width int) []string {
		return strings.Split(wrap(t.body().Render(text), width), "\n")
	}})
	return m, nil
}

func (v *activityView) errorText(ctx *viewContext) string {
	rows := v.rows(ctx)
	if v.cursor < len(rows) {
		if step := rows[v.cursor].step; step != nil && step.State == activity.Failed && step.Error != "" {
			return step.Error
		}
	}
	if ctx.tasks != nil {
		if task := ctx.tasks.latest(); task != nil {
			return task.snapshot().err
		}
	}
	return ""
}
