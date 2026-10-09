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
	"github.com/ajnart/self-host/internal/service"
)

var updateGolden = flag.Bool("update", false, "rewrite golden files")

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

// categoryCatalog gives the sample Apps their categories; whoami is not in
// it, so it gets the fallback icon.
func categoryCatalog() *catalog.Catalog {
	return catalog.New([]app.App{
		stubApp{info: app.Info{ID: "homarr", Name: "Homarr", Category: "Dashboard", Description: "Dashboard", Image: "ghcr.io/homarr-labs/homarr:latest", Port: 7575}},
		stubApp{info: app.Info{ID: "jellyfin", Name: "Jellyfin", Category: "Media", Description: "Media server", Image: "lscr.io/linuxserver/jellyfin:latest", Port: 8096}},
		stubApp{info: app.Info{ID: "ntfy", Name: "ntfy", Category: "Communication", Description: "Notifications", Image: "binwiederhier/ntfy:latest", Port: 2586}},
		stubApp{info: app.Info{ID: "sonarr", Name: "Sonarr", Category: "Requests", Description: "TV shows", Image: "lscr.io/linuxserver/sonarr:latest", Port: 8989}},
	}, []catalog.Recipe{{ID: "media", Name: "Media", Description: "Watch your movies", Apps: []string{"jellyfin"}}})
}

// goldenModel is the sample Project with a Catalog, containers, a known
// update and a Host review that has drifted, so every tab has content.
func goldenModel(t *testing.T, width, height int) Model {
	t.Helper()
	m, backend := sample(t, width, height)
	backend.catalog = categoryCatalog()
	backend.containers = []service.ContainerStatus{
		{App: "jellyfin", Service: "jellyfin", Image: "lscr.io/linuxserver/jellyfin:latest", State: "running", Health: "healthy", Status: "Up 2 hours", Ports: []string{"0.0.0.0:8096→8096"}},
		{App: "sonarr", Service: "sonarr", State: "running", Status: "Up 2 hours", Ports: []string{"0.0.0.0:8989→8989"}},
		{App: "whoami", Service: "whoami", State: "exited", Status: "Exited (0) 1 hour ago"},
	}
	backend.updates = map[string]string{"jellyfin": "available"}
	backend.review = []service.SettingReview{
		{Key: "EXPOSURE", Current: "lan", Choices: []string{"lan", "local"}},
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
					m = drive(t, m, press("]"))
				}

				m = drive(t, m, press(strconv.Itoa(i+1)))

				golden(t, "tab-"+name+size.suffix, trimLines(screen(m)))
			})
		}
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
	m := goldenModel(t, 120, 30)
	m = drive(t, m, press("2"))

	m = drive(t, m, press("[")) // logs → containers

	golden(t, "tab-apps-containers", trimLines(screen(m)))
}
