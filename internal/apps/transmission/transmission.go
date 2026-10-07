// Package transmission is the Transmission torrent client: the container seeds
// its RPC login from the Admin env on first start and serves a private WebUI.
package transmission

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/onboard"
)

// App is Transmission. Traps: docs/catalog/traps/transmission.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "transmission", Name: "Transmission", Category: "Downloads",
		Description:   "A lightweight BitTorrent client with a private web interface",
		Image:         "linuxserver/transmission:version-4.1.3-r0",
		Docs:          "https://github.com/transmission/transmission/tree/main/docs",
		Port:          9091,
		ContainerPort: 9091,
		Service:       "transmission",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  transmission:
    image: linuxserver/transmission:version-4.1.3-r0
    restart: unless-stopped
    environment:
      PUID: ${PUID}
      PGID: ${PGID}
      TZ: ${TZ}
      USER: ${ADMIN_USER}
      PASS: ${ADMIN_PASSWORD}
    volumes:
      - ./config:/config
      - ./media-data:/downloads
    ports:
      - ${BIND_IP}:` + port + `:9091
`
}

func (App) Links() []app.Link { return nil }

const rpcPath = "/transmission/rpc"

// rpcSession reads the pinned session version. Transmission answers 409 with a
// CSRF session id until the caller echoes it back.
func rpcSession(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	body := []byte(`{"jsonrpc":"2.0","method":"session_get","params":{"fields":["version"]},"id":1}`)
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: rpcPath, Body: body,
		Header: map[string]string{"Content-Type": "application/json"},
		User:   user, Password: password,
	})
	if err != nil {
		return false, err
	}
	if resp.Status == 409 {
		session := resp.Header.Get("X-Transmission-Session-Id")
		if session == "" {
			return false, errors.New("Transmission returned no CSRF session id")
		}
		resp, err = h.HTTP(ctx, helpers.Request{
			Method: "POST", Path: rpcPath, Body: body,
			Header: map[string]string{"Content-Type": "application/json", "X-Transmission-Session-Id": session},
			User:   user, Password: password,
		})
		if err != nil {
			return false, err
		}
	}
	if resp.Status == 401 {
		return false, nil
	}
	if !resp.OK() {
		return false, fmt.Errorf("RPC returned HTTP %d", resp.Status)
	}
	var payload struct {
		Result struct {
			Version string `json:"version"`
		} `json:"result"`
	}
	if err := resp.Decode(&payload); err != nil {
		return false, err
	}
	return payload.Result.Version != "", nil
}

func setup() onboard.FirstAdmin {
	return onboard.FirstAdmin{
		Ready: onboard.Probe{Path: "/transmission/web/", Want: []int{200, 401}},
		Login: func(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
			return rpcSession(ctx, h, user, password)
		},
		Manual: "Transmission reads USER and PASS from the container environment on first start; " +
			"if you changed them, reset the RPC login under Settings.",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error { return setup().Setup(ctx, h) }

func (App) Check(ctx context.Context, h *helpers.H) error { return setup().Check(ctx, h) }
