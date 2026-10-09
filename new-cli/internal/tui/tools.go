package tui

import (
	"os/exec"
	"strings"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
)

// tool is a program Settings can run for the person: it never installs one.
type tool struct {
	name, about, readme string
	// install is the one-line install command per GOOS.
	install map[string]string
}

var tools = []tool{
	{
		name: "ctop", about: "live container metrics", readme: "https://github.com/bcicen/ctop#install",
		install: map[string]string{
			"darwin": "brew install ctop",
			"linux":  "sudo wget https://github.com/bcicen/ctop/releases/download/v0.7.7/ctop-0.7.7-linux-amd64 -O /usr/local/bin/ctop && sudo chmod +x /usr/local/bin/ctop",
		},
	},
	{
		name: "lazydocker", about: "terminal UI for Docker", readme: "https://github.com/jesseduffield/lazydocker#installation",
		install: map[string]string{
			"darwin": "brew install lazydocker",
			"linux":  "curl https://raw.githubusercontent.com/jesseduffield/lazydocker/master/scripts/install_update_linux.sh | bash",
		},
	},
}

// toolState is one tool and where it was found; path is empty when missing.
type toolState struct {
	tool
	path string
}

// toolDoneMsg is delivered when a tool run from Settings exits and the TUI
// resumes.
type toolDoneMsg struct {
	name string
	err  error
}

var toolsKeys = []key.Binding{
	hint("↑/↓", "select"), hint("enter", "run"), hint("c", "copy"), hint("[/]", "sub-tab"), hint("esc", "back"),
}

// detectTools looks every tool up on PATH through the Backend.
func detectTools(backend Backend) []toolState {
	states := make([]toolState, len(tools))
	for i, t := range tools {
		states[i].tool = t
		states[i].path, _ = backend.LookTool(t.name)
	}
	return states
}

func (v *settingsView) toolsKey(ctx *viewContext, msg tea.KeyPressMsg) tea.Cmd {
	if len(v.tools) == 0 {
		return nil
	}
	selected := v.tools[v.toolCursor]
	switch {
	case key.Matches(msg, ctx.keys.Up):
		v.toolCursor = max(v.toolCursor-1, 0)
	case key.Matches(msg, ctx.keys.Down):
		v.toolCursor = min(v.toolCursor+1, len(v.tools)-1)
	case msg.String() == "enter":
		if selected.path == "" {
			ctx.setFlash(selected.name+" is not installed; c copies its install command", levelWarn)
			return nil
		}
		return ctx.backend.ExecTool(exec.Command(selected.path), func(err error) tea.Msg {
			return toolDoneMsg{name: selected.name, err: err}
		})
	case msg.String() == "c":
		command := selected.install[v.goos]
		if selected.path != "" || command == "" {
			return nil
		}
		return func() tea.Msg { return clipboardMsg{text: command, what: "the " + selected.name + " install command"} }
	}
	return nil
}

// toolsBox lists the tools: an installed one shows where it was found, a
// missing one is dimmed with its install command and the README to read.
func (v *settingsView) toolsBox(ctx *viewContext, width int) string {
	t := ctx.theme
	inner := max(width-4, 12)
	var lines []string
	for i, s := range v.tools {
		cursor := "  "
		if i == v.toolCursor {
			cursor = t.cursor()
		}
		if s.path != "" {
			lines = append(lines, truncate(cursor+t.active().Render(pad(s.name, 12))+t.body().Render(pad(s.about, 26))+
				t.fg(t.ok).Render("✓ ")+t.dim().Render(s.path), inner))
			continue
		}
		lines = append(lines, truncate(cursor+t.dim().Render(pad(s.name, 12)+pad(s.about, 26)+"not installed"), inner))
		if command := s.install[v.goos]; command != "" {
			lines = append(lines, truncate("      "+t.dim().Render("install  "+command), inner))
		}
		lines = append(lines, "      "+t.dim().Render("docs     ")+link(t, s.readme, truncate(strings.TrimPrefix(s.readme, "https://"), max(inner-15, 8))))
	}
	lines = append(lines, "", "  "+t.dim().Render("self-host never installs these for you."))
	return t.box("Tools", "", strings.Join(lines, "\n"), width, len(lines)+2, true)
}
