package cli_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

const whoamiCompose = "services:\n  whoami:\n    image: traefik/whoami\n    ports:\n      - ${BIND_IP}:8099:80\n"

func TestUnmanagedAppInExtraIsDiscoveredAndControlled(t *testing.T) {
	deps, cat := installed(t, "one")
	root := projectRoot(t, deps)
	os.MkdirAll(filepath.Join(root, "extra", "whoami"), 0o755)
	os.WriteFile(filepath.Join(root, "extra", "whoami", "compose.yml"), []byte(whoamiCompose), 0o644)

	code, out := runWith(t, deps, cat, "start", "whoami")

	if code != 0 || lastCompose(deps) != "up -d --remove-orphans whoami" {
		t.Fatalf("start: %d %q\n%s", code, lastCompose(deps), out)
	}
	if !strings.Contains(readFile(t, filepath.Join(root, "compose.yml")), "  - extra/whoami/compose.yml\n") {
		t.Fatal("root compose does not include extra/whoami/compose.yml")
	}
	if code, _ := runWith(t, deps, cat, "stop", "whoami"); code != 0 || lastCompose(deps) != "stop whoami" {
		t.Fatalf("stop: %q", lastCompose(deps))
	}
	if code, _ := runWith(t, deps, cat, "update", "whoami"); code != 0 {
		t.Fatalf("update: %d", code)
	}
	_, statusOut := runWith(t, deps, cat, "status", "--json")
	var status struct {
		Apps []struct {
			ID      string
			Setup   stepstatus.Setup
			Managed bool
		}
	}
	json.Unmarshal([]byte(statusOut), &status)
	if len(status.Apps) != 2 || status.Apps[1].ID != "whoami" || status.Apps[1].Setup != "unmanaged" || status.Apps[1].Managed {
		t.Fatalf("extra app not listed: %+v", status.Apps)
	}
	if code, out := runWith(t, deps, cat, "setup", "whoami"); code != 1 || !strings.Contains(out, "not a catalog App") {
		t.Fatalf("setup on an Unmanaged app should refuse: %d\n%s", code, out)
	}
}

func extraBackupProject(t *testing.T) (*system.Deps, *catalog.Catalog, string) {
	t.Helper()
	deps, cat := installed(t, "one")
	root := projectRoot(t, deps)
	os.MkdirAll(filepath.Join(root, "extra", "whoami", "data"), 0o755)
	os.WriteFile(filepath.Join(root, "extra", "whoami", "compose.yml"), []byte(whoamiCompose), 0o644)
	os.WriteFile(filepath.Join(root, "extra", "whoami", "data", "db.sqlite"), []byte("whoami-v1"), 0o644)
	deps.Runner.(*systemtest.Runner).OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " ps ") {
			return system.Result{Stdout: []byte(`{"Service":"one","State":"running"}` + "\n" + `{"Service":"whoami","State":"running"}` + "\n")}
		}
		return system.Result{}
	})
	return deps, cat, root
}

func TestBackupIncludesTheExtraAppFolder(t *testing.T) {
	deps, cat, _ := extraBackupProject(t)
	out := filepath.Join(t.TempDir(), "backup.tar.zst")

	r := clitest.Run(t, deps, cat, "backup", "whoami", "-o", out, "--json")

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	files, manifest := archiveEntries(t, out)
	if got := manifestApps(manifest); len(got) != 1 || got[0] != "whoami" {
		t.Fatalf("manifest apps %v", got)
	}
	if files["extra/whoami/data/db.sqlite"] != "whoami-v1" || files["extra/whoami/compose.yml"] != whoamiCompose {
		t.Fatalf("archive misses the folder: %v", keys(files))
	}
}

func TestRestoreExtraAppPutsItBackInExtra(t *testing.T) {
	deps, cat, root := extraBackupProject(t)
	out := filepath.Join(t.TempDir(), "backup.tar.zst")
	clitest.Run(t, deps, cat, "backup", "-o", out)
	os.WriteFile(filepath.Join(root, "extra", "whoami", "data", "db.sqlite"), []byte("whoami-v2"), 0o644)

	r := clitest.Run(t, deps, cat, "restore", out, "whoami", "--yes", "--json")

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	if got := readFile(t, filepath.Join(root, "extra", "whoami", "data", "db.sqlite")); got != "whoami-v1" {
		t.Fatalf("not restored: %q", got)
	}
	if _, err := os.Stat(filepath.Join(root, "apps", "whoami")); err == nil {
		t.Fatal("restored into apps/")
	}
}

func TestRestoreEverythingRebuildsExtraApps(t *testing.T) {
	deps, cat, root := extraBackupProject(t)
	out := filepath.Join(t.TempDir(), "backup.tar.zst")
	clitest.Run(t, deps, cat, "backup", "-o", out)
	os.RemoveAll(root)

	r := clitest.Run(t, deps, cat, "restore", out, "--yes")

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	if got := readFile(t, filepath.Join(root, "extra", "whoami", "data", "db.sqlite")); got != "whoami-v1" {
		t.Fatalf("not restored: %q", got)
	}
	if !strings.Contains(readFile(t, filepath.Join(root, "compose.yml")), "  - extra/whoami/compose.yml\n") {
		t.Fatal("root compose does not include the restored extra app")
	}
}

func TestRemoveExtraAppKeepsItsDataUnlessPurged(t *testing.T) {
	deps, cat, root := extraBackupProject(t)
	data := filepath.Join(root, "extra", "whoami", "data", "db.sqlite")

	code, out := runWith(t, deps, cat, "remove", "whoami", "--yes")

	if code != 0 || !strings.Contains(out, filepath.Join(root, "extra", "whoami")) {
		t.Fatalf("remove: %d\n%s", code, out)
	}
	if _, err := os.Stat(data); err != nil {
		t.Fatal("data deleted without --purge")
	}
	os.WriteFile(filepath.Join(root, "extra", "whoami", "compose.yml"), []byte(whoamiCompose), 0o644)

	if code, out := runWith(t, deps, cat, "remove", "whoami", "--yes", "--purge"); code != 0 {
		t.Fatalf("purge: %d\n%s", code, out)
	}
	if _, err := os.Stat(filepath.Join(root, "extra", "whoami")); err == nil {
		t.Fatal("extra/whoami survived --purge")
	}
}
