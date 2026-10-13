package cli_test

import (
	"encoding/json"
	"strings"
	"syscall"
	"testing"

	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func hostReportDeps(t *testing.T) *system.Deps {
	t.Helper()
	deps := systemtest.NewDeps(t)
	deps.GOOS = "darwin"
	deps.GOARCH = "arm64"
	deps.Runner.(*systemtest.Runner).On("docker version", system.Result{Stdout: []byte("27.3.1\n")})
	deps.Runner.(*systemtest.Runner).On("docker context inspect", system.Result{Stdout: []byte("unix:///var/run/docker.sock\n")})
	deps.BindTCP = func(network, address string) error {
		if address == "127.0.0.1:80" {
			return syscall.EPERM
		}
		if address == "[::]:443" {
			return syscall.EADDRINUSE
		}
		return nil
	}
	return deps
}

func TestHostReportJSONIsOneStableReadOnlyDocument(t *testing.T) {
	deps := hostReportDeps(t)

	code, out := run(t, deps, "host", "report", "--json")
	if code != 0 {
		t.Fatalf("exit %d:\n%s", code, out)
	}
	var report service.HostReport
	if err := json.Unmarshal([]byte(out), &report); err != nil {
		t.Fatalf("invalid JSON: %v\n%s", err, out)
	}
	if report.SchemaVersion != 1 || report.OS != "darwin" || report.Architecture != "arm64" {
		t.Fatalf("machine identity = %+v", report)
	}
	if !report.Docker.Installed || !report.Docker.DaemonReachable || !report.Docker.SocketReachable || report.Docker.EndpointKind != "unix" || report.Docker.Version != "27.3.1" {
		t.Fatalf("docker = %+v", report.Docker)
	}
	if len(report.Ports) != 2 || len(report.Ports[0].Probes) != 3 || report.Ports[0].Probes[1].ErrorClass != "EPERM" || report.Ports[1].Probes[2].Result != "in_use" {
		t.Fatalf("ports = %+v", report.Ports)
	}
}

func TestHostReportDoesNotCallARemoteDaemonALocalSocket(t *testing.T) {
	deps := hostReportDeps(t)
	systemtest.SetEnv(deps, map[string]string{"DOCKER_HOST": "ssh://builder.example"})

	code, out := run(t, deps, "host", "report", "--json")
	var report service.HostReport
	if err := json.Unmarshal([]byte(out), &report); code != 0 || err != nil {
		t.Fatalf("exit %d, JSON error %v:\n%s", code, err, out)
	}
	if !report.Docker.DaemonReachable || report.Docker.SocketReachable || report.Docker.EndpointKind != "ssh" {
		t.Fatalf("remote daemon reported as a local socket: %+v", report.Docker)
	}
}

func TestHostReportDockerContextOverridesDockerHost(t *testing.T) {
	deps := hostReportDeps(t)
	systemtest.SetEnv(deps, map[string]string{
		"DOCKER_CONTEXT": "desktop-linux",
		"DOCKER_HOST":    "tcp://builder.example:2376",
	})
	deps.Runner.(*systemtest.Runner).On("docker context inspect desktop-linux", system.Result{Stdout: []byte("unix:///Users/test/.docker/run/docker.sock\n")})

	_, out := run(t, deps, "host", "report", "--json")
	var report service.HostReport
	if err := json.Unmarshal([]byte(out), &report); err != nil {
		t.Fatal(err)
	}
	if !report.Docker.DaemonReachable || !report.Docker.SocketReachable || report.Docker.EndpointKind != "unix" {
		t.Fatalf("DOCKER_CONTEXT did not override DOCKER_HOST: %+v", report.Docker)
	}
}

func TestHostReportPrintsEveryFindingAndStillSucceeds(t *testing.T) {
	deps := hostReportDeps(t)

	code, out := run(t, deps, "host", "report")
	if code != 0 {
		t.Fatalf("exit %d:\n%s", code, out)
	}
	for _, text := range []string{"Host report", "darwin/arm64", "Docker", "IPv6", "0.0.0.0:80", "127.0.0.1:80", "[::]:443", "permission (EPERM)", "in use (EADDRINUSE)"} {
		if !strings.Contains(out, text) {
			t.Fatalf("missing %q:\n%s", text, out)
		}
	}
}

func TestHostReportSucceedsWhenDockerCannotBeReached(t *testing.T) {
	deps := systemtest.NewDeps(t)
	deps.Runner.(*systemtest.Runner).On("docker version", system.Result{ExitCode: 1, Stderr: []byte("permission denied at private socket path")})

	code, out := run(t, deps, "host", "report", "--json")
	var report service.HostReport
	if err := json.Unmarshal([]byte(out), &report); code != 0 || err != nil {
		t.Fatalf("exit %d, JSON error %v:\n%s", code, err, out)
	}
	if !report.Docker.Installed || report.Docker.SocketReachable || report.Docker.Version != "" {
		t.Fatalf("docker = %+v", report.Docker)
	}
	if strings.Contains(out, "private socket path") {
		t.Fatalf("raw Docker error leaked into report: %s", out)
	}
}
