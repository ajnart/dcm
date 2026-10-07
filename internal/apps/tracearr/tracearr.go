// Package tracearr is Tracearr: private session analytics for your media
// server, backed by TimescaleDB and Redis. Its first owner is created from a
// reviewed email, and media-server enrollment stays a separate approval.
// Traps: docs/catalog/traps/tracearr.md.
package tracearr

import (
	"context"
	"fmt"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/onboard"
)

const defaultEmail = "admin@selfhost.local"

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "tracearr", Name: "Tracearr", Category: "Media",
		Description:   "Turns your media server's play history into private session analytics",
		Image:         "ghcr.io/connorgallopo/tracearr:2.6.0",
		Docs:          "https://docs.tracearr.com/getting-started/installation",
		Port:          3000,
		ContainerPort: 3000,
		Service:       "tracearr",
	}
}

func (App) Inputs() []app.Input {
	return []app.Input{{Key: "email", Prompt: "First owner's email", Default: defaultEmail}}
}

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "db_password", Length: 48},
		{Name: "jwt_secret", Length: 32, Hex: true},
		{Name: "cookie_secret", Length: 32, Hex: true},
		{Name: "auth_secret", Length: 32, Hex: true},
	}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  tracearr:
    image: ghcr.io/connorgallopo/tracearr:2.6.0
    restart: unless-stopped
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      REDIS_URL: redis://redis:6379
      LOG_LEVEL: info
      TZ: ${TZ}
      CORS_ORIGIN: http://127.0.0.1:` + port + `
      DATABASE_URL: postgresql://tracearr:${TRACEARR_DB_PASSWORD}@timescale:5432/tracearr
      JWT_SECRET: ${TRACEARR_JWT_SECRET}
      COOKIE_SECRET: ${TRACEARR_COOKIE_SECRET}
      BETTER_AUTH_SECRET: ${TRACEARR_AUTH_SECRET}
    volumes:
      - ./backups:/data/backup
      - ./images:/data/tracearr/image-cache
    ports:
      - ${BIND_IP}:` + port + `:3000
    depends_on:
      - timescale
      - redis
  timescale:
    image: timescale/timescaledb-ha:pg18.4-ts2.29.1
    restart: unless-stopped
    shm_size: 512mb
    ulimits:
      nofile:
        soft: 65536
        hard: 65536
    command:
      - postgres
      - -c
      - timescaledb.license=timescale
      - -c
      - timescaledb.max_tuples_decompressed_per_dml_transaction=100000
      - -c
      - max_locks_per_transaction=4096
      - -c
      - timescaledb.telemetry_level=off
      - -c
      - max_connections=150
    environment:
      POSTGRES_USER: tracearr
      POSTGRES_DB: tracearr
      POSTGRES_PASSWORD: ${TRACEARR_DB_PASSWORD}
    volumes:
      - ./database:/home/postgres/pgdata/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "tracearr"]
      interval: 10s
      timeout: 5s
      start_period: 0s
      retries: 5
  redis:
    image: redis:8-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - ./redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      start_period: 0s
      retries: 5
`
}

func ownerEmail(h *helpers.H) string {
	if email := h.Inputs["email"]; email != "" {
		return email
	}
	return defaultEmail
}

func signedIn(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	login, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/api/v1/auth/sign-in/username",
		JSON: map[string]string{"username": user, "password": password},
	})
	if err != nil {
		return false, err
	}
	if login.Status == 401 || login.Status == 403 {
		return false, nil
	}
	if login.Status != 200 {
		return false, fmt.Errorf("Tracearr login returned HTTP %d", login.Status)
	}
	var token struct {
		Token string `json:"token"`
	}
	if err := login.Decode(&token); err != nil {
		return false, err
	}
	if token.Token == "" {
		return false, nil
	}
	resp, err := h.HTTP(ctx, helpers.Request{
		Path:   "/api/v1/auth/me",
		Header: map[string]string{"Authorization": "Bearer " + token.Token},
	})
	if err != nil {
		return false, err
	}
	if resp.Status == 401 || resp.Status == 403 {
		return false, nil
	}
	if resp.Status != 200 {
		return false, fmt.Errorf("Tracearr identity returned HTTP %d", resp.Status)
	}
	var me struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Role     string `json:"role"`
		UserID   string `json:"userId"`
	}
	if err := resp.Decode(&me); err != nil {
		return false, err
	}
	return me.Username == user && me.Email == ownerEmail(h) && me.Role == "owner" && me.UserID != "", nil
}

type setupStatus struct {
	NeedsSetup bool `json:"needsSetup"`
}

func ownerExists(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.Expect(ctx, helpers.Request{Path: "/api/v1/setup/status"})
	if err != nil {
		return false, err
	}
	var status setupStatus
	if err := resp.Decode(&status); err != nil {
		return false, err
	}
	return !status.NeedsSetup, nil
}

func createOwner(ctx context.Context, h *helpers.H, user, password string) error {
	_, err := h.Expect(ctx, helpers.Request{
		Method: "POST", Path: "/api/v1/auth/sign-up/email",
		JSON: map[string]string{
			"name": "Administrator", "username": user,
			"email": ownerEmail(h), "password": password,
		},
	})
	return err
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	first := onboard.FirstAdmin{
		Ready:  onboard.Probe{Path: "/health", Want: []int{200}},
		Exists: ownerExists,
		Create: createOwner,
		Login:  signedIn,
		Manual: "Open " + h.URL + " and create the first owner as " + ownerEmail(h) + ".",
	}
	return first.Setup(ctx, h)
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	return (onboard.FirstAdmin{Login: signedIn}).Check(ctx, h)
}

func (App) Links() []app.Link { return nil }
