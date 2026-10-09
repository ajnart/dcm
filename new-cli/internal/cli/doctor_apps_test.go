package cli_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

// doctorProject installs app "one" on a test server's port and makes
// `docker compose ps` publish it on bindIP.
func doctorProject(t *testing.T, bindIP string, exposure ...string) (*system.Deps, *catalog.Catalog, *httptest.Server) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	t.Cleanup(server.Close)
	deps := systemtest.NewDeps(t)
	deps.LANIP = func() (string, error) { return "127.0.0.1", nil }
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	args := []string{"install", "one", "--yes", "--set", "one.port=" + clitest.Port(server)}
	args = append(args, exposure...)
	if code, out := runWith(t, deps, cat, args...); code != 0 {
		t.Fatalf("install: %d\n%s", code, out)
	}
	port := clitest.Port(server)
	deps.Runner.(*systemtest.Runner).OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " ps ") {
			return system.Result{Stdout: []byte(`{"Service":"one","State":"running","Publishers":[{"URL":"` + bindIP + `","TargetPort":80,"PublishedPort":` + port + `,"Protocol":"tcp"}]}` + "\n")}
		}
		return system.Result{}
	})
	return deps, cat, server
}

func doctor(t *testing.T, deps *system.Deps, cat *catalog.Catalog) clitest.Result {
	t.Helper()
	return clitest.Run(t, deps, cat, "doctor", "--json")
}

func TestDoctorPassesForAReachableLANApp(t *testing.T) {
	deps, cat, _ := doctorProject(t, "0.0.0.0")

	r := doctor(t, deps, cat)

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	for _, step := range []string{"running", "binding", "reachable"} {
		if r.StepEvent("one", step) != "step.ok" {
			t.Errorf("%s not ok:\n%s", step, r.Out)
		}
	}
}

func TestDoctorFailsWhenALANAppIsBoundToLoopback(t *testing.T) {
	deps, cat, _ := doctorProject(t, "127.0.0.1")

	r := doctor(t, deps, cat)

	binding := r.Step("one", "binding")
	if r.Code != 1 || binding == nil || binding["event"] != "step.fail" || !strings.Contains(binding["hint"].(string), "self-host start one") {
		t.Fatalf("binding should fail with a recreate hint:\n%s", r.Out)
	}
}

func TestDoctorWarnsThatLocalExposureHidesAppsFromOtherDevices(t *testing.T) {
	deps, cat, _ := doctorProject(t, "127.0.0.1", "--exposure", "local")

	r := doctor(t, deps, cat)

	exposure := r.Step("", "exposure")
	if r.Code != 0 || exposure == nil || exposure["event"] != "step.warn" || !strings.Contains(exposure["msg"].(string), "other devices cannot connect") {
		t.Fatalf("expected exposure warning, exit %d:\n%s", r.Code, r.Out)
	}
	if !strings.Contains(exposure["hint"].(string), "self-host config set EXPOSURE=lan") {
		t.Fatalf("hint should explain how to switch: %v", exposure["hint"])
	}
}

func TestDoctorFailsWhenTheAppDoesNotAnswer(t *testing.T) {
	deps, cat, server := doctorProject(t, "0.0.0.0")
	server.Close()

	r := doctor(t, deps, cat)

	if r.Code != 1 || r.StepEvent("one", "reachable") != "step.fail" {
		t.Fatalf("reachability should fail:\n%s", r.Out)
	}
}

func TestDoctorWarnsAboutActiveUFW(t *testing.T) {
	deps, cat, _ := doctorProject(t, "0.0.0.0")
	deps.Runner.(*systemtest.Runner).On("systemctl is-active ufw", system.Result{Stdout: []byte("active\n")})

	r := doctor(t, deps, cat)

	fw := r.Step("", "firewall")
	if fw == nil || fw["event"] != "step.warn" || !strings.Contains(fw["hint"].(string), "ufw allow") {
		t.Fatalf("expected ufw warning:\n%s", r.Out)
	}
}

func TestDoctorWarnsAboutTheMacOSFirewall(t *testing.T) {
	deps, cat, _ := doctorProject(t, "0.0.0.0")
	deps.GOOS = "darwin"
	deps.Runner.(*systemtest.Runner).On("/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate", system.Result{Stdout: []byte("Firewall is enabled. (State = 1)\n")})

	r := doctor(t, deps, cat)

	if fw := r.Step("", "firewall"); fw == nil || fw["event"] != "step.warn" {
		t.Fatalf("expected macOS firewall warning:\n%s", r.Out)
	}
}

func TestDoctorReportsAnUnopenableProjectLock(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root can open a lock regardless of its mode")
	}
	deps, cat, _ := doctorProject(t, "0.0.0.0")
	lock := filepath.Join(projectRoot(t, deps), ".lock")
	if err := os.WriteFile(lock, []byte("flock:1"), 0o000); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(lock, 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(lock, 0o600) })

	r := doctor(t, deps, cat)

	check := r.Step("", "project-lock")
	if check == nil || check["event"] != "step.fail" {
		t.Fatalf("doctor must report the unopenable lock:\n%s", r.Out)
	}
	msg := check["msg"].(string)
	if !strings.Contains(msg, lock) || !strings.Contains(msg, "sudo chown") {
		t.Fatalf("lock check lacks the path or the fix: %v", check)
	}
}

func TestDoctorFailsForAStoppedApp(t *testing.T) {
	deps, cat, _ := doctorProject(t, "0.0.0.0")
	deps.Runner.(*systemtest.Runner).OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " ps ") {
			return system.Result{Stdout: []byte(`{"Service":"one","State":"exited"}` + "\n")}
		}
		return system.Result{}
	})

	r := doctor(t, deps, cat)

	running := r.Step("one", "running")
	if r.Code != 1 || running == nil || running["event"] != "step.fail" || !strings.Contains(running["hint"].(string), "self-host start one") {
		t.Fatalf("stopped app should fail:\n%s", r.Out)
	}
}
