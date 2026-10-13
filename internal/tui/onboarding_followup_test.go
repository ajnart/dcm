package tui

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/service"
	"github.com/charmbracelet/x/ansi"
)

func TestLookPreviewsTheSelectedSymbolsImmediately(t *testing.T) {
	for _, size := range []struct{ width, height int }{{80, 24}, {120, 30}} {
		m, backend := freshHost(t)
		m = update(t, m, windowSize(size.width, size.height))
		m = atStep(t, m, "Look")
		for _, frame := range []struct{ key, want string }{
			{"", "◆ self-host  ▣ Docker  ✱ key  ⇄ link  ♫ Media  ↓ Downloads  ♥ Monitoring"},
			{"up", "◆ self-host  ▣ Docker  ✱ key  ⇄ link  ♫ Media  ↓ Downloads  ♥ Monitoring"},
			{"space", "󰒋 self-host  󰡨 Docker  󰌆 key  󰌹 link  󰿎 Media  󰇚 Downloads  󰗶 Monitoring"},
			{"down", "󰒋 self-host  󰡨 Docker  󰌆 key  󰌹 link  󰿎 Media  󰇚 Downloads  󰗶 Monitoring"},
			{"space", "◆ self-host  ▣ Docker  ✱ key  ⇄ link  ♫ Media  ↓ Downloads  ♥ Monitoring"},
		} {
			if frame.key != "" {
				m = drive(t, m, press(frame.key))
			}
			if !strings.Contains(screen(m), frame.want) {
				t.Fatalf("selected sample missing %q\n%s", frame.want, screen(m))
			}
			if len(backend.savedGlyphs()) != 0 || len(backend.Actions()) != 0 || m.onboarding.step != stepLook {
				t.Fatal("preview must stay pending on Look")
			}
		}
	}
}

func TestUnsupportedEasyNamesStopsBeforeApprovalAndPreservesRecoveryAnswers(t *testing.T) {
	for _, size := range []struct{ width, height int }{{80, 24}, {120, 30}} {
		m, backend := freshHost(t)
		m = update(t, m, windowSize(size.width, size.height))
		m = atAccess(t, m)
		m.onboarding.answers.lan = "192.0.0.2"
		m.onboarding.answers.adminPassword = "synthetic pass phrase"
		for _, key := range []string{"down", "space", "enter"} {
			m = drive(t, m, press(key))
		}
		for range 3 {
			m = drive(t, m, press("enter"))
		}
		if !strings.Contains(flat(screen(m)), "IPv4 service-continuity") || !strings.Contains(flat(screen(m)), "a Access") || !strings.Contains(flat(screen(m)), "w LAN address") {
			t.Fatalf("unsupported chosen address needs early feedback and navigation\n%s", screen(m))
		}
		if strings.Contains(flat(lastLine(screen(m))), "enter approve") {
			t.Fatal("blocked eligibility must not advertise approval")
		}
		m = drive(t, m, press("enter"))
		if m.onboarding.step != stepReview || len(backend.Actions()) != 0 || len(backend.savedGlyphs()) != 0 || !m.onboarding.answers.easyNames {
			t.Fatal("unsupported Easy names must not approve, persist or silently downgrade")
		}
		m = drive(t, m, press("w"))
		if m.onboarding.step != stepWhere || m.onboarding.answers.lan != "192.0.0.2" || m.onboarding.answers.adminPassword != "synthetic pass phrase" {
			t.Fatal("recovery must preserve answers at the LAN editor")
		}
		next, _ := m.openStep(stepReview)
		m = drive(t, next.(Model), press("a"))
		if m.onboarding.step != stepAccess || m.onboarding.answers.accessChoice != "names" {
			t.Fatal("recovery must preserve the chosen Access")
		}
		m = drive(t, m, press("up"))
		m = drive(t, m, press("space"))
		m = drive(t, m, press("enter"))
		for range 3 {
			m = drive(t, m, press("enter"))
		}
		if m.onboarding.err != "" || m.onboarding.plan.opts.EasyNames || m.onboarding.answers.lan != "192.0.0.2" {
			t.Fatal("Home network is a deliberate recovery, not a replaced address or reachability guarantee")
		}
		if out := flat(screen(m)); !strings.Contains(out, "addresses use 192.0.0.2") || !strings.Contains(out, "Reachability is not verified") {
			t.Fatalf("Home network recovery must not promise other-device reachability\n%s", screen(m))
		}
	}
}

func TestEasyNamesEarlyCheckUsesTheEditedAddressNotDetectedDefault(t *testing.T) {
	m, backend := freshHost(t)
	m.defaults["LAN_IP"] = "192.0.0.2"
	m = atAccess(t, m)
	m.onboarding.answers.lan = "192.168.50.21"
	for _, key := range []string{"down", "space", "enter"} {
		m = drive(t, m, press(key))
	}
	for range 3 {
		m = drive(t, m, press("enter"))
	}
	if m.onboarding.err != "" || m.onboarding.plan.opts.Settings["LAN_IP"] != "192.168.50.21" || !m.onboarding.plan.opts.EasyNames {
		t.Fatalf("the chosen private address must pass static eligibility\n%s", screen(m))
	}
	if len(backend.Actions()) != 0 || m.onboarding.plan.opts.Exposure != service.ExposureLAN {
		t.Fatal("static eligibility must not apply or publish anything")
	}
}

