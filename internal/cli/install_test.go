package cli_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/cli"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

// echoApp is a test-only App with one setup step whose state lives in a map,
// so tests can observe idempotency and failures without a real service.
type echoApp struct {
	id       string
	required bool
	done     map[string]bool
	fail     error
}

func (e *echoApp) Info() app.Info {
	return app.Info{ID: e.id, Name: "Echo " + e.id, Description: "test app", Image: "example/echo:latest", Port: 9000, ContainerPort: 80, Service: e.id}
}

func (e *echoApp) Inputs() []app.Input {
	if !e.required {
		return nil
	}
	return []app.Input{{Key: "greeting", Prompt: "Greeting", Required: true}}
}

func (e *echoApp) Compose(rc app.RenderContext) string {
	return "services:\n  " + e.id + ":\n    image: example/echo:latest\n    environment:\n      TZ: ${TZ}\n    ports:\n      - ${BIND_IP}:" + strconv.Itoa(rc.Port) + ":80\n"
}

func (e *echoApp) Setup(ctx context.Context, h *helpers.H) error {
	return h.Step(ctx, "configure", "configure echo", helpers.StepSpec{
		Check: func(context.Context) (bool, error) { return e.done[e.id], nil },
		Do: func(context.Context) error {
			if e.fail != nil {
				return e.fail
			}
			e.done[e.id] = true
			return nil
		},
		Hint:       "Open the echo settings page and enable greetings.",
		Credential: "admin",
	})
}

func (e *echoApp) Check(context.Context, *helpers.H) error { return nil }
func (e *echoApp) Links() []app.Link                       { return nil }

func testCatalog(apps ...app.App) *catalog.Catalog {
	return catalog.New(apps, []catalog.Recipe{{ID: "pair", Name: "Pair", Apps: []string{"one", "two"}}})
}

func runWith(t *testing.T, deps *system.Deps, cat *catalog.Catalog, args ...string) (int, string) {
	t.Helper()
	var out bytes.Buffer
	deps.Out = &out
	deps.Err = &out
	code := cli.RunWith(context.Background(), deps, cat, args)
	return code, out.String()
}

func projectRoot(t *testing.T, deps *system.Deps) string {
	t.Helper()
	u, _ := deps.CurrentUser()
	return filepath.Join(u.Home, "self-host")
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(data)
}

func TestInstallCreatesProjectAndStartsApp(t *testing.T) {
	deps := systemtest.NewDeps(t)
	done := map[string]bool{}
	cat := testCatalog(&echoApp{id: "one", done: done})

	code, out := runWith(t, deps, cat, "install", "one", "--yes", "--json")

	if code != 0 {
		t.Fatalf("exit %d\n%s", code, out)
	}
	root := projectRoot(t, deps)
	env := readFile(t, filepath.Join(root, ".env"))
	for _, want := range []string{"TZ=Europe/Paris", "PUID=1000", "PGID=1000", "UMASK=022", "LAN_IP=192.168.1.20", "EXPOSURE=lan", "BIND_IP=0.0.0.0"} {
		if !strings.Contains(env, want+"\n") {
			t.Errorf(".env lacks %q:\n%s", want, env)
		}
	}
	info, err := os.Stat(filepath.Join(root, "secrets.env"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("secrets.env missing or not 0600: %v %v", err, info)
	}
	if !strings.Contains(readFile(t, filepath.Join(root, "secrets.env")), "ADMIN_PASSWORD=") {
		t.Fatal("no generated Admin login")
	}
	if !strings.Contains(readFile(t, filepath.Join(root, "apps", "one", "compose.yml")), "${BIND_IP}:9000:80") {
		t.Fatal("fragment not rendered with default port")
	}
	if !strings.Contains(readFile(t, filepath.Join(root, "compose.yml")), "apps/one/compose.yml") {
		t.Fatal("root compose does not include the app fragment")
	}
	calls := strings.Join(deps.Runner.(*systemtest.Runner).Calls(), "\n")
	if !strings.Contains(calls, "docker compose --project-directory "+root+" -p selfhost --env-file "+root+"/.env --env-file "+root+"/secrets.env up -d one") {
		t.Fatalf("compose up not run:\n%s", calls)
	}
	if !strings.Contains(out, `"command":"docker compose --project-directory `+root) {
		t.Fatalf("compose command not logged verbatim:\n%s", out)
	}
	if !done["one"] {
		t.Fatal("setup did not run")
	}
}

func TestInstallNeverLogsTheAdminPassword(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})

	_, out := runWith(t, deps, cat, "install", "one", "--yes", "--json", "--verbose")
	_, creds := runWith(t, deps, cat, "credentials", "--json")

	var parsed struct {
		Admin struct{ Username, Password string }
	}
	if err := json.Unmarshal([]byte(creds), &parsed); err != nil || parsed.Admin.Password == "" {
		t.Fatalf("credentials output: %v\n%s", err, creds)
	}
	if strings.Contains(out, parsed.Admin.Password) {
		t.Fatal("admin password leaked into install events")
	}
}

