package cli_test

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func failedOne(t *testing.T, logs string) (*system.Deps, func(args ...string) (int, string)) {
	t.Helper()
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}, fail: errors.New("greetings endpoint returned 500")})
	if code, out := runWith(t, deps, cat, "install", "one", "--yes"); code != 2 {
		t.Fatalf("install: %d\n%s", code, out)
	}
	deps.Runner.(*systemtest.Runner).OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " logs ") {
			return system.Result{Stdout: []byte(logs)}
		}
		return system.Result{}
	})
	return deps, func(args ...string) (int, string) { return runWith(t, deps, cat, args...) }
}

func TestDebugPrintsTheReportOfAFailedApp(t *testing.T) {
	_, run := failedOne(t, "one-1  | POST /greetings 500\n")

	code, out := run("debug", "one")

	want := `Debug report: Echo one (one)
State     missing
Setup     incomplete
Image     example/echo:latest
Address   http://192.168.1.20:9000

Failed steps
  fail    configure: configure echo
          error: greetings endpoint returned 500
          hint: Open the echo settings page and enable greetings.

Health check
  URL      http://192.168.1.20:9000
  Working  any answer below HTTP 500, such as the app's page or a sign-in page; HTTP 5xx, a timeout or an empty reply means it is not up

Logs (last 100 lines)
  one-1  | POST /greetings 500
`
	if code != 0 || out != want {
		t.Fatalf("debug: exit %d\ngot:\n%s\nwant:\n%s", code, out, want)
	}
}

func TestDebugJSONIsOneDocument(t *testing.T) {
	_, run := failedOne(t, "one-1  | POST /greetings 500\n")

	code, out := run("debug", "one", "--json")

	var report struct {
		ID          string   `json:"id"`
		Setup       string   `json:"setup"`
		Addresses   []string `json:"addresses"`
		FailedSteps []struct {
			ID, Status, Error, Hint string
		} `json:"failed_steps"`
		Logs        []string             `json:"logs"`
		HealthCheck struct{ URL string } `json:"health_check"`
	}
	if code != 0 || json.Unmarshal([]byte(out), &report) != nil {
		t.Fatalf("debug --json: exit %d\n%s", code, out)
	}
	if report.ID != "one" || report.Setup != "incomplete" || len(report.Addresses) != 1 || report.Addresses[0] != "http://192.168.1.20:9000" ||
		len(report.FailedSteps) != 1 || report.FailedSteps[0].ID != "configure" || report.FailedSteps[0].Status != "fail" ||
		report.FailedSteps[0].Error != "greetings endpoint returned 500" || report.FailedSteps[0].Hint != "Open the echo settings page and enable greetings." ||
		len(report.Logs) != 1 || report.Logs[0] != "one-1  | POST /greetings 500" || report.HealthCheck.URL != "http://192.168.1.20:9000" {
		t.Fatalf("unexpected report:\n%s", out)
	}
}

func TestDebugMasksAKnownSecretInBothOutputs(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}, fail: errors.New("greetings endpoint returned 500")})
	runWith(t, deps, cat, "install", "one", "--yes")
	owner, _ := deps.CurrentUser()
	secrets, err := project.Open(owner).LoadSecrets()
	if err != nil || secrets["ADMIN_PASSWORD"] == "" {
		t.Fatalf("no admin password: %v", err)
	}
	secret := secrets["ADMIN_PASSWORD"]
	deps.Runner.(*systemtest.Runner).OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " logs ") {
			return system.Result{Stdout: []byte("one-1  | rejected password " + secret + "\n")}
		}
		return system.Result{}
	})

	for _, args := range [][]string{{"debug", "one"}, {"debug", "one", "--json"}} {
		code, out := runWith(t, deps, cat, args...)
		if code != 0 || strings.Contains(out, secret) || !strings.Contains(out, "rejected password [redacted]") {
			t.Fatalf("%v: exit %d, secret leaked or log lost:\n%s", args, code, out)
		}
	}
}

func TestDebugRejectsAnAppOutsideTheProject(t *testing.T) {
	_, run := failedOne(t, "")

	code, out := run("debug", "ghost")

	if code != 1 || out != "error: ghost is not in the Project (see: self-host status)\n" {
		t.Fatalf("debug ghost: exit %d\n%s", code, out)
	}
}
