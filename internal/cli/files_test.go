package cli_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/systemtest"
)

// fileApp needs a config file holding one of its secrets before it starts.
type fileApp struct{ *echoApp }

func (fileApp) Secrets() []app.SecretSpec { return []app.SecretSpec{{Name: "token", Length: 16}} }

func (fileApp) Files(rc app.RenderContext, secret func(string) string) []app.File {
	return []app.File{
		{Path: "config/app.yaml", Content: "token: " + secret("token") + "\n", Mode: 0o600},
		{Path: "data/state.json", Content: "{}\n", Keep: true},
	}
}

func TestInstallWritesDeclaredFilesBeforeStarting(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(fileApp{&echoApp{id: "one", done: map[string]bool{}}})
	if code, out := runWith(t, deps, cat, "install", "one", "--yes"); code != 0 {
		t.Fatalf("install: %d\n%s", code, out)
	}
	dir := filepath.Join(projectRoot(t, deps), "apps", "one")
	config := readFile(t, filepath.Join(dir, "config", "app.yaml"))
	if !strings.HasPrefix(config, "token: ") || len(strings.TrimSpace(strings.TrimPrefix(config, "token: "))) != 16 {
		t.Fatalf("config not rendered with the secret: %q", config)
	}
	if info, _ := os.Stat(filepath.Join(dir, "config", "app.yaml")); info.Mode().Perm() != 0o600 {
		t.Errorf("mode %v, want 0600", info.Mode().Perm())
	}
	os.WriteFile(filepath.Join(dir, "data", "state.json"), []byte("edited"), 0o644)

	runWith(t, deps, cat, "install", "one", "--yes")

	if readFile(t, filepath.Join(dir, "data", "state.json")) != "edited" {
		t.Error("a Keep file must not be rewritten")
	}
}
