package cli_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/backup"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestRestoreMissingReplacementPreservesProject(t *testing.T) {
	deps, root := backupProject(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	archive := filepath.Join(t.TempDir(), "missing.tar.zst")
	f, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	w, err := backup.Create(f, "", backup.Manifest{Version: 1, Apps: []backup.ManifestApp{{ID: "one"}}})
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{".env", "secrets.env", "state.json"} {
		if err := w.AddBytes(name, []byte(readFile(t, filepath.Join(root, name))), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	before := readFile(t, filepath.Join(root, "state.json"))
	r := clitest.Run(t, deps, cat, "restore", archive, "--yes")
	if r.Code == 0 {
		t.Fatal("incomplete archive was accepted")
	}
	if got := readFile(t, filepath.Join(root, "apps", "one", "db.sqlite")); got != "one-v1" {
		t.Fatalf("original data = %q", got)
	}
	if got := readFile(t, filepath.Join(root, "state.json")); got != before {
		t.Fatal("failed restore changed records")
	}
	for _, call := range deps.Runner.(interface{ Calls() []string }).Calls() {
		if strings.Contains(call, " rm --stop") {
			t.Fatal("incomplete archive removed containers")
		}
	}
}

func TestRestoreEmptyServicesRejectsBeforeMutation(t *testing.T) {
	for _, fragment := range []string{"", "services: {}\n"} {
		t.Run(fragment, func(t *testing.T) {
			deps, root := backupProject(t)
			cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
			archive := filepath.Join(t.TempDir(), "empty.tar.zst")
			f, err := os.Create(archive)
			if err != nil {
				t.Fatal(err)
			}
			w, err := backup.Create(f, "", backup.Manifest{Version: 1, Apps: []backup.ManifestApp{{ID: "one"}}})
			if err != nil {
				t.Fatal(err)
			}
			for _, name := range []string{".env", "secrets.env", "state.json"} {
				if err := w.AddBytes(name, []byte(readFile(t, filepath.Join(root, name))), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if err := w.AddBytes("apps/one/compose.yml", []byte(fragment), 0o644); err != nil {
				t.Fatal(err)
			}
			if err := w.Close(); err != nil {
				t.Fatal(err)
			}
			if err := f.Close(); err != nil {
				t.Fatal(err)
			}
			runner := deps.Runner.(*systemtest.Runner)
			before := len(runner.Calls())
			r := clitest.Run(t, deps, cat, "restore", archive, "--yes")
			if r.Code == 0 {
				t.Fatal("zero-service replacement accepted")
			}
			if readFile(t, filepath.Join(root, "apps", "one", "db.sqlite")) != "one-v1" {
				t.Fatal("invalid replacement changed data")
			}
			for _, call := range runner.Calls()[before:] {
				if strings.Contains(call, " rm ") || strings.Contains(call, " up ") {
					t.Fatalf("invalid replacement mutated containers: %s", call)
				}
			}
		})
	}
}

type backupRecoveryRunner struct {
	system.Runner
	cancel         context.CancelFunc
	root           string
	archiveFailure bool
	startFailure   bool
	restarted      bool
	bounded        bool
}

type restoreRecoveryRunner struct {
	system.Runner
	bounded bool
}

func (r *restoreRecoveryRunner) Run(ctx context.Context, cmd system.Cmd) (system.Result, error) {
	if strings.Contains(systemtest.Line(cmd), " up -d --remove-orphans ") {
		_, r.bounded = ctx.Deadline()
	}
	return r.Runner.Run(ctx, cmd)
}

func (r *backupRecoveryRunner) Run(ctx context.Context, cmd system.Cmd) (system.Result, error) {
	line := systemtest.Line(cmd)
	if strings.Contains(line, " stop one") {
		if r.cancel != nil {
			r.cancel()
		}
		if r.archiveFailure {
			if err := os.RemoveAll(filepath.Join(r.root, "apps", "one")); err != nil {
				return system.Result{}, err
			}
		}
	}
	if strings.Contains(line, " start one") {
		if err := ctx.Err(); err != nil {
			return system.Result{}, err
		}
		r.restarted = true
		_, r.bounded = ctx.Deadline()
		if r.startFailure {
			return system.Result{ExitCode: 1, Stderr: []byte("restart refused")}, nil
		}
	}
	return r.Runner.Run(ctx, cmd)
}

func TestBackupCancellationRestartsOriginallyRunningApp(t *testing.T) {
	deps, root := backupProject(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runner := &backupRecoveryRunner{Runner: deps.Runner, cancel: cancel, root: root}
	deps.Runner = runner
	svc := service.New(deps, events.Discard(), cat)
	out := filepath.Join(t.TempDir(), "cancelled.tar.zst")
	_, err := svc.Backup(ctx, []string{"one"}, out, "")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("backup error = %v, want cancellation", err)
	}
	if !runner.restarted || !runner.bounded {
		t.Fatal("cancelled backup did not attempt bounded App recovery")
	}
	if _, err := os.Stat(out); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("cancelled backup published an archive")
	}
}

func TestBackupReportsArchiveAndRestartFailures(t *testing.T) {
	deps, root := backupProject(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	runner := &backupRecoveryRunner{Runner: deps.Runner, root: root, archiveFailure: true, startFailure: true}
	deps.Runner = runner
	_, err := service.New(deps, events.Discard(), cat).Backup(context.Background(), []string{"one"}, filepath.Join(t.TempDir(), "failed.tar.zst"), "")
	if err == nil || !strings.Contains(err.Error(), "no such file") || !strings.Contains(err.Error(), "restart refused") {
		t.Fatalf("error lost archive or recovery failure: %v", err)
	}
}

func TestRestoreStartFailureRetainsOriginalRecoveryCopy(t *testing.T) {
	deps, root := backupProject(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	archive := filepath.Join(t.TempDir(), "one.tar.zst")
	if r := clitest.Run(t, deps, cat, "backup", "one", "-o", archive); r.Code != 0 {
		t.Fatal(r.Out)
	}
	if err := os.WriteFile(filepath.Join(root, "apps", "one", "db.sqlite"), []byte("latest-original"), 0o644); err != nil {
		t.Fatal(err)
	}
	beforeState := readFile(t, filepath.Join(root, "state.json"))
	beforeSecrets := readFile(t, filepath.Join(root, "secrets.env"))
	deps.Runner.(*systemtest.Runner).OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " up -d --remove-orphans one") {
			return system.Result{ExitCode: 1, Stderr: []byte("start refused")}
		}
		return system.Result{}
	})
	r := clitest.Run(t, deps, cat, "restore", archive, "--yes")
	if r.Code == 0 {
		t.Fatal("start failure was accepted")
	}
	paths, err := filepath.Glob(filepath.Join(root, ".restore-*"))
	if err != nil || len(paths) != 1 || !strings.Contains(r.Out, paths[0]) {
		t.Fatalf("failed restore did not report retained recovery data: %s", r.Out)
	}
	if readFile(t, filepath.Join(paths[0], "replaced-one", "db.sqlite")) != "latest-original" {
		t.Fatal("original data was discarded")
	}
	if readFile(t, filepath.Join(paths[0], "original-records", "state.json")) != beforeState || readFile(t, filepath.Join(paths[0], "original-records", "secrets.env")) != beforeSecrets {
		t.Fatal("original recovery records were discarded")
	}
}

func TestBackupFailsWhenContainerStateIsUnknown(t *testing.T) {
	deps, _ := backupProject(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	deps.Runner.(*systemtest.Runner).OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " ps ") {
			return system.Result{ExitCode: 1, Stderr: []byte("Docker state unavailable")}
		}
		return system.Result{}
	})
	out := filepath.Join(t.TempDir(), "backup.tar.zst")
	r := clitest.Run(t, deps, cat, "backup", "one", "-o", out, "--json")
	if r.Code == 0 {
		t.Fatal("unknown running state produced a successful backup")
	}
	if _, err := os.Stat(out); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("failed backup published an archive")
	}
	if r.StepEvent("one", "archive") != "" {
		t.Fatal("backup copied data without checking running state")
	}
}

