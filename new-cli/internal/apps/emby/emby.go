// Package emby is Emby. Traps: docs/catalog/traps/emby.md.
package emby

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Emby. Traps: docs/catalog/traps/emby.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "emby", Name: "Emby", Category: "Media",
		Description:   "Serves your media library through a private web interface",
		Image:         "emby/embyserver:4.10.0.40",
		Docs:          "https://emby.media/support/articles/Installation.html",
		Port:          8096,
		ContainerPort: 8096,
		Service:       "emby",
		UsesMedia:     true,
	}
}

func (App) Inputs() []app.Input { return nil }
func (App) Links() []app.Link   { return nil }

// Compose mounts the shared media root read-only at /mnt/media; the first
// owner wizard stays manual, as Emby's untouched-state endpoints are unsafe
// to drive.
func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  emby:
    image: emby/embyserver:4.10.0.40
    restart: unless-stopped
    volumes:
      - ./config:/config
      - ${MEDIA_ROOT}:/mnt/media:ro
    ports:
      - ${BIND_IP}:` + port + `:8096
`
}

func embyHeader() map[string]string {
	return map[string]string{
		"X-Emby-Authorization": `Emby Client="selfhost", Device="selfhost-cli", DeviceId="selfhost-cli", Version="1.0.0"`,
	}
}

func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/Users/AuthenticateByName",
		Header: embyHeader(),
		Form:   url.Values{"Username": {user}, "Pw": {password}},
	})
	if err != nil {
		return false, err
	}
	if resp.Status == http.StatusUnauthorized || resp.Status == http.StatusForbidden {
		return false, nil
	}
	if !resp.OK() {
		return false, fmt.Errorf("POST /Users/AuthenticateByName returned HTTP %d", resp.Status)
	}
	var result struct {
		User struct {
			Policy struct {
				IsAdministrator bool `json:"IsAdministrator"`
			} `json:"Policy"`
		} `json:"User"`
	}
	if err := resp.Decode(&result); err != nil {
		return false, err
	}
	return result.User.Policy.IsAdministrator, nil
}

// firstAdmin has no headless Create: the trap forbids writing Startup/User or
// Startup/Complete, so a person completes the first-owner wizard.
func firstAdmin() firstadmin.FirstAdmin {
	return firstadmin.FirstAdmin{
		Ready:  firstadmin.Probe{Path: "/System/Info/Public"},
		Login:  loginWorks,
		Manual: "open the first-owner wizard and create the administrator with username admin and the password from `self-host credentials`",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	return firstAdmin().Setup(ctx, h)
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := loginWorks(ctx, h, h.AdminUser(), h.AdminPassword())
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the Admin login %s cannot sign in to Emby", h.AdminUser())
	}
	return nil
}
