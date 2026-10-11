package homarr

import (
	"context"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/apps/technitiumdns"
	"github.com/ajnart/self-host/internal/helpers"
)

func technitiumDNSTarget() target {
	return target{
		id: "technitium-dns", name: "Technitium DNS Server", kind: "technitiumDns", internal: fixed("http://technitium-dns:5380"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "apiKey", Value: to.Secret(to.Key("homarr_api_key"))}}
		},
		widgets: []widget{plain("dnsHoleSummary"), statWidget("dnsQueriesToday", "adsBlockedToday", "adsBlockedTodayPercentage", "domainsBeingBlocked")},
		preflight: func(ctx context.Context, _, to *helpers.H) error {
			return technitiumdns.VerifyHomarr(ctx, to)
		},
		verify: verifyTechnitiumDNS,
	}
}

func verifyTechnitiumDNS(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := technitiumdns.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.stats.catalog", map[string]any{"integrationId": integrationID})
	if err != nil {
		return err
	}
	catalog, _ := value.(map[string]any)
	metrics, ok := catalog["metrics"].([]any)
	if !ok {
		return errors.New("Homarr did not return its Technitium DNS statistics capabilities")
	}
	units := map[string]string{
		"dnsQueriesToday": "count", "adsBlockedToday": "count",
		"adsBlockedTodayPercentage": "percent", "domainsBeingBlocked": "count",
	}
	for key, unit := range units {
		found := false
		for _, raw := range metrics {
			metric, _ := raw.(map[string]any)
			if stringField(metric, "key") == key && stringField(metric, "unit") == unit {
				found = true
				break
			}
		}
		if !found {
			return errors.New("Homarr Technitium DNS statistic or unit is unsupported; use Homarr 2.4.1 and retry Setup")
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
	updated, hasUpdate := snapshot["updatedAt"].(float64)
	if !hasError || failed || !hasStale || stale || !hasUpdate || updated < float64(started) {
		return errors.New("Homarr did not freshly read Technitium DNS statistics; check its connection and retry self-host setup homarr")
	}
	values, ok := snapshot["values"].(map[string]any)
	if !ok {
		return errors.New("Homarr returned incomplete Technitium DNS statistics")
	}
	for key, unit := range units {
		count, ok := values[key].(float64)
		if !ok || math.IsNaN(count) || math.IsInf(count, 0) || count < 0 || unit == "percent" && count > 100 || unit == "count" && math.Trunc(count) != count {
			return errors.New("Homarr returned incomplete Technitium DNS statistics; explicit zeros are valid but missing values are not")
		}
	}
	if values["adsBlockedToday"].(float64) > values["dnsQueriesToday"].(float64) {
		return errors.New("Homarr returned inconsistent Technitium DNS statistics")
	}
	return nil
}
