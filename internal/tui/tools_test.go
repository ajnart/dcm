package tui

import (
	"errors"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"

	"github.com/charmbracelet/x/ansi"
)

// send sends one message and returns the Model and the command it asked for,
// without running it.
func send(t *testing.T, m Model, msg tea.Msg) (Model, tea.Cmd) {
	t.Helper()
	next, cmd := m.Update(msg)
	return next.(Model), cmd
}

func toolsHost(t *testing.T, goos string, installed map[string]string) (Model, *fakeBackend) {
	t.Helper()
	m, backend := settingsHost(t)
	backend.tools = installed
	m.settings.goos = goos
	for range 4 {
		m = drive(t, m, press("]"))
	}
	return m, backend
}

func TestAnInstalledToolIsRunnableAndEnterExecutesIt(t *testing.T) {
	m, backend := toolsHost(t, "darwin", map[string]string{"ctop": "/opt/homebrew/bin/ctop"})

	out := screen(m)
	if !strings.Contains(out, "ctop") || !strings.Contains(out, "✓ /opt/homebrew/bin/ctop") {
		t.Fatalf("ctop should show as installed with its path\n%s", out)
	}
	m, cmd := send(t, m, press("enter"))

	if cmd == nil {
		t.Fatalf("enter should return a command")
	}
	m = drive(t, m, cmd().(toolDoneMsg))
	if len(backend.executed) != 1 {
		t.Fatalf("enter should execute ctop, executed %v", backend.executed)
	}
	if got := backend.executed[0]; got.Path != "/opt/homebrew/bin/ctop" || len(got.Args) != 1 {
		t.Fatalf("want /opt/homebrew/bin/ctop with no arguments, got %q %q", got.Path, got.Args)
	}
}

func TestAMissingToolIsDimmedWithItsInstallCommandAndCCopiesIt(t *testing.T) {
	for _, tc := range []struct{ goos, ctop, lazydocker string }{
		{"darwin", "brew install ctop", "brew install lazydocker"},
		{"linux", "sudo wget https://github.com/bcicen/ctop/releases/download/v0.7.7/ctop-0.7.7-linux-amd64 -O /usr/local/bin/ctop && sudo chmod +x /usr/local/bin/ctop",
			"curl https://raw.githubusercontent.com/jesseduffield/lazydocker/master/scripts/install_update_linux.sh | bash"},
	} {
		m, _ := toolsHost(t, tc.goos, nil)
		m.settings.show(m.ctx(), tabTools)
		if out := screen(m); !strings.Contains(out, "not installed") {
			t.Fatalf("%s: a missing tool says so\n%s", tc.goos, out)
		}
		_, cmd := send(t, m, press("c"))
		if got, ok := cmd().(clipboardMsg); !ok || got.text != tc.ctop {
			t.Fatalf("%s: c should copy %q, got %#v", tc.goos, tc.ctop, got)
		}
		_, cmd = send(t, drive(t, m, press("j")), press("c"))
		if got, ok := cmd().(clipboardMsg); !ok || got.text != tc.lazydocker {
			t.Fatalf("%s: c should copy %q, got %#v", tc.goos, tc.lazydocker, got)
		}
	}
}

func TestAMissingToolLinksItsREADMEAndIsDim(t *testing.T) {
	m, _ := toolsHost(t, "linux", nil)

	view := m.settings.View(m.ctx(), 120, 30)
	for _, url := range []string{"https://github.com/bcicen/ctop#install", "https://github.com/jesseduffield/lazydocker#installation"} {
		if !strings.Contains(view, ansi.SetHyperlink(url)) {
			t.Errorf("%s is not an OSC 8 hyperlink: %q", url, view)
		}
	}
	if bold := boldText(m.View().Content); strings.Contains(strings.Join(bold, "\n"), "not installed") {
		t.Errorf("a missing tool is dim, not bold")
	}
}

func TestEnterOnAMissingToolRunsNothingAndSaysHowToInstall(t *testing.T) {
	m, backend := toolsHost(t, "darwin", nil)

	m = drive(t, m, press("enter"))

	if len(backend.executed) != 0 {
		t.Fatalf("a missing tool is never run: %v", backend.executed)
	}
	if status := statusLine(screen(m)); !strings.Contains(status, "ctop is not installed") {
		t.Fatalf("status line: %q", status)
	}
}

func TestCDoesNothingOnAnInstalledTool(t *testing.T) {
	m, _ := toolsHost(t, "darwin", map[string]string{"ctop": "/usr/bin/ctop"})

	if _, cmd := send(t, m, press("c")); cmd != nil {
		t.Fatalf("an installed tool has no command to copy")
	}
}

func TestTheTUIResumesAfterAToolExitsAndFlashesAnError(t *testing.T) {
	m, backend := toolsHost(t, "darwin", map[string]string{"ctop": "/usr/bin/ctop"})
	backend.toolErr = errors.New("exit status 1")

	m = drive(t, m, press("enter"))

	if status := statusLine(screen(m)); !strings.Contains(status, "ctop exited with an error: exit status 1") {
		t.Fatalf("status line: %q", status)
	}
	if !strings.Contains(screen(m), "Tools") {
		t.Fatalf("Settings should still be open\n%s", screen(m))
	}
	backend.toolErr = nil
	m = drive(t, m, toolDoneMsg{name: "ctop"})
	if status := statusLine(screen(m)); !strings.Contains(status, "back from ctop") {
		t.Fatalf("status line: %q", status)
	}
}

func TestLinuxInstallCommandsShowInFullWithinEightyColumns(t *testing.T) {
	m, _ := sample(t, 80, 24)
	m = drive(t, m, press("5"))
	m.settings.goos = "linux"
	for range 4 {
		m = drive(t, m, press("]"))
	}

	out := screen(m)
	for _, line := range strings.Split(out, "\n") {
		if ansi.StringWidth(line) > 80 {
			t.Fatalf("line wider than 80 columns: %q", line)
		}
	}
	for _, command := range []string{
		"sudo wget https://github.com/bcicen/ctop/releases/download/v0.7.7/ctop-0.7.7-linux-amd64 -O /usr/local/bin/ctop && sudo chmod +x /usr/local/bin/ctop",
		"curl https://raw.githubusercontent.com/jesseduffield/lazydocker/master/scripts/install_update_linux.sh | bash",
	} {
		if !strings.Contains(installText(out), strings.ReplaceAll(command, " ", "")) {
			t.Fatalf("the install command %q should be readable in full\n%s", command, out)
		}
	}
}

// installText is every install command on screen with its line breaks and
// spaces removed, so a command wrapped over several lines reads as one.
func installText(out string) string {
	var text strings.Builder
	reading := false
	for _, line := range strings.Split(out, "\n") {
		line = strings.Trim(line, "│ ")
		switch {
		case strings.HasPrefix(line, "install"):
			reading = true
			line = strings.TrimPrefix(line, "install")
		case strings.HasPrefix(line, "docs"):
			reading = false
		}
		if reading {
			text.WriteString(strings.ReplaceAll(line, " ", ""))
		}
	}
	return text.String()
}
