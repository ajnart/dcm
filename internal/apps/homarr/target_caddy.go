package homarr

import (
	"context"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/apps/caddy"
	"github.com/ajnart/self-host/internal/helpers"
)

func caddyTarget() target {
	return target{
		id: "caddy", name: "Caddy", kind: "caddy", internal: (*helpers.H).InternalURL,
		secrets: func(_, _ *helpers.H) []secret { return []secret{} },
		widgets: []widget{statWidget("upstreams", "requests", "requestsFailed")},
		verify:  verifyCaddy,
		stats:   verifyCaddyStats,
	}
}

func verifyCaddy(ctx context.Context, _, to *helpers.H, _ string) error {
	return caddy.VerifyStatistics(ctx, to)
}

func verifyCaddyStats(sample statsSample) error {
	for _, key := range []string{"upstreams", "requests", "requestsFailed"} {
		count, ok := sample.values[key].(float64)
		if sample.units[key] != "count" || !ok || count < 0 || math.IsNaN(count) || math.IsInf(count, 0) || math.Trunc(count) != count {
			return errors.New("Homarr returned incomplete Caddy statistics; retry self-host setup homarr")
		}
	}
	return nil
}
