package tui

import (
	"os/exec"
	"slices"
	"strings"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
)

// tool is a program Settings can run for the person: it never installs one.
type tool struct {
	name, about, readme string
	binary              string
	args                []string
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
	{
		name: "btop", about: "CPU, memory, disks and processes", readme: "https://github.com/aristocratos/btop#installation",
		install: map[string]string{"darwin": "brew install btop"},
	},
	{
		name: "bottom", binary: "btm", about: "CPU, memory and network graphs", readme: "https://github.com/ClementTsang/bottom#installation",
		install: map[string]string{"darwin": "brew install bottom"},
	},
	{
		name: "ncdu", about: "find large folders (read-only)", readme: "https://dev.yorhel.nl/ncdu",
		args: []string{"-r", "-r"}, install: map[string]string{"darwin": "brew install ncdu"},
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
		binary := t.name
		if t.binary != "" {
			binary = t.binary
		}
		if path, found := backend.LookTool(binary); found {
			states[i].path = path
		}
	}
	return states
}

func (t tool) installCommand(goos, goarch string) string {
	switch goos {
	case "darwin":
		if goarch != "amd64" && goarch != "arm64" {
			return ""
		}
	case "linux":
		if t.name == "ctop" && goarch != "amd64" || t.name == "lazydocker" && !slices.Contains([]string{"amd64", "386", "arm", "arm64"}, goarch) {
			return ""
		}
	default:
		return ""
	}
	return t.install[goos]
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
			guidance := "; c copies its install command"
			if selected.installCommand(v.goos, v.goarch) == "" {
				guidance = "; see docs for install guidance"
			}
			ctx.setFlash(selected.name+" is not installed"+guidance, levelWarn)
			return nil
		}
		return ctx.backend.ExecTool(exec.Command(selected.path, selected.args...), func(err error) tea.Msg {
			return toolDoneMsg{name: selected.name, err: err}
		})
	case msg.String() == "c":
		if selected.path != "" {
			return nil
		}
		command := selected.installCommand(v.goos, v.goarch)
		if command == "" {
			ctx.setFlash("No install command for "+v.goos+"/"+v.goarch+"; see docs", levelWarn)
			return nil
		}
		return func() tea.Msg { return clipboardMsg{text: command, what: "the " + selected.name + " install command"} }
	}
	return nil
}

// toolsBox lists the tools: an installed one shows where it was found, a
// missing one is dimmed with its install command and the README to read.
func (v *settingsView) toolsBox(ctx *viewContext, width, height int) string {
	t := ctx.theme
	inner := max(width-4, 12)
	if len(v.tools) == 0 {
		return t.box("Tools", "", t.dim().Render("No tools found."), width, 3, true)
	}
	selected := v.tools[v.toolCursor]
	detail := []string{""}
	if selected.path != "" {
		detail = append(detail, t.dim().Render(truncate("  Found "+selected.path, inner)))
	} else if command := selected.installCommand(v.goos, v.goarch); command != "" {
		for _, line := range strings.Split(indent("  install  ", command, inner), "\n") {
			detail = append(detail, t.dim().Render(strings.TrimRight(line, " ")))
		}
	} else {
		detail = append(detail, t.dim().Render("  No install command for "+v.goos+"/"+v.goarch+"."))
		detail = append(detail, t.dim().Render("  Choose a package or matching release in docs."))
	}
	detail = append(detail, "  "+t.dim().Render("docs  ")+link(t, selected.readme, truncate(strings.TrimPrefix(selected.readme, "https://"), max(inner-8, 8))))
	detail = append(detail, "", "  "+t.dim().Render("self-host never installs these for you."))
	detail = append(detail, "  "+t.dim().Render("enter runs installed tools; c copies an available install command."))
	visible := max(height-2-len(detail), 1)
	start := max(v.toolCursor-visible+1, 0)
	var lines []string
	for i := start; i < len(v.tools) && i-start < visible; i++ {
		s := v.tools[i]
		cursor := "  "
		if i == v.toolCursor {
			cursor = t.cursor()
		}
		if s.path != "" {
			lines = append(lines, truncate(cursor+t.active().Render(pad(s.name, 12))+t.body().Render(pad(s.about, 34))+
				t.fg(t.ok).Render("✓ ")+t.dim().Render(s.path), inner))
			continue
		}
		lines = append(lines, truncate(cursor+t.dim().Render(pad(s.name, 12)+pad(s.about, 34)+"not installed"), inner))
	}
	lines = append(lines, detail...)
	return t.box("Tools", "", strings.Join(lines, "\n"), width, len(lines)+2, true)
}
