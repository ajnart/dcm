package tui

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/ajnart/self-host/internal/systemtest"
)

func TestSkippedReleaseIsKeptInTheUserCacheDirectory(t *testing.T) {
	deps := systemtest.NewDeps(t)
	backend := ServiceBackend{Deps: deps}
	if got := backend.SkippedUpdate(); got != "" {
		t.Fatalf("fresh cache skipped %q", got)
	}

	backend.SkipUpdate("1.2.0")

	if got := (ServiceBackend{Deps: deps}).SkippedUpdate(); got != "1.2.0" {
		t.Errorf("skipped = %q", got)
	}
	dir, _ := deps.CacheDir()
	if _, err := os.Stat(filepath.Join(dir, "self-host", "update.json")); err != nil {
		t.Errorf("cache file: %v", err)
	}
}

func TestRestartRunsTheReplacedBinaryWithTheSameArguments(t *testing.T) {
	deps := systemtest.NewDeps(t)
	deps.Executable = func() (string, error) { return "/usr/local/bin/self-host (deleted)", nil }
	var gotPath string
	var gotArgv []string
	deps.Exec = func(path string, argv []string) error {
		gotPath, gotArgv = path, argv
		return nil
	}

	err := ServiceBackend{Deps: deps, Args: []string{"--verbose"}}.Restart()

	if err != nil || gotPath != "/usr/local/bin/self-host" || !reflect.DeepEqual(gotArgv, []string{"/usr/local/bin/self-host", "--verbose"}) {
		t.Errorf("err %v path %q argv %q", err, gotPath, gotArgv)
	}
}
