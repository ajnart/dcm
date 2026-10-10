package tui

import (
	"flag"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/service"
)

var updateGolden = flag.Bool("update", false, "rewrite golden files")

func TestGoldenTailscaleFlows(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		m, backend := freshHost(t)
		backend.catalog = withTailscale(backend.Catalog())
		m = atAccess(t, m)
		m.width, m.height = size.width, size.height
		for _, key := range []string{"down", "down", "enter"} {
			m = drive(t, m, press(key))
		}
		golden(t, "onboarding-tailscale-input"+size.suffix, trimLines(screen(m)))
		m, backend = sample(t, size.width, size.height)
		backend.catalog = withTailscale(backend.Catalog())
		for _, key := range []string{"5", "]", "down", "down", "enter"} {
			m = drive(t, m, press(key))
		}
		golden(t, "settings-tailscale-review"+size.suffix, trimLines(screen(m)))
		m = goldenModel(t, size.width, size.height)
		m.checks = []host.Check{{ID: "tailscale-key-expires", App: "tailscale", Title: "Tailscale", Level: host.Warn, Detail: "The Tailscale sign-in of Jellyfin runs out in 12 days.", Hint: "Open https://login.tailscale.com/admin/machines, find the App's name and choose Disable key expiry."}}
		golden(t, "overview-tailscale-expiry"+size.suffix, trimLines(screen(m)))
	}
}

func golden(t *testing.T, name, got string) {
	t.Helper()
	path := filepath.Join("testdata", name+".golden")
	if *updateGolden {
		os.MkdirAll("testdata", 0o755)
		os.WriteFile(path, []byte(got), 0o644)
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("missing golden %s (run go test -update): %v", path, err)
	}
	if string(want) != got {
		t.Fatalf("%s changed (run go test -update to accept):\n%s", name, got)
	}
}

func trimLines(s string) string {
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		lines[i] = strings.TrimRight(line, " ")
	}
	return strings.Join(lines, "\n")
}

// goldenCatalog is the wizard's Catalog with categories, plus Sonarr.
func goldenCatalog() *catalog.Catalog {
	return catalog.New([]app.App{
		stubApp{info: app.Info{ID: "homarr", Name: "Homarr", Category: "Dashboards", Description: "Dashboard", Image: "ghcr.io/homarr-labs/homarr:latest", Port: 7575}},
		stubApp{info: app.Info{ID: "ntfy", Name: "ntfy", Category: "Notifications", Description: "Notifications", Image: "binwiederhier/ntfy:latest", Port: 2586},
			links: []app.Link{{ID: "homarr-tile", Target: "homarr", Title: "show ntfy in Homarr"}}},
		stubApp{info: app.Info{ID: "jellyfin", Name: "Jellyfin", Category: "Media", Description: "Media server", Image: "lscr.io/linuxserver/jellyfin:latest", Port: 8096, UsesMedia: true}},
		stubApp{info: app.Info{ID: "sonarr", Name: "Sonarr", Category: "Downloads", Description: "TV series", Image: "lscr.io/linuxserver/sonarr:latest", Port: 8989}},
	}, []catalog.Recipe{{ID: "media", Name: "Media", Description: "Watch your movies", Apps: []string{"jellyfin"}}})
}

// goldenModel is the sample Project with a Catalog, containers, a known
// update and a Host review that has drifted, so every tab has content.
func goldenModel(t *testing.T, width, height int) Model {
	t.Helper()
	return goldenModelWith(t, width, height, service.ExposureLAN)
}

// goldenModelWith is goldenModel on a Project whose stored Exposure is the one given.
func goldenModelWith(t *testing.T, width, height int, exposure string) Model {
	t.Helper()
	m, backend := sample(t, width, height)
	backend.status.Exposure = exposure
	m = drive(t, m, statusMsg{status: backend.status})
	backend.catalog = goldenCatalog()
	backend.containers = []service.ContainerStatus{
		{App: "jellyfin", Service: "jellyfin", Image: "lscr.io/linuxserver/jellyfin:latest", State: "running", Health: "healthy", Status: "Up 2 hours", Ports: []string{"0.0.0.0:8096→8096"}},
		{App: "sonarr", Service: "sonarr", State: "running", Status: "Up 2 hours", Ports: []string{"0.0.0.0:8989→8989"}},
		{App: "whoami", Service: "whoami", State: "exited", Status: "Exited (0) 1 hour ago"},
	}
	backend.usage = []service.ContainerUsage{
		{Service: "jellyfin", CPU: 0.18, Mem: 0.31, MemBytes: 2540 << 20},
		{Service: "sonarr", CPU: 0.02, Mem: 0.06, MemBytes: 480 << 20},
	}
	backend.updates = map[string]string{"jellyfin": "available"}
	backend.tools = map[string]string{"ctop": "/usr/local/bin/ctop"}
	backend.review = []service.SettingReview{
		{Key: "EXPOSURE", Current: exposure, Choices: []string{"lan", "local"}},
		{Key: "LAN_IP", Current: "192.168.1.20", Detected: "192.168.0.12", Choices: []string{"192.168.1.20", "192.168.0.12"}, Drift: true, Note: "not an address of this machine any more"},
		{Key: "TZ", Current: "Europe/Paris", Detected: "Europe/Paris"},
		{Key: "PUID", Current: "1000", Detected: "1001", Drift: true},
		{Key: "PGID", Current: "1000", Detected: "1000"},
		{Key: "UMASK", Current: "022"},
		{Key: "MEDIA_ROOT", Current: "/home/alice/media"},
		{Key: "DOWNLOADS_ROOT", Current: "/home/alice/downloads"},
	}
	return m
}

