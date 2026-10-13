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
		verify: verifyDeluge, stats: verifyDelugeStats,
	}
}

func verifyDeluge(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := deluge.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	queue, err := readDownloadsQueue(ctx, from, integrationID, "deluge")
	if err != nil {
		return err
	}
	status := queue.status
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
	items := queue.items
	if len(items) > 50 {
		return errors.New("Homarr did not return the bounded Deluge download list; run self-host setup homarr")
	}
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		progress, ok := item["progress"].(float64)
		if stringField(item, "id") == "" || stringField(item, "name") == "" || stringField(item, "type") != "torrent" || !slices.Contains([]string{"leeching", "seeding", "paused", "unknown"}, stringField(item, "state")) || !ok || progress < 0 || progress > 1 || math.IsNaN(progress) || math.IsInf(progress, 0) {
			return errors.New("Homarr returned incomplete Deluge download data; run self-host setup homarr")
		}
		for _, key := range []string{"time", "upSpeed", "downSpeed"} {
			raw := item[key]
			if key == "downSpeed" && progress == 1 && raw == nil {
				continue
			}
			value, ok := raw.(float64)
			if !ok || math.IsNaN(value) || math.IsInf(value, 0) || key != "time" && value < 0 {
				return errors.New("Homarr returned incomplete Deluge download time or speeds; run self-host setup homarr")
			}
		}
	}
	return nil
}

func verifyDelugeStats(sample statsSample) error {
	for _, key := range []string{"download", "upload"} {
		value, ok := sample.values[key].(float64)
		if sample.units[key] != "bytesPerSecond" || !ok || value < 0 || math.IsNaN(value) || math.IsInf(value, 0) {
			return errors.New("Homarr returned incomplete Deluge transfer Stats; run self-host setup homarr")
		}
	}
	if _, ok := sample.values["paused"].(bool); !ok || sample.units["paused"] != "text" {
		return errors.New("Homarr did not return the Deluge queue state in Stats; run self-host setup homarr")
	}
	return nil
}
