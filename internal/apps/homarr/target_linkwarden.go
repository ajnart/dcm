package homarr

import (
	"context"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/apps/linkwarden"
	"github.com/ajnart/self-host/internal/helpers"
)

func linkwardenTarget() target {
	return target{
		id: "linkwarden", name: "Linkwarden", kind: "linkwarden", internal: fixed("http://linkwarden:3000"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "apiKey", Value: to.Secret(to.Key("homarr_api_key"))}}
		},
		widgets: []widget{statWidget("links", "collections", "tags")},
		verify:  verifyLinkwarden,
	}
}

func verifyLinkwarden(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := linkwarden.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	started := from.Now().UnixMilli()
	value, err := apiKeyWrite(ctx, from, "widget.stats.refresh", map[string]any{"integrationId": integrationID, "force": true})
	if err != nil {
		return err
	}
	snapshot, ok := value.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return Linkwarden statistics; retry self-host setup homarr")
	}
	failed, hasError := snapshot["error"].(bool)
	stale, hasStale := snapshot["stale"].(bool)
	updatedAt, hasTime := snapshot["updatedAt"].(float64)
	if !hasError || failed || !hasStale || stale || !hasTime || math.IsNaN(updatedAt) || math.IsInf(updatedAt, 0) || updatedAt < float64(started) {
		return errors.New("Homarr could not refresh authenticated Linkwarden statistics; check its token and retry self-host setup homarr")
	}
	statistics, ok := snapshot["values"].(map[string]any)
	if !ok {
		return errors.New("Homarr did not return Linkwarden statistics values")
	}
	for _, key := range []string{"links", "collections", "tags"} {
		count, ok := statistics[key].(float64)
		if !ok || math.IsNaN(count) || math.IsInf(count, 0) || count < 0 || math.Trunc(count) != count {
			return errors.New("Homarr returned incomplete Linkwarden statistics; retry self-host setup homarr")
		}
	}
	return nil
}
