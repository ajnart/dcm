package glances

import (
	"context"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Glances. Traps: docs/catalog/traps/glances.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "glances", Name: "Glances", Category: "Monitoring",
		Description:   "See the workload visible to Glances without extra access to your computer",
		Image:         "nicolargo/glances:latest",
		Docs:          "https://glances.readthedocs.io/en/latest/docker.html",
		Port:          61208,
		ContainerPort: 61208,
		Service:       "glances",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  glances:
    image: nicolargo/glances:latest
    restart: unless-stopped
    environment:
      GLANCES_OPT: -w
    ports:
      - ${BIND_IP}:` + port + `:61208
`
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := (firstadmin.NoAccount{Probe: firstadmin.Probe{Path: "/api/4/status"}}).Setup(ctx, h); err != nil {
		return err
	}
	return h.Step(ctx, "api", "verify Glances version and available resource data", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			err := VerifyHomarr(ctx, h)
			return err == nil, err
		},
		Do:   func(ctx context.Context) error { return VerifyHomarr(ctx, h) },
		Hint: "Use Glances 4.5.6 or newer 4.x with API v4 and the CPU, memory, network, filesystem and uptime plugins, then run self-host setup glances. Keep existing authentication enabled; Homarr 2.4.1 cannot connect to authenticated Glances. No extra host or device access is required.",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	return VerifyHomarr(ctx, h)
}

func (App) Links() []app.Link { return nil }
