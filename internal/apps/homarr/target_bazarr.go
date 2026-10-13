package homarr

import (
	"context"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/apps/bazarr"
	"github.com/ajnart/self-host/internal/helpers"
)

func bazarrTarget() target {
	return target{
		id: "bazarr", name: "Bazarr", kind: "bazarr", internal: fixed("http://bazarr:6767"),
		secrets: apiKeySecret,
		widgets: []widget{{kind: "bazarr", options: map[string]any{
			"showMissingEpisodes": true, "showMissingMovies": true,
			"showProviderIssues": true, "showHealthIssues": true,
		}}, statWidget("episodes", "movies", "providers")},
		preflight: func(ctx context.Context, _, to *helpers.H) error {
			return bazarr.VerifyHomarr(ctx, to)
		},
		verify: verifyBazarr,
		stats:  verifyBazarrStats,
	}
}

func verifyBazarr(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := bazarr.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.bazarr.getBadges", map[string]any{"integrationId": integrationID})
	if err != nil {
		return err
	}
	badges, ok := value.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return Bazarr subtitle counts; retry self-host setup homarr")
	}
	for _, key := range []string{"episodes", "movies", "providers", "status", "announcements"} {
		count, ok := badges[key].(float64)
		if !ok || count < 0 || math.IsNaN(count) || math.IsInf(count, 0) || math.Trunc(count) != count {
			return errors.New("Homarr returned incomplete Bazarr subtitle counts; retry self-host setup homarr")
		}
	}
	for _, key := range []string{"sonarr_signalr", "radarr_signalr"} {
		if _, ok := badges[key].(string); !ok {
			return errors.New("Homarr returned incomplete Bazarr media connection status; retry self-host setup homarr")
		}
	}
	return nil
}

func verifyBazarrStats(sample statsSample) error {
	for _, key := range []string{"episodes", "movies", "providers"} {
		count, ok := sample.values[key].(float64)
		if sample.units[key] != "count" || !ok || count < 0 || math.IsNaN(count) || math.IsInf(count, 0) || math.Trunc(count) != count {
			return errors.New("Homarr returned invalid Bazarr subtitle Stats; retry self-host setup homarr")
		}
	}
	return nil
}
