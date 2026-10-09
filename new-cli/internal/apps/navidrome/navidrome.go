// Package navidrome is the Navidrome music server: it streams a read-only
// music library and creates its first administrator on the sign-in page.
package navidrome

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Navidrome. Traps: docs/catalog/traps/navidrome.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "navidrome", Name: "Navidrome", Category: "Media",
		Description:   "Streams your own music library from a private web interface",
		Image:         "deluan/navidrome:0.64.0",
		Docs:          "https://www.navidrome.org/docs/installation/docker/",
		Port:          4533,
		ContainerPort: 4533,
		Service:       "navidrome",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  navidrome:
    image: deluan/navidrome:0.64.0
    restart: unless-stopped
    volumes:
      - ./data:/data
      - ./music:/music:ro
    ports:
      - ${BIND_IP}:` + port + `:4533
`
}

func (App) Links() []app.Link { return nil }

// loginWorks posts the saved Admin login; Navidrome only answers 200 with an
// administrator identity when the credential is right.
func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	resp, err := h.RetryAfter(ctx, helpers.RateLimit{
		Headers: []string{"Retry-After"},
		Default: 20 * time.Second, // The pinned server's default authentication window.
		Bound:   time.Minute,
	}, func(ctx context.Context) (helpers.Response, error) {
		return h.HTTP(ctx, helpers.Request{
			Method: "POST", Path: "/auth/login",
			JSON: map[string]string{"username": user, "password": password},
		})
	})
	if err != nil {
		return false, err
	}
	if resp.Status == 401 {
		return false, nil
	}
	if !resp.OK() {
		return false, fmt.Errorf("sign-in returned HTTP %d", resp.Status)
	}
	var account struct {
		Username string `json:"username"`
		IsAdmin  bool   `json:"isAdmin"`
	}
	if err := resp.Decode(&account); err != nil {
		return false, err
	}
	return account.Username == user && account.IsAdmin, nil
}

// createAdmin calls the native first-admin route; the pinned server refuses
// any existing user, so it never adopts an administrator it did not create.
func createAdmin(ctx context.Context, h *helpers.H, user, password string) error {
	_, err := h.Expect(ctx, helpers.Request{
		Method: "POST", Path: "/auth/createAdmin",
		JSON: map[string]string{"username": user, "password": password},
	})
	return err
}

func setup() firstadmin.FirstAdmin {
	var loginErr error
	return firstadmin.FirstAdmin{
		Ready: firstadmin.Probe{Path: "/"},
		Create: func(ctx context.Context, h *helpers.H, user, password string) error {
			// A failed probe is not evidence that the administrator is absent.
			if loginErr != nil {
				return loginErr
			}
			return createAdmin(ctx, h, user, password)
		},
		Login: func(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
			ok, err := loginWorks(ctx, h, user, password)
			loginErr = err
			return ok, err
		},
		Manual: "If an administrator already exists, sign in with its existing credentials and review Users; reconcile the saved Admin login with that account. Do not delete Navidrome's data folder or reset its administrator.",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error { return setup().Setup(ctx, h) }

func (App) Check(ctx context.Context, h *helpers.H) error { return setup().Check(ctx, h) }
