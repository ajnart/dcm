package prometheus

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Prometheus. Traps: docs/catalog/traps/prometheus.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "prometheus", Name: "Prometheus", Category: "Observability",
		Description:   "Record numbers about how your computers and apps are doing over time",
		Image:         "prom/prometheus:v3.15.0",
		Docs:          "https://prometheus.io/docs/prometheus/latest/installation/",
		Port:          9090,
		ContainerPort: 9090,
		Service:       "prometheus",
	}
}

func (App) Inputs() []app.Input {
	return []app.Input{
		{Key: "username", Prompt: "Existing Prometheus read-only username (optional)", Help: "Only for an already protected HTTP Basic endpoint; does not change Prometheus authentication", Private: true},
		{Key: "password", Prompt: "Existing Prometheus read-only password (optional)", Help: "Supply both credentials through private inputs; leave both empty for the unprotected starter", Private: true},
	}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  prometheus:
    image: prom/prometheus:v3.15.0
    restart: unless-stopped
    user: ${PUID}:${PGID}
    volumes:
      - ./data:/prometheus
    ports:
      - ${BIND_IP}:` + port + `:9090
`
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	return h.Step(ctx, "ready", "verify Prometheus query data and scrape targets", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			_, err := VerifyHomarr(ctx, h)
			return err == nil, err
		},
		Do: func(ctx context.Context) error {
			var manual error
			err := h.Poll(ctx, time.Minute, func(ctx context.Context) (bool, error) {
				_, err := VerifyHomarr(ctx, h)
				if errors.Is(err, helpers.ErrManual) {
					manual = err
					return true, nil
				}
				return err == nil, err
			})
			if manual != nil {
				return manual
			}
			return err
		},
		Hint: recoveryHint,
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	_, err := VerifyHomarr(ctx, h)
	return err
}

func (App) Links() []app.Link { return nil }
