package tui

import (
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/x/ansi"
)

func releaseModel(t *testing.T, version, latest string) Model {
	t.Helper()
	m, backend := sample(t, 140, 32)
	backend.latest = latest
	m.opts.Version = version
	return drive(t, m, releaseMsg{version: backend.latest})
}

func TestHeaderNoticeAppearsWhenANewerReleaseExists(t *testing.T) {
	m := releaseModel(t, "1.1.0", "v1.2.0")

	header := strings.Split(screen(m), "\n")[0]

	if !strings.Contains(header, "↑ v1.2.0") {
		t.Errorf("header lacks the notice\n%s", header)
	}
	if strings.Contains(header, "self-update") {
		t.Errorf("header notice should stay short\n%s", header)
	}
}

func TestHeaderNoticeFitsEightyColumns(t *testing.T) {
	m, backend := sample(t, 80, 24)
	backend.latest = "v1.2.0"
	m.opts.Version = "1.1.0"
	m = drive(t, m, releaseMsg{version: backend.latest})

	if header := strings.Split(screen(m), "\n")[0]; !strings.Contains(header, "↑ v1.2.0") {
		t.Errorf("notice does not fit 80 columns\n%s", header)
	}
}

func TestSelfUpdateHintIsInTheStatusLineAndHelpOverlay(t *testing.T) {
	m := releaseModel(t, "1.1.0", "v1.2.0")

	if status := statusLine(screen(m)); !strings.Contains(status, "self-host self-update") {
		t.Errorf("status line lacks the update hint\n%s", status)
	}

	m = drive(t, m, press("?"))
	if help := ansi.Strip(m.renderOverlay()); !strings.Contains(help, "self-host self-update") {
		t.Errorf("help overlay lacks the update hint\n%s", help)
	}
}

func TestHeaderHasNoNoticeWhenCurrentOrAhead(t *testing.T) {
	for _, tc := range []struct{ version, latest string }{
		{"1.2.0", "v1.2.0"}, {"1.10.0", "v1.9.0"}, {"dev", "v1.2.0"}, {"1.1.0", ""},
	} {
		if out := screen(releaseModel(t, tc.version, tc.latest)); strings.Contains(out, "available") {
			t.Errorf("version %q latest %q: unexpected notice\n%s", tc.version, tc.latest, out)
		}
	}
}

func TestInitChecksForANewerReleaseWithoutBlocking(t *testing.T) {
	m, backend := sample(t, 140, 32)
	backend.latest = "v9.9.9"
	m.opts.Version = "1.0.0"
	m.opts.Now = func() time.Time { return time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC) }

	found := false
	for _, msg := range runCmd(m.Init()) {
		if r, ok := msg.(releaseMsg); ok && r.version == "v9.9.9" {
			found = true
		}
	}
	if !found {
		t.Error("Init did not look up the latest release")
	}
}
