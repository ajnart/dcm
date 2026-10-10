package cli_test

import (
	"archive/tar"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/klauspost/compress/zstd"

	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

// archiveEntries lists the files and the manifest of an unencrypted backup.
func archiveEntries(t *testing.T, path string) (map[string]string, map[string]any) {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zr, err := zstd.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	files := map[string]string{}
	var manifest map[string]any
	tr := tar.NewReader(zr)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		data, _ := io.ReadAll(tr)
		files[h.Name] = string(data)
		if h.Name == "manifest.json" {
			json.Unmarshal(data, &manifest)
		}
	}
	return files, manifest
}

func manifestApps(manifest map[string]any) []string {
	var ids []string
	for _, a := range manifest["apps"].([]any) {
		ids = append(ids, a.(map[string]any)["id"].(string))
	}
	return ids
}

func backupProject(t *testing.T) (*system.Deps, string) {
	t.Helper()
	deps, _ := installed(t, "one", "two")
	root := projectRoot(t, deps)
	os.WriteFile(filepath.Join(root, "apps", "one", "db.sqlite"), []byte("one-v1"), 0o644)
	os.WriteFile(filepath.Join(root, "apps", "two", "db.sqlite"), []byte("two-v1"), 0o644)
	deps.Runner.(*systemtest.Runner).OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " ps ") {
			return system.Result{Stdout: []byte(`{"Service":"one","State":"running"}` + "\n" + `{"Service":"two","State":"running"}` + "\n")}
		}
		return system.Result{}
	})
	return deps, root
}

