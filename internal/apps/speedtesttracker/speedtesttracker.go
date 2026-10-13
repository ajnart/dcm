// Package speedtesttracker is Speedtest Tracker, a private speed-test history
// dashboard. Its Laravel administrator is seeded from the Admin email and
// password; the Laravel app key is generated through the LinuxServer file
// convention.
package speedtesttracker

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// adminEmail is the shared Admin login's email form.
func adminEmail(h *helpers.H) string { return (App{}).AdminEmail(h.AdminUser()) }

// verifyScript reads the seeded administrator from the exact pinned Laravel
// container. The email and password arrive through private environment
// variables, never argv or a config file.
const verifyScript = `require '/app/www/vendor/autoload.php'; $app=require '/app/www/bootstrap/app.php'; $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap(); $p=getenv('SELFHOST_ADMIN_PASSWORD'); $e=getenv('SELFHOST_ADMIN_EMAIL'); $u=App\Models\User::where('email',$e)->first(); if (!$u || !$u->is_admin || !Illuminate\Support\Facades\Hash::check($p,$u->password)) exit(21); echo $u->id;`

// The v1.14.7-ls165 image's Alpine nginx 3.24 base starts PHP-FPM with -F
// at /etc/s6-overlay/s6-rc.d/svc-php-fpm/run. Its pool uses abc, whose UID/GID
// follow PUID/PGID. PHP-FPM requires -R when either pool ID is zero, including
// the rootless Docker identity mapped to the host's project owner.
const phpFPMRun = `#!/usr/bin/with-contenv bash
if [[ "${PUID:-911}" = 0 || "${PGID:-911}" = 0 ]]; then
    exec /usr/sbin/php-fpm85 -F -R
fi
exec /usr/sbin/php-fpm85 -F
`

// App is Speedtest Tracker. Traps: docs/catalog/traps/speedtest-tracker.md.
type App struct{}

func (App) AdminEmail(username string) string {
	if username == "" {
		return ""
	}
	return username + "@selfhost.local"
}

func (App) Info() app.Info {
	return app.Info{
		ID: "speedtest-tracker", Name: "Speedtest Tracker", Category: "Monitoring",
		Description:   "Check your internet speed on a schedule and keep the history",
		Image:         "lscr.io/linuxserver/speedtest-tracker:v1.14.7-ls165",
		Docs:          "https://docs.speedtest-tracker.dev/getting-started/installation/using-docker-compose",
		Port:          8080,
		ContainerPort: 80,
		Service:       "speedtest-tracker",
	}
}

func (App) Inputs() []app.Input { return nil }

// Secrets declares the Laravel app key: 32 random bytes delivered as a
// base64-prefixed value through the image's FILE__ file convention.
func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{{Name: "app_key", Length: 64, Hex: true}}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  speedtest-tracker:
    image: lscr.io/linuxserver/speedtest-tracker:v1.14.7-ls165
    restart: unless-stopped
    environment:
      PUID: ${PUID}
      PGID: ${PGID}
      DB_CONNECTION: sqlite
      APP_URL: http://${LAN_IP}:` + port + `
      ADMIN_EMAIL: ${ADMIN_USER}@selfhost.local
      ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      PUBLIC_DASHBOARD: "false"
      FILE__APP_KEY: /config/app.key
    volumes:
      - ./config:/config
      - ./php-fpm-run:/etc/s6-overlay/s6-rc.d/svc-php-fpm/run:ro
    ports:
      - ${BIND_IP}:` + port + `:80
