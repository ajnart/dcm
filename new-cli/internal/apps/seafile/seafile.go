// Package seafile is Seafile: private file libraries with sync clients and web
// access, backed by MariaDB and Redis. The first administrator is seeded from
// the Admin password environment.
// Traps: docs/catalog/traps/seafile.md.
package seafile

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// adminEmail is the first administrator's login, built from the shared Admin
// user so it matches the recipe's email convention.
func adminEmail(h *helpers.H) string { return h.AdminUser() + "@selfhost.local" }

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "seafile", Name: "Seafile", Category: "Files",
		Description:   "Syncs and shares your private file libraries from every device",
		Image:         "seafileltd/seafile-mc:13.0.28",
		Docs:          "https://manual.seafile.com/13.0/setup/setup_ce_by_docker/",
		Port:          8080,
		ContainerPort: 80,
		Service:       "seafile",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "db_password", Length: 48},
		{Name: "db_root_password", Length: 48},
		{Name: "jwt_private_key", Length: 48},
	}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  seafile:
    image: seafileltd/seafile-mc:13.0.28
    restart: unless-stopped
    environment:
      SEAFILE_MYSQL_DB_HOST: seafile-db
      SEAFILE_MYSQL_DB_PORT: "3306"
      SEAFILE_MYSQL_DB_USER: seafile
      SEAFILE_MYSQL_DB_CCNET_DB_NAME: ccnet_db
      SEAFILE_MYSQL_DB_SEAFILE_DB_NAME: seafile_db
      SEAFILE_MYSQL_DB_SEAHUB_DB_NAME: seahub_db
      INIT_SEAFILE_ADMIN_EMAIL: ${ADMIN_USER}@selfhost.local
      SEAFILE_SERVER_PROTOCOL: http
      SEAFILE_SERVER_HOSTNAME: ${LAN_IP}:` + port + `
      CACHE_PROVIDER: redis
      REDIS_HOST: seafile-redis
      REDIS_PORT: "6379"
      ENABLE_SEADOC: "false"
      ENABLE_NOTIFICATION_SERVER: "false"
      ENABLE_SEAFILE_AI: "false"
      ENABLE_FACE_RECOGNITION: "false"
      SEAFILE_MYSQL_DB_PASSWORD: ${SEAFILE_DB_PASSWORD}
      INIT_SEAFILE_MYSQL_ROOT_PASSWORD: ${SEAFILE_DB_ROOT_PASSWORD}
      INIT_SEAFILE_ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      JWT_PRIVATE_KEY: ${SEAFILE_JWT_PRIVATE_KEY}
    volumes:
      - ./data:/shared
    ports:
      - ${BIND_IP}:` + port + `:80
    depends_on:
      - seafile-db
      - seafile-redis
  seafile-db:
    image: mariadb:10.11.19
    restart: unless-stopped
    environment:
      MYSQL_LOG_CONSOLE: "true"
      MARIADB_AUTO_UPGRADE: "1"
      MYSQL_ROOT_PASSWORD: ${SEAFILE_DB_ROOT_PASSWORD}
    volumes:
      - ./database:/var/lib/mysql
    healthcheck:
      test: ["CMD", "/usr/local/bin/healthcheck.sh", "--connect", "--mariadbupgrade", "--innodb_initialized"]
      interval: 20s
      timeout: 5s
      start_period: 30s
      retries: 10
  seafile-redis:
    image: redis:8.2.9-alpine3.22
    restart: unless-stopped
`
}

// adminWorks acquires an account token from the saved password and then reads
// an administrator-only endpoint, so a token alone is not accepted as proof.
func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	login, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/api2/auth-token/",
		Form: url.Values{"username": {adminEmail(h)}, "password": {h.AdminPassword()}},
	})
	if err != nil {
		return false, err
	}
	if login.Status == 401 || login.Status == 403 {
		return false, nil
	}
	if login.Status != 200 {
		return false, fmt.Errorf("Seafile account-token login returned HTTP %d", login.Status)
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
	admin, err := h.HTTP(ctx, helpers.Request{
		Path:   "/api/v2.1/admin/users/?page=1&per_page=1",
		Header: map[string]string{"Authorization": "Bearer " + token.Token},
	})
	if err != nil {
		return false, err
	}
	if admin.Status == 401 || admin.Status == 403 {
		return false, nil
	}
	if admin.Status != 200 {
		return false, fmt.Errorf("Seafile admin API returned HTTP %d", admin.Status)
	}
	return true, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	ready := firstadmin.NoAccount{Probe: firstadmin.Probe{Path: "/", Want: []int{200, 302}, Timeout: 10 * time.Minute}}
	if err := ready.Setup(ctx, h); err != nil {
		return err
	}
	return h.Step(ctx, "admin-login", "administrator "+adminEmail(h)+" signs in", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 10*time.Minute, func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) })
		},
		Hint: "Open " + h.URL + " and sign in as " + adminEmail(h) +
			" with the password shown by `self-host credentials`; read the logs with: self-host logs seafile",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := adminWorks(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the administrator %s cannot sign in to Seafile", adminEmail(h))
	}
	return nil
}

func (App) Links() []app.Link { return nil }
