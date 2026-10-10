package cli_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/systemtest"
)

func TestProjectFolderAndComposeNameCanBeOverridden(t *testing.T) {
	deps := systemtest.NewDeps(t)
	root := filepath.Join(t.TempDir(), "e2e")
	systemtest.SetEnv(deps, map[string]string{"SELF_HOST_HOME": root, "SELF_HOST_COMPOSE_PROJECT": "selfhost-e2e-1"})
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})

	if code, out := runWith(t, deps, cat, "install", "one", "--yes"); code != 0 {
		t.Fatalf("install: %d\n%s", code, out)
	}

	if _, err := os.Stat(filepath.Join(root, "apps", "one", "compose.yml")); err != nil {
		t.Fatalf("Project not written to SELF_HOST_HOME: %v", err)
	}
	if _, err := os.Stat(projectRoot(t, deps)); err == nil {
		t.Fatal("~/.self-host must stay untouched")
	}
	for _, line := range deps.Runner.(*systemtest.Runner).Calls() {
		if strings.HasPrefix(line, "docker compose --project-directory") && !strings.Contains(line, "-p selfhost-e2e-1 ") {
			t.Fatalf("compose call without the overridden project name: %s", line)
		}
	}
}

func TestComposeProjectNameIsValidated(t *testing.T) {
	deps := systemtest.NewDeps(t)
	systemtest.SetEnv(deps, map[string]string{"SELF_HOST_COMPOSE_PROJECT": "Bad Name"})

	if code, out := runWith(t, deps, testCatalog(&echoApp{id: "one", done: map[string]bool{}}), "install", "one", "--yes"); code != 1 || !strings.Contains(out, "SELF_HOST_COMPOSE_PROJECT") {
		t.Fatalf("bad name accepted: %d\n%s", code, out)
	}
}
