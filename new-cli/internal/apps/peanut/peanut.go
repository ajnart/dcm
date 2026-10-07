// Package peanut is the PeaNUT UPS dashboard. Its private API takes the Admin
// login as HTTP Basic credentials seeded before the first start.
package peanut

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

const infoPath = "/api/v1/info"

// App is PeaNUT. Traps: docs/catalog/traps/peanut.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "peanut", Name: "PeaNUT", Category: "Monitoring",
		Description:   "Dashboard for the readings of your NUT-monitored UPS",
		Image:         "brandawg93/peanut:v6.0.0",
		Docs:          "https://github.com/Brandawg93/PeaNUT#readme",
		Port:          8080,
		ContainerPort: 8080,
		Service:       "peanut",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  peanut:
    image: brandawg93/peanut:v6.0.0
    restart: unless-stopped
    environment:
      WEB_HOST: 0.0.0.0
      WEB_PORT: "8080"
      WEB_USERNAME: ${ADMIN_USER}
      WEB_PASSWORD: ${ADMIN_PASSWORD}
    volumes:
      - ./config:/config
    ports:
      - ${BIND_IP}:` + port + `:8080
`
}

// adminWorks proves the private API rejects anonymous and wrong-password
// requests and accepts the seeded administrator.
func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	anonymous, err := h.HTTP(ctx, helpers.Request{Path: infoPath})
	if err != nil {
		return false, err
	}
	if anonymous.Status != http.StatusUnauthorized && anonymous.Status != http.StatusForbidden {
		return false, nil
	}
	wrong, err := h.HTTP(ctx, helpers.Request{Path: infoPath, User: h.AdminUser(), Password: h.AdminPassword() + "-wrong"})
	if err != nil {
		return false, err
	}
	if wrong.Status != http.StatusUnauthorized && wrong.Status != http.StatusForbidden {
		return false, nil
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: infoPath, User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil {
		return false, err
	}
	return resp.Status == http.StatusOK, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, infoPath); err != nil {
		return err
	}
	return h.Step(ctx, "admin-auth", "verify the administrator "+h.AdminUser(), helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Do: func(context.Context) error {
			return errors.New("PeaNUT creates its first account from WEB_USERNAME/WEB_PASSWORD only on first start")
		},
		Hint: "PeaNUT seeds the account on first start. Recreate the container: self-host start peanut, " +
			"then open " + h.URL + " and sign in with the password from `self-host credentials`.",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := adminWorks(ctx, h); !ok {
		return fmt.Errorf("the Admin login %s is refused by PeaNUT: %v", h.AdminUser(), err)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
