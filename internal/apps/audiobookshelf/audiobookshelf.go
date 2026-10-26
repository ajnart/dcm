// Package audiobookshelf is Audiobookshelf. Traps: docs/catalog/traps/audiobookshelf.md.
package audiobookshelf

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Audiobookshelf. Traps: docs/catalog/traps/audiobookshelf.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "audiobookshelf", Name: "Audiobookshelf", Category: "Media",
		Description:   "Listen to your audiobooks and podcasts on your phone or in a browser",
		Image:         "ghcr.io/advplyr/audiobookshelf:latest",
		Docs:          "https://www.audiobookshelf.org/docs",
		Port:          13378,
		ContainerPort: 80,
		Service:       "audiobookshelf",
	}
}

func (App) Inputs() []app.Input { return nil }
func (App) Links() []app.Link   { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  audiobookshelf:
    image: ghcr.io/advplyr/audiobookshelf:latest
    restart: unless-stopped
    environment:
      TZ: ${TZ}
    volumes:
      - ./config:/config
      - ./metadata:/metadata
    ports:
      - ${BIND_IP}:` + port + `:80
`
}

type status struct {
	App           string `json:"app"`
	ServerVersion string `json:"serverVersion"`
	IsInit        bool   `json:"isInit"`
}

func initialized(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.Expect(ctx, helpers.Request{Path: "/status"})
	if err != nil {
		return false, err
	}
	var s status
	if err := resp.Decode(&s); err != nil {
		return false, err
	}
	return s.IsInit, nil
}

func adminExists(ctx context.Context, h *helpers.H) (bool, error) {
	return initialized(ctx, h)
}

func createAdmin(ctx context.Context, h *helpers.H, user, password string) error {
	_, err := h.Expect(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/init",
		JSON: map[string]any{"newRoot": map[string]string{"username": user, "password": password}},
	})
	return err
}

func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/login",
		JSON: map[string]string{"username": user, "password": password},
	})
	if err != nil {
		return false, err
	}
	if resp.Status == http.StatusUnauthorized || resp.Status == http.StatusForbidden {
		return false, nil
	}
	if !resp.OK() {
		return false, fmt.Errorf("POST /login returned HTTP %d", resp.Status)
	}
	var body struct {
		User struct {
			Username string `json:"username"`
			Type     string `json:"type"`
		} `json:"user"`
	}
	if err := resp.Decode(&body); err != nil {
		return false, err
	}
	return body.User.Username == user && body.User.Type == "root", nil
}

func firstAdmin() firstadmin.FirstAdmin {
	return firstadmin.FirstAdmin{
		Ready:  firstadmin.Probe{Path: "/status"},
		Exists: adminExists,
		Create: createAdmin,
		Login:  loginWorks,
		Manual: "the first visit offers to create the root account",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := firstAdmin().Setup(ctx, h); err != nil {
		return err
	}
	if h.Peer("homarr") == nil {
		h.Skip("homarr-account", "Homarr is not installed; no Audiobookshelf account or API key is needed")
		return nil
	}
	return setupHomarrCredential(ctx, h)
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := loginWorks(ctx, h, h.AdminUser(), h.AdminPassword())
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the Admin login %s cannot sign in to Audiobookshelf", h.AdminUser())
	}
	return nil
}
