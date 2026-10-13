package tdarr

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/ajnart/self-host/internal/helpers"
)

type HomarrData struct {
	NodeCount     int
	UnpausedNodes int
	WorkerCount   int
}

func verifyVersion(ctx context.Context, h *helpers.H) error {
	response, err := h.HTTP(ctx, helpers.Request{Path: "/api/v2/status", NoRedirect: true})
	if err != nil {
		return err
	}
	var version struct{ Status, Version string }
	if response.Status != 200 || response.Decode(&version) != nil || version.Status != "good" || version.Version != "2.92.01" {
		return errors.New("Tdarr's API version is unsupported or unavailable; use 2.92.01 and retry self-host setup tdarr")
	}
	return nil
}

func validKey(key string) bool {
	if !strings.HasPrefix(key, "tapi_") || len(key) < 14 {
		return false
	}
	for _, char := range key {
		if char != '_' && (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') && (char < '0' || char > '9') {
			return false
		}
	}
	return true
}

func readAPI(ctx context.Context, h *helpers.H, path, method string, body any) (map[string]any, error) {
	response, err := h.HTTP(ctx, helpers.Request{
		Path: path, Method: method, JSON: body, NoRedirect: true,
		Header: map[string]string{"X-Api-Key": h.Secret(h.Key("homarr_api_key"))},
	})
	if err != nil {
		return nil, err
	}
	if response.Status == 401 || response.Status == 403 {
		return nil, errors.New("Tdarr rejected its saved native API key; restore the managed credential and retry self-host setup tdarr")
	}
	if response.Status != 200 {
		return nil, fmt.Errorf("Tdarr API %s is unavailable (HTTP %d); read self-host logs tdarr and retry Setup", path, response.Status)
	}
	var data map[string]any
	if response.Decode(&data) != nil || data == nil {
		return nil, fmt.Errorf("Tdarr API %s returned malformed data", path)
	}
	return data, nil
}

func numeric(record map[string]any, key string, count bool) bool {
	value, ok := record[key].(float64)
	if !ok || math.IsNaN(value) || math.IsInf(value, 0) {
		return false
	}
	return !count || value >= 0 && math.Trunc(value) == value
}

func text(record map[string]any, key string) bool {
	_, ok := record[key].(string)
	return ok
}

func segments(record map[string]any, key string) bool {
	value, found := record[key]
	if !found {
		return true
	}
	items, ok := value.([]any)
	if !ok {
		return false
	}
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok || !text(item, "name") || !numeric(item, "value", true) {
			return false
		}
	}
	return true
}

func validStatistics(data map[string]any) bool {
	statistics, ok := data["pieStats"].(map[string]any)
	if !ok || !numeric(statistics, "sizeDiff", false) {
		return false
	}
	for _, key := range []string{"totalFiles", "totalTranscodeCount", "totalHealthCheckCount"} {
		if !numeric(statistics, key, true) {
			return false
		}
	}
	for key, fields := range map[string][]string{
		"status": {"transcode", "healthcheck"}, "video": {"codecs", "containers", "resolutions"}, "audio": {"codecs", "containers"},
	} {
		record, ok := statistics[key].(map[string]any)
		if !ok {
			return false
		}
		for _, field := range fields {
			if !segments(record, field) {
				return false
			}
		}
	}
	return true
}

