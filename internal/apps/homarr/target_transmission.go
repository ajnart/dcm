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
		verify: verifyTransmission, stats: verifyTransmissionStats,
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
	queue, err := readDownloadsQueue(ctx, from, integrationID, "transmission")
	if err != nil {
		return err
	}
	status := queue.status
	rates, _ := status["rates"].(map[string]any)
	types, _ := status["types"].([]any)
	_, pausedOK := status["paused"].(bool)
	items := queue.items
	if !pausedOK || !slices.Contains(types, any("torrent")) || !transmissionNumbers(rates, "down", "up") {
		return errors.New("Homarr returned incomplete Transmission queue status or rates; an explicit empty items array and valid rates are required for an empty queue")
	}
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		itemTime, timeOK := item["time"].(float64)
		if !timeOK || math.IsNaN(itemTime) || math.IsInf(itemTime, 0) || stringField(item, "id") == "" || stringField(item, "name") == "" || stringField(item, "type") != "torrent" || !transmissionNumbers(item, "index", "size", "sent", "received", "upSpeed", "progress") {
			return errors.New("Homarr returned incomplete Transmission download items; retry self-host setup homarr")
		}
		progress := item["progress"].(float64)
		index := item["index"].(float64)
		if progress > 1 || math.Trunc(index) != index || progress < 1 && !transmissionNumbers(item, "downSpeed") || !slices.Contains([]string{"paused", "stalled", "leeching", "seeding"}, stringField(item, "state")) {
			return errors.New("Homarr returned unsupported Transmission download items; retry self-host setup homarr")
		}
	}
	return nil
}

func verifyTransmissionStats(sample statsSample) error {
	_, pausedOK := sample.values["paused"].(bool)
	if !pausedOK || sample.units["paused"] != "text" || sample.units["download"] != "bytesPerSecond" || sample.units["upload"] != "bytesPerSecond" || !transmissionNumbers(sample.values, "download", "upload") {
		return errors.New("Homarr did not return complete Transmission Stats; verify its RPC login and retry self-host setup homarr")
	}
	return nil
}
