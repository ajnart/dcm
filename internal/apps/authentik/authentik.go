// Package authentik is the Authentik single sign-on server: a private identity
// provider backed by PostgreSQL with a background worker and no Docker socket.
package authentik

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Authentik. Traps: docs/catalog/traps/authentik.md.
type App struct{}

func (App) AdminEmail(username string) string {
	if username == "" {
		return ""
	}
	return username + "@selfhost.local"
}

const (
	service = "authentik"
	admin   = "akadmin"
	// The worker applies AUTHENTIK_BOOTSTRAP_TOKEN through a blueprint after
	// migrations, so the token is rejected until that asynchronous run finishes.
	bootstrapTimeout = 5 * time.Minute
)

func (App) Info() app.Info {
	return app.Info{
		ID: "authentik", Name: "Authentik", Category: "Identity",
		Description:   "Sign in once to reach all your apps, with one login for the whole household",
		Image:         "ghcr.io/goauthentik/server:2026.8.3",
		Docs:          "https://docs.goauthentik.io/install-config/install/docker-compose/",
		Port:          9000,
		ContainerPort: 9000,
		Service:       service,
	}
}

func (App) Inputs() []app.Input { return nil }

// Secrets declares the database password shared with postgresql, the signing
// secret, and the bootstrap token Setup uses to read the administrator back.
func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "db_password", Length: 48},
		{Name: "secret_key", Length: 64},
		{Name: "bootstrap_token", Length: 48},
	}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	environment := `      AUTHENTIK_POSTGRESQL__HOST: authentik-postgresql
      AUTHENTIK_POSTGRESQL__NAME: authentik
      AUTHENTIK_POSTGRESQL__USER: authentik
      AUTHENTIK_POSTGRESQL__PASSWORD: ${AUTHENTIK_DB_PASSWORD}
      AUTHENTIK_SECRET_KEY: ${AUTHENTIK_SECRET_KEY}
      AUTHENTIK_BOOTSTRAP_PASSWORD: ${ADMIN_PASSWORD}
      AUTHENTIK_BOOTSTRAP_EMAIL: ${ADMIN_USER}@selfhost.local
`
	return `services:
  authentik:
    image: ghcr.io/goauthentik/server:2026.8.3
    command: server
    restart: unless-stopped
    shm_size: 536870912
    environment:
` + environment + `    volumes:
      - ./data:/data
    ports:
      - ${BIND_IP}:` + port + `:9000
    depends_on:
      authentik-postgresql:
        condition: service_healthy
  authentik-worker:
    image: ghcr.io/goauthentik/server:2026.8.3
    command: worker
    restart: unless-stopped
    shm_size: 536870912
    environment:
` + environment + `      AUTHENTIK_BOOTSTRAP_TOKEN: ${AUTHENTIK_BOOTSTRAP_TOKEN}
    volumes:
      - ./data:/data
    depends_on:
      authentik-postgresql:
        condition: service_healthy
  authentik-postgresql:
    image: docker.io/library/postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: authentik
      POSTGRES_USER: authentik
      POSTGRES_PASSWORD: ${AUTHENTIK_DB_PASSWORD}
    volumes:
      - ./database:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-d", "authentik", "-U", "authentik"]
      interval: 30s
      timeout: 5s
      start_period: 20s
      retries: 5
`
}

// tokenUser reports whether the bootstrap token identifies the akadmin
// superuser, exactly like authentik's current-user endpoint.
func tokenUser(ctx context.Context, h *helpers.H) (bool, error) {
	token := h.Secret(h.Key("bootstrap_token"))
	if token == "" {
		return false, fmt.Errorf("%s is missing from secrets.env", h.Key("bootstrap_token"))
	}
	resp, err := h.HTTP(ctx, helpers.Request{
		Path:   "/api/v3/core/users/me/",
		Header: map[string]string{"Authorization": "Bearer " + token},
	})
	if err != nil {
		return false, err
	}
	if resp.Status == http.StatusUnauthorized || resp.Status == http.StatusForbidden {
		return false, nil
	}
	if resp.Status != http.StatusOK {
		return false, fmt.Errorf("the current-user endpoint returned HTTP %d", resp.Status)
	}
	var body struct {
		User struct {
			Username    string `json:"username"`
			IsSuperuser bool   `json:"is_superuser"`
		} `json:"user"`
	}
	if err := resp.Decode(&body); err != nil {
		return false, err
	}
	return body.User.Username == admin && body.User.IsSuperuser, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/-/health/live/"); err != nil {
		return err
	}
	return h.Step(ctx, "admin", "the bootstrap token identifies the "+admin+" superuser", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return tokenUser(ctx, h) },
		Do: func(ctx context.Context) error {
			if h.Secret(h.Key("bootstrap_token")) == "" {
				return errors.New("the bootstrap token is missing from secrets.env")
			}
			return h.Poll(ctx, bootstrapTimeout, func(ctx context.Context) (bool, error) { return tokenUser(ctx, h) })
		},
		Hint:       "Recreate authentik so it reads " + h.Key("bootstrap_token") + " from secrets.env: self-host start authentik",
		Credential: h.Key("bootstrap_token"),
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := tokenUser(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the bootstrap token does not identify %s", admin)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
