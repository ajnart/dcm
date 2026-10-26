// Package immich is the Immich photo library: a private server with its own
// PostgreSQL, Valkey queue, and machine-learning containers.
package immich

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

// App is Immich. Traps: docs/catalog/traps/immich.md.
type App struct{}

func (App) AdminEmail(string) string { return email }

const (
	service = "immich"
	email   = "admin@example.test"
)

func (App) Info() app.Info {
	return app.Info{
		ID: "immich", Name: "Immich", Category: "Photos",
		Description:   "Back up your phone's photos and find any of them by searching",
		Image:         "ghcr.io/immich-app/immich-server:release",
		Docs:          "https://docs.immich.app/install/docker-compose/",
		Port:          2283,
		ContainerPort: 2283,
		WebSockets:    true,
		LongTimeouts:  true,
		Service:       service,
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{{Name: "db_password", Length: 48}}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  immich:
    image: ghcr.io/immich-app/immich-server:release
    restart: unless-stopped
    environment:
      DB_DATABASE_NAME: immich
      DB_HOSTNAME: immich-database
      DB_USERNAME: postgres
      DB_PASSWORD: ${IMMICH_DB_PASSWORD}
      IMMICH_ALLOW_SETUP: "true"
      IMMICH_MACHINE_LEARNING_URL: http://immich-machine-learning:3003
      REDIS_HOSTNAME: immich-redis
    volumes:
      - ./uploads:/data
    ports:
      - ${BIND_IP}:` + port + `:2283
    depends_on:
      - immich-database
      - immich-redis
    healthcheck:
      test: ["CMD", "immich-healthcheck"]
      interval: 30s
      timeout: 30s
      retries: 3
  immich-machine-learning:
    image: ghcr.io/immich-app/immich-machine-learning:release
    restart: unless-stopped
    volumes:
      - ./model-cache:/cache
    healthcheck:
      test: ["CMD", "python3", "healthcheck.py"]
      interval: 30s
      timeout: 30s
      retries: 3
  immich-redis:
    image: docker.io/valkey/valkey:latest
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3
  immich-database:
    image: ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0
    restart: unless-stopped
    shm_size: 134217728
    environment:
      POSTGRES_DB: immich
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${IMMICH_DB_PASSWORD}
      POSTGRES_INITDB_ARGS: --data-checksums
    volumes:
      - ./database:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "/usr/local/bin/healthcheck.sh"]
      interval: 300s
      timeout: 30s
      start_period: 300s
      retries: 3
`
}

func initialized(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/api/server/config"})
	if err != nil {
		return false, err
	}
	if resp.Status != http.StatusOK {
		return false, fmt.Errorf("the server config returned HTTP %d", resp.Status)
	}
	var config struct {
		IsInitialized bool `json:"isInitialized"`
	}
	if err := resp.Decode(&config); err != nil {
		return false, err
	}
	return config.IsInitialized, nil
}

func login(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/api/auth/login",
		JSON: map[string]string{"email": email, "password": h.AdminPassword()},
	})
	if err != nil {
		return false, err
	}
	if resp.Status == http.StatusUnauthorized || resp.Status == http.StatusBadRequest {
		return false, nil
	}
	if resp.Status != http.StatusCreated && resp.Status != http.StatusOK {
		return false, fmt.Errorf("the login endpoint returned HTTP %d", resp.Status)
	}
	var body struct {
		UserEmail   string `json:"userEmail"`
		IsAdmin     bool   `json:"isAdmin"`
		AccessToken string `json:"accessToken"`
	}
	if err := resp.Decode(&body); err != nil {
		return false, err
	}
	return body.UserEmail == email && body.IsAdmin && body.AccessToken != "", nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/api/server/config"); err != nil {
		return err
	}
	if err := (firstadmin.FirstAdmin{
		Username: func(context.Context, *helpers.H) (string, error) { return email, nil },
		Title:    func(_ *helpers.H, user string) string { return "create the first administrator " + user },
		Login: func(ctx context.Context, h *helpers.H, _, _ string) (bool, error) {
			return login(ctx, h)
		},
		Create: func(ctx context.Context, h *helpers.H, _, _ string) error {
			setUp, err := initialized(ctx, h)
			if err != nil {
				return err
			}
			if !setUp {
				if _, err := h.Expect(ctx, helpers.Request{
					Method: http.MethodPost, Path: "/api/auth/admin-sign-up",
					JSON: map[string]string{"email": email, "name": "Admin", "password": h.AdminPassword()},
				}, http.StatusCreated); err != nil {
					return err
				}
			}
			ok, err := login(ctx, h)
			if err != nil {
				return err
			}
			if !ok {
				return errors.New("the administrator was created but cannot sign in")
			}
			return nil
		},
		Hint: func(h *helpers.H, user string) string {
			return "Open " + h.URL + ", finish the Immich setup with email " + user + " and the password shown by `self-host credentials`, then run: self-host setup immich"
		},
	}).Admin(ctx, h); err != nil {
		return err
	}
	if h.Peer("homarr") == nil {
		h.Skip("homarr-key", "Homarr is not installed; no Immich statistics key is needed")
		return nil
	}
	return h.Step(ctx, "homarr-key", "prepare read-only Immich statistics", helpers.StepSpec{
		Check:      func(ctx context.Context) (bool, error) { return homarrKeyWorks(ctx, h) },
		Do:         func(ctx context.Context) error { return createHomarrKey(ctx, h) },
		Hint:       "Run self-host setup immich to prepare its Homarr credential. If the managed key already exists but its saved secret is lost, restore it through the Project secret boundary or delete only the self-host Homarr statistics key in Immich user settings, then retry.",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := login(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the administrator %s cannot sign in", email)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