func TestSetupRerunSkipsFinishedSteps(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	runWith(t, deps, cat, "install", "one", "--yes")

	code, out := runWith(t, deps, cat, "setup", "one", "--json")

	if code != 0 {
		t.Fatalf("exit %d\n%s", code, out)
	}
	if check := findCheck(decodeEvents(t, out), "configure"); check == nil || check["event"] != "step.skip" {
		t.Fatalf("finished step not skipped:\n%s", out)
	}
}

func TestFailedStepGivesAgentAHandoff(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}, fail: errors.New("greetings endpoint returned 500")})

	code, out := runWith(t, deps, cat, "install", "one", "--yes", "--json")

	if code != 2 {
		t.Fatalf("exit %d, want 2\n%s", code, out)
	}
	fail := findCheck(decodeEvents(t, out), "configure")
	if fail == nil || fail["event"] != "step.fail" {
		t.Fatalf("no step.fail:\n%s", out)
	}
	want := map[string]string{"app": "one", "error": "greetings endpoint returned 500", "url": "http://192.168.1.20:9000",
		"credential": "admin", "hint": "Open the echo settings page and enable greetings."}
	for key, value := range want {
		if fail[key] != value {
			t.Errorf("%s = %v, want %q", key, fail[key], value)
		}
	}
}

func TestMissingRequiredInputFailsNamingTheKey(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", required: true, done: map[string]bool{}})

	code, out := runWith(t, deps, cat, "install", "one", "--yes")

	if code != 1 || !strings.Contains(out, "one.greeting") {
		t.Fatalf("exit %d, output should name one.greeting:\n%s", code, out)
	}
	if _, err := os.Stat(projectRoot(t, deps)); !os.IsNotExist(err) {
		t.Fatal("project written despite missing input")
	}
}

func TestInputsCanBeSetPerApp(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", required: true, done: map[string]bool{}})

	code, out := runWith(t, deps, cat, "install", "one", "--yes", "--set", "one.greeting=hello", "--set", "one.port=9100")

	if code != 0 {
		t.Fatalf("exit %d\n%s", code, out)
	}
	if !strings.Contains(readFile(t, filepath.Join(projectRoot(t, deps), "apps", "one", "compose.yml")), ":9100:80") {
		t.Fatal("port input ignored")
	}
}

func TestRecipeInstallsItsAppsAndTakesNextFreePort(t *testing.T) {
	deps := systemtest.NewDeps(t)
	deps.PortFree = func(port int) bool { return port != 9000 }
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})

	code, out := runWith(t, deps, cat, "install", "pair", "--yes")

	if code != 0 {
		t.Fatalf("exit %d\n%s", code, out)
	}
	root := projectRoot(t, deps)
	if !strings.Contains(readFile(t, filepath.Join(root, "apps", "one", "compose.yml")), ":9001:80") {
		t.Fatal("one should move to 9001")
	}
	if !strings.Contains(readFile(t, filepath.Join(root, "apps", "two", "compose.yml")), ":9002:80") {
		t.Fatal("two should move to 9002, not reuse one's port")
	}
}

