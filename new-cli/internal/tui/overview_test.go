package tui

import (
	"errors"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
)

// withUpdate is the sample Project with an update known for Jellyfin, so
// Needs attention lists a failed step, a stopped App, an update and a host
// warning.
func withUpdate(t *testing.T, width, height int) (Model, *fakeBackend) {
	t.Helper()
	m, backend := sample(t, width, height)
	m = update(t, m, updatesMsg{updates: map[string]string{"jellyfin": service.UpdateAvailable}})
	return m, backend
}

func TestOverviewShowsAppsNeedsAttentionAndNow(t *testing.T) {
	m, _ := sample(t, 120, 30)

	out := screen(m)

	for _, want := range []string{"Apps 3", "Jellyfin", "Needs attention 3", "Now", "No Action yet", "Host: 1 warning"} {
		if !strings.Contains(out, want) {
			t.Errorf("the Overview lacks %q\n%s", want, out)
		}
	}
	if strings.Contains(out, "compose") || strings.Contains(out, "ready on :80") {
		t.Errorf("App details live on the Apps tab now\n%s", out)
	}
}

func TestOverviewAppsShowTheirCategory(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.catalog = catalog.New([]app.App{
		stubApp{info: app.Info{ID: "jellyfin", Name: "Jellyfin", Category: "Media"}},
		stubApp{info: app.Info{ID: "sonarr", Name: "Sonarr", Category: "Downloads"}},
	}, nil)

	out := screen(drive(t, m, statusMsg{status: backend.status}))

	for app, category := range map[string]string{"● ♫ Jellyfin  ": "Media", "✗ ↓ Sonarr  ": "Downloads"} {
		if line := lineWith(t, out, app); !strings.Contains(line, category) {
			t.Errorf("%s's row lacks its category %q: %q", app, category, line)
		}
	}
}

func TestNeedsAttentionTakesFocusAndAOpensTheItemsAppMenu(t *testing.T) {
	m, _ := withUpdate(t, 120, 30)

	m = drive(t, m, press("tab"))
	if bar := lastLine(screen(m)); !strings.Contains(bar, "a  resolve") {
		t.Fatalf("the bar should follow Needs attention: %q", bar)
	}
	for _, tc := range []struct {
		downs             int
		menu, highlighted string
	}{
		{0, "Sonarr · Actions", "> Retry Setup"},
		{1, "whoami · Actions", "> Start"},
		{1, "Jellyfin · Actions", "> Update"},
	} {
		for range tc.downs {
			m = drive(t, m, press("down"))
		}
		m = drive(t, m, press("a"))
		out := screen(m)
		if !strings.Contains(out, tc.menu) || !strings.Contains(out, tc.highlighted) {
			t.Fatalf("a should open %q on %q\n%s", tc.menu, tc.highlighted, out)
		}
		m = drive(t, m, press("esc"))
	}
}

func TestEnterOnANeedsAttentionItemGoesToItsApp(t *testing.T) {
	m, backend := sample(t, 120, 30)

	m = drive(t, m, press("tab"))
	m = drive(t, m, press("down")) // whoami is stopped
	m = drive(t, m, press("enter"))

	if got := activeTab(t, m); got != "2 Apps" || m.selectedID() != "whoami" {
		t.Fatalf("enter should open whoami on the Apps tab, got %q %q", got, m.selectedID())
	}
	if len(backend.Actions()) != 0 {
		t.Fatalf("enter must not run anything: %v", backend.Actions())
	}
}

