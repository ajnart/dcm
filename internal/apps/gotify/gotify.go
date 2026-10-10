// Package gotify is the Gotify notification server: a private push service
// whose administrator is seeded on the first start.
package gotify

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Gotify. Traps: docs/catalog/traps/gotify.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "gotify", Name: "Gotify", Category: "Communication",
		Description:   "Collect notifications from your apps and send them to your phone",
		Image:         "gotify/server:3.1.1",
		Docs:          "https://gotify.net/docs/install",
		Port:          8080,
		ContainerPort: 80,
		Service:       "gotify",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	return `services:
  gotify:
    image: gotify/server:3.1.1
    restart: unless-stopped
    environment:
      GOTIFY_DEFAULTUSER_NAME: ${ADMIN_USER}
      GOTIFY_REGISTRATION: "false"
      GOTIFY_LOCALAUTH_ENABLED: "true"
      TZ: ${TZ}
      GOTIFY_DEFAULTUSER_PASS_FILE: /run/secrets/admin-password
    volumes:
      - ./appdata:/app/data
    secrets:
      - admin-password
    ports:
      - ${BIND_IP}:` + strconv.Itoa(rc.Port) + `:80

secrets:
  admin-password:
    environment: ADMIN_PASSWORD
`
}

func ready(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/version"})
	if err != nil {
		return false, err
	}
	return resp.OK(), nil
}

type account struct {
	Name  string `json:"name"`
	Admin bool   `json:"admin"`
}

func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/current/user", User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil {
		return false, err
	}
	if resp.Status != 200 {
		return false, nil
	}
	var acc account
	if err := resp.Decode(&acc); err != nil {
		return false, err
	}
	return acc.Name == h.AdminUser() && acc.Admin, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Step(ctx, "ready", "wait for the Gotify API", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return ready(ctx, h) },
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) {
				return ready(ctx, h)
			})
		},
		Hint: "Check the App's logs (self-host logs gotify) for startup errors.",
	}); err != nil {
		return err
	}
	return h.Step(ctx, "admin-access", "sign in as the administrator "+h.AdminUser(), helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Do: func(ctx context.Context) error {
			return errors.New("the administrator is only seeded when Gotify first creates its database")
		},
		Hint: "The Gotify administrator is seeded from the Admin login on the first start. Recreate the container so it " +
			"picks up the password (show it with: self-host credentials): self-host start gotify",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := adminWorks(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("the administrator " + h.AdminUser() + " cannot sign in to Gotify")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