func TestSudoInstallBelongsToInvokingUser(t *testing.T) {
	deps := systemtest.NewDeps(t)
	bobHome := t.TempDir()
	deps.CurrentUser = func() (system.User, error) { return system.User{Name: "root", Home: t.TempDir()}, nil }
	deps.LookupUser = func(name string) (system.User, error) {
		return system.User{Name: name, Home: bobHome, UID: 1001, GID: 1002}, nil
	}
	systemtest.SetEnv(deps, map[string]string{"SUDO_USER": "bob", "SUDO_UID": "1001", "SUDO_GID": "1002"})
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})

	code, out := runWith(t, deps, cat, "install", "one", "--yes")

	if code != 0 {
		t.Fatalf("exit %d\n%s", code, out)
	}
	env := readFile(t, filepath.Join(bobHome, "self-host", ".env"))
	if !strings.Contains(env, "PUID=1001\n") || !strings.Contains(env, "PGID=1002\n") {
		t.Fatalf("ids not taken from sudo user:\n%s", env)
	}
}

func TestLocalExposureBindsLoopbackAndShowsInStatus(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	runWith(t, deps, cat, "install", "one", "--yes", "--exposure", "local")

	code, out := runWith(t, deps, cat, "status", "--json")

	if code != 0 {
		t.Fatalf("exit %d\n%s", code, out)
	}
	var status struct {
		Exposure string
		LANIP    string `json:"lan_ip"`
		Settings map[string]string
		Apps     []struct {
			ID, URL, State, Setup string
			Port                  int
			Managed               bool
		}
	}
	if err := json.Unmarshal([]byte(out), &status); err != nil {
		t.Fatalf("status is not one JSON document: %v\n%s", err, out)
	}
	if status.Exposure != "local" || status.Settings["BIND_IP"] != "127.0.0.1" || status.LANIP != "192.168.1.20" {
		t.Fatalf("exposure not reported: %+v", status)
	}
	if len(status.Apps) != 1 || status.Apps[0].URL != "http://127.0.0.1:9000" || status.Apps[0].Setup != "ok" || !status.Apps[0].Managed {
		t.Fatalf("app status wrong: %+v", status.Apps)
	}
}

func TestStatusReportsContainerState(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	runWith(t, deps, cat, "install", "one", "--yes")
	deps.Runner.(*systemtest.Runner).OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " ps ") {
			return system.Result{Stdout: []byte(`{"Service":"one","State":"running","Health":"healthy","Image":"example/echo:latest"}` + "\n")}
		}
		return system.Result{}
	})

	_, out := runWith(t, deps, cat, "status", "--json")

	var status struct {
		Apps []struct{ State, Health string }
	}
	if err := json.Unmarshal([]byte(out), &status); err != nil || len(status.Apps) != 1 {
		t.Fatalf("bad status: %v\n%s", err, out)
	}
	if status.Apps[0].State != "running" || status.Apps[0].Health != "healthy" {
		t.Fatalf("container state missing: %+v", status.Apps[0])
	}
}

func TestLiveLockBlocksSecondMutatingCommand(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	runWith(t, deps, cat, "install", "one", "--yes")
	os.WriteFile(filepath.Join(projectRoot(t, deps), ".lock"), []byte("777"), 0o644)
	deps.ProcessAlive = func(pid int) bool { return pid == 777 }

	code, out := runWith(t, deps, cat, "setup", "one")

	if code != 1 || !strings.Contains(out, "777") {
		t.Fatalf("exit %d, should name holder PID 777:\n%s", code, out)
	}
	if code, _ := runWith(t, deps, cat, "status"); code != 0 {
		t.Fatal("status must not take the lock")
	}
}

func TestStaleLockIsReplaced(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	runWith(t, deps, cat, "install", "one", "--yes")
	os.WriteFile(filepath.Join(projectRoot(t, deps), ".lock"), []byte("777"), 0o644)

	if code, out := runWith(t, deps, cat, "setup", "one"); code != 0 {
		t.Fatalf("stale lock blocked setup: %d\n%s", code, out)
	}
	if _, err := os.Stat(filepath.Join(projectRoot(t, deps), ".lock")); !os.IsNotExist(err) {
		t.Fatal("lock not released")
	}
}
