// Package bazarr is Bazarr. Traps: docs/catalog/traps/bazarr.md.
package bazarr

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Bazarr. Traps: docs/catalog/traps/bazarr.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "bazarr", Name: "Bazarr", Category: "Requests",
		Description:   "Downloads and manages subtitles for your movie and TV library",
		Image:         "lscr.io/linuxserver/bazarr:version-v1.6.0",
		Docs:          "https://wiki.bazarr.media/",
		Port:          6767,
		ContainerPort: 6767,
		Service:       "bazarr",
		UsesMedia:     true,
	}
}

func (App) Inputs() []app.Input { return nil }
func (App) Links() []app.Link   { return nil }

// Compose mounts the shared media root at /media, the path Sonarr and
// Radarr file into, so subtitles need no remote path mapping.
func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  bazarr:
    image: lscr.io/linuxserver/bazarr:version-v1.6.0
    restart: unless-stopped
    environment:
      PUID: ${PUID}
      PGID: ${PGID}
      TZ: ${TZ}
      UMASK: ${UMASK}
    volumes:
      - ./config:/config
      - ${MEDIA_ROOT}:/media
    ports:
      - ${BIND_IP}:` + port + `:6767
`
}

// apiKey waits for the key Bazarr writes to its config on first start.
func apiKey(ctx context.Context, h *helpers.H) (string, error) {
	return h.ConfigValue(ctx, "config/config/config.yaml", helpers.YAMLPath("auth.apikey"), 2*time.Minute)
}

// anonymousDenied reports whether Bazarr already refuses anonymous UI access.
func anonymousDenied(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/"})
	if err != nil {
		return false, err
	}
	return resp.Status == http.StatusUnauthorized, nil
}

func adminExists(ctx context.Context, h *helpers.H) (bool, error) {
	return anonymousDenied(ctx, h)
}

func createAdmin(ctx context.Context, h *helpers.H, user, password string) error {
	key, err := apiKey(ctx, h)
	if err != nil {
		return err
	}
	_, err = h.Expect(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/api/system/settings",
		Header: map[string]string{"X-API-KEY": key},
		Form: url.Values{
			"settings-auth-type":     {"basic"},
			"settings-auth-username": {user},
			"settings-auth-password": {password},
		},
	}, http.StatusNoContent)
	return err
}

func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	anonymous, err := h.HTTP(ctx, helpers.Request{Path: "/"})
	if err != nil {
		return false, err
	}
	if anonymous.Status != http.StatusUnauthorized {
		return false, nil
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/", User: user, Password: password})
	if err != nil {
		return false, err
	}
	return resp.Status == http.StatusOK, nil
}

func firstAdmin() firstadmin.FirstAdmin {
	return firstadmin.FirstAdmin{
		Ready:  firstadmin.Probe{Path: "/", Want: []int{http.StatusOK, http.StatusUnauthorized}},
		Exists: adminExists,
		Create: createAdmin,
		Login:  loginWorks,
		Manual: "Settings > General > Authentication: set it to Basic with the administrator username and password",
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
		return fmt.Errorf("the Admin login %s cannot sign in to Bazarr", h.AdminUser())
	}
	denied, err := anonymousDenied(ctx, h)
	if err != nil {
		return err
	}
	if !denied {
		return errors.New("Bazarr still permits anonymous UI access; Basic authentication is not applied")
	}
	return nil
}
