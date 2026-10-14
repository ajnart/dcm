// Package valkey is Valkey: a private cache and queue. It is published on the
// LAN, so it requires a generated password (VALKEY_PASSWORD).
package valkey

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Valkey. Traps: docs/catalog/traps/valkey.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "valkey", Name: "Valkey", Category: "Databases",
		Description:   "A fast short-term memory that your other apps use to run quicker",
		Image:         "valkey/valkey:9.1.2",
		Docs:          "https://valkey.io/topics/installation/",
		Port:          6379,
		ContainerPort: 6379,
		Service:       "valkey",
		NoWebUI:       true,
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Secrets() []app.SecretSpec { return []app.SecretSpec{{Name: "password", Length: 32}} }

// Files keeps the password out of the command line.
func (App) Files(_ app.RenderContext, secret func(string) string) []app.File {
	return []app.File{
		{Path: "valkey.conf", Content: "protected-mode no\nrequirepass " + secret("password") + "\n", Mode: 0o600},
		{Path: "data/.keep", Mode: 0o644},
	}
}

// Run the server directly: the image's root entrypoint switches to UID 999,
// which cannot read the private config owned by the configured Project user.
func (App) Compose(rc app.RenderContext) string {
	return `services:
  valkey:
    image: valkey/valkey:9.1.2
    entrypoint: ["tini", "--", "sh", "-c", "umask 0077; exec /usr/local/bin/valkey-server \"$$@\"", "selfhost-valkey"]
    command: ["/usr/local/etc/valkey/valkey.conf"]
    restart: unless-stopped
    user: ${PUID}:${PGID}
    volumes:
      - ./data:/data
      - ./valkey.conf:/usr/local/etc/valkey/valkey.conf:ro
    ports:
      - ${BIND_IP}:` + strconv.Itoa(rc.Port) + `:6379
`
}

func ping(ctx context.Context, h *helpers.H) (bool, error) {
	password := h.Secret(h.Key("password"))
	env := map[string]string{"VALKEYCLI_AUTH": password, "REDISCLI_AUTH": password}
	result, err := h.Exec(ctx, env, "valkey-cli", "-h", "127.0.0.1", "-p", "6379", "PING")
	if err != nil {
		return false, err
	}
	return result.ExitCode == 0 && strings.TrimSpace(string(result.Stdout)) == "PONG", nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	return h.Step(ctx, "ping", "answer PING inside the container", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return ping(ctx, h) },
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) {
				return ping(ctx, h)
			})
		},
		Hint: "Ping the server inside its container: docker compose exec valkey valkey-cli PING, or read the logs with: self-host logs valkey",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := ping(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("Valkey did not answer PONG inside its container")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
