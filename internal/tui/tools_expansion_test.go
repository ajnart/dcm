package tui

import (
	"slices"
	"strings"
	"testing"
)

type toolDiscoveryBackend struct {
	Backend
	looked []string
}

func (b *toolDiscoveryBackend) LookTool(name string) (string, bool) {
	b.looked = append(b.looked, name)
	return b.Backend.LookTool(name)
}

func TestToolsCuratedExpansionDiscoversExecutablesAndOnlyLaunchesOnEnter(t *testing.T) {
	m, fake := sample(t, 80, 24)
	fake.tools = map[string]string{"btop": "/tools/btop", "btm": "/tools/btm", "ncdu": "/tools/ncdu"}
	backend := &toolDiscoveryBackend{Backend: fake}
	m.backend = backend
	m = drive(t, m, press("5"))
	for range 4 {
		m = drive(t, m, press("]"))
	}
	if !slices.Equal(backend.looked, []string{"ctop", "lazydocker", "btop", "btm", "ncdu"}) {
		t.Fatalf("Tools must discover the upstream executable names, got %v", backend.looked)
	}
	for _, name := range []string{"ctop", "lazydocker", "btop", "bottom", "ncdu"} {
		if !strings.Contains(screen(m), name) {
			t.Fatalf("Tools lacks %s\n%s", name, screen(m))
		}
	}
	for range 2 {
		m = drive(t, m, press("down"))
	}
	if len(fake.executed) != 0 {
		t.Fatal("discovery and navigation must not execute a tool")
	}
	for _, tc := range []struct {
		path string
		args []string
	}{
		{"/tools/btop", []string{"/tools/btop"}},
		{"/tools/btm", []string{"/tools/btm"}},
		{"/tools/ncdu", []string{"/tools/ncdu", "-r", "-r"}},
	} {
		before := len(fake.executed)
		m, cmd := send(t, m, press("enter"))
		if cmd == nil || len(fake.executed) != before+1 {
			t.Fatal("enter must dispatch exactly one installed tool")
		}
		got := fake.executed[before]
		if got.Path != tc.path || !slices.Equal(got.Args, tc.args) {
			t.Fatalf("unsafe launch: path %q args %q", got.Path, got.Args)
		}
		m = drive(t, m, cmd().(toolDoneMsg))
		if m.surface != surfaceSettings || !strings.Contains(statusLine(screen(m)), "back from ") {
			t.Fatal("tool exit must restore Settings")
		}
		m = drive(t, m, press("down"))
		if len(fake.executed) != before+1 {
			t.Fatal("navigation must not execute a tool")
		}
	}
}

func TestExpandedMissingToolsHaveMacInstallGuidanceAndStayVisibleAtEightyByTwentyFour(t *testing.T) {
	m, fake := sample(t, 80, 24)
	m = drive(t, m, press("5"))
	m.settings.goos = "darwin"
	for range 4 {
		m = drive(t, m, press("]"))
	}
	for range 2 {
		m = drive(t, m, press("down"))
	}
	for _, command := range []string{"brew install btop", "brew install bottom", "brew install ncdu"} {
		out := screen(m)
		if !strings.Contains(out, command) || !strings.Contains(out, "self-host never installs these for you.") || len(strings.Split(out, "\n")) != 24 {
			t.Fatalf("missing tool guidance must remain in the viewport\n%s", out)
		}
		m, cmd := send(t, m, press("c"))
		if cmd == nil {
			t.Fatal("c must copy the displayed install command")
		}
		copied, ok := cmd().(clipboardMsg)
		if !ok || copied.text != command {
			t.Fatal("install copy must use the selected tool's guidance")
		}
		m = drive(t, m, press("enter"))
		m = drive(t, m, press("down"))
	}
	if len(fake.executed) != 0 || len(fake.Actions()) != 0 {
		t.Fatal("missing tools must never be installed or launched")
	}
}

func TestToolsDoNotOfferWrongArchitectureOrUnknownPlatformCommands(t *testing.T) {
	for _, tc := range []struct {
		goos, arch string
	}{
		{"linux", "arm64"},
		{"linux", "riscv64"},
		{"darwin", "386"},
		{"plan9", "amd64"},
	} {
		m, fake := sample(t, 80, 24)
		m = drive(t, m, press("5"))
		m.settings.goos, m.settings.goarch = tc.goos, tc.arch
		for range 4 {
			m = drive(t, m, press("]"))
		}
		out := screen(m)
		if strings.Contains(out, "│   install  ") || !strings.Contains(out, "No install command for "+tc.goos+"/"+tc.arch) || !strings.Contains(out, "docs") {
			t.Fatalf("unsupported install guidance must name the platform and point to docs\n%s", out)
		}
		m, cmd := send(t, m, press("c"))
		if cmd != nil || !strings.Contains(statusLine(screen(m)), "see docs") {
			t.Fatal("c must not copy an incompatible install command")
		}
		m = drive(t, m, press("enter"))
		if strings.Contains(statusLine(screen(m)), "c copies") || len(fake.executed) != 0 {
			t.Fatal("missing tools without commands must point to docs, never launch")
		}
	}
}

func TestExpandedLinuxToolsGuideToDistributionPackagesAndMatchingReleases(t *testing.T) {
	m, _ := sample(t, 80, 24)
	m = drive(t, m, press("5"))
	m.settings.goos, m.settings.goarch = "linux", "arm64"
	for range 4 {
		m = drive(t, m, press("]"))
	}
	for range 2 {
		m = drive(t, m, press("down"))
	}
	for _, name := range []string{"btop", "bottom", "ncdu"} {
		out := screen(m)
		if !strings.Contains(out, name) || !strings.Contains(out, "linux/arm64") || !strings.Contains(out, "Choose a package or matching release in docs.") {
			t.Fatalf("Linux guidance must not assume apt, RPM or an x86 binary\n%s", out)
		}
		m, cmd := send(t, m, press("c"))
		if cmd != nil || !strings.Contains(statusLine(screen(m)), "see docs") {
			t.Fatal("no distro-independent install command must be copied")
		}
		m = drive(t, m, press("down"))
	}
}

func TestGoldenExpandedToolsSelection(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		m, _ := sample(t, size.width, size.height)
		m = drive(t, m, press("5"))
		m.settings.goos, m.settings.goarch = "linux", "arm64"
		for range 4 {
			m = drive(t, m, press("]"))
		}
		golden(t, "tools-linux-arm64"+size.suffix, trimLines(screen(m)))
		for range 4 {
			m = drive(t, m, press("down"))
		}
		golden(t, "tools-ncdu-linux"+size.suffix, trimLines(screen(m)))
	}
}
