package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

const extraWhoami = "services:\n  whoami:\n    image: traefik/whoami\n    ports:\n      - ${BIND_IP}:8099:80\n"

func (h *harness) writeExtra(name, content string) {
	h.t.Helper()
	dir := filepath.Join(h.root(), "extra", name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		h.t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "compose.yml"), []byte(content), 0o644); err != nil {
		h.t.Fatal(err)
	}
}

func TestStatusListsExtraAppAsUnmanagedWithItsAddress(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	h.writeExtra("whoami", extraWhoami)
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " ps ") {
			return system.Result{Stdout: []byte(`[{"Service":"whoami","State":"running","Publishers":[{"PublishedPort":8099,"TargetPort":80,"Protocol":"tcp"}]}]`)}
		}
		return system.Result{}
	})

	status, err := h.svc.Status(context.Background())

	if err != nil {
		t.Fatal(err)
	}
	if len(status.Apps) != 2 {
		t.Fatalf("apps = %+v", status.Apps)
	}
	got := status.Apps[1]
	if got.ID != "whoami" || got.Managed || got.Setup != "unmanaged" || got.URL != "http://192.168.1.20:8099" || got.Port != 8099 || got.State != "running" {
		t.Fatalf("extra App = %+v", got)
	}
}

func TestInstallRefusesAnAppNamedLikeAnExtraApp(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	h.writeExtra("one", extraWhoami)

	err := h.install("one")

	if err == nil || !strings.Contains(err.Error(), "Unmanaged app") {
		t.Fatalf("install over an extra App: %v", err)
	}
}

func TestStartingAnExtraAppLetsTheDashboardAddItsTile(t *testing.T) {
	dashboard := &inventoryProbeApp{testApp: &testApp{id: "homarr", done: map[string]bool{}}, inspect: true}
	h := newHarness(t, dashboard)
	if err := h.install("homarr"); err != nil {
		t.Fatal(err)
	}
	h.writeExtra("whoami", extraWhoami)
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " ps ") {
			return system.Result{Stdout: []byte(`[{"Service":"whoami","State":"running","Publishers":[{"PublishedPort":8099,"TargetPort":80,"Protocol":"tcp"}]}]`)}
		}
		return system.Result{}
	})
	dashboard.installed = nil

	if err := h.svc.Start(context.Background(), []string{"whoami"}); err != nil {
		t.Fatal(err)
	}

	want := helpers.InstalledApp{ID: "whoami", Name: "whoami", URL: "http://192.168.1.20:8099", Service: "whoami", ContainerPort: 80}
	if len(dashboard.installed) != 2 || dashboard.installed[1] != want {
		t.Fatalf("dashboard inventory = %+v", dashboard.installed)
	}
}
