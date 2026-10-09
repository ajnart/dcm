package tui

import (
	"errors"
	"strings"
	"testing"
)

// offered is the dashboard at version, told the latest release is latest.
func offered(t *testing.T, version, latest, skipped string) (Model, *fakeBackend) {
	t.Helper()
	m, backend := sample(t, 120, 30)
	backend.latest, backend.skipped = latest, skipped
	m.opts.Version = version
	return drive(t, m, releaseMsg{version: latest, skipped: skipped}), backend
}

func TestAPromptOffersANewerReleaseAndNamesBothVersions(t *testing.T) {
	m, _ := offered(t, "1.1.0", "v1.2.0", "")

	out := screen(m)

	for _, want := range []string{"self-host 1.2.0 is available (you have 1.1.0)", "Update now?", "y", "n"} {
		if !strings.Contains(out, want) {
			t.Errorf("prompt lacks %q\n%s", want, out)
		}
	}
}

func TestNoPromptWhenEqualAheadSkippedOrADevelopmentBuild(t *testing.T) {
	for _, tc := range []struct{ name, version, latest, skipped string }{
		{"equal", "1.2.0", "v1.2.0", ""},
		{"ahead", "1.10.0", "v1.9.0", ""},
		{"skipped", "1.1.0", "v1.2.0", "1.2.0"},
		{"development build", "dev", "v1.2.0", ""},
		{"lookup failed", "1.1.0", "", ""},
	} {
		m, _ := offered(t, tc.version, tc.latest, tc.skipped)
		if out := screen(m); strings.Contains(out, "Update now?") {
			t.Errorf("%s: unexpected prompt\n%s", tc.name, out)
		}
	}
}

func TestASkippedReleaseDoesNotHideANewerOne(t *testing.T) {
	m, _ := offered(t, "1.1.0", "v1.3.0", "1.2.0")

	if out := screen(m); !strings.Contains(out, "self-host 1.3.0 is available") {
		t.Errorf("a newer release should be offered again\n%s", out)
	}
}

func TestYUpdatesShowsProgressThenRestartsIntoTheNewBinary(t *testing.T) {
	m, backend := offered(t, "1.1.0", "v1.2.0", "")
	backend.updateTo = "1.2.0"

	next, cmd := m.Update(press("y"))
	m = next.(Model)

	if out := screen(m); !strings.Contains(out, "Updating to 1.2.0") {
		t.Errorf("no progress shown\n%s", out)
	}
	for _, msg := range runCmd(cmd) {
		m = drive(t, m, msg)
	}
	if backend.selfUpdates != 1 {
		t.Fatalf("SelfUpdate called %d times", backend.selfUpdates)
	}
	if !m.quitting || !m.restart {
		t.Fatalf("the dashboard should close to restart: quitting %v restart %v", m.quitting, m.restart)
	}
	if backend.restarts != 0 {
		t.Fatal("Restart must wait until the terminal is restored")
	}
	if err := restartIfUpdated(m, backend); err != nil || backend.restarts != 1 {
		t.Fatalf("restart: %v, calls %d", err, backend.restarts)
	}
}

func TestNoRestartWithoutAnUpdate(t *testing.T) {
	m, backend := offered(t, "1.1.0", "v1.2.0", "")

	if err := restartIfUpdated(m, backend); err != nil || backend.restarts != 0 {
		t.Fatalf("restart %v, calls %d", err, backend.restarts)
	}
}

func TestAFailedUpdateShowsTheErrorAndKeepsRunning(t *testing.T) {
	m, backend := offered(t, "1.1.0", "v1.2.0", "")
	backend.updateErr = errors.New("checksum mismatch for the archive")

	m = drive(t, m, press("y"))

	out := screen(m)
	if !strings.Contains(out, "checksum mismatch") || !strings.Contains(out, "Overview") && !strings.Contains(out, "Jellyfin") {
		t.Errorf("the failure should be shown over the dashboard\n%s", out)
	}
	if m.quitting || m.restart {
		t.Fatal("a failed update must not close the dashboard")
	}
	m = drive(t, m, press("x"))
	if strings.Contains(screen(m), "checksum mismatch") {
		t.Error("a key should dismiss the failure")
	}
	if len(backend.skips) != 0 {
		t.Errorf("a failure should not skip the release: %v", backend.skips)
	}
	m = drive(t, m, press("3"))
	if m.surface != surfaceActivity {
		t.Error("the dashboard does not answer keys after a failure")
	}
}

