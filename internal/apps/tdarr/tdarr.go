// Package tdarr is the Tdarr transcode server: its web UI registers the first
// administrator and the internal node starts with every worker disabled.
package tdarr

import (
	"context"
	"fmt"
	"slices"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/onboard"
)

// App is Tdarr. Traps: docs/catalog/traps/tdarr.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "tdarr", Name: "Tdarr", Category: "Media",
		Description:   "Monitors a media library and transcodes files you choose",
		Image:         "ghcr.io/haveagitgat/tdarr:2.92.01",
		Docs:          "https://docs.tdarr.io/",
		Port:          8265,
		ContainerPort: 8265,
		Service:       "tdarr",
	}
}

func (App) Inputs() []app.Input { return nil }

const source = "webui"

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  tdarr:
    image: ghcr.io/haveagitgat/tdarr:2.92.01
    restart: unless-stopped
    environment:
      PUID: ${PUID}
      PGID: ${PGID}
      TZ: ${TZ}
      serverIP: 0.0.0.0
      serverPort: "8266"
      webUIPort: "8265"
      internalNode: "true"
      inContainer: "true"
      auth: "true"
      openBrowser: "false"
      transcodecpuWorkers: "0"
      transcodegpuWorkers: "0"
      healthcheckcpuWorkers: "0"
      healthcheckgpuWorkers: "0"
    volumes:
      - ./server:/app/server
      - ./configs:/app/configs
      - ./logs:/app/logs
      - ./media-library:/media:ro
      - ./transcode-cache:/temp
    ports:
      - ${BIND_IP}:` + port + `:8265
`
}

func (App) Links() []app.Link { return nil }

func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/api/v2/public/auth/login",
		Header: map[string]string{"x-tdarr-request-source": source},
		JSON:   map[string]string{"username": user, "password": password},
	})
	if err != nil {
		return false, err
	}
	if resp.Status == 401 || resp.Status == 403 {
		return false, nil
	}
	if !resp.OK() {
		return false, fmt.Errorf("login returned HTTP %d", resp.Status)
	}
	var login struct {
		Token string `json:"token"`
	}
	if err := resp.Decode(&login); err != nil {
		return false, err
	}
	if login.Token == "" {
		return false, nil
	}
	verify, err := h.HTTP(ctx, helpers.Request{
		Path: "/api/v2/auth/verify-token",
		Header: map[string]string{
			"Authorization":          "Bearer " + login.Token,
			"x-tdarr-request-source": source,
		},
	})
	if err != nil {
		return false, err
	}
	if !verify.OK() {
		return false, nil
	}
	var owner struct {
		Roles []string `json:"roles"`
	}
	if err := verify.Decode(&owner); err != nil {
		return false, err
	}
	return slices.Contains(owner.Roles, "admin"), nil
}

// exists reads the unauthenticated verify-token state: 401/403 with
// setupAdmin=true means no owner has registered yet.
func exists(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Path:   "/api/v2/auth/verify-token",
		Header: map[string]string{"x-tdarr-request-source": source},
	})
	if err != nil {
		return false, err
	}
	if resp.OK() {
		return true, nil
	}
	if resp.Status != 401 && resp.Status != 403 {
		return false, fmt.Errorf("verify-token returned HTTP %d", resp.Status)
	}
	var state struct {
		SetupAdmin bool `json:"setupAdmin"`
	}
	if err := resp.Decode(&state); err != nil {
		return false, err
	}
	return !state.SetupAdmin, nil
}

func create(ctx context.Context, h *helpers.H, user, password string) error {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/api/v2/public/auth/register",
		Header: map[string]string{"x-tdarr-request-source": source},
		JSON:   map[string]string{"username": user, "password": password},
	})
	if err != nil {
		return err
	}
	if resp.Status != 201 && !resp.OK() {
		return fmt.Errorf("registering the first administrator returned HTTP %d", resp.Status)
	}
	return nil
}

func setup() onboard.FirstAdmin {
	return onboard.FirstAdmin{
		Ready:  onboard.Probe{Path: "/"},
		Exists: exists,
		Create: create,
		Login:  loginWorks,
		Manual: "Tdarr registers the first administrator on its first-run page.",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error { return setup().Setup(ctx, h) }

func (App) Check(ctx context.Context, h *helpers.H) error { return setup().Check(ctx, h) }
