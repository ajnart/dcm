package tui

import (
	"net/http"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/systemtest"
	"github.com/ajnart/self-host/internal/telemetry"
	"github.com/ajnart/self-host/internal/telemetry/telemetrytest"
)

const noticeLine = "Anonymous usage and error data is sent. Turn off: SELF_HOST_NO_TELEMETRY=1"

func welcomeWithNotice(t *testing.T, width, height int) Model {
	t.Helper()
	backend := &fakeBackend{catalog: wizardCatalog(), checks: readyChecks, telemetryNotice: noticeLine}
	m := New(backend, Options{Version: "1.0.0"})
	m = update(t, m, windowSize(width, height))
	m = drive(t, m, statusMsgFor(service.ErrNoProject))
	m = update(t, m, doctorMsg{checks: backend.checks})
	return drive(t, frames(t, m, 60), press("enter"))
}

func TestWelcomeAnnouncesTelemetryOnOneLine(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		m := welcomeWithNotice(t, size.width, size.height)
		if got := strings.Count(screen(m), noticeLine); got != 1 {
			t.Fatalf("%dx%d: the notice appears %d times, want once\n%s", size.width, size.height, got, screen(m))
		}
		golden(t, "onboarding-welcome-telemetry"+size.suffix, trimLines(screen(m)))
	}
}

func TestOtherStepsDoNotRepeatTheTelemetryNotice(t *testing.T) {
	m := welcomeWithNotice(t, 120, 30)
	m = drive(t, m, press("enter"))
	if !strings.Contains(indicator(t, m), "● What") || strings.Contains(screen(m), "SELF_HOST_NO_TELEMETRY") {
		t.Fatalf("the What step should not carry the notice\n%s", screen(m))
	}
	m = drive(t, m, press("esc"))
	if !strings.Contains(screen(m), noticeLine) {
		t.Fatalf("coming back to Welcome should show the same notice\n%s", screen(m))
	}
}

func TestWelcomeHasNoNoticeOnceItWasShown(t *testing.T) {
	m, _ := freshHost(t)
	if strings.Contains(screen(m), "SELF_HOST_NO_TELEMETRY") {
		t.Fatalf("Welcome carries a notice the backend did not announce\n%s", screen(m))
	}
}

func TestTheServiceBackendAnnouncesTelemetryOnce(t *testing.T) {
	key := telemetry.ProjectKey
	telemetry.ProjectKey = "phc_test"
	t.Cleanup(func() { telemetry.ProjectKey = key })
	deps := systemtest.NewDeps(t)
	deps.Version = "1.2.3"
	deps.HTTP = &http.Client{Transport: &telemetrytest.Transport{}}
	backend := ServiceBackend{Deps: deps, Apps: wizardCatalog()}

	first, second := backend.TelemetryNotice(), backend.TelemetryNotice()

	if first != noticeLine || second != "" {
		t.Fatalf("notices = %q then %q, want %q then nothing", first, second, noticeLine)
	}
}

func TestTheServiceBackendSaysNothingWhereTelemetryIsOff(t *testing.T) {
	deps := systemtest.NewDeps(t)
	backend := ServiceBackend{Deps: deps, Apps: wizardCatalog()}
	if notice := backend.TelemetryNotice(); notice != "" {
		t.Fatalf("a test build announced %q", notice)
	}
}
