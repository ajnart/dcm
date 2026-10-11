package homarr

import (
	"context"
	"errors"
	"math"
	"slices"

	"github.com/ajnart/self-host/internal/apps/deluge"
	"github.com/ajnart/self-host/internal/helpers"
)

func delugeTarget() target {
	return target{
		id: "deluge", name: "Deluge", kind: "deluge", internal: fixed("http://deluge:8112"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "password", Value: deluge.WebPassword(to)}}
		},
		widgets: []widget{{kind: "downloads", options: map[string]any{
			"columns":             []string{"name", "progress", "downSpeed", "upSpeed", "time", "state"},
			"limitPerIntegration": 50,
		}}, statWidget("download", "upload", "paused")},
		verify: verifyDeluge,
	}
}

func verifyDeluge(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := deluge.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.downloads.getJobsAndStatuses", map[string]any{
		"integrationIds": []string{integrationID}, "limitPerIntegration": 50,
	})
	if err != nil {
		return err
	}
	results, ok := value.([]any)
	if !ok || len(results) != 1 {
		return errors.New("Homarr did not return the Deluge download queue; run self-host setup deluge, then self-host setup homarr")
	}
	result, _ := results[0].(map[string]any)
	integration, _ := result["integration"].(map[string]any)
	data, _ := result["data"].(map[string]any)
	if result["error"] != nil || stringField(result, "integrationId") != integrationID || stringField(integration, "id") != integrationID || stringField(integration, "kind") != "deluge" || data == nil {
		return errors.New("Homarr could not read the authenticated Deluge queue; run self-host setup deluge, then self-host setup homarr")
	}
	status, _ := data["status"].(map[string]any)
	rates, _ := status["rates"].(map[string]any)
	for _, key := range []string{"down", "up"} {
		rate, ok := rates[key].(float64)
		if !ok || rate < 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
			return errors.New("Homarr returned incomplete Deluge transfer rates; run self-host setup homarr")
		}
	}
	if _, ok := status["paused"].(bool); !ok {
		return errors.New("Homarr did not return the Deluge queue state; run self-host setup homarr")
	}
	types, ok := status["types"].([]any)
	if !ok || !slices.Contains(types, any("torrent")) {
		return errors.New("Homarr did not identify the Deluge torrent queue; run self-host setup homarr")
	}
	items, ok := data["items"].([]any)
	if !ok || len(items) > 50 {
		return errors.New("Homarr did not return the bounded Deluge download list; run self-host setup homarr")
	}
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		progress, ok := item["progress"].(float64)
		if stringField(item, "id") == "" || stringField(item, "name") == "" || stringField(item, "type") != "torrent" || !slices.Contains([]string{"leeching", "seeding", "paused", "unknown"}, stringField(item, "state")) || !ok || progress < 0 || progress > 1 || math.IsNaN(progress) || math.IsInf(progress, 0) {
			return errors.New("Homarr returned incomplete Deluge download data; run self-host setup homarr")
		}
	}
	catalog, err := apiKeyProcedure(ctx, from, "widget.stats.catalog", map[string]any{"integrationId": integrationID})
	if err != nil {
		return err
	}
	statistics, _ := catalog.(map[string]any)
	metrics, _ := statistics["metrics"].([]any)
	for _, key := range []string{"download", "upload", "paused"} {
		found := false
		for _, raw := range metrics {
			metric, _ := raw.(map[string]any)
			if stringField(metric, "key") == key {
				found = true
				break
			}
		}
		if !found {
			return errors.New("Homarr does not expose the required Deluge Stats fields; use Homarr 2.4.1, then retry self-host setup homarr")
		}
	}
	return nil
}
