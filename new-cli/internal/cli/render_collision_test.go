package cli_test

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/backup"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/systemtest"
)

type collisionApp struct {
	*echoApp
	cache, config string
}

func (*collisionApp) Inputs() []app.Input {
	return []app.Input{{Key: "label", Default: "original"}}
}

func TestRestoreServiceCollisionPreservesDataBeforeCompose(t *testing.T) {
	deps, root := backupProject(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	archive := filepath.Join(t.TempDir(), "collision.tar.zst")
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
	if err := w.AddBytes("apps/one/compose.yml", []byte("services:\n  one:\n    image: example/one\n  two:\n    image: example/conflicting-sidecar\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := w.AddBytes("apps/one/db.sqlite", []byte("replacement database"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	runner := deps.Runner.(*systemtest.Runner)
	start := len(runner.Cmds())
	result := clitest.Run(t, deps, cat, "restore", archive, "--yes")
	if result.Code == 0 || !strings.Contains(result.Out, "defined by both Apps") {
		t.Fatal("restore did not reject conflicting service ownership")
	}
	if readFile(t, filepath.Join(root, "apps", "one", "db.sqlite")) != "one-v1" {
		t.Fatal("conflicting restore replaced original data")
	}
	for _, cmd := range runner.Cmds()[start:] {
		if strings.Contains(systemtest.Line(cmd), "docker compose --project-directory") {
			t.Fatal("conflicting restore triggered Compose observation, removal, or apply")
		}
	}
}

func TestLifecycleCollisionRejectsApplyAndReinstallCanRepair(t *testing.T) {
	deps := systemtest.NewDeps(t)
	one := &collisionApp{echoApp: &echoApp{id: "one", done: map[string]bool{}}, cache: "one-cache", config: "one configuration"}
	two := &collisionApp{echoApp: &echoApp{id: "two", done: map[string]bool{}}, cache: "two-cache", config: "two configuration"}
	cat := testCatalog(one, two)
	if result := clitest.Run(t, deps, cat, "install", "one", "two", "--yes"); result.Code != 0 {
		t.Fatal(result.Out)
	}
	fragment := filepath.Join(projectRoot(t, deps), "apps", "two", "compose.yml")
	// Model an existing legacy/manual composition without going through the new writer guard.
	legacy := strings.ReplaceAll(readFile(t, fragment), "two-cache:", "one-cache:")
	if err := os.WriteFile(fragment, []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}
	runner := deps.Runner.(*systemtest.Runner)
	for _, verb := range []string{"start", "restart", "update"} {
		start := len(runner.Cmds())
		result := clitest.Run(t, deps, cat, verb, "one")
		if result.Code == 0 || !strings.Contains(result.Out, "one-cache") {
			t.Fatalf("%s did not reject conflicting service ownership", verb)
		}
		for _, cmd := range runner.Cmds()[start:] {
			if strings.Contains(systemtest.Line(cmd), "docker compose --project-directory") {
				t.Fatal("conflicting composition triggered Compose observation or apply")
			}
		}
		if readFile(t, fragment) != legacy {
			t.Fatal("failed lifecycle changed existing fragment")
		}
	}
	if result := clitest.Run(t, deps, cat, "install", "two", "--yes"); result.Code != 0 {
		t.Fatal("explicit reinstall could not repair legacy composition")
	}
	if result := clitest.Run(t, deps, cat, "start", "one"); result.Code != 0 {
		t.Fatal("repaired composition could not start")
	}
}

func (a *collisionApp) Compose(rc app.RenderContext) string {
	return a.echoApp.Compose(rc) + "  " + a.cache + ":\n    image: example/cache\n"
}
func (a *collisionApp) Files(app.RenderContext, func(string) string) []app.File {
	return []app.File{{Path: "config", Content: a.config, Mode: 0o600}}
}

func TestInstallCollisionPreservesConfigAndRejectsBeforeCompose(t *testing.T) {
	deps := systemtest.NewDeps(t)
	one := &collisionApp{echoApp: &echoApp{id: "one", done: map[string]bool{}}, cache: "shared-cache", config: "one configuration"}
	two := &collisionApp{echoApp: &echoApp{id: "two", done: map[string]bool{}}, cache: "two-cache", config: "saved configuration"}
	cat := testCatalog(one, two)
	if result := clitest.Run(t, deps, cat, "install", "one", "two", "--yes"); result.Code != 0 {
		t.Fatal(result.Out)
	}
	dir := filepath.Join(projectRoot(t, deps), "apps", "two")
	before := readFile(t, filepath.Join(dir, "compose.yml"))
	p := &project.Project{Root: projectRoot(t, deps)}
	beforeState, err := p.LoadState()
	if err != nil {
		t.Fatal(err)
	}
	runner := deps.Runner.(*systemtest.Runner)
	start := len(runner.Cmds())
	two.cache, two.config = "shared-cache", "replacement configuration"
	result := clitest.Run(t, deps, cat, "install", "two", "--yes", "--json", "--set", "two.port=31002", "--set", "two.label=unapplied-label")
	if result.Code == 0 || !strings.Contains(result.Out, "shared-cache") {
		t.Fatal("install did not reject the conflicting App-owned service")
	}
	if readFile(t, filepath.Join(dir, "config")) != "saved configuration" || readFile(t, filepath.Join(dir, "compose.yml")) != before {
		t.Fatal("rejected install changed existing App files")
	}
	afterState, err := p.LoadState()
	if err != nil {
		t.Fatal(err)
	}
	previous, current := beforeState.Apps["two"], afterState.Apps["two"]
	if current.Port != previous.Port || !reflect.DeepEqual(current.Inputs, previous.Inputs) {
		t.Fatal("rejected install persisted unapplied port or public inputs")
	}
	if current.Steps["render"].Status != "fail" || !strings.Contains(current.Steps["render"].Error, "shared-cache") || result.StepEvent("two", "render") != "step.fail" {
		t.Fatal("render rejection did not persist and emit its failure record")
	}
	for _, cmd := range runner.Cmds()[start:] {
		line := systemtest.Line(cmd)
		if strings.Contains(line, "docker compose --project-directory") {
			t.Fatal("collision triggered Compose configuration, pull, or apply")
		}
	}
}
