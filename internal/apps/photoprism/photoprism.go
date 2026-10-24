// Package photoprism is PhotoPrism, a private photo library. Its administrator
// is seeded from the Admin login and verified through a real session.
package photoprism

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is PhotoPrism. Traps: docs/catalog/traps/photoprism.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "photoprism", Name: "PhotoPrism", Category: "Photos",
		Description:   "Browse, organize and search your photo collection privately",
		Image:         "docker.io/photoprism/photoprism:latest",
		Docs:          "https://docs.photoprism.app/getting-started/docker-compose/",
		Port:          2342,
		ContainerPort: 2342,
		Service:       "photoprism",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  photoprism:
    image: docker.io/photoprism/photoprism:latest
    restart: unless-stopped
    environment:
      PHOTOPRISM_ADMIN_USER: ${ADMIN_USER}
      PHOTOPRISM_ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      PHOTOPRISM_DATABASE_DRIVER: sqlite
    volumes:
      - ./originals:/photoprism/originals
      - ./storage:/photoprism/storage
    ports:
      - ${BIND_IP}:` + port + `:2342
`
}

type sessionUser struct {
	Name     string `json:"Name"`
	Role     string `json:"Role"`
	CanLogin bool   `json:"CanLogin"`
}

type session struct {
	Status      string      `json:"status"`
	AccessToken string      `json:"access_token"`
	User        sessionUser `json:"user"`
}

// adminWorks denies anonymous sessions, then proves the saved password creates
// an active administrator session that reads back with the same identity.
// Public mode returns a session without validating the password, so anonymous
// denial is required.
func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	anonymous, err := h.HTTP(ctx, helpers.Request{Path: "/api/v1/session"})
	if err != nil {
		return false, err
	}
	if anonymous.Status != http.StatusUnauthorized {
		return false, nil
	}
	resp, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/api/v1/session", JSON: map[string]string{
		"username": h.AdminUser(), "password": h.AdminPassword(),
	}})
	if err != nil {
		return false, err
	}
	if resp.Status != http.StatusOK {
		return false, nil
	}
	var login session
	if err := resp.Decode(&login); err != nil {
		return false, err
	}
	if login.Status != "success" || login.AccessToken == "" || login.User.Name != h.AdminUser() ||
		login.User.Role != "admin" || !login.User.CanLogin {
		return false, nil
	}
	readback, err := h.HTTP(ctx, helpers.Request{Path: "/api/v1/session", Header: map[string]string{"Authorization": "Bearer " + login.AccessToken}})
	if err != nil {
		return false, err
	}
	if readback.Status != http.StatusOK {
		return false, nil
	}
	var verified session
	if err := readback.Decode(&verified); err != nil {
		return false, err
	}
	return verified.Status == "success" && verified.AccessToken == login.AccessToken &&
		verified.User.Name == h.AdminUser() && verified.User.Role == "admin", nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/api/v1/status"); err != nil {
		return err
	}
	return firstadmin.FirstAdmin{
		StepID: "admin-login",
		Title:  func(_ *helpers.H, user string) string { return "verify the administrator " + user },
		Login: func(ctx context.Context, h *helpers.H, _, _ string) (bool, error) {
			return adminWorks(ctx, h)
		},
		Create: func(context.Context, *helpers.H, string, string) error {
			return errors.New("PhotoPrism creates the administrator from PHOTOPRISM_ADMIN_USER/PHOTOPRISM_ADMIN_PASSWORD only on first start")
		},
		Hint: func(h *helpers.H, _ string) string {
			return "PhotoPrism seeds the administrator on first start. Recreate the container: self-host start photoprism, " +
				"then open " + h.URL + " and sign in with the password from `self-host credentials`."
		},
	}.Admin(ctx, h)
}

// Check verifies the administrator session only; the read-only API app
// password and photo ingestion stay separate acceptance steps.
func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := adminWorks(ctx, h); !ok {
		return fmt.Errorf("the Admin login %s cannot open a PhotoPrism session: %v", h.AdminUser(), err)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
