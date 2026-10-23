// Package bookstack is the BookStack wiki: a private documentation site with
// a MariaDB database.
package bookstack

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is BookStack. Traps: docs/catalog/traps/bookstack.md.
type App struct{}

func (App) AdminEmail(username string) string {
	if username == "" {
		return ""
	}
	return username + "@selfhost.local"
}

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
		Description:   "Keep notes and how-to guides organized in books, chapters and pages",
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
      DB_HOST: bookstack-db
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
      - bookstack-db
  bookstack-db:
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
	email := (App{}).AdminEmail(h.AdminUser())
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

type httpReadinessError struct {
	Phase  string
	Status int
	Cause  error
}

func (e *httpReadinessError) Error() string {
	if e.Status > 0 {
		return fmt.Sprintf("BookStack HTTP readiness: phase=%s http_status=%d; HTTP %d", e.Phase, e.Status, e.Status)
	}
	return fmt.Sprintf("BookStack HTTP readiness: phase=%s http_status=0; transport failed", e.Phase)
}

func (e *httpReadinessError) Unwrap() error { return e.Cause }

func recordHTTPReadiness(ctx context.Context, h *helpers.H, status int, cause error) error {
	return h.Step(ctx, "http-readiness", "verify the BookStack login page", helpers.StepSpec{
		Do: func(context.Context) error {
			return &httpReadinessError{Phase: "login-page", Status: status, Cause: cause}
		},
		Hint: "The BookStack login page must answer with HTTP 200 before administrator setup; inspect the independent startup facts without changing credentials.",
	})
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/login"); err != nil {
		return errors.Join(err, startupStatus(ctx, h))
	}
	loginPage, err := h.HTTP(ctx, helpers.Request{Path: "/login", NoRedirect: true, Header: map[string]string{"Accept": "text/html"}})
	if err != nil {
		return errors.Join(recordHTTPReadiness(ctx, h, 0, err), startupStatus(ctx, h))
	}
	if loginPage.Status != http.StatusOK {
		return errors.Join(recordHTTPReadiness(ctx, h, loginPage.Status, nil), startupStatus(ctx, h))
	}
	email := (App{}).AdminEmail(h.AdminUser())
	return firstadmin.FirstAdmin{
		Username: func(context.Context, *helpers.H) (string, error) { return email, nil },
		Login: func(ctx context.Context, h *helpers.H, _, _ string) (bool, error) {
			return login(ctx, h)
		},
		Create: func(ctx context.Context, h *helpers.H, _, _ string) error {
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
		Hint: func(h *helpers.H, user string) string {
			return "Open " + h.URL + "/login and sign in as " + user +
				" with the password shown by `self-host credentials`, or replace the seeded account inside the container with: " +
				"php /app/www/artisan bookstack:create-admin --initial --email=" + user +
				" --name=" + h.AdminUser() + ` --password="$SELFHOST_PW"`
		},
	}.Admin(ctx, h)
}

