package tui

import (
	"strings"
	"testing"
	"time"
)

func releaseModel(t *testing.T, version, latest string) Model {
	t.Helper()
	m, backend := sample(t, 140, 32)
	backend.latest = latest
	m.opts.Version = version
	return drive(t, m, releaseMsg{version: backend.latest})
}

func TestHeaderNoticeAppearsWhenANewerReleaseExists(t *testing.T) {
	out := screen(releaseModel(t, "1.1.0", "v1.2.0"))

	if want := "↑ v1.2.0 available · self-host self-update"; !strings.Contains(out, want) {
		t.Errorf("header lacks %q\n%s", want, out)
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