func TestRestoreReplacementFailureRollsBackDataAndRecords(t *testing.T) {
	deps, root := backupProject(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	archive := filepath.Join(t.TempDir(), "both.tar.zst")
	if r := clitest.Run(t, deps, cat, "backup", "-o", archive); r.Code != 0 {
		t.Fatal(r.Out)
	}
	for _, id := range []string{"one", "two"} {
		if err := os.WriteFile(filepath.Join(root, "apps", id, "db.sqlite"), []byte(id+"-v2"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p := &project.Project{Root: root}
	if err := p.SaveSecrets(map[string]string{"ADMIN_PASSWORD": "current-password", "ONE_API_KEY": "current-key"}); err != nil {
		t.Fatal(err)
	}
	beforeState := readFile(t, filepath.Join(root, "state.json"))
	beforeSecrets := readFile(t, filepath.Join(root, "secrets.env"))
	baseRunner := deps.Runner.(*systemtest.Runner)
	baseRunner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " ps ") {
			return system.Result{Stdout: []byte(`{"Service":"one","State":"running"}` + "\n" + `{"Service":"two","State":"exited"}` + "\n")}
		}
		// Lose a staged replacement after preflight, while stopping containers.
		if strings.Contains(systemtest.Line(cmd), " rm --stop --force one") {
			entries, err := filepath.Glob(filepath.Join(root, ".restore-*", "apps", "two"))
			if err != nil {
				t.Fatal(err)
			}
			for _, dir := range entries {
				if err := os.RemoveAll(dir); err != nil {
					t.Fatal(err)
				}
			}
		}
		return system.Result{}
	})
	beforeCalls := len(baseRunner.Calls())
	recoveryRunner := &restoreRecoveryRunner{Runner: baseRunner}
	deps.Runner = recoveryRunner
	r := clitest.Run(t, deps, cat, "restore", archive, "--yes")
	if r.Code == 0 {
		t.Fatal("replacement failure was accepted")
	}
	for _, id := range []string{"one", "two"} {
		if got := readFile(t, filepath.Join(root, "apps", id, "db.sqlite")); got != id+"-v2" {
			t.Fatalf("%s original not recovered: %q", id, got)
		}
	}
	if readFile(t, filepath.Join(root, "state.json")) != beforeState || readFile(t, filepath.Join(root, "secrets.env")) != beforeSecrets {
		t.Fatal("failed restore changed records")
	}
	var upCalls []string
	for _, call := range baseRunner.Calls()[beforeCalls:] {
		if strings.Contains(call, " up -d") {
			upCalls = append(upCalls, call)
		}
	}
	if len(upCalls) != 1 || !strings.HasSuffix(upCalls[0], " up -d --remove-orphans one") || !recoveryRunner.bounded {
		t.Fatalf("rollback must recreate only previously running services with a bound: %v", upCalls)
	}
}

func TestRestoreScopedArchivePreservesOtherCredentials(t *testing.T) {
	deps, root := backupProject(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	p := &project.Project{Root: root}
	if err := p.SaveSecrets(map[string]string{"ADMIN_USER": "old-admin", "ADMIN_PASSWORD": "old-password", "ONE_API_KEY": "old-one"}); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), "one.tar.zst")
	if r := clitest.Run(t, deps, cat, "backup", "one", "-o", archive); r.Code != 0 {
		t.Fatal(r.Out)
	}
	current := map[string]string{"ADMIN_USER": "current-admin", "ADMIN_PASSWORD": "current-password", "ONE_API_KEY": "new-one", "TWO_API_KEY": "keep-two"}
	if err := p.SaveSecrets(current); err != nil {
		t.Fatal(err)
	}
	if r := clitest.Run(t, deps, cat, "restore", archive, "--yes"); r.Code != 0 {
		t.Fatal(r.Out)
	}
	got, err := p.LoadSecrets()
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"ADMIN_USER", "ADMIN_PASSWORD", "TWO_API_KEY"} {
		if got[key] != current[key] {
			t.Fatalf("unrelated credential %s was changed", key)
		}
	}
	if got["ONE_API_KEY"] != "old-one" {
		t.Fatal("restored App's credential was not restored")
	}
}

