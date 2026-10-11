package homarr

import (
	"context"
	"errors"
	"math"
	"slices"

	"github.com/ajnart/self-host/internal/apps/transmission"
	"github.com/ajnart/self-host/internal/helpers"
)

func transmissionTarget() target {
	return target{
		id: "transmission", name: "Transmission", kind: "transmission", internal: fixed("http://transmission:9091"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "username", Value: to.AdminUser()}, {Kind: "password", Value: to.AdminPassword()}}
		},
		widgets: []widget{{kind: "downloads", options: map[string]any{
			"columns":             []string{"name", "progress", "downSpeed", "upSpeed", "state"},
			"limitPerIntegration": 50, "showCompletedTorrent": true,
		}}, statWidget("download", "upload", "paused")},
		preflight: func(ctx context.Context, _, to *helpers.H) error {
			return transmission.VerifyHomarr(ctx, to)
		},
		verify: verifyTransmission,
	}
}

func transmissionNumbers(value map[string]any, keys ...string) bool {
	for _, key := range keys {
		number, ok := value[key].(float64)
		if !ok || number < 0 || math.IsNaN(number) || math.IsInf(number, 0) {
			return false
		}
	}
	return true
}

func verifyTransmission(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := transmission.VerifyHomarr(ctx, to); err != nil {
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
		return errors.New("Homarr did not return Transmission's download data; retry self-host setup homarr")
	}
	result, _ := results[0].(map[string]any)
	integration, _ := result["integration"].(map[string]any)
	data, _ := result["data"].(map[string]any)
	if result["error"] != nil || stringField(result, "integrationId") != integrationID || stringField(integration, "id") != integrationID || stringField(integration, "kind") != "transmission" || data == nil {
		return errors.New("Homarr could not read the owned Transmission integration; verify its RPC login and access policy, then retry self-host setup homarr")
	}
	status, _ := data["status"].(map[string]any)
	rates, _ := status["rates"].(map[string]any)
	types, _ := status["types"].([]any)
	_, pausedOK := status["paused"].(bool)
	items, itemsOK := data["items"].([]any)
	if !pausedOK || !itemsOK || !slices.Contains(types, any("torrent")) || !transmissionNumbers(rates, "down", "up") {
		return errors.New("Homarr returned incomplete Transmission queue status or rates; an explicit empty items array and valid rates are required for an empty queue")
	}
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		if stringField(item, "id") == "" || stringField(item, "name") == "" || stringField(item, "type") != "torrent" || !transmissionNumbers(item, "index", "size", "sent", "received", "upSpeed", "progress") {
			return errors.New("Homarr returned incomplete Transmission download items; retry self-host setup homarr")
		}
		progress := item["progress"].(float64)
		index := item["index"].(float64)
		if progress > 1 || math.Trunc(index) != index || progress < 1 && !transmissionNumbers(item, "downSpeed") || !slices.Contains([]string{"paused", "stalled", "leeching", "seeding"}, stringField(item, "state")) {
			return errors.New("Homarr returned unsupported Transmission download items; retry self-host setup homarr")
		}
	}
	value, err = apiKeyWrite(ctx, from, "widget.stats.refresh", map[string]any{"integrationId": integrationID, "force": true})
	if err != nil {
		return err
	}
	snapshot, _ := value.(map[string]any)
	statistics, _ := snapshot["values"].(map[string]any)
	updatedAt, updatedOK := snapshot["updatedAt"].(float64)
	_, pausedOK = statistics["paused"].(bool)
	if snapshot["error"] != false || snapshot["stale"] != false || !updatedOK || updatedAt <= 0 || !pausedOK || !transmissionNumbers(statistics, "download", "upload") {
		return errors.New("Homarr did not return fresh Transmission Stats; verify its RPC login and retry self-host setup homarr")
	}
	return nil
}
