package host_test

import (
	"context"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestActiveDockerSocketUsesDockerHost(t *testing.T) {
	deps := systemtest.NewDeps(t, systemtest.WithEnv(map[string]string{"DOCKER_HOST": "unix:///run/user/1000/docker.sock"}))

	got, err := host.ActiveDockerSocket(context.Background(), deps)
	if err != nil {
		t.Fatal(err)
	}
	if got != "/run/user/1000/docker.sock" {
		t.Fatalf("DockerSocket = %q, want the rootless DOCKER_HOST path", got)
	}
}

func TestActiveDockerSocketUsesActiveContext(t *testing.T) {
	runner := &systemtest.Runner{}
	runner.On("docker context inspect", system.Result{Stdout: []byte("unix:///var/run/docker.sock\n")})
	deps := systemtest.NewDeps(t, systemtest.WithRunner(runner))

	got, err := host.ActiveDockerSocket(context.Background(), deps)
	if err != nil {
		t.Fatal(err)
	}
	if got != "/var/run/docker.sock" {
		t.Fatalf("DockerSocket = %q, want the active context path", got)
	}
}

func TestActiveDockerSocketContextOverridesDockerHost(t *testing.T) {
	runner := &systemtest.Runner{}
	runner.On("docker context inspect", system.Result{Stdout: []byte("unix:///run/user/1000/docker.sock\n")})
	deps := systemtest.NewDeps(t,
		systemtest.WithRunner(runner),
		systemtest.WithEnv(map[string]string{
			"DOCKER_CONTEXT": "rootless",
			"DOCKER_HOST":    "unix:///wrong/docker.sock",
		}),
	)

	got, err := host.ActiveDockerSocket(context.Background(), deps)
	if err != nil {
		t.Fatal(err)
	}
	if got != "/run/user/1000/docker.sock" {
		t.Fatalf("ActiveDockerSocket = %q, want the explicit context socket", got)
	}
	if calls := runner.Calls(); len(calls) != 1 || !strings.HasSuffix(calls[0], " rootless") {
		t.Fatalf("Docker commands = %v, want inspection of the explicit context", calls)
	}
}

func TestActiveDockerSocketRefusesRemoteContext(t *testing.T) {
	runner := &systemtest.Runner{}
	runner.On("docker context inspect", system.Result{Stdout: []byte("ssh://docker.example.test\n")})
	deps := systemtest.NewDeps(t,
		systemtest.WithRunner(runner),
		systemtest.WithEnv(map[string]string{"DOCKER_CONTEXT": "remote"}),
	)

	if _, err := host.ActiveDockerSocket(context.Background(), deps); err == nil {
		t.Fatal("ActiveDockerSocket accepted a remote Docker context")
	}
}
