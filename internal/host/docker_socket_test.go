package host_test

import (
	"context"
	"testing"

	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestDockerSocketUsesDockerHost(t *testing.T) {
	deps := systemtest.NewDeps(t, systemtest.WithEnv(map[string]string{"DOCKER_HOST": "unix:///run/user/1000/docker.sock"}))

	got, err := host.DockerSocket(context.Background(), deps)
	if err != nil {
		t.Fatal(err)
	}
	if got != "/run/user/1000/docker.sock" {
		t.Fatalf("DockerSocket = %q, want the rootless DOCKER_HOST path", got)
	}
}

func TestDockerSocketUsesActiveContext(t *testing.T) {
	runner := &systemtest.Runner{}
	runner.On("docker context inspect", system.Result{Stdout: []byte(`"unix:///var/run/docker.sock"`)})
	deps := systemtest.NewDeps(t, systemtest.WithRunner(runner))

	got, err := host.DockerSocket(context.Background(), deps)
	if err != nil {
		t.Fatal(err)
	}
	if got != "/var/run/docker.sock" {
		t.Fatalf("DockerSocket = %q, want the active context path", got)
	}
}
