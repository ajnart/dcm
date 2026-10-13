package homarr

import (
	"context"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/apps/tdarr"
	"github.com/ajnart/self-host/internal/helpers"
)

func tdarrTarget() target {
	return target{
		id: "tdarr", name: "Tdarr", kind: "tdarr", internal: fixed("http://tdarr:8266"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "apiKey", Value: to.Secret(to.Key("homarr_api_key"))}}
		},
		widgets: []widget{{kind: "mediaTranscoding", options: map[string]any{
			"defaultView": "statistics", "queuePageSize": 10,
		}}, statWidget("totalFileCount", "totalTranscodeCount", "failedTranscodeCount")},
		preflight: preflightTdarr,
		verify:    verifyTdarr,
		stats:     verifyTdarrStats,
	}
}

func preflightTdarr(ctx context.Context, from, to *helpers.H) error {
	data, err := tdarr.ReadHomarr(ctx, to)
	if err != nil {
		return err
	}
	if data.NodeCount == 0 {
		from.Info("Tdarr's server API answers, but no nodes are connected. Restore the existing internal node's saved API key and retry self-host setup tdarr, then self-host setup homarr. Connecting another node or enabling workers needs separate approval.")
		return helpers.ErrManual
	}
	if data.UnpausedNodes == 0 {
		from.Info("Tdarr's connected nodes are all paused. Review the node and media permissions before approving processing, then retry self-host setup homarr; Setup will not unpause nodes or enable workers.")
		return helpers.ErrManual
	}
	if data.WorkerCount == 0 {
		from.Info("Tdarr has a connected node but no running workers. Homarr can show empty queues and server statistics; this does not verify processing or hardware. Workers remain disabled until separately approved.")
	}
	return nil
}

func tdarrNumber(record map[string]any, key string, count bool) bool {
	value, ok := record[key].(float64)
	if !ok || math.IsNaN(value) || math.IsInf(value, 0) {
		return false
	}
	return !count || value >= 0 && math.Trunc(value) == value
}

func tdarrText(record map[string]any, key string) bool {
	_, ok := record[key].(string)
	return ok
}

func verifyTdarr(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := preflightTdarr(ctx, from, to); err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.mediaTranscoding.getDataAsync", map[string]any{
		"integrationId": integrationID, "page": 1, "pageSize": 10,
	})
	if err != nil {
		return err
	}
	response, ok := value.(map[string]any)
	if !ok || response["integrationId"] != integrationID {
		return errors.New("Homarr did not return the owned Tdarr integration's native data")
	}
	data, ok := response["data"].(map[string]any)
	if !ok {
		return errors.New("Homarr returned malformed Tdarr data")
	}
	statistics, ok := data["statistics"].(map[string]any)
	if !ok || statistics["libraryName"] != "All" || !tdarrNumber(statistics, "totalSavedSpace", false) {
		return errors.New("Homarr returned incomplete Tdarr media statistics")
	}
	for _, key := range []string{"totalFileCount", "totalTranscodeCount", "totalHealthCheckCount", "failedTranscodeCount", "failedHealthCheckCount", "stagedTranscodeCount", "stagedHealthCheckCount"} {
		if !tdarrNumber(statistics, key, true) {
			return errors.New("Homarr returned incomplete Tdarr counts; explicit zeros are valid")
		}
	}
	for _, key := range []string{"transcodeStatus", "healthCheckStatus", "videoCodecs", "videoContainers", "videoResolutions", "audioCodecs", "audioContainers"} {
		segments, ok := statistics[key].([]any)
		if !ok {
			return errors.New("Homarr returned incomplete Tdarr chart data")
		}
		for _, raw := range segments {
			segment, ok := raw.(map[string]any)
			if !ok || !tdarrText(segment, "name") || !tdarrNumber(segment, "value", true) {
				return errors.New("Homarr returned malformed Tdarr chart data")
			}
		}
	}
	queue, ok := data["queue"].(map[string]any)
	if !ok || !tdarrNumber(queue, "totalCount", true) || queue["startIndex"] != float64(0) {
		return errors.New("Homarr returned incomplete Tdarr queue data")
	}
	items, ok := queue["array"].([]any)
	if !ok || len(items) > 10 || queue["totalCount"].(float64) < float64(len(items)) || queue["endIndex"] != float64(len(items)-1) {
		return errors.New("Homarr returned malformed Tdarr queue pagination")
	}
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok || !tdarrNumber(item, "fileSize", false) || item["type"] != "transcode" && item["type"] != "health-check" {
			return errors.New("Homarr returned malformed Tdarr queue entries")
		}
		for _, key := range []string{"id", "healthCheck", "transcode", "filePath", "container", "codec", "resolution"} {
			if !tdarrText(item, key) {
				return errors.New("Homarr returned incomplete Tdarr queue entries")
			}
		}
	}
	workers, ok := data["workers"].([]any)
	if !ok {
		return errors.New("Homarr returned incomplete Tdarr worker data")
	}
	for _, raw := range workers {
		worker, ok := raw.(map[string]any)
		if !ok {
			return errors.New("Homarr returned malformed Tdarr worker data")
		}
		for _, key := range []string{"id", "filePath", "ETA", "jobType", "status", "step"} {
			if !tdarrText(worker, key) {
				return errors.New("Homarr returned incomplete Tdarr worker data")
			}
		}
		for _, key := range []string{"fps", "percentage", "originalSize"} {
			if !tdarrNumber(worker, key, false) {
				return errors.New("Homarr returned incomplete Tdarr worker measurements")
			}
		}
		for _, key := range []string{"estimatedSize", "outputSize"} {
			value, found := worker[key]
			if !found || value != nil && !tdarrNumber(worker, key, false) {
				return errors.New("Homarr returned incomplete optional Tdarr worker measurements")
			}
		}
	}
	return nil
}

func verifyTdarrStats(sample statsSample) error {
	if math.Trunc(sample.updatedAt) != sample.updatedAt {
		return errors.New("Homarr returned an invalid Tdarr Stats timestamp; retry self-host setup homarr")
	}
	if age := sample.completedAt - sample.updatedAt; age < -60_000 || age > 300_000 {
		return errors.New("Homarr returned stale Tdarr Stats; retry self-host setup homarr")
	}
	for _, key := range []string{"totalFileCount", "totalTranscodeCount", "failedTranscodeCount"} {
		if sample.units[key] != "count" || !tdarrNumber(sample.values, key, true) {
			return errors.New("Homarr returned incomplete Tdarr Stats; explicit zeros are valid")
		}
	}
	return nil
}
