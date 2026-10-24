package dashdot

import (
	"context"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Dash.. Traps: docs/catalog/traps/dashdot.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "dashdot", Name: "Dash.", Category: "Monitoring",
		Description:   "See kernel-visible processor and memory use",
		Image:         "mauricenino/dashdot:latest",
		Docs:          "https://getdashdot.com/docs/",
		Port:          3001,
		ContainerPort: 3001,
		Service:       "dashdot",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  dashdot:
    image: mauricenino/dashdot:latest
    restart: unless-stopped
    read_only: true
    environment:
      DASHDOT_RUNNING_IN_DOCKER: "false"
      DASHDOT_WIDGET_LIST: cpu,ram
      DASHDOT_DISABLE_BACKGROUND_STATS_COLLECTION: "true"
      DASHDOT_DISABLE_INTEGRATIONS: "false"
      DASHDOT_ENABLE_CPU_TEMPS: "false"
      DASHDOT_PAGE_TITLE: Kernel CPU and RAM
      DASHDOT_RAM_LABEL_LIST: size
    ports:
      - ${BIND_IP}:` + port + `:3001
`
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := (firstadmin.NoAccount{Probe: firstadmin.Probe{Path: "/config"}}).Setup(ctx, h); err != nil {
		return err
	}
	probe := func(ctx context.Context) (bool, error) {
		err := VerifyMetrics(ctx, h)
		return err == nil, err
	}
	return h.Step(ctx, "metrics", "verify Dash. kernel CPU and RAM data", helpers.StepSpec{
		Check: probe,
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 2*time.Minute, probe)
		},
		Hint: "Read self-host logs dashdot; restore the Catalog CPU/RAM settings and restart Dash., then retry self-host setup dashdot. No host mounts or extra privileges are needed.",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	return VerifyMetrics(ctx, h)
}

func (App) Links() []app.Link { return nil }
