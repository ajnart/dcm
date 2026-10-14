package cli_test

import (
	"encoding/json"
	"net/http"
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
	if report.OS != "darwin" || report.Architecture != "arm64" {
		t.Fatalf("machine identity = %+v", report)
	}
	if !report.Docker.Installed || !report.Docker.DaemonReachable || report.Docker.EndpointKind != "unix" || report.Docker.Version != "27.3.1" {
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
	if !report.Docker.DaemonReachable || report.Docker.EndpointKind != "ssh" {
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
	if !report.Docker.DaemonReachable || report.Docker.EndpointKind != "unix" {
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
	if !report.Docker.Installed || report.Docker.Version != "" {
		t.Fatalf("docker = %+v", report.Docker)
	}
	if strings.Contains(out, "private socket path") {
		t.Fatalf("raw Docker error leaked into report: %s", out)
	}
}

func TestHostReportExtraIsOptInAndAdditive(t *testing.T) {
	deps := hostReportDeps(t)
	deps.HTTP = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: http.NoBody}, nil
	})}
	deps.DiskUsage = func(string) (system.DiskUsage, error) { return system.DiskUsage{AvailableBytes: 20 << 30}, nil }
	deps.MachineResources = func() (system.MachineResources, error) {
		return system.MachineResources{MemoryBytes: 4 << 30, CPUs: 4}, nil
	}
	deps.FileLimits = func() (system.FileLimits, error) {
		return system.FileLimits{InotifyWatches: 524288, OpenFiles: 1048576}, nil
	}
	deps.FileSystem = func(string) (system.FileSystem, error) {
		return system.FileSystem{Type: "apfs", CaseSensitive: false}, nil
	}

	_, plain := run(t, deps, "host", "report", "--json")
	if strings.Contains(plain, `"extra"`) {
		t.Fatalf("default report changed: %s", plain)
	}
	code, out := run(t, deps, "host", "report", "--extra", "--json")
	var report service.HostReport
	if err := json.Unmarshal([]byte(out), &report); code != 0 || err != nil {
		t.Fatalf("exit %d, JSON error %v:\n%s", code, err, out)
	}
	if len(report.Extra) < 10 {
		t.Fatalf("extra report is not additive: %+v", report)
	}
	foundFilesystem := false
	for _, item := range report.Extra {
		if item.ID == "filesystem" && item.Level == "warn" {
			foundFilesystem = true
		}
	}
	if !foundFilesystem {
		t.Fatal("extra report omitted the case-sensitivity warning")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
