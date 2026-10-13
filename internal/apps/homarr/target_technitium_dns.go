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
		stats:  verifyTechnitiumDNSStats,
	}
}

func verifyTechnitiumDNS(ctx context.Context, _, to *helpers.H, _ string) error {
	return technitiumdns.VerifyHomarr(ctx, to)
}

func verifyTechnitiumDNSStats(sample statsSample) error {
	units := map[string]string{
		"dnsQueriesToday": "count", "adsBlockedToday": "count",
		"adsBlockedTodayPercentage": "percent", "domainsBeingBlocked": "count",
	}
	for key, unit := range units {
		if sample.units[key] != unit {
			return errors.New("Homarr Technitium DNS statistic or unit is unsupported; use Homarr 2.4.1 and retry Setup")
		}
	}
	if sample.updatedAt < sample.startedAt {
		return errors.New("Homarr did not freshly read Technitium DNS statistics; check its connection and retry self-host setup homarr")
	}
	for key, unit := range units {
		count, ok := sample.values[key].(float64)
		if !ok || math.IsNaN(count) || math.IsInf(count, 0) || count < 0 || unit == "percent" && count > 100 || unit == "count" && math.Trunc(count) != count {
			return errors.New("Homarr returned incomplete Technitium DNS statistics; explicit zeros are valid but missing values are not")
		}
	}
	if sample.values["adsBlockedToday"].(float64) > sample.values["dnsQueriesToday"].(float64) {
		return errors.New("Homarr returned inconsistent Technitium DNS statistics")
	}
	return nil
}
