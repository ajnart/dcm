// Package bookstack is the BookStack wiki: a private documentation site with
// a MariaDB database.
package bookstack

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is BookStack. Traps: docs/catalog/traps/bookstack.md.
type App struct{}

const service = "bookstack"

// The pinned image inherits Alpine nginx 3.24's PHP 8.5 pool for abc,
// whose IDs follow PUID/PGID. PHP-FPM needs -R if either pool ID is zero,
// including container zero mapped to the rootless project owner.
const phpFPMRun = `#!/usr/bin/with-contenv bash
if [[ "${PUID:-911}" = 0 || "${PGID:-911}" = 0 ]]; then
    exec /usr/sbin/php-fpm85 -F -R
fi
exec /usr/sbin/php-fpm85 -F
`

// Files keeps the pinned PHP-FPM service compatible with the configured IDs.
func (App) Files(_ app.RenderContext, _ func(string) string) []app.File {
	return []app.File{{Path: "php-fpm-run", Content: phpFPMRun, Mode: 0o755}}
}

func (App) Info() app.Info {
	return app.Info{
		ID: "bookstack", Name: "BookStack", Category: "Productivity",
		Description:   "Organize notes and documentation into books, chapters and pages",
		Image:         "lscr.io/linuxserver/bookstack:v26.05.3-ls277",
		Docs:          "https://www.bookstackapp.com/docs/admin/installation/",
		Port:          8080,
		ContainerPort: 80,
		Service:       service,
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "app_key", Length: 32},
		{Name: "db_password", Length: 48},
		{Name: "db_root_password", Length: 48},
	}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  bookstack:
    image: lscr.io/linuxserver/bookstack:v26.05.3-ls277
    restart: unless-stopped
    environment:
      PUID: ${PUID}
      PGID: ${PGID}
      TZ: ${TZ}
      APP_URL: http://${LAN_IP}:` + port + `
      DB_HOST: db
      DB_PORT: "3306"
      DB_USERNAME: bookstack
      DB_DATABASE: bookstack
      DB_PASSWORD: ${BOOKSTACK_DB_PASSWORD}
      APP_KEY: ${BOOKSTACK_APP_KEY}
    volumes:
      - ./config:/config
      - ./php-fpm-run:/etc/s6-overlay/s6-rc.d/svc-php-fpm/run:ro
    ports:
      - ${BIND_IP}:` + port + `:80
    depends_on:
      - db
  db:
    image: docker.io/library/mariadb:12.3.3
    restart: unless-stopped
    environment:
      MARIADB_DATABASE: bookstack
      MARIADB_USER: bookstack
      MARIADB_PASSWORD: ${BOOKSTACK_DB_PASSWORD}
      MARIADB_ROOT_PASSWORD: ${BOOKSTACK_DB_ROOT_PASSWORD}
    volumes:
      - ./database:/var/lib/mysql
`
}

// login signs in through the pinned email form and proves administrator access
// by opening the users settings page.
func login(ctx context.Context, h *helpers.H) (bool, error) {
	email := h.AdminUser() + "@selfhost.local"
	session := h.Session()
	token, err := session.FormToken(ctx, "/login", "_token")
	if err != nil {
		return false, nil
	}
	form := url.Values{"_token": {token}, "email": {email}, "password": {h.AdminPassword()}}
	resp, err := session.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/login", Form: form, NoRedirect: true,
		Header: map[string]string{"Accept": "text/html"},
	})
	if err != nil {
		return false, err
	}
	if resp.Status == http.StatusUnprocessableEntity {
		return false, nil
	}
	if resp.Status != http.StatusFound {
		return false, fmt.Errorf("the login endpoint returned HTTP %d", resp.Status)
	}
	users, err := session.HTTP(ctx, helpers.Request{
		Path: "/settings/users", NoRedirect: true,
		Header: map[string]string{"Accept": "text/html"},
	})
	if err != nil {
		return false, err
	}
	return users.Status == http.StatusOK, nil
}

// createAdmin replaces the seeded account with the shared Admin login, passing
// the password only through the environment so it never reaches the argv.
func createAdmin(ctx context.Context, h *helpers.H) error {
	user := h.AdminUser()
	script := fmt.Sprintf(
		`php /app/www/artisan bookstack:create-admin --initial --email=%s@selfhost.local --name=%s --password="$SELFHOST_PW"`,
		user, user)
	_, err := h.ExecSecret(ctx, map[string]string{"SELFHOST_PW": h.AdminPassword()}, script)
	return err
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/login"); err != nil {
		return errors.Join(err, startupStatus(ctx, h))
	}
	email := h.AdminUser() + "@selfhost.local"
	return h.Step(ctx, "admin", "create the administrator "+email, helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return login(ctx, h) },
		Do: func(ctx context.Context) error {
			if err := createAdmin(ctx, h); err != nil {
				return err
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
		Hint: "Open " + h.URL + "/login and sign in as " + email +
			" with the password shown by `self-host credentials`, or replace the seeded account inside the container with: " +
			"php /app/www/artisan bookstack:create-admin --initial --email=" + email +
			" --name=" + h.AdminUser() + ` --password="$SELFHOST_PW"`,
		Credential: "admin",
	})
}

// Failure-only observations distinguish image initialization from an absent
// PHP upstream. Database TCP availability does not claim authenticated access.
func startupStatus(ctx context.Context, h *helpers.H) error {
	facts := "bootstrap_metadata=unobserved"
	if h.Config.Exec != nil {
		probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		result, err := h.Exec(probeCtx, nil, "/usr/bin/with-contenv", "bash", "-c", bootstrapProbe)
		if err == nil && result.ExitCode == 0 {
			values := strings.Fields(string(result.Stdout))
			keys := []string{"key", "root_pool", "upstream", "database"}
			valid := len(values) == len(keys)
			if valid {
				for i, key := range keys {
					if values[i] != key+"=true" && values[i] != key+"=false" {
						valid = false
						break
					}
					values[i] = strings.TrimPrefix(values[i], key+"=")
				}
			}
			if valid {
				facts = fmt.Sprintf("app_key_present=%s pool_identity_includes_root=%s php_upstream_listening=%s database_tcp_listening=%s", values[0], values[1], values[2], values[3])
			}
		}
	}
	return h.Step(ctx, "startup-status", "observe BookStack bootstrap dependencies", helpers.StepSpec{
		Do:   func(context.Context) error { return errors.New("BookStack startup status: " + facts) },
		Hint: "Check owned image initialization, PHP-FPM readiness and database health before retrying; a database TCP listener does not prove authenticated database access.",
	})
}

// The pinned Alpine-nginx image uses PHP-FPM TCP 9000; BookStack's public
// init-bookstack-config script waits for DB_HOST/DB_PORT before migrations.
// Emit only booleans, never environment values, private files or command output.
const bootstrapProbe = `set +x
key=false; root_pool=false; upstream=false; database=false
[ -n "${APP_KEY:-}" ] && key=true
if [ "$(id -u abc)" = 0 ] || [ "$(id -g abc)" = 0 ]; then root_pool=true; fi
timeout 2 bash -c 'true > /dev/tcp/127.0.0.1/9000' >/dev/null 2>&1 && upstream=true
timeout 2 bash -c 'true > "/dev/tcp/${DB_HOST}/${DB_PORT:-3306}"' >/dev/null 2>&1 && database=true
printf 'key=%s\nroot_pool=%s\nupstream=%s\ndatabase=%s\n' "$key" "$root_pool" "$upstream" "$database"
`

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := login(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the administrator %s cannot sign in", h.AdminUser()+"@selfhost.local")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