`
}

// Files writes the Laravel APP_KEY to /config/app.key, the path the
// LinuxServer image reads through FILE__APP_KEY. The file holds a canonical
// base64-prefixed 32-byte key and is mode 0600. It also writes the pinned
// PHP-FPM launcher for container identities that include UID or GID zero.
func (App) Files(_ app.RenderContext, secret func(name string) string) []app.File {
	raw, err := hex.DecodeString(secret("app_key"))
	if err != nil || len(raw) != 32 {
		return nil
	}
	content := "base64:" + base64.StdEncoding.EncodeToString(raw)
	return []app.File{
		{Path: "config/app.key", Content: content, Mode: 0o600},
		{Path: "php-fpm-run", Content: phpFPMRun, Mode: 0o755},
	}
}

// adminWorks verifies the seeded administrator inside the pinned Laravel
// container, where the app has no headless HTTP login endpoint.
func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	result, err := h.Exec(ctx, map[string]string{
		"SELFHOST_ADMIN_EMAIL":    adminEmail(h),
		"SELFHOST_ADMIN_PASSWORD": h.AdminPassword(),
	}, "s6-setuidgid", "abc", "php", "-r", verifyScript)
	if err != nil {
		return false, err
	}
	return result.ExitCode == 0 && strings.TrimSpace(string(result.Stdout)) != "", nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := ready(ctx, h); err != nil {
		return err
	}
	if err := h.Step(ctx, "admin-login", "verify the administrator "+adminEmail(h), helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Do: func(context.Context) error {
			return errors.New("Speedtest Tracker seeds the administrator from ADMIN_EMAIL/ADMIN_PASSWORD only on first start")
		},
		Hint: "Speedtest Tracker seeds the Admin login only on first start. Open " + h.URL +
			" and verify the existing account with self-host credentials. Restore the matching Project credential through its secret boundary, then retry self-host setup speedtest-tracker; do not delete configuration or reset an existing account.",
		Credential: "admin",
	}); err != nil {
		return err
	}
	if err := h.Step(ctx, "homarr-key", "verify the Speedtest Tracker results credential", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return homarrKeyWorks(ctx, h) },
		Do:    func(ctx context.Context) error { return createHomarrKey(ctx, h) },
		Hint:  tokenHint, Credential: "admin",
	}); err != nil {
		return err
	}
	return h.Step(ctx, "homarr-results", "verify measured Speedtest Tracker results", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			_, err := ReadHomarr(ctx, h)
			return err == nil, err
		},
		Do: func(ctx context.Context) error {
			_, err := ReadHomarr(ctx, h)
			return err
		},
		Hint: measurementHint, Credential: "admin",
	})
}

func ready(ctx context.Context, h *helpers.H) error {
	status := 0
	probe := func(ctx context.Context) (bool, error) {
		response, err := h.HTTP(ctx, helpers.Request{Path: "/api/healthcheck"})
		if err != nil {
			status = 0
			return false, errors.New("healthcheck transport failed")
		}
		status = response.Status
		if status >= 500 {
			return false, fmt.Errorf("HTTP %d", status)
		}
		return true, nil
	}
	return h.Step(ctx, "ready", "wait for speedtest-tracker to answer on /api/healthcheck", helpers.StepSpec{
		Check: probe,
		Do: func(ctx context.Context) error {
			err := h.Poll(ctx, 3*time.Minute, probe)
			if err != nil && status == http.StatusBadGateway {
				facts := phpBootstrapFacts(ctx, h)
				if strings.Contains(facts, "php_config_error=config_open php_failure_path=main_config") && strings.Contains(facts, "failure_path_readable=true") {
					facts += "; ask the host administrator to review PHP-FPM confinement compatibility: its configuration appears readable but PHP-FPM cannot open it"
				}
				return fmt.Errorf("%w; %s", err, facts)
			}
			return err
		},
		Hint: "A persistent HTTP 502 means nginx did not obtain a response from its pinned PHP-FPM upstream; verify owned application initialization and PHP-FPM readiness before changing the healthcheck route.",
	})
}

// Only fixed booleans/enums survive this bounded failure-only dependency probe.
// No private file contents, environment values, PHP config or logs are reported.
// The official PHP-FPM config checker consumes its own configuration silently.
func phpBootstrapFacts(ctx context.Context, h *helpers.H) string {
	if h.Config.Exec == nil {
		return "php_bootstrap_metadata=unobserved"
	}
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	res, err := h.Exec(ctx, nil, "/usr/bin/with-contenv", "bash", "-c", strings.ReplaceAll(phpBootstrapProbe, "__SELFHOST_LAUNCHER_SHA__", fmt.Sprintf("%x", sha256.Sum256([]byte(phpFPMRun)))))
	if err != nil || res.ExitCode != 0 {
		return "php_bootstrap_metadata=unobserved"
	}
	facts := strings.Fields(string(res.Stdout))
	keys := []string{"key", "readable", "root_pool", "upstream", "source_match", "source_exec", "compiled_match", "compiled_exec", "wanted", "up", "config", "category", "path", "process_root", "target_read", "target_write", "target_owner"}
	if len(facts) != len(keys) {
		return "php_bootstrap_metadata=unobserved"
	}
	for i, key := range keys {
		if key == "path" {
			if !slices.Contains([]string{"path=main_config", "path=base_pool", "path=local_pool", "path=php_log", "path=proc_stderr", "path=unrecognized"}, facts[i]) {
				return "php_bootstrap_metadata=unobserved"
			}
			facts[i] = strings.TrimPrefix(facts[i], "path=")
			continue
		}
		if key == "category" {
			if !slices.Contains([]string{"category=none", "category=root_identity", "category=identity_lookup", "category=directive", "category=missing_path", "category=permission", "category=log_open", "category=socket", "category=resource", "category=config_open", "category=unrecognized", "category=timeout", "category=unavailable"}, facts[i]) {
				return "php_bootstrap_metadata=unobserved"
			}
			facts[i] = strings.TrimPrefix(facts[i], "category=")
			continue
		}
		unknown := i >= 4 && facts[i] == key+"=unknown"
		if facts[i] != key+"=true" && facts[i] != key+"=false" && !unknown {
			return "php_bootstrap_metadata=unobserved"
		}
		facts[i] = strings.TrimPrefix(facts[i], key+"=")
	}
	return fmt.Sprintf("app_key_present=%s app_key_file_readable=%s pool_identity_includes_root=%s php_upstream_listening=%s launcher_source_matches=%s launcher_source_executable=%s launcher_compiled_matches=%s launcher_compiled_executable=%s php_service_wanted=%s php_service_up=%s php_config_valid=%s php_config_error=%s php_failure_path=%s process_uid_zero=%s failure_path_readable=%s failure_path_writable=%s failure_path_owner_current=%s", facts[0], facts[1], facts[2], facts[3], facts[4], facts[5], facts[6], facts[7], facts[8], facts[9], facts[10], facts[11], facts[12], facts[13], facts[14], facts[15], facts[16])
}

const phpBootstrapProbe = `set +x
key=false; readable=false; root_pool=false; upstream=false
[ -n "${APP_KEY:-}" ] && key=true
[ -r /config/app.key ] && readable=true
if [ "$(id -u abc)" = 0 ] || [ "$(id -g abc)" = 0 ]; then root_pool=true; fi
timeout 2 bash -c 'true > /dev/tcp/127.0.0.1/9000' >/dev/null 2>&1 && upstream=true
printf 'key=%s\nreadable=%s\nroot_pool=%s\nupstream=%s\n' "$key" "$readable" "$root_pool" "$upstream"

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
`

func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := adminWorks(ctx, h); !ok {
		return fmt.Errorf("the administrator %s cannot be verified in Speedtest Tracker: %v", adminEmail(h), err)
	}
	_, err := ReadHomarr(ctx, h)
	return err
}

func (App) Links() []app.Link { return nil }
