package cli_test

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestCanceledFreshRestoreDoesNotCreateProject(t *testing.T) {
	deps, _ := backupProject(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	archive := filepath.Join(t.TempDir(), "backup.tar.zst")
	if r := clitest.Run(t, deps, cat, "backup", "-o", archive, "--json"); r.Code != 0 {
		t.Fatal("prepare fixture backup:", r.Out)
	}
	systemtest.SetEnv(deps, map[string]string{"SELF_HOST_HOME": filepath.Join(t.TempDir(), "restored")})
	svc := service.New(deps, events.Discard(), cat)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := svc.Restore(ctx, archive, nil, ""); !errors.Is(err, context.Canceled) {
		t.Fatalf("restore = %v, want canceled", err)
	}
	p, err := svc.Project()
	if err != nil {
		t.Fatal(err)
	}
	if p.Exists() {
		t.Fatal("canceled fresh restore created active Project settings")
	}
}
