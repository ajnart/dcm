// Package speedtesttracker is Speedtest Tracker, a private speed-test history
// dashboard. Its Laravel administrator is seeded from the Admin email and
// password; the Laravel app key is generated through the LinuxServer file
// convention.
package speedtesttracker

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// adminEmail is the shared Admin login's email form.
func adminEmail(h *helpers.H) string { return h.AdminUser() + "@selfhost.local" }

// verifyScript reads the seeded administrator from the exact pinned Laravel
// container. The email and password arrive through private environment
// variables, never argv or a config file.
const verifyScript = `require '/app/www/vendor/autoload.php'; $app=require '/app/www/bootstrap/app.php'; $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap(); $p=getenv('SELFHOST_ADMIN_PASSWORD'); $e=getenv('SELFHOST_ADMIN_EMAIL'); $u=App\Models\User::where('email',$e)->first(); if (!$u || !$u->is_admin || !Illuminate\Support\Facades\Hash::check($p,$u->password)) exit(21); echo $u->id;`

// App is Speedtest Tracker. Traps: docs/catalog/traps/speedtest-tracker.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "speedtest-tracker", Name: "Speedtest Tracker", Category: "Monitoring",
		Description:   "Records your internet speed measurements and their history",
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
    ports:
      - ${BIND_IP}:` + port + `:80
`
}

// Files writes the Laravel APP_KEY to /config/app.key, the path the
// LinuxServer image reads through FILE__APP_KEY. The file holds a canonical
// base64-prefixed 32-byte key and is mode 0600.
func (App) Files(_ app.RenderContext, secret func(name string) string) []app.File {
	raw, err := hex.DecodeString(secret("app_key"))
	if err != nil || len(raw) != 32 {
		return nil
	}
	content := "base64:" + base64.StdEncoding.EncodeToString(raw)
	return []app.File{{Path: "config/app.key", Content: content, Mode: 0o600}}
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
	if err := h.Ready(ctx, "/api/healthcheck"); err != nil {
		return err
	}
	return h.Step(ctx, "admin-login", "verify the administrator "+adminEmail(h), helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Do: func(context.Context) error {
			return errors.New("Speedtest Tracker seeds the administrator from ADMIN_EMAIL/ADMIN_PASSWORD only on first start")
		},
		Hint: "Speedtest Tracker seeds the admin account on first start. Recreate the container with an empty config volume: " +
			"self-host start speedtest-tracker, then open " + h.URL + " and sign in as " + adminEmail(h) +
			" with the password from `self-host credentials`.",
		Credential: "admin",
	})
}

// Check verifies the seeded administrator only; the scoped API token and a real
// measurement stay separate acceptance steps.
func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := adminWorks(ctx, h); !ok {
		return fmt.Errorf("the administrator %s cannot be verified in Speedtest Tracker: %v", adminEmail(h), err)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