func TestAHostItemWithoutAnAppDoesNothing(t *testing.T) {
	m, _ := sample(t, 120, 30)

	m = drive(t, m, press("tab"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("down")) // Firewall: ufw is active
	m = drive(t, m, press("a"))

	out := screen(m)
	if strings.Contains(out, "· Actions") || !strings.Contains(out, "sudo ufw allow") {
		t.Fatalf("a host check has no Action; its command stays visible\n%s", out)
	}
}

func TestNeedsAttentionDoesNotTakeFocusWhenEmpty(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.status.Apps = backend.status.Apps[:1]
	m = update(t, m, statusMsg{status: backend.status})
	m = update(t, m, doctorMsg{})

	m = drive(t, m, press("tab"))

	if bar := lastLine(screen(m)); !strings.Contains(bar, "↑/↓  select") || strings.Contains(bar, "resolve") {
		t.Fatalf("an empty Needs attention should not take focus: %q", bar)
	}
}

func TestNowStripMirrorsARunningAction(t *testing.T) {
	m, _ := sample(t, 120, 30)
	task := m.tasks.start("update jellyfin sonarr")
	t.Cleanup(m.tasks.cancelAll)
	for _, e := range []events.Event{
		{Event: events.RunStart, Msg: "update jellyfin sonarr"},
		{Event: events.StepStart, Step: "pull", Msg: "pull 2 images"},
		{Event: events.PullProgress, Image: "jellyfin:latest", Layer: "l1", Current: 50, Total: 100},
		{Event: events.PullProgress, Image: "sonarr:latest", Status: "Pulled"},
	} {
		task.append(e)
	}

	out := screen(m)

	for _, want := range []string{"update jellyfin sonarr", "█", "1 of 2 images", "Pulling 2 images"} {
		if !strings.Contains(out, want) {
			t.Errorf("the Now strip lacks %q\n%s", want, out)
		}
	}
	if strings.Contains(statusLine(out), "update jellyfin sonarr") {
		t.Errorf("on the Overview the Now strip, not the status line, shows the running Action: %q", statusLine(out))
	}
}

func TestNowStripShowsTheLastResultAndHostHealthWhenIdle(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.fail = errors.New("compose restart failed")

	m = drive(t, m, press("a"))
	m = drive(t, m, press("t"))
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("1"))

	out := screen(m)
	for _, want := range []string{"✗ restart jellyfin", "compose restart failed", "Host: 1 warning"} {
		if !strings.Contains(out, want) {
			t.Errorf("the idle Now strip lacks %q\n%s", want, out)
		}
	}
	if strings.Contains(statusLine(out), "restart jellyfin") {
		t.Errorf("the result belongs to the Now strip on the Overview: %q", statusLine(out))
	}
}

func TestOverviewStatusLineStillShowsOtherMessages(t *testing.T) {
	m, _ := sample(t, 120, 30)

	m = drive(t, m, flashMsg{text: "opened http://192.168.1.20:8096", level: levelOK})

	if !strings.Contains(statusLine(screen(m)), "opened http://192.168.1.20:8096") {
		t.Fatalf("other messages stay on the status line\n%s", screen(m))
	}
}

func TestHeaderShowsProjectLANHealthAndTime(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.status.Project = "/srv/homelab"
	m = update(t, m, statusMsg{status: backend.status})

	header := strings.Split(screen(m), "\n")[0]

	for _, want := range []string{"homelab", "LAN 192.168.1.20", "◐ 1 warning", "12:00:00"} {
		if !strings.Contains(header, want) {
			t.Errorf("the header lacks %q: %q", want, header)
		}
	}
}

func TestEightyColumnOverviewKeepsTheLANAddressAndTimeInTheNowStrip(t *testing.T) {
	m, _ := sample(t, 80, 24)

	out := screen(m)

	host := lineWith(t, out, "Host: 1 warning")
	for _, want := range []string{"LAN 192.168.1.20", "12:00:00"} {
		if !strings.Contains(host, want) {
			t.Errorf("the Now strip's host line should carry %q when the header has no room: %q", want, host)
		}
	}
	if header := strings.Split(out, "\n")[0]; strings.Contains(header, "LAN") || strings.Contains(header, "12:00:00") {
		t.Errorf("the header has no room for them at 80 columns: %q", header)
	}
}

func TestWideOverviewShowsTheLANAddressAndTimeOnlyInTheHeader(t *testing.T) {
	m, _ := sample(t, 140, 30)

	out := screen(m)

	if n := strings.Count(out, "LAN 192.168.1.20"); n != 1 {
		t.Errorf("the LAN address belongs to the header alone, shown %d times\n%s", n, out)
	}
	if n := strings.Count(out, "12:00:00"); n != 1 {
		t.Errorf("the time belongs to the header alone, shown %d times\n%s", n, out)
	}
}
