package homarr

import (
	"context"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/apps/prometheus"
	"github.com/ajnart/self-host/internal/helpers"
)

func prometheusTarget() target {
	return target{
		id: "prometheus", name: "Prometheus", kind: "prometheus", internal: fixed("http://prometheus:9090"),
		secrets: func(_, to *helpers.H) []secret {
			user, password := to.Secret(to.Key("username")), to.Secret(to.Key("password"))
			if user == "" && password == "" {
				return []secret{}
			}
			return []secret{{Kind: "username", Value: user}, {Kind: "password", Value: password}}
		},
		widgets: []widget{statWidget("total", "up", "down")},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			_, err := prometheus.VerifyHomarr(ctx, to)
			if errors.Is(err, helpers.ErrManual) {
				from.Info("Preserve Prometheus authentication and its scrape configuration. Run self-host setup prometheus for the private credential or self-scrape recovery instructions, then retry self-host setup homarr.")
			}
			return err
		},
		verify: verifyPrometheus,
	}
}

func verifyPrometheus(ctx context.Context, from, to *helpers.H, integrationID string) error {
	counts, err := prometheus.VerifyHomarr(ctx, to)
	if err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.stats.catalog", map[string]any{"integrationId": integrationID})
	if err != nil {
		return err
	}
	catalog, ok := value.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return the Prometheus metric catalog")
	}
	metrics, _ := catalog["metrics"].([]any)
	for _, key := range []string{"total", "up", "down"} {
		found := false
		for _, raw := range metrics {
			metric, _ := raw.(map[string]any)
			if stringField(metric, "key") == key && stringField(metric, "unit") == "count" {
				found = true
			}
		}
		if !found {
			return errors.New("Homarr does not expose the supported Prometheus target-count metrics; retry self-host setup homarr with Homarr 2.4.1")
		}
	}
	started := float64(from.Now().UnixMilli())
	value, err = apiKeyWrite(ctx, from, "widget.stats.refresh", map[string]any{"integrationId": integrationID, "force": true})
	if err != nil {
		return err
	}
	snapshot, ok := value.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return Prometheus statistics")
	}
	failed, hasError := snapshot["error"].(bool)
	stale, hasStale := snapshot["stale"].(bool)
	updated, hasTime := snapshot["updatedAt"].(float64)
	now := float64(from.Now().UnixMilli())
	if !hasError || failed || !hasStale || stale || !hasTime || math.IsNaN(updated) || math.IsInf(updated, 0) || updated < started || updated > now+5000 {
		return errors.New("Homarr Prometheus statistics are failed, missing or not freshly refreshed; retry self-host setup homarr")
	}
	values, ok := snapshot["values"].(map[string]any)
	if !ok {
		return errors.New("Homarr returned incomplete Prometheus statistics")
	}
	for key, expected := range map[string]int{"total": counts.Total, "up": counts.Up, "down": counts.Down} {
		actual, ok := values[key].(float64)
		if !ok || actual != float64(expected) {
			return errors.New("Homarr returned incomplete or changed Prometheus target counts; retry self-host setup homarr")
		}
	}
	return nil
}
