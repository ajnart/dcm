package homarr

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/ajnart/self-host/internal/apps/patchmon"
	"github.com/ajnart/self-host/internal/helpers"
)

func patchmonTarget() target {
	return target{
		id: "patchmon", name: "PatchMon", kind: "patchmon",
		internal: fixed("http://patchmon:3000"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{
				{Kind: "patchmonApiKey", Value: to.Secret(to.Key("homarr_api_key"))},
				{Kind: "patchmonApiSecret", Value: to.Secret(to.Key("homarr_api_secret"))},
			}
		},
		widgets: []widget{
			{kind: "patchmon", options: map[string]any{
				"showComplianceHero": false, "enableThresholdColors": false,
				"showTotalHosts": true, "showHostsNeedingUpdates": true,
				"showSecurityUpdates": true, "showTotalOutdatedPackages": true,
			}},
			statWidget("totalHosts", "hostsNeedingUpdates", "securityUpdates", "totalOutdatedPackages"),
		},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			err := patchmon.HomarrReadiness(ctx, to)
			if errors.Is(err, helpers.ErrManual) {
				from.Info(patchmon.HomarrHint)
			}
			return err
		},
		verify: verifyPatchmon,
	}
}

func verifyPatchmon(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if _, err := patchmon.HomarrStats(ctx, to); err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.patchmon.getStats", map[string]any{"integrationId": integrationID})
	if err != nil {
		return err
	}
	stats, ok := value.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return PatchMon statistics")
	}
	for _, key := range []string{
		"totalHosts", "hostsNeedingUpdates", "securityUpdates", "upToDateHosts",
		"hostsWithSecurityUpdates", "recentUpdates24h", "totalOutdatedPackages", "totalRepos",
	} {
		count, ok := stats[key].(float64)
		if !ok || count < 0 || math.IsNaN(count) || math.IsInf(count, 0) || math.Trunc(count) != count {
			return errors.New("Homarr returned incomplete PatchMon statistics; retry self-host setup homarr")
		}
	}
	if _, err := time.Parse(time.RFC3339, stringField(stats, "lastUpdated")); err != nil {
		return errors.New("Homarr did not return the PatchMon statistics timestamp")
	}
	if stats["totalHosts"] == float64(0) {
		from.Info("PatchMon reports no enrolled computers. These zero counts are not evidence of secure or fully patched computers.")
	}
	return nil
}
