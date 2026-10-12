package homarr

import (
	"context"
	"errors"
	"math"
	"slices"

	"github.com/ajnart/self-host/internal/apps/nzbget"
	"github.com/ajnart/self-host/internal/helpers"
)

func nzbgetTarget() target {
	return target{
		id: "nzbget", name: "NZBGet", kind: "nzbGet", internal: fixed("http://nzbget:6789"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{
				{Kind: "username", Value: to.Secret(to.Key("homarr_username"))},
				{Kind: "password", Value: to.Secret(to.Key("homarr_password"))},
			}
		},
		widgets: []widget{{kind: "downloads", options: map[string]any{
			"columns":             []string{"name", "progress", "downSpeed", "time", "state"},
			"showCompletedUsenet": true, "limitPerIntegration": 50,
		}}, statWidget("download", "paused")},
		preflight: func(_ context.Context, from, _ *helpers.H) error {
			from.Info("NZBGet native activation is blocked by #354: Homarr 2.4.1 can log a credential-bearing RPC Address after a rejected request. Keep this Link inactive until supported HTTP Basic transport or complete downstream redaction is resolved, the exact Homarr version/source contract is reviewed, and activation is authorized; then retry self-host setup homarr. Standalone NZBGet Setup and owned Link removal remain separate.")
			return helpers.ErrManual
		},
		verify: verifyNZBGet,
	}
}

func verifyNZBGet(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := verifyNZBGetIdentity(ctx, from, integrationID); err != nil {
		return err
	}
	if err := nzbget.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.downloads.getJobsAndStatuses", map[string]any{
		"integrationIds": []string{integrationID}, "limitPerIntegration": 50,
	})
	if err != nil {
		return errors.New("Homarr could not read NZBGet Downloads; run self-host setup nzbget, then self-host setup homarr")
	}
	results, ok := value.([]any)
	if !ok || len(results) != 1 {
		return errors.New("Homarr did not return the NZBGet download queue; retry self-host setup homarr")
	}
	result, _ := results[0].(map[string]any)
	integration, _ := result["integration"].(map[string]any)
	data, _ := result["data"].(map[string]any)
	if result["error"] != nil || stringField(result, "integrationId") != integrationID || stringField(integration, "id") != integrationID || stringField(integration, "kind") != "nzbGet" || data == nil {
		return errors.New("Homarr could not read the authenticated NZBGet queue; retry self-host setup homarr")
	}
	status, _ := data["status"].(map[string]any)
	rates, _ := status["rates"].(map[string]any)
	rate, ok := rates["down"].(float64)
	if !ok || rate < 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
		return errors.New("Homarr did not return the NZBGet download rate; retry self-host setup homarr")
	}
	if _, ok := status["paused"].(bool); !ok {
		return errors.New("Homarr did not return the NZBGet queue state; retry self-host setup homarr")
	}
	types, ok := status["types"].([]any)
	if !ok || !slices.Contains(types, any("usenet")) {
		return errors.New("Homarr did not identify the NZBGet Usenet queue; retry self-host setup homarr")
	}
	items, ok := data["items"].([]any)
	if !ok || len(items) > 50 {
		return errors.New("Homarr did not return the bounded NZBGet download list; retry self-host setup homarr")
	}
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		progress, ok := item["progress"].(float64)
		if stringField(item, "id") == "" || stringField(item, "name") == "" || stringField(item, "type") != "usenet" || !slices.Contains([]string{"downloading", "queued", "paused", "completed", "failed", "processing"}, stringField(item, "state")) || !ok || progress < 0 || progress > 1 || math.IsNaN(progress) || math.IsInf(progress, 0) {
			return errors.New("Homarr returned incomplete NZBGet download data; retry self-host setup homarr")
		}
		for _, key := range []string{"size", "index", "time"} {
			value, ok := item[key].(float64)
			if !ok || math.IsNaN(value) || math.IsInf(value, 0) || key == "size" && value < 0 {
				return errors.New("Homarr returned incomplete NZBGet download data; retry self-host setup homarr")
			}
		}
	}
	catalog, err := apiKeyProcedure(ctx, from, "widget.stats.catalog", map[string]any{"integrationId": integrationID})
	if err != nil {
		return errors.New("Homarr could not read the NZBGet Stats catalog; retry self-host setup homarr")
	}
	statistics, _ := catalog.(map[string]any)
	metrics, _ := statistics["metrics"].([]any)
	for _, key := range []string{"download", "paused"} {
		found := false
		for _, raw := range metrics {
			metric, _ := raw.(map[string]any)
			if stringField(metric, "key") == key {
				found = true
				break
			}
		}
		if !found {
			return errors.New("Homarr does not expose the required NZBGet Stats fields; use Homarr 2.4.1, then retry Setup")
		}
	}
	return nil
}

func verifyNZBGetIdentity(ctx context.Context, from *helpers.H, integrationID string) error {
	if integrationID == "" {
		from.Info("Homarr's NZBGet Link has no saved integration identifier; review its owned record before retrying self-host setup homarr. No integration was adopted or changed.")
		return helpers.ErrManual
	}
	value, err := apiKeyProcedure(ctx, from, "integration.byId", map[string]any{"id": integrationID})
	if err != nil {
		return errors.New("Homarr could not read the saved NZBGet credential metadata; review its owned integration and retry self-host setup homarr")
	}
	integration, _ := value.(map[string]any)
	credentials, ok := integration["secrets"].([]any)
	valid := ok && len(credentials) == 2 && stringField(integration, "id") == integrationID && stringField(integration, "kind") == "nzbGet" && stringField(integration, "url") == "http://nzbget:6789"
	seen := map[string]bool{}
	for _, raw := range credentials {
		credential, _ := raw.(map[string]any)
		kind := stringField(credential, "kind")
		value, present := credential["value"]
		if seen[kind] || !present || kind != "username" && kind != "password" || kind == "username" && value != "self-host-homarr" || kind == "password" && value != nil {
			valid = false
		}
		seen[kind] = true
	}
	if !valid || !seen["username"] || !seen["password"] {
		from.Info("Homarr's saved NZBGet integration must use exactly the managed restricted username and a redacted password credential. Review and explicitly repair only the owned record; do not adopt an Admin or foreign account. Then retry self-host setup homarr. No credential was changed.")
		return helpers.ErrManual
	}
	return nil
}
