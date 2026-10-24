package tui

import (
	"slices"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/service"
)

func TestOnboardingChoosesEasyNamesAndKeepsHomeNetwork(t *testing.T) {
	m, _ := freshHost(t)
	m.onboarding.openStep(m.ctx(), stepAccess)
	for _, key := range []string{"down", "space", "enter"} {
		m = drive(t, m, press(key))
	}
	if m.onboarding.step != stepWho {
		t.Fatalf("step %v, want Who", m.onboarding.step)
	}
	plan := planFromAnswers(m.backend, m.onboarding.answers)
	if !plan.opts.EasyNames || plan.opts.Exposure != service.ExposureLAN {
		t.Fatalf("plan %+v", plan.opts)
	}
}

func TestOnboardingNeverPreselectsEasyNames(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		m, _ := freshHost(t)
		defaults := map[string]string{"LAN_IP": "192.168.1.20"}
		if enabled {
			defaults["EASY_NAMES"] = "on"
		}
		m = drive(t, m, defaultsMsg{settings: defaults})
		if got := planFromAnswers(m.backend, m.onboarding.answers).opts.EasyNames; got {
			t.Fatalf("inspection %v: EasyNames %v", enabled, got)
		}
	}
}

func TestSettingsEasyNamesArePendingUntilAppliedAndCanBeTurnedOff(t *testing.T) {
	m, backend := sample(t, 80, 24)
	for _, k := range []string{"5", "]", "down", "enter"} {
		m = drive(t, m, press(k))
	}
	if !slices.Equal(m.settings.pairs(), []string{"EASY_NAMES=on"}) || len(backend.Actions()) != 0 {
		t.Fatalf("pending %v calls %v", m.settings.pairs(), backend.Actions())
	}
	m = drive(t, m, ctrlS())
	if !slices.Contains(backend.Actions(), "config EASY_NAMES=on") {
		t.Fatalf("calls %v", backend.Actions())
	}
	m, _ = sample(t, 80, 24)
	m.status.Settings = map[string]string{"EASY_NAMES": "on"}
	for _, k := range []string{"5", "]", "up", "enter"} {
		m = drive(t, m, press(k))
	}
	if !slices.Equal(m.settings.pairs(), []string{"EASY_NAMES=off"}) {
		t.Fatalf("turn off: %v", m.settings.pairs())
	}
}

func TestEasyNamesHelpExplainsHostOnlyChecksDHCPAndDNSFallback(t *testing.T) {
	o, _ := accessByID("names")
	text := accessHelpText(o, "192.168.1.20", 70)
	for _, want := range []string{"sslip.io", "checked from this computer", "router", "bookmarks", "numbers", "port 80"} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %q: %s", want, text)
		}
	}
	if strings.Contains(text, "movies.local") || strings.Contains(text, "coming soon") {
		t.Fatal(text)
	}
}

func TestGoldenEasyNames(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		t.Run("names"+size.suffix, func(t *testing.T) {
			m := goldenModel(t, size.width, size.height)
			for _, k := range []string{"5", "]", "down", "enter"} {
				m = drive(t, m, press(k))
			}
			golden(t, "easy-names-pending"+size.suffix, trimLines(screen(m)))
			m = drive(t, m, press("?"))
			for range 60 {
				m = drive(t, m, press("down"))
			}
			if !strings.Contains(screen(m), "Technical details") || !strings.Contains(screen(m), "DHCP") {
				t.Fatal(screen(m))
			}
			golden(t, "easy-names-technical"+size.suffix, trimLines(screen(m)))
			o, _ := freshHost(t)
			o = drive(t, o, windowSize(size.width, size.height))
			o = atAccess(t, o)
			for _, k := range []string{"down", "space", "enter", "esc"} {
				o = drive(t, o, press(k))
			}
			golden(t, "easy-names-onboarding"+size.suffix, trimLines(screen(o)))
		})
	}
}

func TestStoppedNamesAppearInNeedsAttentionWithoutDoctorResults(t *testing.T) {
	m, _ := sample(t, 120, 30)
	m.checks = nil
	m.status.Names = &service.NamesStatus{On: true, Problem: "binding", Message: "Easy names are stopped"}
	if !strings.Contains(screen(m), "Easy names are stopped") {
		t.Fatal(screen(m))
	}
}
