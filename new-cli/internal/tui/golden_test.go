package tui

import (
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"

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

func TestGoldenDashboard(t *testing.T) {
	m, _ := sample(t, 120, 30)
	m = drive(t, m, press("j"))
	m = drive(t, m, press("tab"))

	golden(t, "dashboard", trimLines(screen(m)))
}

func TestGoldenNarrowDashboard(t *testing.T) {
	m, _ := sample(t, 80, 24)

	golden(t, "dashboard-narrow", trimLines(screen(m)))
}

func TestGoldenInstall(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.catalog = wizardCatalog()

	m = drive(t, m, press("i"))

	golden(t, "install", trimLines(screen(m)))
}

func TestGoldenSettings(t *testing.T) {
	m, backend := sample(t, 120, 30)
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

	m = drive(t, m, press("s"))

	golden(t, "settings", trimLines(screen(m)))
}

func TestGoldenStack(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.containers = []service.ContainerStatus{
		{App: "jellyfin", Service: "jellyfin", Image: "lscr.io/linuxserver/jellyfin:latest", State: "running", Health: "healthy", Status: "Up 2 hours", Ports: []string{"0.0.0.0:8096→8096"}},
		{App: "sonarr", Service: "sonarr", State: "running", Status: "Up 2 hours", Ports: []string{"0.0.0.0:8989→8989"}},
		{App: "whoami", Service: "whoami", State: "exited", Status: "Exited (0) 1 hour ago"},
	}
	backend.updates = map[string]string{"jellyfin": "available"}

	m = drive(t, m, press("d"))

	golden(t, "stack", trimLines(screen(m)))
}
