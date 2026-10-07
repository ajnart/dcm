package tui

import (
	"strings"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
)

type workflowView struct{ cursor int }

func (v *workflowView) Title() string { return "Workflow" }

func (v *workflowView) Keys() []key.Binding {
	k := newKeyMap()
	return []key.Binding{k.Up, k.Down, k.Back}
}

func (v *workflowView) Update(ctx *viewContext, msg tea.Msg) (view, tea.Cmd, nav) {
	if msg, ok := msg.(tea.KeyPressMsg); ok {
		switch {
		case key.Matches(msg, ctx.keys.Back):
			return v, nil, nav{kind: navBack}
		case key.Matches(msg, ctx.keys.Up):
			v.cursor = max(v.cursor-1, 0)
		case key.Matches(msg, ctx.keys.Down):
			steps := 0
			for _, app := range ctx.workflow().Apps {
				steps += len(app.Steps)
			}
			v.cursor = min(v.cursor+1, max(steps-1, 0))
		}
	}
	return v, nil, nav{}
}

func (v *workflowView) View(ctx *viewContext, width, height int) string {
	t := ctx.theme
	workflow := ctx.workflow()
	lines := []string{"  " + t.title().Render("Workflow") + " · " +
		plural(workflow.Counts.AppsSetUp, "App fully set up", "Apps fully set up") + " · " +
		plural(workflow.Counts.StepsFailed, "step failed", "steps failed"), ""}
	index := 0
	for _, app := range workflow.Apps {
		lines = append(lines, "  "+t.title().Render(app.Name))
		if !app.Managed {
			lines = append(lines, "    "+t.dim().Render("added by hand, no Setup"))
		} else if len(app.Steps) == 0 {
			lines = append(lines, "    "+t.dim().Render("no remembered steps"))
		}
		for _, step := range app.Steps {
			mark := t.dim().Render("○")
			switch step.State {
			case WorkflowDone:
				mark = t.fg(t.ok).Render("✓")
			case WorkflowSkipped:
				mark = t.fg(t.info).Render("↷")
			case WorkflowFailed:
				mark = t.fg(t.fail).Render("✗")
			}
			prefix := "    "
			if index == v.cursor {
				prefix = "  " + t.fg(t.accent).Bold(true).Render("> ")
			}
			line := prefix + mark + " " + step.Label
			if step.Msg != "" {
				line += t.dim().Render(" · " + firstLine(step.Msg))
			}
			lines = append(lines, line)
			index++
		}
		lines = append(lines, "")
	}
	return fit(strings.Join(lines, "\n"), width, height)
}