// Failure-only observations distinguish image initialization from an absent
// PHP upstream. Database TCP availability does not claim authenticated access.
func startupStatus(ctx context.Context, h *helpers.H) error {
	facts := "bootstrap_metadata=unobserved"
	hint := "Check owned image initialization, PHP-FPM readiness and database health before retrying; a database TCP listener does not prove authenticated database access."
	if h.Config.Exec != nil {
		probeCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()
		result, err := h.Exec(probeCtx, nil, "/usr/bin/with-contenv", "bash", "-c", strings.ReplaceAll(bootstrapProbe, "__SELFHOST_LAUNCHER_SHA__", fmt.Sprintf("%x", sha256.Sum256([]byte(phpFPMRun)))))
		if err == nil && result.ExitCode == 0 {
			values := strings.Fields(string(result.Stdout))
			keys := []string{"key", "root_pool", "launcher_root", "php_process", "upstream", "database", "authenticated", "source_match", "source_exec", "compiled_match", "compiled_exec", "wanted", "up", "config", "category", "path", "process_root", "target_read", "target_write", "target_owner", "worker_identity", "worker_profile"}
			if len(values) == len(keys)-2 {
				values = append(values, "worker_identity=unobserved", "worker_profile=unobserved")
			}
			valid := len(values) == len(keys)
			if valid {
				for i, key := range keys {
					if key == "worker_identity" {
						if !slices.Contains([]string{"worker_identity=root", "worker_identity=mixed", "worker_identity=nonroot", "worker_identity=unobserved"}, values[i]) {
							valid = false
							break
						}
						values[i] = strings.TrimPrefix(values[i], "worker_identity=")
						continue
					}
					if key == "worker_profile" {
						if !slices.Contains([]string{"worker_profile=unconfined", "worker_profile=php-fpm-enforced", "worker_profile=other-enforced", "worker_profile=php-fpm-complain", "worker_profile=other-complain", "worker_profile=other-mode", "worker_profile=unobserved"}, values[i]) {
							valid = false
							break
						}
						values[i] = strings.TrimPrefix(values[i], "worker_profile=")
						continue
					}
					if key == "path" {
						if !slices.Contains([]string{"path=main_config", "path=base_pool", "path=local_pool", "path=php_log", "path=proc_stderr", "path=unrecognized"}, values[i]) {
							valid = false
							break
						}
						values[i] = strings.TrimPrefix(values[i], "path=")
						continue
					}
					if key == "category" {
						if !slices.Contains([]string{"category=none", "category=root_identity", "category=identity_lookup", "category=directive", "category=missing_path", "category=permission", "category=log_open", "category=socket", "category=resource", "category=config_open", "category=unrecognized", "category=timeout", "category=unavailable"}, values[i]) {
							valid = false
							break
						}
						values[i] = strings.TrimPrefix(values[i], "category=")
						continue
					}
					unknown := (key == "authenticated" || key == "php_process" || i >= 7) && values[i] == key+"=unknown"
					if values[i] != key+"=true" && values[i] != key+"=false" && !unknown {
						valid = false
						break
					}
					values[i] = strings.TrimPrefix(values[i], key+"=")
				}
			}
			if valid {
				if values[14] == "config_open" && values[15] == "main_config" && values[17] == "true" {
					hint += " Ask the host administrator to review PHP-FPM confinement compatibility: its configuration appears readable but PHP-FPM cannot open it."
				}
				facts = fmt.Sprintf("app_key_present=%s pool_identity_includes_root=%s launcher_root_mode=%s php_process_present=%s php_upstream_listening=%s database_tcp_listening=%s database_authenticated=%s launcher_source_matches=%s launcher_source_executable=%s launcher_compiled_matches=%s launcher_compiled_executable=%s php_service_wanted=%s php_service_up=%s php_config_valid=%s php_config_error=%s php_failure_path=%s process_uid_zero=%s failure_path_readable=%s failure_path_writable=%s failure_path_owner_current=%s fpm_worker_identity=%s fpm_worker_profile=%s", values[0], values[1], values[2], values[3], values[4], values[5], values[6], values[7], values[8], values[9], values[10], values[11], values[12], values[13], values[14], values[15], values[16], values[17], values[18], values[19], values[20], values[21])
			}
		}
	}
	return h.Step(ctx, "startup-status", "observe BookStack bootstrap dependencies", helpers.StepSpec{
		Do:   func(context.Context) error { return errors.New("BookStack startup status: " + facts) },
		Hint: hint,
	})
}

