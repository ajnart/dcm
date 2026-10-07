package cli_test

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/backup"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type rootlessArchiveRunner struct {
	system.Runner
	t              *testing.T
	root           string
	tar            []byte
	commands       []system.Cmd
	metadata       []string
	cancel         context.CancelFunc
	archiveError   error
	helperCleanup  bool
	cleanupBounded bool
}

func (r *rootlessArchiveRunner) Run(ctx context.Context, cmd system.Cmd) (system.Result, error) {
	if strings.HasPrefix(systemtest.Line(cmd), "docker rm --force selfhost-backup-") {
		r.helperCleanup = true
		_, r.cleanupBounded = ctx.Deadline()
		if err := ctx.Err(); err != nil {
			return system.Result{}, err
		}
	}
	return r.Runner.Run(ctx, cmd)
}

func (r *rootlessArchiveRunner) StreamIO(ctx context.Context, cmd system.Cmd, stdin io.Reader, stdout, stderr io.Writer) error {
	r.commands = append(r.commands, cmd)
	if !strings.Contains(systemtest.Line(cmd), "--network none") || !strings.Contains(systemtest.Line(cmd), "--read-only") {
		r.t.Fatal("archive helper lacks network/rootfs restrictions")
	}
	script, err := io.ReadAll(stdin)
	if err != nil {
		return err
	}
	if strings.Contains(string(script), "chown -h") {
		r.metadata = append(r.metadata, string(script))
		return nil
	}
	if strings.Contains(string(script), "rm -rf") {
		for i, arg := range cmd.Args {
			if arg != "--mount" {
				continue
			}
			fields, err := csv.NewReader(strings.NewReader(cmd.Args[i+1])).Read()
			if err != nil {
				return err
			}
			for _, field := range fields {
				if !strings.HasPrefix(field, "src=") {
					continue
				}
				dir := strings.TrimPrefix(field, "src=")
				entries, err := os.ReadDir(dir)
				if err != nil {
					return err
				}
				for _, entry := range entries {
					if err := os.RemoveAll(filepath.Join(dir, entry.Name())); err != nil {
						return err
					}
				}
			}
		}
		return nil
	}
	if r.cancel != nil {
		r.cancel()
		return ctx.Err()
	}
	if r.archiveError != nil {
		return r.archiveError
	}
	if _, err := io.WriteString(stderr, "helper diagnostic, not archive data\n"); err != nil {
		return err
	}
	_, err = stdout.Write(r.tar)
	return err
}

func TestRootlessBackupHelperCancellationCleansUpAndRestartsApp(t *testing.T) {
	deps, root := backupProject(t)
	base := deps.Runner.(*systemtest.Runner)
	base.On("docker info", system.Result{Stdout: []byte(`["name=rootless"]`)})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runner := &rootlessArchiveRunner{Runner: base, t: t, root: root, cancel: cancel}
	deps.Runner = runner
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	out := filepath.Join(t.TempDir(), "cancelled.tar.zst")
	_, err := service.New(deps, events.Discard(), cat).Backup(ctx, []string{"one"}, out, "")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("backup error = %v", err)
	}
	if !runner.helperCleanup || !runner.cleanupBounded {
		t.Fatal("helper cancellation did not perform bounded cleanup")
	}
	var restarted bool
	for _, cmd := range base.Calls() {
		if strings.Contains(cmd, " start one") {
			restarted = true
		}
		if strings.HasPrefix(cmd, "docker rm --force") && !strings.HasPrefix(cmd, "docker rm --force selfhost-backup-") {
			t.Fatal("cleanup exceeded its owned helper")
		}
	}
	if !restarted {
		t.Fatal("helper cancellation left App stopped")
	}
	if _, err := os.Stat(out); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("cancelled backup published archive")
	}
}