func TestBackupArchivesEveryAppWithSecretsAndManifest(t *testing.T) {
	deps, root := backupProject(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	out := filepath.Join(t.TempDir(), "backup.tar.zst")

	r := clitest.Run(t, deps, cat, "backup", "-o", out, "--json")

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	files, manifest := archiveEntries(t, out)
	if got := manifestApps(manifest); len(got) != 2 {
		t.Fatalf("manifest apps %v", got)
	}
	if files["apps/one/db.sqlite"] != "one-v1" || !strings.Contains(files["secrets.env"], "ADMIN_PASSWORD=") || files["state.json"] == "" {
		t.Fatalf("archive misses data or secrets: %v", keys(files))
	}
	if r.StepEvent("", "unencrypted") != "step.warn" {
		t.Fatalf("no warning about unencrypted secrets:\n%s", r.Out)
	}
	var order []string
	for _, e := range r.Events {
		if e["app"] == "one" && strings.HasPrefix(e["event"].(string), "step.") && e["event"] != "step.start" {
			order = append(order, e["step"].(string))
		}
	}
	if strings.Join(order, ",") != "stop,archive,start" {
		t.Fatalf("one: order %v", order)
	}
	_ = root
}

func keys(m map[string]string) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestBackupOfOneAppListsOnlyThatApp(t *testing.T) {
	deps, _ := backupProject(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	out := filepath.Join(t.TempDir(), "one.tar.zst")

	clitest.Run(t, deps, cat, "backup", "one", "-o", out)

	files, manifest := archiveEntries(t, out)
	if got := manifestApps(manifest); len(got) != 1 || got[0] != "one" {
		t.Fatalf("manifest apps %v", got)
	}
	if _, found := files["apps/two/db.sqlite"]; found {
		t.Fatal("two archived")
	}
}

func TestRestoreOneAppLeavesOthersUntouched(t *testing.T) {
	deps, root := backupProject(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	out := filepath.Join(t.TempDir(), "backup.tar.zst")
	clitest.Run(t, deps, cat, "backup", "-o", out)
	os.WriteFile(filepath.Join(root, "apps", "one", "db.sqlite"), []byte("one-v2"), 0o644)
	os.WriteFile(filepath.Join(root, "apps", "two", "db.sqlite"), []byte("two-v2"), 0o644)

	r := clitest.Run(t, deps, cat, "restore", out, "one", "--yes", "--json")

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	if got := readFile(t, filepath.Join(root, "apps", "one", "db.sqlite")); got != "one-v1" {
		t.Fatalf("one not restored: %q", got)
	}
	if got := readFile(t, filepath.Join(root, "apps", "two", "db.sqlite")); got != "two-v2" {
		t.Fatalf("two touched: %q", got)
	}
}

func TestRestoreEverythingRebuildsTheProject(t *testing.T) {
	deps, root := backupProject(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	out := filepath.Join(t.TempDir(), "backup.tar.zst")
	clitest.Run(t, deps, cat, "backup", "-o", out)
	secrets := readFile(t, filepath.Join(root, "secrets.env"))
	os.RemoveAll(root)

	r := clitest.Run(t, deps, cat, "restore", out, "--yes")

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	if readFile(t, filepath.Join(root, "secrets.env")) != secrets {
		t.Fatal("secrets not restored")
	}
	if !strings.Contains(readFile(t, filepath.Join(root, "compose.yml")), "apps/two/compose.yml") {
		t.Fatal("root compose not rebuilt")
	}
	status := clitest.Run(t, deps, cat, "status", "--json")
	if !strings.Contains(status.Out, `"setup": "ok"`) {
		t.Fatalf("state not restored:\n%s", status.Out)
	}
}

func TestEncryptedBackupNeedsThePassphrase(t *testing.T) {
	deps, root := backupProject(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	out := filepath.Join(t.TempDir(), "backup.tar.zst.age")
	systemtest.SetEnv(deps, map[string]string{"SELF_HOST_BACKUP_PASSPHRASE": "correct horse"})

	r := clitest.Run(t, deps, cat, "backup", "one", "-o", out, "--encrypt", "--json")
	if r.Code != 0 || r.StepEvent("", "unencrypted") != "" {
		t.Fatalf("encrypted backup: %d\n%s", r.Code, r.Out)
	}
	data, _ := os.ReadFile(out)
	if !bytes.HasPrefix(data, []byte("age-encryption.org/v1")) || bytes.Contains(data, []byte("ADMIN_PASSWORD")) {
		t.Fatal("archive not encrypted")
	}

	systemtest.SetEnv(deps, map[string]string{"SELF_HOST_BACKUP_PASSPHRASE": "wrong"})
	if r := clitest.Run(t, deps, cat, "restore", out, "--yes"); r.Code != 1 || !strings.Contains(r.Out, "passphrase") {
		t.Fatalf("wrong passphrase: %d\n%s", r.Code, r.Out)
	}
	systemtest.SetEnv(deps, map[string]string{})
	if r := clitest.Run(t, deps, cat, "restore", out, "--yes"); r.Code != 1 || !strings.Contains(r.Out, "SELF_HOST_BACKUP_PASSPHRASE") {
		t.Fatalf("missing passphrase: %d\n%s", r.Code, r.Out)
	}

	os.WriteFile(filepath.Join(root, "apps", "one", "db.sqlite"), []byte("one-v2"), 0o644)
	systemtest.SetEnv(deps, map[string]string{"SELF_HOST_BACKUP_PASSPHRASE": "correct horse"})
	if r := clitest.Run(t, deps, cat, "restore", out, "--yes"); r.Code != 0 {
		t.Fatalf("restore: %d\n%s", r.Code, r.Out)
	}
	if got := readFile(t, filepath.Join(root, "apps", "one", "db.sqlite")); got != "one-v1" {
		t.Fatalf("not restored: %q", got)
	}
}

func TestRestoreRejectsPathsEscapingTheProject(t *testing.T) {
	deps, _ := backupProject(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	evil := filepath.Join(t.TempDir(), "evil.tar.zst")
	f, _ := os.Create(evil)
	zw, _ := zstd.NewWriter(f)
	tw := tar.NewWriter(zw)
	manifest := []byte(`{"version":1,"apps":[{"id":"one"}]}`)
	tw.WriteHeader(&tar.Header{Name: "manifest.json", Mode: 0o644, Size: int64(len(manifest))})
	tw.Write(manifest)
	tw.WriteHeader(&tar.Header{Name: "apps/one/../../../escape.txt", Mode: 0o644, Size: 1})
	tw.Write([]byte("x"))
	tw.Close()
	zw.Close()
	f.Close()

	r := clitest.Run(t, deps, cat, "restore", evil, "--yes")

	if r.Code != 1 || !strings.Contains(r.Out, "unsafe path") {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
}
