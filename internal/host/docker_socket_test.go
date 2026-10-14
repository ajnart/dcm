package host_test

import (
	"context"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestActiveDockerEndpointUsesDockerHost(t *testing.T) {
	deps := systemtest.NewDeps(t, systemtest.WithEnv(map[string]string{"DOCKER_HOST": "unix:///run/user/1000/docker.sock"}))

	got, err := host.ActiveDockerEndpoint(context.Background(), deps)
	if err != nil {
		t.Fatal(err)
	}
	if got.Host != "unix:///run/user/1000/docker.sock" {
		t.Fatalf("DockerSocket = %q, want the rootless DOCKER_HOST path", got)
	}
}

func TestActiveDockerEndpointUsesActiveContext(t *testing.T) {
	runner := &systemtest.Runner{}
	runner.On("docker context inspect", system.Result{Stdout: []byte("unix:///var/run/docker.sock\n")})
	deps := systemtest.NewDeps(t, systemtest.WithRunner(runner))

	got, err := host.ActiveDockerEndpoint(context.Background(), deps)
	if err != nil {
		t.Fatal(err)
	}
	if got.Host != "unix:///var/run/docker.sock" {
		t.Fatalf("DockerSocket = %q, want the active context path", got)
	}
}

func TestActiveDockerEndpointContextOverridesDockerHost(t *testing.T) {
	runner := &systemtest.Runner{}
	runner.On("docker context inspect", system.Result{Stdout: []byte("unix:///run/user/1000/docker.sock\n")})
	deps := systemtest.NewDeps(t,
		systemtest.WithRunner(runner),
		systemtest.WithEnv(map[string]string{
			"DOCKER_CONTEXT": "rootless",
			"DOCKER_HOST":    "unix:///wrong/docker.sock",
		}),
	)

	got, err := host.ActiveDockerEndpoint(context.Background(), deps)
	if err != nil {
		t.Fatal(err)
	}
	if got.Host != "unix:///run/user/1000/docker.sock" {
		t.Fatalf("ActiveDockerEndpoint = %q, want the explicit context socket", got)
	}
	if calls := runner.Calls(); len(calls) != 1 || !strings.HasSuffix(calls[0], " rootless") {
		t.Fatalf("Docker commands = %v, want inspection of the explicit context", calls)
	}
}

func TestActiveDockerEndpointClassifiesRemoteContext(t *testing.T) {
	runner := &systemtest.Runner{}
	runner.On("docker context inspect", system.Result{Stdout: []byte("ssh://docker.example.test\n")})
	deps := systemtest.NewDeps(t,
		systemtest.WithRunner(runner),
		systemtest.WithEnv(map[string]string{"DOCKER_CONTEXT": "remote"}),
	)

	got, err := host.ActiveDockerEndpoint(context.Background(), deps)
	if err != nil || got.Kind != "ssh" {
		t.Fatalf("endpoint = %+v, %v, want an ssh endpoint", got, err)
	}
}
