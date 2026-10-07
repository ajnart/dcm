// Package unbound is Unbound: a private recursive DNS resolver whose
// readiness is proven with fixed local TCP and UDP queries.
package unbound

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Unbound. Traps: docs/catalog/traps/unbound.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "unbound", Name: "Unbound", Category: "DNS",
		Description:   "Recursive DNS resolver that answers queries locally and caches results for your network",
		Image:         "madnuttah/unbound:1.26.0-0",
		Docs:          "https://unbound.docs.nlnetlabs.nl/",
		Port:          5335,
		ContainerPort: 5335,
		Service:       "unbound",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  unbound:
    image: madnuttah/unbound:1.26.0-0
    restart: unless-stopped
    environment:
      TZ: ${TZ}
    ports:
      - ${BIND_IP}:` + port + `:5335
      - ${BIND_IP}:` + port + `:5335/udp
    healthcheck:
      test: ["CMD", "/usr/local/unbound/sbin/healthcheck.sh"]
      interval: 60s
      timeout: 15s
      retries: 3
      start_period: 5s
`
}

const dnsName = "nlnetlabs.nl"

func query(ctx context.Context, h *helpers.H, protocol string) (bool, error) {
	args := []string{"drill"}
	if protocol == "tcp" {
		args = append(args, "-t")
	}
	args = append(args, "-p", "5335", "@127.0.0.1", dnsName, "A")
	result, err := h.Exec(ctx, nil, args...)
	if err != nil {
		return false, err
	}
	if result.ExitCode != 0 {
		return false, fmt.Errorf("drill exited %d", result.ExitCode)
	}
	return strings.Contains(string(result.Stdout), "NOERROR"), nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	for _, protocol := range []string{"udp", "tcp"} {
		id := "dns-" + protocol
		err := h.Step(ctx, id, "answer a local "+strings.ToUpper(protocol)+" DNS query", helpers.StepSpec{
			Check: func(ctx context.Context) (bool, error) { return query(ctx, h, protocol) },
			Do: func(ctx context.Context) error {
				return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) {
					return query(ctx, h, protocol)
				})
			},
			Hint: "Query the resolver inside its container: docker compose exec unbound drill -p 5335 @127.0.0.1 " +
				dnsName + " A (add -t for TCP), or read the logs with: self-host logs unbound",
		})
		if err != nil {
			return err
		}
	}
	return nil
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	for _, protocol := range []string{"udp", "tcp"} {
		ok, err := query(ctx, h, protocol)
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("Unbound did not answer the local %s query for %s", strings.ToUpper(protocol), dnsName)
		}
	}
	return nil
}

func (App) Links() []app.Link { return nil }
