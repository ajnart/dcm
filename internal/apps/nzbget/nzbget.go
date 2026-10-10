// Package nzbget is the NZBGet Usenet downloader. Its control interface takes
// the Admin login as environment variables and speaks a Basic-authenticated
// JSON-RPC API.
package nzbget

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// version is the pinned image's RPC version.
const version = "26.3"

// App is NZBGet. Traps: docs/catalog/traps/nzbget.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "nzbget", Name: "NZBGet", Category: "Downloads",
		Description:   "Downloads articles from your Usenet provider",
		Image:         "ghcr.io/nzbgetcom/nzbget:v26.3",
		Docs:          "https://nzbget.com/documentation/",
		Port:          6789,
		ContainerPort: 6789,
		Service:       "nzbget",
		UsesMedia:     true,
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  nzbget:
    image: ghcr.io/nzbgetcom/nzbget:v26.3
    restart: unless-stopped
    environment:
      NZBGET_USER: ${ADMIN_USER}
      NZBGET_PASS: ${ADMIN_PASSWORD}
      PUID: ${PUID}
      PGID: ${PGID}
      TZ: ${TZ}
    volumes:
      - ./config:/config
      - ${DOWNLOADS_ROOT}:/downloads
    ports:
      - ${BIND_IP}:` + port + `:6789
`
}

func rpc() map[string]any {
	return map[string]any{"version": "1.1", "method": "version", "params": []any{}, "id": "selfhost-version"}
}

// adminWorks proves the RPC interface rejects anonymous reads and accepts the
// saved administrator's Basic credentials with the pinned version.
func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	anonymous, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/jsonrpc", JSON: rpc()})
	if err != nil {
		return false, err
	}
	if anonymous.Status != http.StatusUnauthorized {
		return false, nil
	}
	resp, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/jsonrpc", JSON: rpc(), User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil {
		return false, err
	}
	if resp.Status != http.StatusOK {
		return false, nil
	}
	var result struct {
		ID     string `json:"id"`
		Error  any    `json:"error"`
		Result string `json:"result"`
	}
	if err := resp.Decode(&result); err != nil {
		return false, err
	}
	return result.ID == "selfhost-version" && result.Error == nil && result.Result == version, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/"); err != nil {
		return err
	}
	return h.Step(ctx, "admin-rpc", "verify the administrator "+h.AdminUser(), helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Do: func(context.Context) error {
			return errors.New("NZBGet reads NZBGET_USER and NZBGET_PASS only when the container starts")
		},
		Hint: "NZBGet applies the Admin login on first start. Recreate the container: self-host start nzbget, " +
			"then open " + h.URL + " and sign in with the password from `self-host credentials`.",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := adminWorks(ctx, h); !ok {
		return fmt.Errorf("the Admin login %s cannot read NZBGet's version over RPC: %v", h.AdminUser(), err)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
