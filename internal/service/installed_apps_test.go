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
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestHomarrInventorySharesCombinedStatusNavigation(t *testing.T) {
	h, _, opts := publicationHarness(t)
	paperless, _ := h.svc.Catalog.App("paperless-ngx")
	paperless.(*publicationApp).path = "/custom/path?view=all"
	dashboard := &inventoryProbeApp{testApp: &testApp{id: "homarr", done: map[string]bool{}}, inspect: true}
	h.svc.Catalog = catalog.New(append(h.svc.Catalog.Apps(), dashboard), nil)
	net := &tailnet{running: []string{"paperless-ngx", "jellyfin", "homarr", "cloudflare-tunnel", "access-caddy"}, trackStartup: true}
	net.install(h)
	if err := h.install("homarr"); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.ConfigSet(t.Context(), []string{"EASY_NAMES=on"}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.CloudflarePublish(t.Context(), opts); err != nil {
		t.Fatal(err)
	}
	if err := h.installTailscale(); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"private", "private-public-stopped", "private-unknown", "public", "names", "ip", "inventory-error"} {
		t.Run(mode, func(t *testing.T) {
			switch mode {
			case "private-public-stopped":
				net.running = []string{"paperless-ngx", "jellyfin", "homarr", "tailscale", "tailscale-paperless-ngx", "tailscale-jellyfin", "access-caddy"}
				net.stopped = []string{"cloudflare-tunnel"}
			case "private-unknown":
				net.running = []string{"paperless-ngx", "jellyfin", "homarr", "cloudflare-tunnel", "access-caddy"}
				net.stopped = nil
				net.unknown = []string{"tailscale-paperless-ngx"}
			case "public":
				net.running = []string{"paperless-ngx", "jellyfin", "homarr", "cloudflare-tunnel", "access-caddy"}
				net.unknown = nil
			case "names":
				net.running = []string{"paperless-ngx", "jellyfin", "homarr", "access-caddy"}
			case "ip":
				net.running = []string{"paperless-ngx", "jellyfin", "homarr"}
			case "inventory-error":
				if err := h.svc.ConfigSet(t.Context(), []string{"EASY_NAMES=off"}); err != nil {
					t.Fatal(err)
				}
				h.runner.On("docker compose --project-directory", system.Result{ExitCode: 1, Stderr: []byte("inventory unavailable")})
			}
			if err := h.svc.Setup(t.Context(), []string{"homarr"}); err != nil {
				t.Fatal(err)
			}
			want := map[string]string{
				"private":                "https://paperless-ngx.tail1234.ts.net/custom/path?view=all",
				"private-public-stopped": "https://paperless-ngx.tail1234.ts.net/custom/path?view=all",
				"private-unknown":        "https://paperless-ngx.example.com/custom/path?view=all",
				"public":                 "https://paperless-ngx.example.com/custom/path?view=all",
				"names":                  "http://paperless-ngx.192-168-1-20.sslip.io/custom/path?view=all",
				"ip":                     "http://192.168.1.20:9000/custom/path?view=all",
				"inventory-error":        "http://192.168.1.20:9000/custom/path?view=all",
			}[mode]
			for _, item := range dashboard.installed {
				if item.ID == "paperless-ngx" && item.URL != want {
					t.Fatalf("%s inventory = %+v, want %s", mode, item, want)
				}
			}
			a := appStatus(t, h, "paperless-ngx")
			if a.URL != want || a.observationURL() != "http://192.168.1.20:9000/custom/path?view=all" {
				t.Fatalf("%s Status = %+v", mode, a)
			}
			if mode == "private-unknown" || mode == "inventory-error" {
				status, err := h.svc.Status(t.Context())
				if err != nil || len(status.AccessWarnings) == 0 {
					t.Fatalf("unknown inspection lost its warning: %+v %v", status, err)
				}
			}
		})
	}
}

type inventoryProbeApp struct {
	*testApp
	inspect   bool
	installed []helpers.InstalledApp
	info      *app.Info
	setups    int
}

func (a *inventoryProbeApp) Info() app.Info {
	if a.info != nil {
		return *a.info
	}
	return a.testApp.Info()
}

func (a *inventoryProbeApp) Setup(ctx context.Context, h *helpers.H) error {
	a.setups++
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