func TestAFailedRestartTellsThePersonToStartAgain(t *testing.T) {
	m, backend := offered(t, "1.1.0", "v1.2.0", "")
	backend.updateTo = "1.2.0"
	backend.restartErr = errors.New("exec format error")
	m = drive(t, m, press("y"))

	err := restartIfUpdated(m, backend)

	if err == nil || !strings.Contains(err.Error(), "updated to 1.2.0") || !strings.Contains(err.Error(), "exec format error") {
		t.Errorf("err = %v", err)
	}
}

func TestNSkipsTheReleaseAndRemembersIt(t *testing.T) {
	m, backend := offered(t, "1.1.0", "v1.2.0", "")

	m = drive(t, m, press("n"))

	if got := strings.Join(backend.skips, ","); got != "1.2.0" {
		t.Errorf("saved skips = %q", got)
	}
	out := screen(m)
	if strings.Contains(out, "Update now?") {
		t.Errorf("prompt still shown\n%s", out)
	}
	if header := strings.Split(out, "\n")[0]; !strings.Contains(header, "↑ v1.2.0") {
		t.Errorf("the header should still show the update\n%s", header)
	}
	if backend.selfUpdates != 0 {
		t.Error("n must not update")
	}
}

func TestEscAlsoSkips(t *testing.T) {
	m, backend := offered(t, "1.1.0", "v1.2.0", "")

	m = drive(t, m, press("esc"))

	if len(backend.skips) != 1 || strings.Contains(screen(m), "Update now?") {
		t.Errorf("skips %v\n%s", backend.skips, screen(m))
	}
}

func TestThePromptCoversNoOtherKey(t *testing.T) {
	m, _ := offered(t, "1.1.0", "v1.2.0", "")

	m = drive(t, m, press("3"))

	if m.surface == surfaceActivity || !strings.Contains(screen(m), "Update now?") {
		t.Error("other keys must not act behind the prompt")
	}
}

func TestNoPromptDuringPrebootOrWhileAnActionRuns(t *testing.T) {
	m, backend, _ := approved(t, 120, 30)
	backend.latest = "v1.2.0"
	m.opts.Version = "1.1.0"

	m = drive(t, m, releaseMsg{version: "v1.2.0"})

	if m.preboot == nil || m.upgrade != nil {
		t.Fatalf("pre-boot is on screen and must not be interrupted: update %+v", m.upgrade)
	}
}

func TestThePromptWaitsForARunningActionAndThenAppears(t *testing.T) {
	m, _ := sample(t, 120, 30)
	m.opts.Version = "1.1.0"
	next, _ := m.run(Request{Action: ActionRestart}, "restart")
	m = next.(Model)
	t.Cleanup(m.tasks.cancelAll)
	m = update(t, m, releaseMsg{version: "v1.2.0"})

	if m.upgrade != nil {
		t.Fatal("prompt shown while an Action runs")
	}
	id := m.tasks.latest().id
	m = drive(t, m, taskDoneMsg{id: id, title: "restart", action: ActionRestart})

	if !strings.Contains(screen(m), "Update now?") {
		t.Errorf("the deferred prompt should appear once idle\n%s", screen(m))
	}
}

func TestThePromptIsOfferedOncePerSession(t *testing.T) {
	m, _ := offered(t, "1.1.0", "v1.2.0", "")
	m = drive(t, m, press("n"))

	m = drive(t, m, releaseMsg{version: "v1.2.0"})

	if strings.Contains(screen(m), "Update now?") {
		t.Error("a dismissed prompt came back")
	}
}

func TestNoPromptWhenOptedOutButTheHeaderStillShowsTheRelease(t *testing.T) {
	m, backend := sample(t, 120, 30)
	m.opts.Version, m.opts.NoUpdatePrompt = "1.1.0", true
	backend.latest = "v1.2.0"

	m = drive(t, m, releaseMsg{version: "v1.2.0"})

	out := screen(m)
	if strings.Contains(out, "Update now?") || !strings.Contains(strings.Split(out, "\n")[0], "↑ v1.2.0") {
		t.Errorf("opted out\n%s", out)
	}
}