func readNodes(data map[string]any) (HomarrData, error) {
	result := HomarrData{NodeCount: len(data)}
	for id, raw := range data {
		node, ok := raw.(map[string]any)
		if !ok || id == "" || !text(node, "_id") || node["_id"] == "" || !text(node, "nodeName") {
			return result, errors.New("Tdarr returned malformed node data")
		}
		paused, ok := node["nodePaused"].(bool)
		if !ok {
			return result, errors.New("Tdarr did not report whether its node is paused")
		}
		if !paused {
			result.UnpausedNodes++
		}
		workers, ok := node["workers"].(map[string]any)
		if !ok {
			return result, errors.New("Tdarr returned malformed worker data")
		}
		result.WorkerCount += len(workers)
		for id, raw := range workers {
			worker, ok := raw.(map[string]any)
			if !ok || id == "" || !text(worker, "_id") || worker["_id"] == "" {
				return result, errors.New("Tdarr returned a malformed worker identifier")
			}
			for _, key := range []string{"file", "ETA", "status", "workerType"} {
				if !text(worker, key) {
					return result, errors.New("Tdarr returned incomplete worker data")
				}
			}
			for _, key := range []string{"fps", "percentage", "originalfileSizeInGbytes"} {
				if !numeric(worker, key, false) {
					return result, errors.New("Tdarr returned incomplete worker measurements")
				}
			}
			for _, key := range []string{"estSize", "outputFileSizeInGbytes"} {
				if _, found := worker[key]; found && !numeric(worker, key, false) {
					return result, errors.New("Tdarr returned malformed optional worker measurements")
				}
			}
			job, ok := worker["job"].(map[string]any)
			if !ok || !text(job, "type") {
				return result, errors.New("Tdarr returned incomplete worker job data")
			}
			if raw, found := worker["lastPluginDetails"]; found {
				details, ok := raw.(map[string]any)
				if !ok {
					return result, errors.New("Tdarr returned malformed worker plugin data")
				}
				if _, found := details["number"]; found && !text(details, "number") {
					return result, errors.New("Tdarr returned malformed worker plugin number")
				}
			}
		}
	}
	return result, nil
}

func validQueue(data map[string]any) bool {
	items, ok := data["array"].([]any)
	if !ok || !numeric(data, "totalCount", true) || data["totalCount"].(float64) < float64(len(items)) {
		return false
	}
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok || !numeric(item, "file_size", false) {
			return false
		}
		for _, key := range []string{"_id", "HealthCheck", "TranscodeDecisionMaker", "file", "container", "video_codec_name", "video_resolution"} {
			if !text(item, key) {
				return false
			}
		}
	}
	return true
}

func ReadHomarr(ctx context.Context, h *helpers.H) (HomarrData, error) {
	var result HomarrData
	if !validKey(h.Secret(h.Key("homarr_api_key"))) {
		return result, errors.New("Tdarr's managed API key is missing or malformed; run self-host setup tdarr")
	}
	seed := h.Secret(h.Key("api_key_seed"))
	if seed == "" || h.Secret(h.Key("homarr_api_key")) != "tapi_"+seed {
		return result, errors.New("Tdarr's saved API key does not match its owned native seed; restore the managed credential through the Project secret boundary, then retry self-host setup tdarr")
	}
	if err := verifyVersion(ctx, h); err != nil {
		return result, err
	}
	anonymous, err := h.HTTP(ctx, helpers.Request{Path: "/api/v2/is-server-alive", Method: "POST", NoRedirect: true})
	if err != nil {
		return result, err
	}
	if anonymous.Status != 401 && anonymous.Status != 403 {
		return result, errors.New("Tdarr did not reject anonymous API access; keep auth=true and retry Setup")
	}
	alive, err := readAPI(ctx, h, "/api/v2/is-server-alive", "POST", nil)
	if err != nil {
		return result, err
	}
	if alive["isAlive"] != true {
		return result, errors.New("Tdarr did not confirm server API readiness")
	}
	statistics, err := readAPI(ctx, h, "/api/v2/stats/get-pies", "POST", map[string]any{"data": map[string]any{"libraryId": ""}})
	if err != nil {
		return result, err
	}
	if !validStatistics(statistics) {
		return result, errors.New("Tdarr returned incomplete media statistics; an empty library must still report explicit counts")
	}
	for _, table := range []string{"table1", "table4"} {
		queue, err := readAPI(ctx, h, "/api/v2/client/status-tables", "POST", map[string]any{"data": map[string]any{
			"start": 0, "pageSize": 10, "filters": []any{}, "sorts": []any{}, "opts": map[string]any{"table": table},
		}})
		if err != nil {
			return result, err
		}
		if !validQueue(queue) {
			return result, errors.New("Tdarr returned incomplete queue data; retry self-host setup tdarr")
		}
	}
	nodes, err := readAPI(ctx, h, "/api/v2/get-nodes", "GET", nil)
	if err != nil {
		return result, err
	}
	return readNodes(nodes)
}