func TestRestorePartialRemovalReportsScopedRecoveryFailure(t *testing.T) {
	deps, root := backupProject(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	archive := filepath.Join(t.TempDir(), "one.tar.zst")
	if r := clitest.Run(t, deps, cat, "backup", "one", "-o", archive); r.Code != 0 {
		t.Fatal(r.Out)
	}
	base := deps.Runner.(*systemtest.Runner)
	base.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		line := systemtest.Line(cmd)
		if strings.Contains(line, " ps ") {
			return system.Result{Stdout: []byte(`{"Service":"one","State":"running"}` + "\n")}
		}
		if strings.Contains(line, " rm --stop --force one") {
			return system.Result{ExitCode: 1, Stderr: []byte("partial removal failed")}
		}
		if strings.Contains(line, " up -d --remove-orphans one") {
			return system.Result{ExitCode: 1, Stderr: []byte("recovery start refused")}
		}
		return system.Result{}
	})
	recovery := &restoreRecoveryRunner{Runner: base}
	deps.Runner = recovery
	r := clitest.Run(t, deps, cat, "restore", archive, "--yes")
	if r.Code == 0 || !strings.Contains(r.Out, "partial removal failed") || !strings.Contains(r.Out, "recovery start refused") || !strings.Contains(r.Out, "self-host start one") {
		t.Fatalf("missing recovery diagnostics: %s", r.Out)
	}
	if !recovery.bounded {
		t.Fatal("recovery was not bounded")
	}
	paths, err := filepath.Glob(filepath.Join(root, ".restore-*"))
	if err != nil || len(paths) != 1 || !strings.Contains(r.Out, paths[0]) {
		t.Fatal("recovery records location was not retained and reported")
	}
	if readFile(t, filepath.Join(root, "apps", "one", "db.sqlite")) != "one-v1" {
		t.Fatal("partial remove changed original data")
	}
}
