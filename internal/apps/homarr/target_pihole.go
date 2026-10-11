package homarr

import (
	"context"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/apps/pihole"
	"github.com/ajnart/self-host/internal/helpers"
)

func piholeTarget() target {
	return target{
		id: "pihole", name: "Pi-hole", kind: "piHole", internal: fixed("http://pihole:80"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "apiKey", Value: to.Secret(to.Key("homarr_app_password"))}}
		},
		widgets: []widget{{kind: "dnsHoleSummary", options: map[string]any{"usePiHoleColors": true, "layout": "grid"}},
			statWidget("dnsQueriesToday", "adsBlockedToday", "adsBlockedTodayPercentage", "domainsBeingBlocked")},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			err := pihole.VerifyHomarr(ctx, to)
			if errors.Is(err, helpers.ErrManual) {
				from.Info("Pi-hole's dedicated application password must have app_sudo disabled. Review Pi-hole's application-password settings, then run self-host setup pihole followed by self-host setup homarr; this Link will not change permissions or blocking rules.")
			}
			return err
		},
		verify: verifyPihole,
	}
}

func piholeStatistics(value any) bool {
	statistics, ok := value.(map[string]any)
	if !ok {
		return false
	}
	for _, key := range []string{"dnsQueriesToday", "adsBlockedToday", "adsBlockedTodayPercentage", "domainsBeingBlocked"} {
		count, ok := statistics[key].(float64)
		if !ok || math.IsNaN(count) || math.IsInf(count, 0) || count < 0 {
			return false
		}
		if key == "adsBlockedTodayPercentage" {
			if count > 100 {
				return false
			}
		} else if math.Trunc(count) != count {
			return false
		}
	}
	return statistics["adsBlockedToday"].(float64) <= statistics["dnsQueriesToday"].(float64)
}

func verifyPihole(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := pihole.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.stats.catalog", map[string]any{"integrationId": integrationID})
	if err != nil {
		return err
	}
	catalog, _ := value.(map[string]any)
	metrics, _ := catalog["metrics"].([]any)
	for key, unit := range map[string]string{"dnsQueriesToday": "count", "adsBlockedToday": "count", "adsBlockedTodayPercentage": "percent", "domainsBeingBlocked": "count"} {
		found := false
		for _, raw := range metrics {
			metric, _ := raw.(map[string]any)
			if stringField(metric, "key") == key && stringField(metric, "unit") == unit {
				found = true
			}
		}
		if !found {
			return errors.New("Homarr does not expose the supported Pi-hole Stats keys and units; use Homarr 2.4.1, then retry Setup")
		}
	}
	started := from.Now().UnixMilli()
	value, err = apiKeyWrite(ctx, from, "widget.stats.refresh", map[string]any{"integrationId": integrationID, "force": true})
	if err != nil {
		return err
	}
	snapshot, _ := value.(map[string]any)
	failed, hasError := snapshot["error"].(bool)
	stale, hasStale := snapshot["stale"].(bool)
	updated, hasUpdated := snapshot["updatedAt"].(float64)
	if !hasError || failed || !hasStale || stale || !hasUpdated || updated < float64(started) || !piholeStatistics(snapshot["values"]) {
		return errors.New("Homarr did not return fresh authenticated Pi-hole Stats; explicit zero counts are valid, missing or failed results are not. Retry self-host setup pihole, then self-host setup homarr")
	}
	value, err = apiKeyProcedure(ctx, from, "widget.dnsHole.summary", map[string]any{"integrationIds": []string{integrationID}})
	if err != nil {
		return err
	}
	results, ok := value.([]any)
	if !ok || len(results) != 1 {
		return errors.New("Homarr did not return the Pi-hole DNS Hole Summary")
	}
	result, _ := results[0].(map[string]any)
	summary, _ := result["summary"].(map[string]any)
	if stringField(result, "integrationId") != integrationID || result["error"] != nil || !piholeStatistics(summary) || stringField(summary, "status") != "enabled" && stringField(summary, "status") != "disabled" {
		return errors.New("Homarr returned incomplete or failed Pi-hole DNS Hole data; retry self-host setup pihole, then self-host setup homarr")
	}
	return nil
}
