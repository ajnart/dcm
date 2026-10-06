package tui

import (
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
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
