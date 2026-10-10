// Package deluge is the Deluge BitTorrent client with its Web UI.
// Traps: docs/catalog/traps/deluge.md.
package deluge

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "deluge", Name: "Deluge", Category: "Downloads",
		Description:   "Download torrents in the background, with a simple web page to manage them",
		Image:         "lscr.io/linuxserver/deluge:2.2.0-ls381",
		Docs:          "https://deluge.readthedocs.io/en/latest/",
		Port:          8112,
		ContainerPort: 8112,
		Service:       "deluge",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  deluge:
    image: lscr.io/linuxserver/deluge:2.2.0-ls381
    restart: unless-stopped
    environment:
      PUID: ${PUID}
      PGID: ${PGID}
      TZ: ${TZ}
    volumes:
      - ./config:/config
      - ./media-data:/downloads
    ports:
      - ${BIND_IP}:` + port + `:8112
`
}

// initialPassword is the shared default Deluge Web UI password the image ships
// with; Setup rotates it to the Admin login.
const initialPassword = "deluge"

type rpcResponse struct {
	ID     int    `json:"id"`
	Error  any    `json:"error"`
	Result bool   `json:"result"`
	Cookie string `json:"-"`
}

func rpc(ctx context.Context, h *helpers.H, method, cookie string, params ...string) (rpcResponse, error) {
	req := helpers.Request{Method: http.MethodPost, Path: "/json",
		JSON: map[string]any{"method": method, "params": params, "id": 1}}
	if cookie != "" {
		req.Header = map[string]string{"Cookie": cookie}
	}
	resp, err := h.Expect(ctx, req, http.StatusOK)
	if err != nil {
		return rpcResponse{}, err
	}
	var body rpcResponse
	if err := resp.Decode(&body); err != nil {
		return rpcResponse{}, err
	}
	if body.ID != 1 || body.Error != nil {
		return rpcResponse{}, errors.New("Deluge returned a JSON-RPC error")
	}
	body.Cookie = resp.Cookie("_session_id")
	return body, nil
}

func login(ctx context.Context, h *helpers.H, password string) (string, error) {
	body, err := rpc(ctx, h, "auth.login", "", password)
	if err != nil {
		return "", err
	}
	if !body.Result || body.Cookie == "" {
		return "", nil
	}
	return "_session_id=" + body.Cookie, nil
}

func canLogin(ctx context.Context, h *helpers.H, password string) (bool, error) {
	cookie, err := login(ctx, h, password)
	return cookie != "", err
}

func ready(ctx context.Context, h *helpers.H, path string) error {
	probe := func(ctx context.Context) (bool, error) {
		resp, err := h.HTTP(ctx, helpers.Request{Path: path})
		if err != nil {
			return false, err
		}
		return resp.Status < 500, nil
	}
	return h.Step(ctx, "ready", "wait for the web server on "+path, helpers.StepSpec{
		Check: probe,
		Do:    func(ctx context.Context) error { return h.Poll(ctx, 2*time.Minute, probe) },
		Hint:  "Check the App's logs: self-host logs " + h.App,
	})
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := ready(ctx, h, "/"); err != nil {
		return err
	}
	return h.Step(ctx, "web-password", "rotate the shared initial Web password to the Admin login", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return canLogin(ctx, h, h.AdminPassword()) },
		Do: func(ctx context.Context) error {
			cookie, err := login(ctx, h, initialPassword)
			if err != nil {
				return err
			}
			if cookie == "" {
				return errors.New("the documented initial Web password no longer works and the Admin password does not sign in")
			}
			rotated, err := rpc(ctx, h, "auth.change_password", cookie, initialPassword, h.AdminPassword())
			if err != nil {
				return err
			}
			if !rotated.Result {
				return errors.New("Deluge did not confirm the Web password change")
			}
			return nil
		},
		Hint: "Open " + h.URL + " and change the Deluge Web password to the one shown by `self-host credentials`, " +
			"then run: self-host setup deluge",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := canLogin(ctx, h, h.AdminPassword())
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("the Admin password cannot sign in to the Deluge Web UI")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
