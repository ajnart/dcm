// Package patchmon is PatchMon: a private dashboard of host patch status, with
// PostgreSQL, an authenticated Redis and a Guacamole daemon. Its first
// administrator is created through the dashboard API from an owner-chosen
// email, and host enrollment stays a separate approval.
// Traps: docs/catalog/traps/patchmon.md.
package patchmon

import (
	"context"
	"fmt"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "patchmon", Name: "PatchMon", Category: "Monitoring",
		Description:   "Tracks which packages each host is missing and which updates are outstanding",
		Image:         "ghcr.io/patchmon/patchmon-server:2.1.3",
		Docs:          "https://docs.patchmon.net/",
		Port:          3000,
		ContainerPort: 3000,
		Service:       "patchmon",
	}
}

// Inputs asks for the administrator email the first-owner API requires.
func (App) Inputs() []app.Input {
	return []app.Input{{Key: "admin_email", Prompt: "Administrator email"}}
}

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "db_password", Length: 32, Hex: true},
		{Name: "redis_password", Length: 32, Hex: true},
		{Name: "jwt_secret", Length: 64, Hex: true},
		{Name: "session_secret", Length: 64, Hex: true},
		{Name: "ai_encryption_key", Length: 64, Hex: true},
	}
}

func (App) Files(_ app.RenderContext, secret func(string) string) []app.File {
	return []app.File{
		{Path: "redis-config", Content: "requirepass " + secret("redis_password") + "\n", Mode: 0o600},
	}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  patchmon:
    image: ghcr.io/patchmon/patchmon-server:2.1.3
    restart: unless-stopped
    environment:
      APP_ENV: production
      PORT: "3000"
      POD_ID: patchmon-server
      REDIS_HOST: patchmon-redis
      REDIS_PORT: "6379"
      REDIS_DB: "0"
      GUACD_ADDRESS: patchmon-guacd:4822
      CORS_ORIGIN: http://127.0.0.1:` + port + `
      DATABASE_URL: postgresql://patchmon_user:${PATCHMON_DB_PASSWORD}@patchmon-database:5432/patchmon_db
      REDIS_PASSWORD: ${PATCHMON_REDIS_PASSWORD}
      JWT_SECRET: ${PATCHMON_JWT_SECRET}
      SESSION_SECRET: ${PATCHMON_SESSION_SECRET}
      AI_ENCRYPTION_KEY: ${PATCHMON_AI_ENCRYPTION_KEY}
    ports:
      - ${BIND_IP}:` + port + `:3000
    depends_on:
      - patchmon-database
      - patchmon-redis
      - patchmon-guacd
  patchmon-database:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: patchmon_user
      POSTGRES_DB: patchmon_db
      POSTGRES_PASSWORD: ${PATCHMON_DB_PASSWORD}
    volumes:
      - ./database:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "patchmon_user", "-d", "patchmon_db"]
      interval: 3s
      timeout: 5s
      start_period: 0s
      retries: 7
  patchmon-redis:
    image: redis:7.4-alpine
    user: ${PUID}:${PGID}
    # Keep the selected user: the image entrypoint drops container 0 to redis.
    entrypoint: ["/bin/sh", "-c", "umask 077; exec \"$$@\"", "--"]
    command: ["redis-server", "/run/secrets/redis-config"]
    restart: unless-stopped
    volumes:
      - ./redis:/data
      - ./redis-config:/run/secrets/redis-config:ro
  patchmon-guacd:
    image: guacamole/guacd:1.6.0
    restart: unless-stopped
    read_only: true
    cap_drop: ["ALL"]
    mem_limit: 512m
    cpus: "1"
    tmpfs:
      - /tmp
    healthcheck:
      test: ["CMD", "nc", "-z", "localhost", "4822"]
      interval: 10s
      timeout: 5s
      start_period: 10s
      retries: 3
`
}

func adminEmail(h *helpers.H) string {
	if email := h.Inputs["admin_email"]; email != "" {
		return email
	}
	return h.AdminUser() + "@selfhost.local"
}

// A stable, non-secret client identity lets the pinned server reuse the
// bootstrap session when an immediate check issues the same refresh JWT.
const clientDeviceID = "self-host-patchmon"

type profile struct {
	User struct {
		ID       string `json:"id"`
		Username string `json:"username"`
		Email    string `json:"email"`
		Role     string `json:"role"`
		IsActive bool   `json:"is_active"`
	} `json:"user"`
}

func signedIn(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	login, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/api/v1/auth/login",
		Header: map[string]string{"X-Device-ID": clientDeviceID},
		JSON:   map[string]string{"username": user, "password": password},
	})
	if err != nil {
		return false, err
	}
	if login.Status == 401 || login.Status == 403 {
		return false, nil
	}
	if login.Status != 200 {
		return false, fmt.Errorf("PatchMon login returned HTTP %d", login.Status)
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
		Path:   "/api/v1/auth/profile",
		Header: map[string]string{"Authorization": "Bearer " + token.Token},
	})
	if err != nil {
		return false, err
	}
	if resp.Status == 401 || resp.Status == 403 {
		return false, nil
	}
	if resp.Status != 200 {
		return false, fmt.Errorf("PatchMon profile returned HTTP %d", resp.Status)
	}
	var p profile
	if err := resp.Decode(&p); err != nil {
		return false, err
	}
	return p.User.Username == user && p.User.Email == adminEmail(h) &&
		p.User.Role == "superadmin" && p.User.IsActive, nil
}

func adminExists(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.Expect(ctx, helpers.Request{Path: "/api/v1/settings/login-settings"})
	if err != nil {
		return false, err
	}
	var settings struct {
		HasAdminUsers bool `json:"hasAdminUsers"`
	}
	if err := resp.Decode(&settings); err != nil {
		return false, err
	}
	return settings.HasAdminUsers, nil
}

func createAdmin(ctx context.Context, h *helpers.H, user, password string) error {
	_, err := h.Expect(ctx, helpers.Request{
		Method: "POST", Path: "/api/v1/auth/setup-admin",
		Header: map[string]string{"X-Device-ID": clientDeviceID},
		JSON: map[string]string{
			"firstName": "Dashboard", "lastName": "Administrator",
			"username": user, "email": adminEmail(h), "password": password,
		},
	}, 201)
	return err
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	first := firstadmin.FirstAdmin{
		Ready:  firstadmin.Probe{Path: "/health", Want: []int{200}},
		Exists: adminExists,
		Create: createAdmin,
		Login:  signedIn,
		Manual: "Open " + h.URL + " and create the first administrator as " + adminEmail(h) + ".",
	}
	return first.Setup(ctx, h)
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	return (firstadmin.FirstAdmin{Login: signedIn}).Check(ctx, h)
}

func (App) Links() []app.Link { return nil }