func TestGoldenTabs(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		for i, name := range []string{"overview", "apps", "activity", "catalog", "settings"} {
			t.Run(name+size.suffix, func(t *testing.T) {
				m := goldenModel(t, size.width, size.height)
				if name == "overview" && size.suffix == "" {
					m = drive(t, m, press("j"))
				}

				m = drive(t, m, press(strconv.Itoa(i+1)))

				golden(t, "tab-"+name+size.suffix, trimLines(screen(m)))
			})
		}
	}
}

// TestGoldenSettingsSubTabs is the Settings sub-tabs after Host, Access and
// Appearance: Backups, Tools and About.
func TestGoldenSettingsSubTabs(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		for i, name := range []string{"backups", "tools", "about"} {
			t.Run(name+size.suffix, func(t *testing.T) {
				m := goldenModel(t, size.width, size.height)
				m = drive(t, m, press("5"))
				m.settings.goos = "darwin"

				for range i + 3 {
					m = drive(t, m, press("]"))
				}

				golden(t, "settings-"+name+size.suffix, trimLines(screen(m)))
			})
		}
	}
}

// TestGoldenSettingsAccess is Settings' Access sub-tab on each option, with
// its help page, the note for an option not built yet, and the Access in use
// being this computer only, alone and with Home network pending.
func TestGoldenSettingsAccess(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		for i, id := range []string{"home", "names", "tailscale", "cloudflare", "custom"} {
			name := "settings-access-" + id
			t.Run(id+size.suffix, func(t *testing.T) {
				m := goldenModel(t, size.width, size.height)
				m = drive(t, m, press("5"))
				m = drive(t, m, press("]"))
				for range i {
					m = drive(t, m, press("down"))
				}

				golden(t, name+size.suffix, trimLines(screen(m)))
				golden(t, name+"-help"+size.suffix, trimLines(screen(drive(t, m, press("?")))))
				if id == "custom" {
					golden(t, "settings-access-coming-soon-note"+size.suffix, trimLines(screen(drive(t, m, press("enter")))))
				}
			})
		}
		t.Run("local"+size.suffix, func(t *testing.T) {
			m := goldenModelWith(t, size.width, size.height, service.ExposureLocal)
			m = drive(t, m, press("5"))
			golden(t, "settings-access-local"+size.suffix, trimLines(screen(drive(t, m, press("]")))))

			m = goldenModelWith(t, size.width, size.height, service.ExposureLocal)
			m = drive(t, m, press("5"))
			golden(t, "settings-access-pending"+size.suffix, trimLines(screen(drive(t, pickHomeNetwork(t, m), press("]")))))
		})
	}
}

func TestGoldenActionMenus(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		for _, tc := range []struct{ name, key string }{{"menu-app", "a"}, {"menu-project", "A"}} {
			t.Run(tc.name+size.suffix, func(t *testing.T) {
				m := goldenModel(t, size.width, size.height)

				m = drive(t, m, press(tc.key))

				golden(t, tc.name+size.suffix, trimLines(screen(m)))
			})
		}
	}
}

func TestGoldenAppsContainers(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		t.Run("containers"+size.suffix, func(t *testing.T) {
			m := goldenModel(t, size.width, size.height)
			m = drive(t, m, press("2"))

			m = drive(t, m, press("[")) // logs → containers

			golden(t, "tab-apps-containers"+size.suffix, trimLines(screen(m)))
		})
	}
}

// TestGoldenOverview is the Overview idle after an Action, with its result
// in the Now strip, and while an Action pulls images.
func TestGoldenOverview(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		t.Run("idle"+size.suffix, func(t *testing.T) {
			m := goldenModel(t, size.width, size.height)
			m = drive(t, m, press("a"))
			m = drive(t, m, press("t"))
			m = drive(t, m, press("enter"))

			m = drive(t, m, press("1"))

			golden(t, "overview-idle"+size.suffix, trimLines(screen(m)))
		})
		t.Run("running"+size.suffix, func(t *testing.T) {
			m := goldenModel(t, size.width, size.height)
			task := m.tasks.start("update jellyfin sonarr")
			t.Cleanup(m.tasks.cancelAll)
			for _, e := range []events.Event{
				{Event: events.RunStart, Msg: "update jellyfin sonarr"},
				{Event: events.StepStart, Step: "pull", Msg: "pull 2 images"},
				{Event: events.PullProgress, Image: "lscr.io/linuxserver/jellyfin:latest", Layer: "l1", Current: 120, Total: 200},
				{Event: events.PullProgress, Image: "lscr.io/linuxserver/sonarr:latest", Status: "Pulled"},
			} {
				task.append(e)
			}

			golden(t, "overview-running"+size.suffix, trimLines(screen(m)))
		})
	}
}