func TestSettingsAccessSpaceIsDiscoverableAndPending(t *testing.T) {
	m, backend := sample(t, 80, 24)
	for _, key := range []string{"5", "]", "down"} {
		m = drive(t, m, press(key))
	}
	if !strings.Contains(flat(lastLine(screen(m))), "space select") || !strings.Contains(screen(m), "> ○ Easy names at home") {
		t.Fatalf("Space and focus must be explicit\n%s", screen(m))
	}
	m = drive(t, m, press("space"))
	m = drive(t, m, press("up"))
	m = drive(t, m, press("enter"))
	if !strings.Contains(screen(m), "● Easy names at home (pending)") || !strings.Contains(screen(m), "> ○ Home network") || len(backend.Actions()) != 0 {
		t.Fatalf("Space must select without applying\n%s", screen(m))
	}
	m = drive(t, m, ctrlS())
	if got := backend.Actions(); len(got) != 1 || got[0] != "config EASY_NAMES=on" {
		t.Fatalf("Ctrl+S must apply selected pending Access: %v", got)
	}
}

func TestSettingsRemoteAccessSpaceDoesNotOpenPrivateOrPublicationInput(t *testing.T) {
	for _, downs := range []int{2, 3} {
		m, backend := sample(t, 80, 24)
		m = drive(t, m, press("5"))
		m = drive(t, m, press("]"))
		for range downs {
			m = drive(t, m, press("down"))
		}
		m = drive(t, m, press("space"))
		if m.surface != surfaceSettings || m.settings.cloudflare != nil || m.install != nil || len(backend.Actions()) != 0 || !strings.Contains(screen(m), "(pending)") {
			t.Fatalf("Space must only select a pending remote Access\n%s", screen(m))
		}
		m = drive(t, m, press("up"))
		m = drive(t, m, press("enter"))
		if downs == 2 && m.surface != surfaceInstall || downs == 3 && m.settings.cloudflare == nil || len(backend.Actions()) != 0 {
			t.Fatal("Enter must open the selected Access boundary, not the focused row; no approval yet")
		}
	}
}

func TestLANEditorSpaceTypesAndTabChoiceIsExplained(t *testing.T) {
	m, backend := movedHost(t)
	m = drive(t, m, press("5"))
	m = drive(t, m, press("enter"))
	if !strings.Contains(flat(screen(m)), "tab fills next detected address") {
		t.Fatalf("detected choices need a truthful hint\n%s", screen(m))
	}
	m = drive(t, m, press("space"))
	if m.settings.input.Value() != "192.168.1.20 " || len(backend.Actions()) != 0 {
		t.Fatal("Space in an address editor must type, not select or apply")
	}
	m = drive(t, m, press("tab"))
	if m.settings.input.Value() != "192.168.0.12" {
		t.Fatal("Tab must still fill the next detected choice")
	}
	m = drive(t, m, press("enter"))
	if len(backend.Actions()) != 0 || m.settings.pairs()[0] != "LAN_IP=192.168.0.12" {
		t.Fatal("accepting an address must wait for Ctrl+S")
	}
}

func TestDoctorKeepsLiteralCoordinatesThroughRevealAndRefresh(t *testing.T) {
	for _, size := range []struct{ width, height, x, y int }{{80, 24, 2, 4}, {120, 30, 12, 7}} {
		m, _ := onboardingHost(t, size.width, size.height, readyChecks...)
		m.onboarding.autoContinue = false
		checkPosition := func(text string, x, y int) {
			t.Helper()
			lines := strings.Split(screen(m), "\n")
			at := strings.Index(lines[y], text)
			if at < 0 || ansi.StringWidth(lines[y][:at]) != x {
				t.Fatalf("%dx%d: %q must start at (%d,%d)\n%s", size.width, size.height, text, x, y, screen(m))
			}
		}
		for _, level := range []host.Level{host.OK, host.Warn, host.Fail} {
			m = update(t, m, tea.FocusMsg{})
			checkPosition("Checking this machine", size.x, size.y)
			checkPosition("Checking Docker…", size.x+2, size.y+3)
			checks := []host.Check{
				{ID: "docker", Title: "Docker", Level: level, Detail: strings.Repeat("long diagnostic ", 12), Hint: strings.Repeat("long recovery ", 12), Docs: "https://docs.example.invalid/recovery"},
				{ID: "daemon", Title: "Docker daemon", Level: host.OK, Detail: "ready"},
				{ID: "compose", Title: "Docker Compose", Level: host.OK, Detail: "ready"},
				{ID: "ids", Title: "Container IDs", Level: host.OK, Detail: "ready"},
			}
			m = update(t, m, doctorMsg{checks: checks})
			for frame := range 31 {
				checkPosition("Checking this machine", size.x, size.y)
				checkPosition("Docker", size.x+2, size.y+3)
				if frame >= 6 {
					checkPosition("Docker daemon", size.x+2, size.y+6)
				}
				if frame >= 24 {
					if level == host.Fail {
						checkPosition("Fix the failed check", size.x, size.y+16)
					} else {
						checkPosition("✓ This machine is ready.", size.x, size.y+16)
					}
				}
				m = update(t, m, frameMsg{})
			}
		}
		m.defaults = nil
		m = update(t, m, tea.FocusMsg{})
		m = update(t, m, doctorMsg{checks: readyChecks})
		m = frames(t, m, 30)
		checkPosition("Checking this machine", size.x, size.y)
		checkPosition("Reading this machine's settings…", size.x+2, size.y+16)
		m = update(t, m, defaultsMsg{settings: map[string]string{"LAN_IP": "192.168.1.20"}})
		checkPosition("Checking this machine", size.x, size.y)
		checkPosition("✓ This machine is ready.", size.x, size.y+16)
	}
}
