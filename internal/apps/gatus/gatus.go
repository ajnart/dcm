// Package gatus is Gatus, a private health dashboard whose starter config only
// checks Gatus itself and keeps its history in SQLite.
package gatus

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Gatus. Traps: docs/catalog/traps/gatus.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "gatus", Name: "Gatus", Category: "Monitoring",
		Description:   "Check that your apps are working and see them on a status page",
		Image:         "ghcr.io/twin/gatus:v5.37.0",
		Docs:          "https://github.com/TwiN/gatus/blob/v5.37.0/README.md",
		Port:          8080,
		ContainerPort: 8080,
		Service:       "gatus",
	}
}

func (App) Inputs() []app.Input { return nil }

const config = `storage:
  type: sqlite
  path: /data/gatus.db
endpoints:
  - name: gatus-self
    group: local
    url: http://127.0.0.1:8080/health
    interval: 1m
    conditions:
      - "[STATUS] == 200"
`

func (App) Files(app.RenderContext, func(string) string) []app.File {
	return []app.File{{Path: "config", Content: config}}
}

func (App) Compose(rc app.RenderContext) string {
	return `services:
  gatus:
    image: ghcr.io/twin/gatus:v5.37.0
    restart: unless-stopped
    volumes:
      - ./config:/config/config.yaml
      - ./data:/data
    ports:
      - ${BIND_IP}:` + strconv.Itoa(rc.Port) + `:8080
`
}

var probe = firstadmin.NoAccount{Probe: firstadmin.Probe{Path: "/health"}}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := probe.Setup(ctx, h); err != nil {
		return err
	}
	attempt := func(ctx context.Context) (bool, error) {
		err := VerifyHomarr(ctx, h)
		return err == nil, err
	}
	return h.Step(ctx, "checks", "verify Gatus records its local health check", helpers.StepSpec{
		Check: attempt,
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 2*time.Minute, attempt)
		},
		Hint: "Keep the local gatus-self check in Gatus's config, read self-host logs gatus, then retry self-host setup gatus. Existing authentication must not be disabled for Homarr.",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if err := probe.Check(ctx, h); err != nil {
		return err
	}
	return VerifyHomarr(ctx, h)
}

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	response, err := h.HTTP(ctx, helpers.Request{Path: "/api/v1/endpoints/statuses", NoRedirect: true})
	if err != nil {
		return errors.New("Gatus status API is unavailable; read self-host logs gatus and retry self-host setup gatus")
	}
	if response.Status != 200 {
		return fmt.Errorf("Gatus status API returned HTTP %d; Homarr supports only the existing no-credentials mode, do not disable authentication", response.Status)
	}
	var endpoints []struct {
		Key     string `json:"key"`
		Name    string `json:"name"`
		Group   string `json:"group"`
		Results []struct {
			Success   *bool     `json:"success"`
			Status    int       `json:"status"`
			Hostname  string    `json:"hostname"`
			Timestamp time.Time `json:"timestamp"`
		} `json:"results"`
	}
	if response.Decode(&endpoints) != nil || endpoints == nil {
		return errors.New("Gatus did not return endpoint statuses; retry self-host setup gatus")
	}
	for _, endpoint := range endpoints {
		if endpoint.Results == nil {
			return errors.New("Gatus returned incomplete endpoint statuses; retry self-host setup gatus")
		}
		for _, result := range endpoint.Results {
			if result.Success == nil {
				return errors.New("Gatus returned an endpoint result without its health outcome; retry self-host setup gatus")
			}
		}
		if endpoint.Key != "local_gatus-self" || endpoint.Name != "gatus-self" || endpoint.Group != "local" {
			continue
		}
		if len(endpoint.Results) == 0 {
			return errors.New("Gatus has not recorded its local health check yet; retry self-host setup gatus")
		}
		latest := endpoint.Results[len(endpoint.Results)-1]
		if !*latest.Success || latest.Status != 200 || latest.Hostname != "127.0.0.1" || latest.Timestamp.IsZero() {
			return errors.New("Gatus's recorded local health check is not successful; read self-host logs gatus and retry self-host setup gatus")
		}
		return nil
	}
	return errors.New("Gatus has no recorded local gatus-self check; preserve existing checks and add the starter loopback health check, then retry self-host setup gatus")
}

func (App) Links() []app.Link { return nil }
