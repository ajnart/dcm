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
	value, err := apiKeyWrite(ctx, from, "widget.stats.refresh", map[string]any{"integrationId": integrationID, "force": true})
	if err != nil {
		return err
	}
	snapshot, ok := value.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return Caddy statistics; retry self-host setup homarr")
	}
	failed, hasError := snapshot["error"].(bool)
	stale, hasStale := snapshot["stale"].(bool)
	updated, hasUpdated := snapshot["updatedAt"].(float64)
	if !hasError || failed || !hasStale || stale || !hasUpdated || updated <= 0 || math.IsNaN(updated) || math.IsInf(updated, 0) {
		return errors.New("Homarr could not refresh Caddy statistics; check Caddy's read-only route, then retry self-host setup homarr")
	}
	statistics, ok := snapshot["values"].(map[string]any)
	if !ok {
		return errors.New("Homarr did not return Caddy statistic values; retry self-host setup homarr")
	}
	for _, key := range []string{"upstreams", "requests", "requestsFailed"} {
		count, ok := statistics[key].(float64)
		if !ok || count < 0 || math.IsNaN(count) || math.IsInf(count, 0) || math.Trunc(count) != count {
			return errors.New("Homarr returned incomplete Caddy statistics; retry self-host setup homarr")
		}
	}
	return nil
}
