package tui

import (
	"slices"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/service"
)

// movedHost is the sample Project after the laptop moved from the office
// (192.168.1.20) to a home network (192.168.0.12).
func movedHost(t *testing.T) (Model, *fakeBackend) {
	t.Helper()
	m, backend := sample(t, 140, 32)
	backend.catalog = wizardCatalog()
	backend.review = []service.SettingReview{
		{Key: "EXPOSURE", Current: "lan", Choices: []string{"lan", "local"}},
		{Key: "LAN_IP", Current: "192.168.1.20", Detected: "192.168.0.12", Choices: []string{"192.168.1.20", "192.168.0.12"}, Drift: true,
			Note: "not an address of this machine any more"},
		{Key: "TZ", Current: "Europe/Paris", Detected: "Europe/Paris", Choices: []string{"Europe/Paris"}},
	}
	backend.status.LANIPStale, backend.status.HostIPs = true, []string{"192.168.0.12"}
	m = drive(t, m, statusMsg{status: backend.status})
	return m, backend
}

func TestStaleLANIPNeedsActionAndPointsAtHostSettings(t *testing.T) {
	m, _ := movedHost(t)

	out := screen(m)
	for _, want := range []string{"⚠ LAN 192.168.1.20", "LAN IP 192.168.1.20 is not on this machine", "i Host settings"} {
		if !strings.Contains(out, want) {
			t.Errorf("dashboard lacks %q\n%s", want, out)
		}
	}
}

func TestHostSettingsReviewAppliesTheDetectedLANIPWithoutInstalling(t *testing.T) {
	m, backend := movedHost(t)

	m = drive(t, m, press("i"))
	if currentPick(m) != hostSettingsKey {
		t.Fatalf("Host settings should be the first picker entry, got %q", currentPick(m))
	}
	m = drive(t, m, press("enter"))
	overlay := m.renderOverlay()
	if !strings.Contains(overlay, "Host settings") || !strings.Contains(overlay, "192.168.0.12") || !strings.Contains(overlay, "not an address of this machine") {
		t.Fatalf("review should preselect the detected LAN IP\n%s", overlay)
	}
	drive(t, m, press("enter"))

	if got := backend.Actions(); !slices.Equal(got, []string{"config LAN_IP=192.168.0.12"}) {
		t.Fatalf("actions %v", got)
	}
	if len(backend.installs()) != 0 {
		t.Fatal("re-confirming Host settings must not install anything")
	}
}

func TestHostSettingsReviewCanChangeExposureAndGoBack(t *testing.T) {
	m, backend := movedHost(t)

	m = drive(t, m, press("i"))
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("space")) // EXPOSURE: lan → local
	m = drive(t, m, press("esc"))
	if m.picker == nil || m.picker.host != nil || len(backend.Actions()) != 0 {
		t.Fatal("esc should return to the picker without applying")
	}
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("space"))
	drive(t, m, press("enter"))

	if got := backend.Actions(); !slices.Equal(got, []string{"config EXPOSURE=local LAN_IP=192.168.0.12"}) {
		t.Fatalf("actions %v", got)
	}
}
