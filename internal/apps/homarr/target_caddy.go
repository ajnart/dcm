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
		id: "caddy", name: "Caddy", kind: "caddy", internal: fixed("http://caddy:2015"),
		secrets: func(_, _ *helpers.H) []secret { return []secret{} },
		widgets: []widget{statWidget("upstreams", "requests", "requestsFailed")},
		verify:  verifyCaddy,
	}
}

func verifyCaddy(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := caddy.VerifyStatistics(ctx, to); err != nil {
		return err
	}
	statistics, err := freshStatsSnapshot(ctx, from, integrationID)
	if err != nil {
		return err
	}
	for _, key := range []string{"upstreams", "requests", "requestsFailed"} {
		count, ok := statistics[key].(float64)
		if !ok || count < 0 || math.IsNaN(count) || math.IsInf(count, 0) || math.Trunc(count) != count {
			return errors.New("Homarr returned incomplete Caddy statistics; retry self-host setup homarr")
		}
	}
	return nil
}
