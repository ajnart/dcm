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
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			if err := linkwarden.VerifyHomarr(ctx, to); err != nil {
				if errors.Is(err, helpers.ErrManual) {
					from.Info(linkwarden.HomarrRecoveryHint + " No Homarr mutation is permitted while that prerequisite is Manual.")
				}
				return err
			}
			return nil
		},
		verify: verifyLinkwarden,
	}
}

func verifyLinkwarden(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := linkwarden.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	accountID, err := linkwarden.HomarrAccountID(to)
	if err != nil {
		return err
	}
	value, err := apiKeyWrite(ctx, from, "integration.request", map[string]any{
		"integrationId": integrationID, "method": "GET", "path": "/api/v1/users/me",
	})
	if err != nil {
		return err
	}
	result, _ := value.(map[string]any)
	integration, _ := result["integration"].(map[string]any)
	data, _ := result["data"].(map[string]any)
	identity, _ := data["response"].(map[string]any)
	if result["ok"] != true || result["status"] != float64(200) || integration["id"] != integrationID || integration["kind"] != "linkwarden" || identity["id"] != float64(accountID) {
		from.Info("Restore the known selected account's token to this owned Linkwarden integration in Homarr Management > Integrations, preserving unrelated integrations, then retry self-host setup homarr. Equal or empty native counts do not establish account identity.")
		return helpers.ErrManual
	}
	statistics, err := freshStatsSnapshot(ctx, from, integrationID)
	if err != nil {
		return err
	}
	for _, key := range []string{"links", "collections", "tags"} {
		count, ok := statistics[key].(float64)
		if !ok || math.IsNaN(count) || math.IsInf(count, 0) || count < 0 || math.Trunc(count) != count {
			return errors.New("Homarr returned incomplete Linkwarden statistics; retry self-host setup homarr")
		}
	}
	return nil
}
