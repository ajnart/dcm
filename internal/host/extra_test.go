package host_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestExtraChecksAreIndependentAndCleanUpOwnedDockerResources(t *testing.T) {
	deps := systemtest.NewDeps(t)
	runner := deps.Runner.(*systemtest.Runner)
	runner.On("docker info --format {{.DockerRootDir}}", system.Result{Stdout: []byte("/var/lib/docker\n")})
	runner.On("docker network create", system.Result{ExitCode: 1, Stderr: []byte("network denied")})
	runner.On("docker volume create", system.Result{Stdout: []byte("created\n")})
	deps.DiskUsage = func(path string) (system.DiskUsage, error) {
		if path == "/var/lib/docker" {
			return system.DiskUsage{}, errors.New("unreadable")
		}
		return system.DiskUsage{AvailableBytes: 30 << 30}, nil
	}
	deps.MachineResources = func() (system.MachineResources, error) {
		return system.MachineResources{MemoryBytes: 8 << 30, CPUs: 4}, nil
	}
	deps.FileLimits = func() (system.FileLimits, error) {
		return system.FileLimits{InotifyWatches: 524288, OpenFiles: 1048576}, nil
	}
	deps.FileSystem = func(string) (system.FileSystem, error) {
		return system.FileSystem{Type: "ext4", CaseSensitive: true}, nil
	}

	checks := host.Extra(context.Background(), deps, host.ExtraOptions{ProjectPath: "/project", AppCount: 3})
	if check(checks, "disk-docker").Status != host.Warn {
		t.Fatal("an unreadable Docker path should warn")
	}
	if check(checks, "memory").Status != host.OK || check(checks, "filesystem").Status != host.OK {
		t.Fatal("later independent checks should still run")
	}
	if check(checks, "docker-network").Status != host.Warn || check(checks, "docker-volume").Status != host.OK {
		t.Fatal("network failure must not hide the volume check")
	}
	calls := strings.Join(runner.Calls(), "\n")
	if strings.Contains(calls, "docker network rm self-host-doctor-") ||
		!strings.Contains(calls, "docker volume rm self-host-doctor-") {
		t.Fatalf("owned resources were not cleaned up:\n%s", calls)
	}
}

func TestExtraChecksUseSharedRequirementsAndReportConnectivity(t *testing.T) {
	registry := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Date", time.Date(2026, 10, 6, 12, 0, 20, 0, time.UTC).Format(http.TimeFormat))
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(registry.Close)
	deps := systemtest.NewDeps(t)
	deps.DiskUsage = func(string) (system.DiskUsage, error) {
		return system.DiskUsage{AvailableBytes: 1 << 30}, nil
	}
	deps.MachineResources = func() (system.MachineResources, error) {
		return system.MachineResources{MemoryBytes: 512 << 20, CPUs: 1}, nil
	}
	deps.FileLimits = func() (system.FileLimits, error) { return system.FileLimits{}, errors.New("unsupported") }
	deps.FileSystem = func(string) (system.FileSystem, error) { return system.FileSystem{Type: "unknown"}, nil }

	checks := host.Extra(context.Background(), deps, host.ExtraOptions{
		ProjectPath: "/project", AppCount: 2,
		RegistryURL: registry.URL, ReleaseURL: registry.URL,
		RegistryHost: "registry.192-168-1-20.sslip.io", ReleaseHost: "release.192-168-1-20.sslip.io",
	})
	if check(checks, "disk-project").Status != host.Warn || check(checks, "memory").Status != host.Warn {
		t.Fatal("resource checks should use the shared per-App requirements")
	}
	if check(checks, "dns-registry").Status != host.OK || check(checks, "https-release").Status != host.OK {
		t.Fatal("DNS and HTTPS checks should report independently")
	}
	if check(checks, "clock").Status != host.OK || check(checks, "file-limits").Status != host.Skipped {
		t.Fatal("clock and unsupported limit results should have stable statuses")
	}
}

func TestExtraReportsCleanupFailure(t *testing.T) {
	deps := systemtest.NewDeps(t)
	runner := deps.Runner.(*systemtest.Runner)
	runner.On("docker volume rm", system.Result{ExitCode: 1})
	checks := host.Extra(context.Background(), deps, host.ExtraOptions{})
	if check(checks, "docker-volume").Status != host.Fail {
		t.Fatal("a temporary resource left behind must fail its check")
	}
}

func check(checks []host.ExtraCheck, id string) host.ExtraCheck {
	for _, item := range checks {
		if item.ID == id {
			return item
		}
	}
	return host.ExtraCheck{}
}
