package cli_test

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/cli"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func decodeEvents(t *testing.T, out string) []map[string]any {
	t.Helper()
	var events []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatalf("line is not JSON: %q", line)
		}
		events = append(events, event)
	}
	return events
}

func findCheck(events []map[string]any, id string) map[string]any {
	for _, event := range events {
		if event["step"] == id && strings.HasPrefix(event["event"].(string), "step.") && event["event"] != "step.start" {
			return event
		}
	}
	return nil
}

func run(t *testing.T, deps *system.Deps, args ...string) (int, string) {
	t.Helper()
	var out bytes.Buffer
	deps.Out = &out
	deps.Err = &out
	code := cli.Run(context.Background(), deps, args)
	return code, out.String()
}

func TestDoctorReportsMissingDockerWithDocsLink(t *testing.T) {
	deps := systemtest.NewDeps(t)
	deps.LookPath = func(string) (string, error) { return "", system.ErrNotFound }

	code, out := run(t, deps, "doctor", "--json")

	if code != 1 {
		t.Fatalf("exit code = %d, want 1\n%s", code, out)
	}
	check := findCheck(decodeEvents(t, out), "docker")
	if check == nil || check["event"] != "step.fail" {
		t.Fatalf("missing failed docker check:\n%s", out)
	}
	if check["docs"] != "https://docs.docker.com/engine/install/" {
		t.Fatalf("docs = %v", check["docs"])
	}
}

func TestDoctorPointsMacUsersToOrbStack(t *testing.T) {
	deps := systemtest.NewDeps(t)
	deps.GOOS = "darwin"
	deps.LookPath = func(string) (string, error) { return "", system.ErrNotFound }

	_, out := run(t, deps, "doctor", "--json")

	check := findCheck(decodeEvents(t, out), "docker")
	if check["docs"] != "https://orbstack.dev/download" {
		t.Fatalf("docs = %v", check["docs"])
	}
}

func TestDoctorReportsSocketPermissionDenied(t *testing.T) {
	deps := systemtest.NewDeps(t)
	deps.Runner.(*systemtest.Runner).On("docker version", system.Result{ExitCode: 1,
		Stderr: []byte("permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock")})

	code, out := run(t, deps, "doctor", "--json")

	if code != 1 {
		t.Fatalf("exit code = %d, want 1", code)
	}
	check := findCheck(decodeEvents(t, out), "docker-socket")
	if check == nil || check["event"] != "step.fail" {
		t.Fatalf("missing failed socket check:\n%s", out)
	}
	if check["docs"] != "https://docs.docker.com/engine/install/linux-postinstall/" {
		t.Fatalf("docs = %v", check["docs"])
	}
}

func TestDoctorRequiresComposeV2(t *testing.T) {
	deps := systemtest.NewDeps(t)
	deps.Runner.(*systemtest.Runner).On("docker compose version", system.Result{ExitCode: 1,
		Stderr: []byte("docker: 'compose' is not a docker command.")})

	code, out := run(t, deps, "doctor", "--json")

	if code != 1 {
		t.Fatalf("exit code = %d, want 1", code)
	}
	if check := findCheck(decodeEvents(t, out), "compose"); check == nil || check["event"] != "step.fail" {
		t.Fatalf("missing failed compose check:\n%s", out)
	}
}

func TestDoctorPassesOnHealthyHost(t *testing.T) {
	deps := systemtest.NewDeps(t)

	code, out := run(t, deps, "doctor", "--json")

	if code != 0 {
		t.Fatalf("exit code = %d, want 0\n%s", code, out)
	}
	events := decodeEvents(t, out)
	for _, id := range []string{"docker", "docker-socket", "compose"} {
		if check := findCheck(events, id); check == nil || check["event"] != "step.ok" {
			t.Fatalf("check %s not ok:\n%s", id, out)
		}
	}
	if events[0]["event"] != "run.start" || events[len(events)-1]["event"] != "run.end" {
		t.Fatalf("run not framed by run.start/run.end:\n%s", out)
	}
}

func TestDoctorHumanOutputShowsHints(t *testing.T) {
	deps := systemtest.NewDeps(t)
	deps.LookPath = func(string) (string, error) { return "", system.ErrNotFound }

	_, out := run(t, deps, "doctor")

	if !strings.Contains(out, "✗") || !strings.Contains(out, "https://docs.docker.com/engine/install/") {
		t.Fatalf("human output lacks failure mark or docs link:\n%s", out)
	}
}

func TestVersionFlag(t *testing.T) {
	deps := systemtest.NewDeps(t)
	deps.Version = "1.2.3"

	code, out := run(t, deps, "--version")

	if code != 0 || !strings.Contains(out, "1.2.3") {
		t.Fatalf("code=%d out=%q", code, out)
	}
}
