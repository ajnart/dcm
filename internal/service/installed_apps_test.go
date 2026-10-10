package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/postgresql"
	"github.com/ajnart/self-host/internal/apps/restic"
	"github.com/ajnart/self-host/internal/apps/valkey"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type inventoryProbeApp struct {
	*testApp
	inspect   bool
	installed []helpers.InstalledApp
	info      *app.Info
}

func (a *inventoryProbeApp) Info() app.Info {
	if a.info != nil {
		return *a.info
	}
	return a.testApp.Info()
}

func (a *inventoryProbeApp) Setup(ctx context.Context, h *helpers.H) error {
	if a.inspect {
		if h.InstalledApps == nil {
			return errors.New("installed App inventory unavailable")
		}
		var err error
		a.installed, err = h.InstalledApps(ctx)
		if err != nil {
			return err
		}
	}
	return a.testApp.Setup(ctx, h)
}

func TestSetupDoesNotAdvertiseBrowserLinksForNonWebApps(t *testing.T) {
	for _, info := range []app.Info{postgresql.App{}.Info(), valkey.App{}.Info(), restic.App{}.Info()} {
		t.Run(info.ID, func(t *testing.T) {
			a := &inventoryProbeApp{testApp: &testApp{id: info.ID, done: map[string]bool{}}, inspect: true, info: &info}
			h := newHarness(t, a)
			if err := h.install(info.ID); err != nil {
				t.Fatal(err)
			}
			if len(a.installed) != 1 || a.installed[0].URL != "" {
				t.Fatalf("non-Web App advertised as a browser link: %+v", a.installed)
			}
		})
	}
}

func TestSetupCanListManagedAndUnmanagedAppEndpoints(t *testing.T) {
	a := &inventoryProbeApp{testApp: &testApp{id: "one", done: map[string]bool{}}}
	h := newHarness(t, a)
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	p, err := h.svc.Project()
	if err != nil {
		t.Fatal(err)
	}
	if err := p.WriteFragment("custom", "services:\n  custom-web:\n    image: example/web:latest\n    ports: [\"127.0.0.1:19001:8080\"]\n"); err != nil {
		t.Fatal(err)
	}
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " ps ") {
			return system.Result{Stdout: []byte(`[{"Service":"custom-web","State":"running","Publishers":[{"PublishedPort":19001,"TargetPort":8080,"Protocol":"tcp"}]}]`)}
		}
		return system.Result{}
	})
	a.inspect = true
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	if len(a.installed) != 2 {
		t.Fatalf("installed Apps = %+v", a.installed)
	}
	want := []helpers.InstalledApp{
		{ID: "custom", Name: "custom", URL: "http://192.168.1.20:19001", Service: "custom-web", ContainerPort: 8080},
		{ID: "one", Name: "one", URL: "http://192.168.1.20:9000", Service: "one", ContainerPort: 80},
	}
	for i, expected := range want {
		if a.installed[i] != expected {
			t.Errorf("App %d = %+v, want %+v", i, a.installed[i], expected)
		}
	}
}
