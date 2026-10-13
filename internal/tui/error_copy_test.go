package tui

import (
	"fmt"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/service"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

func TestFailedInstallCopiesAndInspectsTheFullMaskedErrorBeforeProjectExists(t *testing.T) {
	for _, size := range []struct{ width, height int }{{80, 24}, {120, 30}} {
		m, backend := freshHost(t)
		backend.catalog = withTailscale(backend.catalog)
		m = update(t, m, windowSize(size.width, size.height))
		m = atStep(t, m, "Review")
		m.onboarding.answers.adminPassword = "synthetic-admin-sentinel"
		m.onboarding.answers.inputs["tailscale.auth_key"] = new(string)
		*m.onboarding.answers.inputs["tailscale.auth_key"] = "synthetic-key-sentinel"
		m.onboarding.plan.opts.AdminPassword = "synthetic-admin-sentinel"
		backend.statusErr = service.ErrNoProject
		backend.fail = errString("Provider refused synthetic-admin-sentinel\n\nTechnical details:\nkey synthetic-key-sentinel rejected\n" + strings.Repeat("safe multiline diagnostic\n", 25) + "last recovery line")
		m = drive(t, m, press("enter"))
		if m.onboarding == nil || m.onboarding.step != stepReview {
			t.Fatalf("failure before Project must return to Review\n%s", screen(m))
		}
		for _, secret := range []string{"synthetic-admin-sentinel", "synthetic-key-sentinel"} {
			if strings.Contains(screen(m), secret) || strings.Contains(m.onboarding.err, secret) {
				t.Fatalf("known pending secret reached diagnostics: %q", secret)
			}
		}
		want := "Provider refused [redacted]\n\nTechnical details:\nkey [redacted] rejected\n" + strings.Repeat("safe multiline diagnostic\n", 25) + "last recovery line"
		if !strings.Contains(flat(lastLine(screen(m))), "c copy error") || !strings.Contains(flat(lastLine(screen(m))), "e full error") {
			t.Fatalf("copy and inspection must be discoverable\n%s", screen(m))
		}
		next, cmd := m.handleKey(press("c"))
		m = next.(Model)
		if cmd == nil {
			t.Fatal("Review must return a copy command")
		}
		copied, ok := cmd().(clipboardMsg)
		if !ok || copied.text != want || copied.what != "error" {
			t.Fatalf("full safe error copy mismatch: %#v", copied)
		}
		golden(t, fmt.Sprintf("onboarding-error-%dx%d", size.width, size.height), trimLines(screen(m)))
		m = drive(t, m, press("e"))
		if !m.showHelp || !strings.Contains(screen(m), "Provider refused [redacted]") {
			t.Fatalf("full error needs a scrollable reader\n%s", screen(m))
		}
		for range 40 {
			m = drive(t, m, press("down"))
		}
		if !strings.Contains(screen(m), "last recovery line") {
			t.Fatalf("reader must reach the last line\n%s", screen(m))
		}
		golden(t, fmt.Sprintf("onboarding-error-reader-%dx%d", size.width, size.height), trimLines(screen(m)))
		next, cmd = m.handleKey(press("c"))
		m = next.(Model)
		if cmd == nil {
			t.Fatal("reader must return a copy command")
		}
		if copied, ok := cmd().(clipboardMsg); !ok || copied.text != want || copied.what != "error" {
			t.Fatalf("reader must copy the whole error, not its visible portion: %#v", copied)
		}
		m = drive(t, m, press("a"))
		if !m.showHelp || m.onboarding.step != stepReview {
			t.Fatal("reader must exclusively own keys")
		}
		m = drive(t, m, press("esc"))
		if m.showHelp || m.onboarding.answers.adminPassword != "synthetic-admin-sentinel" || m.onboarding.err != want {
			t.Fatal("closing inspection must preserve answers and error")
		}
		next, _ = m.Update(press("ctrl+c"))
		if !next.(Model).quitting {
			t.Fatal("Ctrl+C must still quit Review")
		}
	}
}

func TestActivityCopiesAndInspectsFailuresOutsideAppSteps(t *testing.T) {
	for _, size := range []struct{ width, height int }{{80, 24}, {120, 30}} {
		m, _ := sample(t, size.width, size.height)
		task := m.tasks.start("install")
		t.Cleanup(m.tasks.cancelAll)
		want := "Safe provider error\nTechnical details:\n" + strings.Repeat("full diagnostic\n", 30) + "last recovery line"
		m.tasks.finish(task.id, errString(want))
		m = drive(t, m, press("3"))
		if !strings.Contains(flat(lastLine(screen(m))), "c copy error") || !strings.Contains(flat(lastLine(screen(m))), "e full error") {
			t.Fatalf("failed Action needs copy/inspection even without a failed App step\n%s", screen(m))
		}
		golden(t, fmt.Sprintf("activity-action-error-%dx%d", size.width, size.height), trimLines(screen(m)))
		next, cmd := m.handleKey(press("c"))
		m = next.(Model)
		if cmd == nil {
			t.Fatal("Activity must return a copy command")
		}
		copied, ok := cmd().(clipboardMsg)
		if !ok || copied.text != want || copied.what != "error" {
			t.Fatalf("copied Action error: %#v", copied)
		}
		next, _ = m.update(copied)
		m = next.(Model)
		if m.flash != "copied error" {
			t.Fatal("copy confirmation must not echo diagnostics")
		}
		m = drive(t, m, press("e"))
		for range 40 {
			m = drive(t, m, press("down"))
		}
		if !strings.Contains(screen(m), "last recovery line") {
			t.Fatal("Action error inspection must reach its last line")
		}
		m = drive(t, m, press("5"))
		if m.surface != surfaceActivity || !m.showHelp {
			t.Fatal("error reader must prevent tab keys acting underneath")
		}
		next, _ = m.Update(press("ctrl+c"))
		if !next.(Model).quitting {
			t.Fatal("Ctrl+C must quit the error reader")
		}
	}
}

func TestActivitySelectedStepCopiesFullErrorAndSearchStillTypesC(t *testing.T) {
	m, backend := sample(t, 80, 24)
	backend.status.Apps[0].Steps = []service.StepStatus{{ID: "configure", Status: stepstatus.StepFail, Error: "Safe step failure\nlast provider detail"}}
	backend.status.Apps[0].Setup = stepstatus.SetupIncomplete
	m = update(t, m, statusMsg{status: backend.status})
	m = drive(t, m, press("3"))
	m = drive(t, m, press("down"))
	next, cmd := m.handleKey(press("c"))
	m = next.(Model)
	if cmd == nil {
		t.Fatal("selected failed step must be copyable")
	}
	if copied, ok := cmd().(clipboardMsg); !ok || copied.text != "Safe step failure\nlast provider detail" {
		t.Fatalf("step copy = %#v", copied)
	}
	m = drive(t, m, press("e"))
	if !m.showHelp || !strings.Contains(screen(m), "last provider detail") {
		t.Fatal("selected failed step needs full inspection")
	}
	m = drive(t, m, press("esc"))
	m = drive(t, m, press("/"))
	m = drive(t, m, press("c"))
	if !m.activity.searching || m.activity.filter != "c" || m.showHelp {
		t.Fatal("search must type c, not copy an error")
	}
}
