package cli_test

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func installed(t *testing.T, ids ...string) (*system.Deps, *catalog.Catalog) {
	t.Helper()
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	if code, out := runWith(t, deps, cat, append([]string{"install", "--yes"}, ids...)...); code != 0 {
		t.Fatalf("install: %d\n%s", code, out)
	}
	return deps, cat
}

func composeCalls(deps *system.Deps) []string {
	var calls []string
	for _, line := range deps.Runner.(*systemtest.Runner).Calls() {
		if _, rest, found := strings.Cut(line, "secrets.env "); found {
			calls = append(calls, rest)
		}
	}
	return calls
}

func lastCompose(deps *system.Deps) string {
	calls := composeCalls(deps)
	return calls[len(calls)-1]
}

func TestStopAndStartTargetOnlyTheNamedApp(t *testing.T) {
	deps, cat := installed(t, "one", "two")

	if code, out := runWith(t, deps, cat, "stop", "one"); code != 0 || lastCompose(deps) != "stop one" {
		t.Fatalf("stop: %d %q\n%s", code, lastCompose(deps), out)
	}
	if code, _ := runWith(t, deps, cat, "start", "one"); code != 0 || lastCompose(deps) != "up -d --remove-orphans one" {
		t.Fatalf("start: %d %q", code, lastCompose(deps))
	}
	if code, _ := runWith(t, deps, cat, "restart", "two"); code != 0 || lastCompose(deps) != "restart two" {
		t.Fatalf("restart: %d %q", code, lastCompose(deps))
	}
}

func TestStopWithoutArgumentsStopsEveryApp(t *testing.T) {
	deps, cat := installed(t, "one", "two")

	runWith(t, deps, cat, "stop")

	if lastCompose(deps) != "stop one two" {
		t.Fatalf("got %q", lastCompose(deps))
	}
}

func TestUnknownAppIsRejected(t *testing.T) {
	deps, cat := installed(t, "one")

	code, out := runWith(t, deps, cat, "stop", "nope")

	if code != 1 || !strings.Contains(out, "nope") {
		t.Fatalf("exit %d\n%s", code, out)
	}
}