func TestRootlessBackupHelperFailureReportsCleanupFailure(t *testing.T) {
	deps, root := backupProject(t)
	base := deps.Runner.(*systemtest.Runner)
	base.On("docker info", system.Result{Stdout: []byte(`["name=rootless"]`)})
	base.On("docker rm --force", system.Result{ExitCode: 1, Stderr: []byte("helper removal refused")})
	runner := &rootlessArchiveRunner{Runner: base, t: t, root: root, archiveError: errors.New("tar read failed")}
	deps.Runner = runner
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	r := clitest.Run(t, deps, cat, "backup", "one", "-o", filepath.Join(t.TempDir(), "failed.tar.zst"))
	if r.Code == 0 || !strings.Contains(r.Out, "tar read failed") || !strings.Contains(r.Out, "helper removal refused") || !strings.Contains(r.Out, "docker rm --force selfhost-backup-") {
		t.Fatalf("missing failure/recovery diagnostics: %s", r.Out)
	}
}

func TestRootlessBackupRejectsSymlinkedAppDirectoryAncestry(t *testing.T) {
	deps, root := backupProject(t)
	base := deps.Runner.(*systemtest.Runner)
	base.On("docker info", system.Result{Stdout: []byte(`["name=rootless"]`)})
	outside := filepath.Join(t.TempDir(), "external-apps")
	if err := os.Rename(filepath.Join(root, "apps"), outside); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "apps")); err != nil {
		t.Fatal(err)
	}
	runner := &rootlessArchiveRunner{Runner: base, t: t, root: root}
	deps.Runner = runner
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	r := clitest.Run(t, deps, cat, "backup", "one", "-o", filepath.Join(t.TempDir(), "outside.tar.zst"))
	if r.Code == 0 || len(runner.commands) != 0 {
		t.Fatalf("helper followed an unowned directory ancestor: %s", r.Out)
	}
	if readFile(t, filepath.Join(outside, "one", "db.sqlite")) != "one-v1" {
		t.Fatal("external data changed")
	}
}

