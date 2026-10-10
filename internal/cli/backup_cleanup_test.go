package cli_test

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestBackupHelperWaitsForAutomaticRemoval(t *testing.T) {
	for _, cancelRun := range []bool{false, true} {
		name := "failure"
		if cancelRun {
			name = "cancelled"
		}
		t.Run(name, func(t *testing.T) {
			deps, root := backupProject(t)
			base := deps.Runner.(*systemtest.Runner)
			base.On("docker info", system.Result{Stdout: []byte(`["name=rootless"]`)})
			var ownedName string
			var inspected int
			base.OnFunc("docker rm --force", func(cmd system.Cmd) system.Result {
				ownedName = cmd.Args[len(cmd.Args)-1]
				return system.Result{ExitCode: 1, Stderr: []byte("removal of container is already in progress")}
			})
			base.OnFunc("docker container inspect", func(cmd system.Cmd) system.Result {
				if ownedName == "" || cmd.Args[len(cmd.Args)-1] != ownedName || cmd.Args[len(cmd.Args)-2] != "{{.State.Status}}" {
					t.Fatal("cleanup inspected anything beyond its owned helper state")
				}
				inspected++
				if inspected == 1 {
					return system.Result{Stdout: []byte("removing\n")}
				}
				return system.Result{ExitCode: 1, Stderr: []byte("No such container: " + ownedName)}
			})
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			runner := &rootlessArchiveRunner{Runner: base, t: t, root: root, archiveError: errors.New("archive read refused")}
			if cancelRun {
				runner.cancel = cancel
			}
			deps.Runner = runner
			cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
			_, err := service.New(deps, events.Discard(), cat).Backup(ctx, []string{"one"}, filepath.Join(t.TempDir(), "failure.tar.zst"), "")
			if err == nil || strings.Contains(err.Error(), "cleanup failed") {
				t.Fatalf("completed automatic removal was reported as cleanup failure: %v", err)
			}
			if inspected != 2 || !runner.cleanupBounded {
				t.Fatal("cleanup did not confirm owned helper disappearance within its bound")
			}
		})
	}
}

func TestBackupHelperRetainedStateReportsRecoveryName(t *testing.T) {
	for _, tc := range []struct {
		name, detail string
		inspectError bool
	}{
		{name: "stuck", detail: "timed out confirming helper removal"},
		{name: "inspect-error", detail: "state lookup refused", inspectError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			deps, root := backupProject(t)
			base := deps.Runner.(*systemtest.Runner)
			base.On("docker info", system.Result{Stdout: []byte(`["name=rootless"]`)})
			var ownedName string
			base.OnFunc("docker rm --force", func(cmd system.Cmd) system.Result {
				ownedName = cmd.Args[len(cmd.Args)-1]
				return system.Result{ExitCode: 1, Stderr: []byte("removal of container is already in progress")}
			})
			base.OnFunc("docker container inspect", func(cmd system.Cmd) system.Result {
				if cmd.Args[len(cmd.Args)-1] != ownedName || cmd.Args[len(cmd.Args)-2] != "{{.State.Status}}" {
					t.Fatal("cleanup exceeded its owned helper state")
				}
				if tc.inspectError {
					return system.Result{ExitCode: 1, Stderr: []byte(tc.detail)}
				}
				return system.Result{Stdout: []byte("removing\n")}
			})
			runner := &rootlessArchiveRunner{Runner: base, t: t, root: root, archiveError: errors.New("archive read refused")}
			deps.Runner = runner
			cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
			_, err := service.New(deps, events.Discard(), cat).Backup(context.Background(), []string{"one"}, filepath.Join(t.TempDir(), "failure.tar.zst"), "")
			if err == nil || ownedName == "" || !strings.Contains(err.Error(), tc.detail) || !strings.Contains(err.Error(), "run docker rm --force "+ownedName) {
				t.Fatalf("retained helper lost actionable diagnostics: %v", err)
			}
		})
	}
}