func TestUnmanagedAppInLegacyAppsFolderKeepsWorking(t *testing.T) {
	deps, cat := installed(t, "one")
	root := projectRoot(t, deps)
	os.MkdirAll(filepath.Join(root, "apps", "whoami"), 0o755)
	os.WriteFile(filepath.Join(root, "apps", "whoami", "compose.yml"), []byte("services:\n  whoami:\n    image: traefik/whoami\n    ports:\n      - ${BIND_IP}:8099:80\n"), 0o644)

	code, out := runWith(t, deps, cat, "start", "whoami")

	if code != 0 || lastCompose(deps) != "up -d --remove-orphans whoami" {
		t.Fatalf("start unmanaged: %d %q\n%s", code, lastCompose(deps), out)
	}
	if !strings.Contains(readFile(t, filepath.Join(root, "compose.yml")), "apps/whoami/compose.yml") {
		t.Fatal("root compose does not include the unmanaged app")
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
	if len(status.Apps) != 2 || status.Apps[1].ID != "whoami" || status.Apps[1].Setup != stepstatus.SetupUnmanaged || status.Apps[1].Managed {
		t.Fatalf("unmanaged app not listed: %+v", status.Apps)
	}
	if code, out := runWith(t, deps, cat, "setup", "whoami"); code != 1 || !strings.Contains(out, "not a catalog App") {
		t.Fatalf("setup on unmanaged app should refuse: %d\n%s", code, out)
	}
}

func TestRemoveKeepsDataUnlessPurged(t *testing.T) {
	deps, cat := installed(t, "one", "two")
	root := projectRoot(t, deps)
	os.WriteFile(filepath.Join(root, "apps", "one", "data.db"), []byte("x"), 0o644)

	code, out := runWith(t, deps, cat, "remove", "one", "--yes")

	if code != 0 || lastCompose(deps) != "rm --stop --force one" {
		t.Fatalf("remove: %d %q\n%s", code, lastCompose(deps), out)
	}
	if _, err := os.Stat(filepath.Join(root, "apps", "one", "data.db")); err != nil {
		t.Fatal("data deleted without --purge")
	}
	if strings.Contains(readFile(t, filepath.Join(root, "compose.yml")), "apps/one/") {
		t.Fatal("removed app still included")
	}
	if strings.Contains(readFile(t, filepath.Join(root, "state.json")), `"one"`) {
		t.Fatal("removed app still in state")
	}

	runWith(t, deps, cat, "remove", "two", "--purge", "--yes")

	if _, err := os.Stat(filepath.Join(root, "apps", "two")); !os.IsNotExist(err) {
		t.Fatal("--purge kept the data")
	}
	if lastCompose(deps) != "down" {
		t.Fatalf("last App removal left Project resources: %q", lastCompose(deps))
	}
}

func TestDownSucceedsAfterRemovingEveryApp(t *testing.T) {
	deps, cat := installed(t, "one", "two")
	if code, out := runWith(t, deps, cat, "remove", "one", "two", "--purge", "--yes"); code != 0 {
		t.Fatalf("remove: %d\n%s", code, out)
	}
	before := len(composeCalls(deps))
	for range 2 {
		if code, out := runWith(t, deps, cat, "down"); code != 0 {
			t.Fatalf("down on an empty Project: %d\n%s", code, out)
		}
	}
	if calls := composeCalls(deps)[before:]; len(calls) != 0 {
		t.Fatalf("empty Project should need no Compose work: %v", calls)
	}
}

func TestPurgeEmptiesRootOwnedDataThroughContainer(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root can delete everything")
	}
	deps, cat := installed(t, "one")
	root := projectRoot(t, deps)
	locked := filepath.Join(root, "apps", "one", "redis")
	os.MkdirAll(locked, 0o755)
	os.WriteFile(filepath.Join(locked, "dump.rdb"), []byte("x"), 0o644)
	os.Chmod(locked, 0o555)
	t.Cleanup(func() { os.Chmod(locked, 0o755) })
	deps.Runner.(*systemtest.Runner).OnFunc("docker compose", func(cmd system.Cmd) system.Result {
		if slices.Contains(cmd.Args, "run") {
			os.Chmod(locked, 0o755)
			os.RemoveAll(locked)
		}
		return system.Result{}
	})

	code, out := runWith(t, deps, cat, "remove", "one", "--purge", "--yes")

	if code != 0 {
		t.Fatalf("purge: %d\n%s", code, out)
	}
	if !strings.Contains(strings.Join(deps.Runner.(*systemtest.Runner).Calls(), "\n"), "run --rm --no-deps -T --user 0 -v "+filepath.Join(root, "apps", "one")+":/purge --entrypoint find one /purge -mindepth 1 ! -path /purge/compose.yml -delete") {
		t.Fatal("root-owned data was not emptied through a container")
	}
	if _, err := os.Stat(filepath.Join(root, "apps", "one")); !os.IsNotExist(err) {
		t.Fatal("--purge kept the data")
	}
}

func TestRemoveNeedsConfirmationWhenNotInteractive(t *testing.T) {
	deps, cat := installed(t, "one")

	code, out := runWith(t, deps, cat, "remove", "one")

	if code != 1 || !strings.Contains(out, "--yes") {
		t.Fatalf("exit %d\n%s", code, out)
	}
}

func TestUpdatePullsRecreatesAndChecks(t *testing.T) {
	deps, cat := installed(t, "one")

	code, out := runWith(t, deps, cat, "update", "one", "--json")

	calls := composeCalls(deps)
	if code != 0 || calls[len(calls)-2] != "--progress json pull one" || calls[len(calls)-1] != "up -d --remove-orphans one" {
		t.Fatalf("update: %d %v\n%s", code, calls, out)
	}
	if findCheck(decodeEvents(t, out), "check") == nil {
		t.Fatalf("update did not run Check:\n%s", out)
	}
}