func TestNamespaceRestoreRejectsUnsafeManifestBeforeCleanup(t *testing.T) {
	deps, root := backupProject(t)
	base := deps.Runner.(*systemtest.Runner)
	base.On("docker info", system.Result{Stdout: []byte(`["name=rootless"]`)})
	sentinel := filepath.Join(root, "project-sentinel")
	if err := os.WriteFile(sentinel, []byte("keep-project"), 0o600); err != nil {
		t.Fatal(err)
	}
	outsideSentinel := filepath.Join(t.TempDir(), "outside-sentinel")
	if err := os.WriteFile(outsideSentinel, []byte("keep-outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), "unsafe.tar.zst")
	f, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	w, err := backup.Create(f, "", backup.Manifest{Version: 1, Apps: []backup.ManifestApp{{ID: "../..", OwnershipNamespace: backup.OwnershipDocker}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := w.AddBytes("apps/../../rejected", []byte("bad"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	runner := &rootlessArchiveRunner{Runner: base, t: t, root: root}
	deps.Runner = runner
	before := len(base.Calls())
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	r := clitest.Run(t, deps, cat, "restore", archive, "--yes")
	if r.Code == 0 {
		t.Fatal("unsafe manifest accepted")
	}
	if len(runner.commands) > 0 || len(base.Calls()) > before {
		t.Fatal("unsafe manifest reached helper preparation or cleanup")
	}
	if readFile(t, outsideSentinel) != "keep-outside" || readFile(t, sentinel) != "keep-project" || readFile(t, filepath.Join(root, "apps", "one", "db.sqlite")) != "one-v1" {
		t.Fatal("unsafe manifest changed Project data")
	}
}

func TestNamespaceRestoreAppliesScopedDatabaseMetadata(t *testing.T) {
	deps, root := backupProject(t)
	base := deps.Runner.(*systemtest.Runner)
	base.On("docker info", system.Result{Stdout: []byte(`["name=rootless"]`)})
	out := filepath.Join(t.TempDir(), "namespace.tar.zst")
	f, err := os.Create(out)
	if err != nil {
		t.Fatal(err)
	}
	w, err := backup.Create(f, "", backup.Manifest{Version: 1, Apps: []backup.ManifestApp{{ID: "one", OwnershipNamespace: backup.OwnershipDocker}}})
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{".env", "secrets.env", "state.json"} {
		if err := w.AddBytes(name, []byte(readFile(t, filepath.Join(root, name))), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	var source bytes.Buffer
	tw := tar.NewWriter(&source)
	compose := readFile(t, filepath.Join(root, "apps", "one", "compose.yml"))
	for _, file := range []struct {
		header tar.Header
		data   string
	}{
		{header: tar.Header{Name: ".", Typeflag: tar.TypeDir, Mode: 0o755}},
		{header: tar.Header{Name: "compose.yml", Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(compose))}, data: compose},
		{header: tar.Header{Name: "database", Typeflag: tar.TypeDir, Mode: 0o700, Uid: 999, Gid: 999}},
		{header: tar.Header{Name: "database/row", Typeflag: tar.TypeReg, Mode: 0o600, Uid: 999, Gid: 999, Size: 7}, data: "pg-row" + "!"},
	} {
		if err := tw.WriteHeader(&file.header); err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(tw, file.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := w.AddTar(&source, "apps/one"); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	runner := &rootlessArchiveRunner{Runner: base, t: t, root: root}
	deps.Runner = runner
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	r := clitest.Run(t, deps, cat, "restore", out, "--yes")
	if r.Code != 0 {
		t.Fatal(r.Out)
	}
	if len(runner.metadata) != 1 || !strings.Contains(runner.metadata[0], "999:999") || !strings.Contains(runner.metadata[0], "chmod 700") {
		t.Fatal("restore did not apply database ownership and modes inside Docker")
	}
	if readFile(t, filepath.Join(root, "apps", "one", "database", "row")) != "pg-row!" {
		t.Fatal("restored database payload changed")
	}
	for _, cmd := range runner.commands {
		if strings.Contains(systemtest.Line(cmd), filepath.Join(root, "apps", "two")) || strings.Contains(systemtest.Line(cmd), "docker.sock") {
			t.Fatal("metadata helper exceeded selected App")
		}
	}
}

func TestRootlessBackupUsesScopedNamespaceArchive(t *testing.T) {
	deps, root := backupProject(t)
	base := deps.Runner.(*systemtest.Runner)
	base.On("docker info", system.Result{Stdout: []byte(`["name=rootless"]`)})
	var source bytes.Buffer
	tw := tar.NewWriter(&source)
	for _, h := range []*tar.Header{
		{Name: ".", Typeflag: tar.TypeDir, Mode: 0o755},
		{Name: "database", Typeflag: tar.TypeDir, Mode: 0o700, Uid: 999, Gid: 999},
		{Name: "database/row", Typeflag: tar.TypeReg, Mode: 0o600, Uid: 999, Gid: 999, Size: int64(len("database-row"))},
	} {
		if err := tw.WriteHeader(h); err != nil {
			t.Fatal(err)
		}
		if h.Size > 0 {
			if _, err := tw.Write([]byte("database-row")); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	runner := &rootlessArchiveRunner{Runner: base, t: t, root: root, tar: source.Bytes()}
	deps.Runner = runner
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	out := filepath.Join(t.TempDir(), "rootless.tar.zst")
	r := clitest.Run(t, deps, cat, "backup", "one", "-o", out)
	if r.Code != 0 {
		t.Fatal(r.Out)
	}
	files, manifest := archiveEntries(t, out)
	if files["apps/one/database/row"] != "database-row" {
		t.Fatal("backup did not read the namespace archive")
	}
	app := manifest["apps"].([]any)[0].(map[string]any)
	if app["ownership_namespace"] != "docker" {
		t.Fatal("backup lost its ownership namespace")
	}
	if len(runner.commands) != 1 {
		t.Fatalf("helper commands = %d", len(runner.commands))
	}
	cmd := systemtest.Line(runner.commands[0])
	if !strings.Contains(cmd, "src="+filepath.Join(root, "apps", "one")+",") || strings.Contains(cmd, filepath.Join(root, "apps", "two")) || strings.Contains(cmd, "docker.sock") {
		t.Fatalf("helper mount exceeded selected App: %s", cmd)
	}
	var pulled bool
	for _, call := range base.Calls() {
		if strings.HasPrefix(call, "docker pull ") || strings.HasPrefix(call, "docker image inspect ") {
			pulled = true
		}
		if strings.Contains(call, " stop one") && !pulled {
			t.Fatal("helper image resolved after stopping App")
		}
	}
	if !pulled {
		t.Fatal("helper image was not resolved")
	}
	if _, err := os.Stat(out + ".partial"); !os.IsNotExist(err) {
		t.Fatal("backup left its partial archive")
	}
}
