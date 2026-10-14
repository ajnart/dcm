package service

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type dockerSocketApp struct{ *testApp }

func (a *dockerSocketApp) Info() app.Info {
	return app.Info{ID: "beszel", Name: "Beszel", Image: "example/beszel:1", Port: 8090, ContainerPort: 8090, Service: "beszel-socket-proxy"}
}

func (*dockerSocketApp) DockerSocketTarget() string { return "/var/run/docker.sock" }

func (a *dockerSocketApp) Compose(rc app.RenderContext) string {
	return "services:\n  beszel-socket-proxy:\n    image: " + a.Info().Image + "\n    volumes:\n      - " + rc.DockerSocket + ":/var/run/docker.sock:ro\n"
}

func (a *dockerSocketApp) Setup(ctx context.Context, h *helpers.H) error {
	return a.testApp.Setup(ctx, h)
}

func TestAnArgumentThatIsAnAppAndARecipeMeansTheRecipeEverywhere(t *testing.T) {
	apps := []app.App{
		&testApp{id: "media", done: map[string]bool{}},
		&testApp{id: "jellyfin", done: map[string]bool{}},
		&testApp{id: "ntfy", done: map[string]bool{}},
	}
	recipes := []catalog.Recipe{{ID: "media", Apps: []string{"jellyfin", "ntfy"}}}
	svc := New(systemtest.NewDeps(t), events.New(&recorder{}), catalog.New(apps, recipes))

	resolved, err := svc.Resolve([]string{"media"})
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, a := range resolved {
		ids = append(ids, a.Info().ID)
	}
	if want := []string{"jellyfin", "ntfy"}; !reflect.DeepEqual(ids, want) {
		t.Fatalf("Resolve = %v, want %v", ids, want)
	}
	if got, want := svc.recipeOf([]string{"media"}), map[string]string{"jellyfin": "media", "ntfy": "media"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("recipeOf = %v, want %v", got, want)
	}
}

func TestInstallRendersSocketFromExplicitDockerContext(t *testing.T) {
	a := &dockerSocketApp{testApp: &testApp{id: "beszel", done: map[string]bool{}}}
	h := newHarness(t, a)
	h.deps.Getenv = func(key string) string {
		return map[string]string{
			"DOCKER_CONTEXT": "rootless",
			"DOCKER_HOST":    "unix:///wrong/docker.sock",
		}[key]
	}
	h.runner.On("docker context inspect", system.Result{Stdout: []byte("unix:///run/user/1000/docker.sock\n")})

	if err := h.install("beszel"); err != nil {
		t.Fatal(err)
	}
	fragment, err := os.ReadFile(filepath.Join(h.root(), "apps", "beszel", "compose.yml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(fragment), "/run/user/1000/docker.sock:/var/run/docker.sock:ro") {
		t.Fatalf("fragment did not use the explicit context socket:\n%s", fragment)
	}
}

func TestInstallRefusesRemoteDockerContextForSocketMount(t *testing.T) {
	a := &dockerSocketApp{testApp: &testApp{id: "beszel", done: map[string]bool{}}}
	h := newHarness(t, a)
	h.deps.Getenv = func(key string) string {
		if key == "DOCKER_CONTEXT" {
			return "remote"
		}
		return ""
	}
	h.runner.On("docker context inspect", system.Result{Stdout: []byte("ssh://docker.example.test\n")})

	err := h.install("beszel")
	if err == nil || !strings.Contains(err.Error(), "not a Unix socket") {
		t.Fatalf("Install error = %v, want remote-context refusal", err)
	}
	if _, statErr := os.Stat(filepath.Join(h.root(), "apps", "beszel", "compose.yml")); !os.IsNotExist(statErr) {
		t.Fatalf("fragment was written before refusal: %v", statErr)
	}
}

func TestInstallStopsBeforeAnyChangeWhenDockerSocketIsDenied(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	h.runner.On("docker version", system.Result{ExitCode: 1, Stderr: []byte("permission denied while trying to connect to the Docker daemon socket")})

	err := h.install("one")
	if err == nil || !strings.Contains(err.Error(), "sudo usermod -aG docker $USER") {
		t.Fatalf("Install error = %v, want the socket hint", err)
	}
	e := h.rec.find("", "docker-socket")
	if e == nil || e.Event != events.StepFail || e.Hint != host.SocketDeniedHint {
		t.Fatalf("docker-socket event = %+v", e)
	}
	if _, statErr := os.Stat(h.root()); !os.IsNotExist(statErr) {
		t.Fatalf("Project written before refusal: %v", statErr)
	}
	if calls := h.composeCalls(); len(calls) != 0 {
		t.Fatalf("compose ran: %v", calls)
	}
}