func TestUpdatePullFailureNamesTheImage(t *testing.T) {
	deps, cat := installed(t, "one")
	deps.Runner.(*systemtest.Runner).OnStreamError("--progress json pull",
		`{"id":"Image example/echo:latest","status":"Working","text":"Pulling"}`+"\n", errors.New("exit status 125"))

	code, out := runWith(t, deps, cat, "update", "one", "--json")

	if code != 1 {
		t.Fatalf("exit %d\n%s", code, out)
	}
	for _, want := range []string{"example/echo:latest", "docker pull example/echo:latest"} {
		if !strings.Contains(out, want) {
			t.Fatalf("pull failure lacks %q:\n%s", want, out)
		}
	}
}

func TestConfigSetRewritesSettingsAndRecreatesApps(t *testing.T) {
	deps, cat := installed(t, "one")

	code, out := runWith(t, deps, cat, "config", "set", "EXPOSURE=local", "TZ=UTC")

	if code != 0 {
		t.Fatalf("exit %d\n%s", code, out)
	}
	env := readFile(t, filepath.Join(projectRoot(t, deps), ".env"))
	for _, want := range []string{"TZ=UTC\n", "EXPOSURE=local\n", "BIND_IP=127.0.0.1\n"} {
		if !strings.Contains(env, want) {
			t.Errorf(".env lacks %q", want)
		}
	}
	if lastCompose(deps) != "up -d --remove-orphans one" {
		t.Fatalf("app not recreated: %q", lastCompose(deps))
	}
}

func TestConfigSetRejectsUnknownKeysAndBadExposure(t *testing.T) {
	deps, cat := installed(t, "one")

	if code, out := runWith(t, deps, cat, "config", "set", "COLOR=blue"); code != 1 || !strings.Contains(out, "COLOR") {
		t.Fatalf("unknown key accepted: %d\n%s", code, out)
	}
	if code, _ := runWith(t, deps, cat, "config", "set", "EXPOSURE=public"); code != 1 {
		t.Fatal("bad exposure accepted")
	}
}

func TestAppsListAndInfo(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", required: true, done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})

	_, out := runWith(t, deps, cat, "apps", "list", "--json")
	var list struct {
		Apps    []struct{ ID string }
		Recipes []struct {
			ID   string
			Apps []string
		}
	}
	if err := json.Unmarshal([]byte(out), &list); err != nil || len(list.Apps) != 2 || list.Recipes[0].ID != "pair" {
		t.Fatalf("list: %v\n%s", err, out)
	}

	_, out = runWith(t, deps, cat, "apps", "info", "one", "--json")
	var info struct {
		ID     string
		Port   int
		Inputs []struct {
			Key      string
			Required bool
		}
	}
	if err := json.Unmarshal([]byte(out), &info); err != nil || info.Port != 9000 || len(info.Inputs) != 1 || !info.Inputs[0].Required {
		t.Fatalf("info: %v\n%s", err, out)
	}
}

func TestLogsStreamsTheAppsContainers(t *testing.T) {
	deps, cat := installed(t, "one")
	deps.Runner.(*systemtest.Runner).Logs = "one-1  | listening on :80\n"

	code, out := runWith(t, deps, cat, "logs", "one", "--tail", "50")

	if code != 0 || !strings.Contains(out, "listening on :80") || lastCompose(deps) != "logs --no-color --tail 50 one" {
		t.Fatalf("logs: %d %q\n%s", code, lastCompose(deps), out)
	}
}

func TestHiddenAppIsUnlistedAndRefusedForNewInstalls(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := catalog.New([]app.App{&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "lldap", done: map[string]bool{}}}, nil)

	_, out := runWith(t, deps, cat, "apps", "list", "--json")
	if strings.Contains(out, "lldap") {
		t.Fatalf("hidden App listed:\n%s", out)
	}
	_, out = runWith(t, deps, cat, "apps", "info", "lldap")
	if !strings.Contains(out, "temporarily unavailable") || !strings.Contains(out, "issues/452") {
		t.Fatalf("info: %s", out)
	}
	code, out := runWith(t, deps, cat, "install", "--yes", "lldap")
	if code == 0 || !strings.Contains(out, "temporarily unavailable") {
		t.Fatalf("install: %d\n%s", code, out)
	}
	if _, err := os.Stat(projectRoot(t, deps)); err == nil {
		t.Fatal("refused install changed the Host")
	}
}
