// Package valkey is Valkey: a private cache and queue for trusted peers on the
// shared Compose network, with no authentication by default.
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
		Description:   "In-memory key-value store used as a fast cache or queue by other Apps",
		Image:         "valkey/valkey:9.1.2",
		Docs:          "https://valkey.io/topics/installation/",
		Port:          6379,
		ContainerPort: 6379,
		Service:       "valkey",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	return `services:
  valkey:
    image: valkey/valkey:9.1.2
    command: ["valkey-server", "--protected-mode", "no"]
    restart: unless-stopped
    volumes:
      - ./data:/data
    ports:
      - ${BIND_IP}:` + strconv.Itoa(rc.Port) + `:6379
`
}

func ping(ctx context.Context, h *helpers.H) (bool, error) {
	result, err := h.Exec(ctx, nil, "valkey-cli", "-h", "127.0.0.1", "-p", "6379", "PING")
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