// The pinned Alpine-nginx image uses PHP-FPM TCP 9000; BookStack's public
// init-bookstack-config script waits for DB_HOST/DB_PORT before migrations.
// Emit only fixed booleans/enums, never environment values, private files or raw output.
const bootstrapProbe = `set +x
key=false; root_pool=false; launcher_root=false; php_process=unknown; upstream=false; database=false; authenticated=unknown
[ -n "${APP_KEY:-}" ] && key=true
if [ "$(id -u abc)" = 0 ] || [ "$(id -g abc)" = 0 ]; then root_pool=true; fi
if [[ "${PUID:-911}" = 0 || "${PGID:-911}" = 0 ]]; then launcher_root=true; fi
if command -v pgrep >/dev/null 2>&1; then
    php_process=false
    pgrep -x php-fpm85 >/dev/null 2>&1 && php_process=true
fi
timeout 2 bash -c 'true > /dev/tcp/127.0.0.1/9000' >/dev/null 2>&1 && upstream=true
timeout 2 bash -c 'true > "/dev/tcp/${DB_HOST}/${DB_PORT:-3306}"' >/dev/null 2>&1 && database=true
# PDO receives only the existing application environment inside its container.
# It neither reads Laravel's private configuration nor prints exception text.
auth_result=$(timeout 2 php -r 'try { new PDO("mysql:host=".getenv("DB_HOST").";port=".(getenv("DB_PORT") ?: "3306").";dbname=".getenv("DB_DATABASE"), getenv("DB_USERNAME"), getenv("DB_PASSWORD"), [PDO::ATTR_TIMEOUT => 2]); echo "true"; } catch (Throwable $e) { echo "false"; }' 2>/dev/null)
case "$auth_result" in true|false) authenticated="$auth_result" ;; esac
printf 'key=%s\nroot_pool=%s\nlauncher_root=%s\nphp_process=%s\nupstream=%s\ndatabase=%s\nauthenticated=%s\n' "$key" "$root_pool" "$launcher_root" "$php_process" "$upstream" "$database" "$authenticated"

# Hash only the owned non-secret launcher; expose neither content nor hashes.
launcher_matches() {
    local actual
    actual=$(sha256sum "$1" 2>/dev/null) || { printf unknown; return; }
    if [[ "$actual" = "__SELFHOST_LAUNCHER_SHA__ "* ]]; then printf true; else printf false; fi
}
launcher_executable() {
    if [ ! -e "$1" ]; then printf unknown; elif [ -x "$1" ]; then printf true; else printf false; fi
}
source=/etc/s6-overlay/s6-rc.d/svc-php-fpm/run
compiled=/run/service/svc-php-fpm/run
source_match=$(launcher_matches "$source"); source_exec=$(launcher_executable "$source")
compiled_match=$(launcher_matches "$compiled"); compiled_exec=$(launcher_executable "$compiled")
wanted=unknown; up=unknown
supervision=$(timeout 2 s6-svstat -o up,wantedup /run/service/svc-php-fpm 2>/dev/null)
case "$supervision" in
    'true true') up=true; wanted=true ;;
    'true false') up=true; wanted=false ;;
    'false true') up=false; wanted=true ;;
    'false false') up=false; wanted=false ;;
esac
# PHP 8.5 fpm_conf.c/fpm_unix.c/fpm_stdio.c/fpm_sockets.c error phrases.
# Consume at most 16 KiB in memory and emit only a fixed category; no raw
# diagnostic, private path, configuration value or pool name leaves the pipe.
validation=$(
    timeout 3 /usr/sbin/php-fpm85 -t -R 2>&1 | head -c 16384 | awk '
        BEGIN { category="unrecognized"; path="unrecognized" }
        category == "unrecognized" && /ERROR:|ALERT:/ {
            candidate_path="unrecognized"
            if (index($0, "\047/etc/php85/php-fpm.conf\047")) candidate_path="main_config"
            else if (index($0, "\047/etc/php85/php-fpm.d/www.conf\047")) candidate_path="base_pool"
            else if (index($0, "\047/config/php/www2.conf\047")) candidate_path="local_pool"
            else if (index($0, "(/config/log/php/error.log)")) candidate_path="php_log"
            else if (index($0, "(/proc/self/fd/2)")) candidate_path="proc_stderr"
            if (/please specify user and group other than root|without --allow-to-run-as-root/) category="root_identity"
            else if (/cannot get uid for user|cannot get gid for group|ID .* is out of range/) category="identity_lookup"
            else if (/unknown entry|unable to parse value for entry|Unknown INI syntax|No pool defined|no listen address have been defined|process manager is missing/) category="directive"
            else if (/failed to open error_log/) category="log_open"
            else if (/does not exist or is not a directory/) category="missing_path"
            else if (/failed to open configuration file|failed to include more than 5 files recursively/) category="config_open"
            else if (/Permission denied|Operation not permitted/) category="permission"
            else if (/unable to bind listening socket|failed to listen to address|already listen on|invalid port value/) category="socket"
            else if (/failed to set rlimit|unable to malloc|failed to create pipe/) category="resource"
            if (category != "unrecognized") path=candidate_path
        }
        END { print category " " path }
    '
    printf '%s\n' "${PIPESTATUS[0]}"
)
config=unknown
classification="${validation%%$'\n'*}"
category="${classification%% *}"
path="${classification##* }"
case "${validation##*$'\n'}" in
    0) config=true; category=none ;;
    124) category=timeout ;;
    127) category=unavailable ;;
    141) category=unrecognized ;;
    *) config=false ;;
esac
printf 'source_match=%s\nsource_exec=%s\ncompiled_match=%s\ncompiled_exec=%s\nwanted=%s\nup=%s\nconfig=%s\ncategory=%s\n' "$source_match" "$source_exec" "$compiled_match" "$compiled_exec" "$wanted" "$up" "$config" "$category"

# Metadata only for fixed public/owned paths. Never traverse an observed path.
process_root=false; target_read=unknown; target_write=unknown; target_owner=unknown
test "$(id -u)" = 0 && process_root=true
target=''
case "$path" in
    main_config) target=/etc/php85/php-fpm.conf ;;
    base_pool) target=/etc/php85/php-fpm.d/www.conf ;;
    local_pool) target=/config/php/www2.conf ;;
    php_log) target=/config/log/php/error.log ;;
    proc_stderr) target=/proc/self/fd/2 ;;
esac
if [ -n "$target" ]; then
    target_read=false; target_write=false
    test -r "$target" && target_read=true
    test -w "$target" && target_write=true
    owner=$(stat -c %u "$target" 2>/dev/null)
    if [[ "$owner" =~ ^[0-9]+$ ]]; then
        target_owner=false
        test "$owner" = "$(id -u)" && target_owner=true
    fi
fi
printf 'path=%s\nprocess_root=%s\ntarget_read=%s\ntarget_write=%s\ntarget_owner=%s\n' "$path" "$process_root" "$target_read" "$target_write" "$target_owner"

worker_identity=unobserved; worker_profile=unobserved
php_pids=$(pgrep -x php-fpm85 2>/dev/null)
php_pid_set=" $(printf '%s\n' "$php_pids" | tr '\n' ' ')"
for pid in $php_pids; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    ppid=$(awk '/^PPid:/ {print $2}' "/proc/$pid/status" 2>/dev/null)
    [[ "$ppid" =~ ^[0-9]+$ ]] || continue
    case "$php_pid_set" in *" $ppid "*) ;; *) continue ;; esac
    euid=$(awk '/^Uid:/ {print $3}' "/proc/$pid/status" 2>/dev/null)
    egid=$(awk '/^Gid:/ {print $3}' "/proc/$pid/status" 2>/dev/null)
    if [[ "$euid" =~ ^[0-9]+$ && "$egid" =~ ^[0-9]+$ ]]; then
        if [[ "$euid" = 0 && "$egid" = 0 ]]; then worker_identity=root
        elif [[ "$euid" = 0 || "$egid" = 0 ]]; then worker_identity=mixed
        else worker_identity=nonroot
        fi
    fi
    profile=$(head -c 128 "/proc/$pid/attr/current" 2>/dev/null)
    case "$profile" in
        unconfined) worker_profile=unconfined ;;
        'php-fpm (enforce)') worker_profile=php-fpm-enforced ;;
        *' (enforce)') worker_profile=other-enforced ;;
        'php-fpm (complain)') worker_profile=php-fpm-complain ;;
        *' (complain)') worker_profile=other-complain ;;
        ?*) worker_profile=other-mode ;;
    esac
    break
done
printf 'worker_identity=%s\nworker_profile=%s\n' "$worker_identity" "$worker_profile"
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
