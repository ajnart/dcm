// Package uptimekuma is Uptime Kuma: a private uptime monitor. Its first
// administrator is created over Socket.IO, which the shared HTTP helpers do
// not speak, so Setup only proves the saved login through the metrics endpoint.
package uptimekuma

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Uptime Kuma. Traps: docs/catalog/traps/uptime-kuma.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "uptime-kuma", Name: "Uptime Kuma", Category: "Monitoring",
		Description:   "Checks your services and alerts you when they go down",
		Image:         "louislam/uptime-kuma:2.5.5",
		Docs:          "https://github.com/louislam/uptime-kuma/wiki/%F0%9F%94%A7-How-to-Install",
		Port:          3001,
		ContainerPort: 3001,
		Service:       "uptime-kuma",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  uptime-kuma:
    image: louislam/uptime-kuma:2.5.5
    restart: unless-stopped
    environment:
      UPTIME_KUMA_DB_TYPE: sqlite
    volumes:
      - ./appdata:/app/data
    ports:
      - ${BIND_IP}:` + port + `:3001
`
}

func (App) Links() []app.Link { return nil }

// loginWorks proves the saved administrator through the metrics endpoint,
// which uses administrator Basic auth until someone creates an API key.
func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/metrics", User: user, Password: password})
	if err != nil {
		return false, err
	}
	if resp.Status == 401 {
		return false, nil
	}
	if !resp.OK() {
		return false, errors.New("the metrics endpoint did not accept the Admin login (HTTP " + strconv.Itoa(resp.Status) + ")")
	}
	return strings.Contains(string(resp.Body), "# HELP") || strings.Contains(string(resp.Body), "# TYPE"), nil
}

func setup() firstadmin.FirstAdmin {
	return firstadmin.FirstAdmin{
		Ready: firstadmin.Probe{Path: "/"},
		Login: loginWorks,
		Manual: "Uptime Kuma creates its first administrator in the web UI and has no HTTP setup API; " +
			"open the App, create the administrator, then rerun setup.",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error { return setup().Setup(ctx, h) }

func (App) Check(ctx context.Context, h *helpers.H) error { return setup().Check(ctx, h) }
