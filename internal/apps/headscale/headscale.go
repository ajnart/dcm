// Package headscale is Headscale: a private Tailscale control server with one
// canonical HTTPS identity and no local password administrator.
package headscale

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Headscale. Traps: docs/catalog/traps/headscale.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "headscale", Name: "Headscale", Category: "Remote access",
		Description:   "Runs your own Tailscale-compatible control server for a private mesh of devices",
		Image:         "docker.io/headscale/headscale:0.29.4",
		Docs:          "https://headscale.net/stable/setup/install/container/",
		Port:          18082,
		ContainerPort: 8080,
		Service:       "headscale",
	}
}

func (App) Inputs() []app.Input {
	return []app.Input{
		{
			Key:      "canonical-origin",
			Prompt:   "Canonical HTTPS origin",
			Help:     "The exact HTTPS origin clients use, e.g. https://headscale.example.com (DNS, TLS and the control-protocol proxy are a separate ingress decision)",
			Required: true,
		},
		{
			Key:      "magic-dns-domain",
			Prompt:   "MagicDNS base domain",
			Help:     "A distinct domain for mesh device names, e.g. mesh.example.com; it must differ from the origin host",
			Required: true,
		},
	}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  headscale:
    image: docker.io/headscale/headscale:0.29.4
    restart: unless-stopped
    command: ["serve"]
    read_only: true
    environment:
      TZ: ${TZ}
    volumes:
      - ./config.yaml:/etc/headscale/config.yaml:ro
      - ./data:/var/lib/headscale
    tmpfs:
      - /var/run/headscale
    ports:
      - ${BIND_IP}:` + port + `:8080
    healthcheck:
      test: ["CMD", "/ko-app/headscale", "health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
`
}

func (App) Files(rc app.RenderContext, secret func(string) string) []app.File {
	_ = secret
	origin := strings.TrimSpace(rc.Inputs["canonical-origin"])
	if origin == "" {
		origin = "https://headscale.example.com"
	}
	magic := strings.TrimSpace(rc.Inputs["magic-dns-domain"])
	if magic == "" {
		magic = "mesh.example.com"
	}
	config := `server_url: ` + fmt.Sprintf("%q", origin) + `
listen_addr: 0.0.0.0:8080
metrics_listen_addr: 127.0.0.1:9090
grpc_listen_addr: 127.0.0.1:50443
grpc_allow_insecure: false
noise:
  private_key_path: /var/lib/headscale/noise_private.key
prefixes:
  v4: 100.64.0.0/10
  v6: fd7a:115c:a1e0::/48
  allocation: sequential
disable_check_updates: true
database:
  type: sqlite
  sqlite:
    path: /var/lib/headscale/db.sqlite
    write_ahead_log: true
dns:
  magic_dns: true
  base_domain: ` + fmt.Sprintf("%q", magic) + `
  override_local_dns: false
  nameservers:
    global: []
    split: {}
  search_domains: []
  extra_records: []
unix_socket: /var/run/headscale/headscale.sock
unix_socket_permission: "0770"
log:
  level: info
  format: text
logtail:
  enabled: false
`
	return []app.File{{Path: "config.yaml", Content: config, Keep: true}}
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Step(ctx, "ready", "the Headscale control plane answers its health probe", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return healthy(ctx, h) },
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) { return healthy(ctx, h) })
		},
		Hint: "Headscale is not healthy; read its logs with: self-host logs headscale",
	}); err != nil {
		return err
	}
	h.Info("Headscale has no password administrator: a user is a node identity. Enroll a node with " +
		"`headscale users create <name>` and `headscale preauthkeys create --user <id>` inside the container. " +
		"Install a proxy that supports the tailscale-control-protocol WebSocket upgrade before clients connect.")
	return nil
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := healthy(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("Headscale health probe failed; read its logs with: self-host logs headscale")
	}
	return nil
}

func (App) Links() []app.Link { return nil }

func healthy(ctx context.Context, h *helpers.H) (bool, error) {
	result, err := h.Exec(ctx, nil, "/ko-app/headscale", "health")
	if err != nil {
		return false, err
	}
	return result.ExitCode == 0, nil
}
