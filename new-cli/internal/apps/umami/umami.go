// Package umami is Umami: private website analytics on PostgreSQL. The image
// seeds an administrator with a public password, so Setup rotates it to the
// generated password on the private origin before anything else trusts it.
// Traps: docs/catalog/traps/umami.md.
package umami

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

const (
	seededPassword = "umami"
	username       = "admin"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "umami", Name: "Umami", Category: "Analytics",
		Description:   "Shows private, cookie-free traffic statistics for your websites",
		Image:         "ghcr.io/umami-software/umami:3.4.0",
		Docs:          "https://umami.is/docs/install",
		Port:          3000,
		ContainerPort: 3000,
		Service:       "umami",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "db_password", Length: 48},
		{Name: "app_secret", Length: 48},
		{Name: "two_factor_key", Length: 32, Hex: true},
	}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  umami:
    image: ghcr.io/umami-software/umami:3.4.0
    init: true
    restart: always
    environment:
      DATABASE_URL: postgresql://umami:${UMAMI_DB_PASSWORD}@umami-db:5432/umami
      APP_SECRET: ${UMAMI_APP_SECRET}
      TWO_FACTOR_ENCRYPTION_KEY: ${UMAMI_TWO_FACTOR_KEY}
    ports:
      - ${BIND_IP}:` + port + `:3000
    depends_on:
      - umami-db
  umami-db:
    image: postgres:15-alpine
    restart: always
    environment:
      POSTGRES_DB: umami
      POSTGRES_USER: umami
      POSTGRES_PASSWORD: ${UMAMI_DB_PASSWORD}
    volumes:
      - ./database:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "umami", "-d", "umami"]
      interval: 5s
      timeout: 5s
      start_period: 0s
      retries: 5
`
}

type signIn struct {
	ID    string
	Token string
}

// signIn posts the login and returns the authenticated administrator identity,
// or ok=false when the credentials are rejected.
func signInAs(ctx context.Context, h *helpers.H, password string) (signIn, bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/api/auth/login",
		JSON: map[string]string{"username": username, "password": password},
	})
	if err != nil {
		return signIn{}, false, err
	}
	if resp.Status == 401 || resp.Status == 403 {
		return signIn{}, false, nil
	}
	if resp.Status != 200 {
		return signIn{}, false, fmt.Errorf("Umami login returned HTTP %d", resp.Status)
	}
	var out struct {
		Token string `json:"token"`
		User  struct {
			ID       string `json:"id"`
			Username string `json:"username"`
			Role     string `json:"role"`
			IsAdmin  bool   `json:"isAdmin"`
		} `json:"user"`
	}
	if err := resp.Decode(&out); err != nil {
		return signIn{}, false, err
	}
	if out.Token == "" || out.User.Username != username || out.User.Role != "admin" || !out.User.IsAdmin || out.User.ID == "" {
		return signIn{}, false, nil
	}
	return signIn{ID: out.User.ID, Token: out.Token}, true, nil
}

func generatedWorks(ctx context.Context, h *helpers.H) (bool, error) {
	_, ok, err := signInAs(ctx, h, h.AdminPassword())
	return ok, err
}

func seedWorks(ctx context.Context, h *helpers.H) (bool, error) {
	_, ok, err := signInAs(ctx, h, seededPassword)
	return ok, err
}

func rotate(ctx context.Context, h *helpers.H) error {
	seed, ok, err := signInAs(ctx, h, seededPassword)
	if err != nil {
		return err
	}
	if !ok {
		_, generated, err := signInAs(ctx, h, h.AdminPassword())
		if err != nil {
			return err
		}
		if generated {
			return nil
		}
		return fmt.Errorf("the seeded Umami administrator cannot sign in and the generated password does not work")
	}
	_, err = h.Expect(ctx, helpers.Request{
		Method: "POST", Path: "/api/users/" + seed.ID,
		Header: map[string]string{"Authorization": "Bearer " + seed.Token},
		JSON:   map[string]string{"password": h.AdminPassword()},
	})
	return err
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	ready := firstadmin.NoAccount{Probe: firstadmin.Probe{Path: "/api/heartbeat", Timeout: 5 * time.Minute}}
	if err := ready.Setup(ctx, h); err != nil {
		return err
	}
	return h.Step(ctx, "rotate-admin", "the seeded administrator password is replaced", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			ok, err := generatedWorks(ctx, h)
			if err != nil || !ok {
				return false, err
			}
			seeded, err := seedWorks(ctx, h)
			return !seeded, err
		},
		Do: func(ctx context.Context) error { return rotate(ctx, h) },
		Hint: "Open " + h.URL + " and change the admin password to the one shown by `self-host credentials`; " +
			"if it was already changed by hand, run: self-host setup umami",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := generatedWorks(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the generated Umami administrator password does not sign in")
	}
	seeded, err := seedWorks(ctx, h)
	if err != nil {
		return err
	}
	if seeded {
		return fmt.Errorf("Umami still accepts its seeded administrator password")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
