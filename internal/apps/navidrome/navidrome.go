// Package navidrome is the Navidrome music server: it streams a read-only
// music library and creates its first administrator on the sign-in page.
package navidrome

import (
	"context"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Navidrome. Traps: docs/catalog/traps/navidrome.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "navidrome", Name: "Navidrome", Category: "Media",
		Description:   "Stream your music collection to your phone or computer",
		Image:         "deluan/navidrome:latest",
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
    image: deluan/navidrome:latest
    restart: unless-stopped
    volumes:
      - ./data:/data
      - ./music:/music:ro
    ports:
      - ${BIND_IP}:` + port + `:4533
`
}

func (App) Links() []app.Link { return nil }

// loginWorks verifies the shared administrator, separately from Homarr's user.
func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	account, err := login(ctx, h, user, password)
	if err != nil || account == nil {
		return false, err
	}
	return account.Username == user && account.IsAdmin != nil && *account.IsAdmin, nil
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

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := setup().Setup(ctx, h); err != nil {
		return err
	}
	if err := h.Step(ctx, "homarr-user", "prepare the regular Navidrome account for Homarr", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			if h.Secret(h.Key("homarr_user_id")) == "" {
				return false, nil
			}
			err := VerifyHomarrUser(ctx, h)
			return err == nil, err
		},
		Do:         func(ctx context.Context) error { return createHomarrUser(ctx, h) },
		Hint:       homarrRecovery,
		Credential: "admin",
	}); err != nil {
		return err
	}
	return h.Step(ctx, "homarr-api", "verify music API readiness", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			err := verifyMusicAPI(ctx, h)
			return err == nil, err
		},
		Do:         func(ctx context.Context) error { return verifyMusicAPI(ctx, h) },
		Hint:       "Review the saved Homarr account, its library access and music library scan; do not reset accounts or delete data. Run self-host setup navidrome.",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if err := setup().Check(ctx, h); err != nil {
		return err
	}
	if err := VerifyHomarrUser(ctx, h); err != nil {
		return err
	}
	return verifyMusicAPI(ctx, h)
}
