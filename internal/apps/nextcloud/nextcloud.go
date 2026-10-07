// Package nextcloud is Nextcloud: your private files, calendars and
// collaboration, backed by MariaDB and Redis. Its administrator is created
// from the generated admin-password file on the first start.
// Traps: docs/catalog/traps/nextcloud.md.
package nextcloud

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/onboard"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "nextcloud", Name: "Nextcloud", Category: "Files",
		Description:   "Keeps your files, calendars and contacts in sync across your devices",
		Image:         "nextcloud:35.0.1-apache",
		Docs:          "https://github.com/nextcloud/docker",
		Port:          8080,
		ContainerPort: 80,
		Service:       "nextcloud",
	}
}

func (App) Inputs() []app.Input { return nil }

// Secrets backs the database. The administrator is the shared Admin login,
// written to a file by Files before the container first starts.
func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "db_password", Length: 48},
		{Name: "db_root_password", Length: 48},
	}
}

func (App) Files(_ app.RenderContext, secret func(string) string) []app.File {
	return []app.File{
		{Path: "secrets/db_password", Content: secret("db_password") + "\n", Mode: 0o600},
		{Path: "secrets/db_root_password", Content: secret("db_root_password") + "\n", Mode: 0o600},
		{Path: "secrets/admin_password", Content: secret("ADMIN_PASSWORD") + "\n", Mode: 0o600},
	}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  nextcloud:
    image: nextcloud:35.0.1-apache
    restart: unless-stopped
    environment:
      MYSQL_HOST: db
      MYSQL_DATABASE: nextcloud
      MYSQL_USER: nextcloud
      NEXTCLOUD_ADMIN_USER: ${ADMIN_USER}
      NEXTCLOUD_TRUSTED_DOMAINS: 127.0.0.1
      REDIS_HOST: redis
      MYSQL_PASSWORD_FILE: /run/secrets/db_password
      NEXTCLOUD_ADMIN_PASSWORD_FILE: /run/secrets/admin_password
    volumes:
      - ./html:/var/www/html
      - ./secrets/db_password:/run/secrets/db_password:ro
      - ./secrets/admin_password:/run/secrets/admin_password:ro
    ports:
      - ${BIND_IP}:` + port + `:80
    depends_on:
      - db
      - redis
  db:
    image: mariadb:12.3.3
    restart: unless-stopped
    command: ["--transaction-isolation=READ-COMMITTED"]
    environment:
      MARIADB_DATABASE: nextcloud
      MARIADB_USER: nextcloud
      MARIADB_PASSWORD_FILE: /run/secrets/db_password
      MARIADB_ROOT_PASSWORD_FILE: /run/secrets/db_root_password
    volumes:
      - ./db:/var/lib/mysql
      - ./secrets/db_password:/run/secrets/db_password:ro
      - ./secrets/db_root_password:/run/secrets/db_root_password:ro
  redis:
    image: redis:8.10.2-alpine3.23
    restart: unless-stopped
  cron:
    image: nextcloud:35.0.1-apache
    restart: unless-stopped
    entrypoint: ["/cron.sh"]
    environment:
      MYSQL_HOST: db
      MYSQL_DATABASE: nextcloud
      MYSQL_USER: nextcloud
      REDIS_HOST: redis
      MYSQL_PASSWORD_FILE: /run/secrets/db_password
    volumes:
      - ./html:/var/www/html
      - ./secrets/db_password:/run/secrets/db_password:ro
    depends_on:
      - nextcloud
`
}

const ocsUsersPath = "/ocs/v1.php/cloud/users"

// adminWorks signs in with basic auth and lists users through the protected
// OCS endpoint.
func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Path: ocsUsersPath,
		Header: map[string]string{
			"OCS-APIRequest": "true",
			"Accept":         "application/json",
		},
		User:     h.AdminUser(),
		Password: h.AdminPassword(),
	})
	if err != nil {
		return false, err
	}
	if resp.Status == 401 || resp.Status == 403 {
		return false, nil
	}
	if resp.Status != 200 {
		return false, fmt.Errorf("Nextcloud %s returned HTTP %d", ocsUsersPath, resp.Status)
	}
	var ocs struct {
		OCS struct {
			Meta struct {
				StatusCode int `json:"statuscode"`
			} `json:"meta"`
			Data struct {
				Users []string `json:"users"`
			} `json:"data"`
		} `json:"ocs"`
	}
	if err := resp.Decode(&ocs); err != nil {
		return false, err
	}
	if ocs.OCS.Meta.StatusCode != 100 {
		return false, nil
	}
	for _, user := range ocs.OCS.Data.Users {
		if user == h.AdminUser() {
			return true, nil
		}
	}
	return false, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	ready := onboard.NoAccount{Probe: onboard.Probe{Path: "/status.php", Timeout: 5 * time.Minute}}
	if err := ready.Setup(ctx, h); err != nil {
		return err
	}
	return h.Step(ctx, "admin-login", "administrator "+h.AdminUser()+" signs in", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 5*time.Minute, func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) })
		},
		Hint: "Open " + h.URL + " and sign in as " + h.AdminUser() +
			". The password is in the admin-password file; if the first start failed, read: self-host logs nextcloud",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := adminWorks(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the administrator %s cannot sign in to Nextcloud", h.AdminUser())
	}
	return nil
}

func (App) Links() []app.Link { return nil }
