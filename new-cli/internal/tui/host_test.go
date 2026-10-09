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

func TestStaleLANIPNeedsAttentionAndPointsAtTheSettingsTab(t *testing.T) {
	m, _ := movedHost(t)

	out := screen(m)
	for _, want := range []string{"⚠ LAN 192.168.1.20", "LAN IP 192.168.1.20 is not on this machine", "5 Host settings"} {
		if !strings.Contains(out, want) {
			t.Errorf("dashboard lacks %q\n%s", want, out)
		}
	}
}

func TestHostSettingsReviewAppliesTheDetectedLANIPWithoutInstalling(t *testing.T) {
	m, backend := movedHost(t)

	m = drive(t, m, press("5"))
	if m.surface != surfaceSettings {
		t.Fatalf("5 should open the Settings tab")
	}
	m = drive(t, m, press("down"))  // LAN_IP row
	m = drive(t, m, press("enter")) // edit
	m = drive(t, m, press("tab"))   // cycle to the detected address
	m = drive(t, m, press("enter")) // accept
	m = drive(t, m, ctrlS())        // apply

	if got := backend.Actions(); !slices.Equal(got, []string{"config LAN_IP=192.168.0.12"}) {
		t.Fatalf("actions %v", got)
	}
	if len(backend.installs()) != 0 {
		t.Fatal("re-confirming Host settings must not install anything")
	}
	if m.surface != surfaceActivity {
		t.Fatal("ctrl+s should hand focus to Activity")
	}
}

func TestHostSettingsReviewCanChangeExposureAndGoBack(t *testing.T) {
	m, backend := movedHost(t)

	m = drive(t, m, press("5"))
	m = drive(t, m, press("space")) // EXPOSURE: lan → local
	m = drive(t, m, press("esc"))   // pending changes: ask to discard
	if !m.settings.confirmDiscard || len(backend.Actions()) != 0 {
		t.Fatal("esc with pending changes should ask before discarding")
	}
	m = drive(t, m, press("n")) // keep editing
	if m.settings == nil || m.settings.confirmDiscard {
		t.Fatal("n should keep the pending changes")
	}
	m = drive(t, m, ctrlS())

	if got := backend.Actions(); !slices.Equal(got, []string{"config EXPOSURE=local"}) {
		t.Fatalf("actions %v", got)
	}
}
