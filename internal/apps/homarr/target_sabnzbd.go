package homarr

import (
	"context"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/apps/sabnzbd"
	"github.com/ajnart/self-host/internal/helpers"
)

func sabnzbdTarget() target {
	return target{
		id: "sabnzbd", name: "SABnzbd", kind: "sabNzbd", internal: fixed("http://sabnzbd:8080"),
		secrets: apiKeySecret,
		widgets: []widget{plain("downloads"), statWidget("download", "paused")},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			err := (sabnzbd.App{}).Check(ctx, to)
			if errors.Is(err, helpers.ErrManual) {
				from.Info("SABnzbd needs your existing authorized provider in Config > Servers; run self-host setup sabnzbd, then self-host setup homarr. No provider account is created or tested.")
			}
			if err != nil {
				return err
			}
			return sabnzbd.VerifyHomarr(ctx, to)
		},
		verify: verifySABnzbd,
	}
}

func verifySABnzbd(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := sabnzbd.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.downloads.getJobsAndStatuses", map[string]any{
		"integrationIds": []string{integrationID}, "limitPerIntegration": 50,
		"includeArchivedHistory": false, "historyWindowDays": 7,
	})
	if err != nil {
		return err
	}
	results, ok := value.([]any)
	if !ok || len(results) != 1 {
		return errors.New("Homarr did not return SABnzbd download data")
	}
	result, ok := results[0].(map[string]any)
	if !ok || stringField(result, "integrationId") != integrationID || result["error"] != nil {
		return errors.New("Homarr could not read SABnzbd downloads; repair its full API key and private connection, then retry self-host setup homarr")
	}
	data, _ := result["data"].(map[string]any)
	status, _ := data["status"].(map[string]any)
	rates, _ := status["rates"].(map[string]any)
	rate, numeric := rates["down"].(float64)
	_, paused := status["paused"].(bool)
	items, hasItems := data["items"].([]any)
	if !numeric || math.IsNaN(rate) || math.IsInf(rate, 0) || rate < 0 || !paused || !hasItems {
		return errors.New("Homarr returned incomplete SABnzbd downloads; an empty queue must explicitly contain items and a nonnegative download rate")
	}
	for _, item := range items {
		if !validSABnzbdItem(item) {
			return errors.New("Homarr returned incomplete SABnzbd download items; check the queue/history data and retry self-host setup homarr")
		}
	}
	catalog, err := apiKeyProcedure(ctx, from, "widget.stats.catalog", map[string]any{"integrationId": integrationID})
	if err != nil {
		return err
	}
	record, _ := catalog.(map[string]any)
	metrics, _ := record["metrics"].([]any)
	for _, expected := range []string{"download", "paused"} {
		found := false
		for _, raw := range metrics {
			metric, _ := raw.(map[string]any)
			if stringField(metric, "key") == expected {
				found = true
			}
		}
		if !found {
			return errors.New("Homarr does not expose the supported SABnzbd Stats fields; use Homarr 2.4.1 and retry Setup")
		}
	}
	snapshot, err := apiKeyWrite(ctx, from, "widget.stats.refresh", map[string]any{"integrationId": integrationID, "force": false})
	if err != nil {
		return err
	}
	record, _ = snapshot.(map[string]any)
	values, _ := record["values"].(map[string]any)
	failed, hasError := record["error"].(bool)
	stale, hasStale := record["stale"].(bool)
	updatedAt, hasTimestamp := record["updatedAt"].(float64)
	rate, numeric = values["download"].(float64)
	_, paused = values["paused"].(bool)
	if !hasError || failed || !hasStale || stale || !hasTimestamp || updatedAt <= 0 || !numeric || math.IsNaN(rate) || math.IsInf(rate, 0) || rate < 0 || !paused {
		return errors.New("Homarr SABnzbd Stats are unavailable or incomplete; retry self-host setup homarr after checking its private connection and full API key")
	}
	return nil
}

func validSABnzbdItem(raw any) bool {
	item, ok := raw.(map[string]any)
	if !ok || item["type"] != "usenet" {
		return false
	}
	for _, key := range []string{"id", "name"} {
		value, ok := item[key].(string)
		if !ok || value == "" {
			return false
		}
	}
	switch item["state"] {
	case "downloading", "queued", "paused", "completed", "failed", "processing":
	default:
		return false
	}
	for _, key := range []string{"index", "size", "time", "progress"} {
		value, ok := item[key].(float64)
		if !ok || math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
		if key == "size" && value < 0 || key == "progress" && (value < 0 || value > 1) {
			return false
		}
	}
	for _, key := range []string{"sent", "received", "downSpeed", "upSpeed", "added"} {
		raw, present := item[key]
		if !present {
			continue
		}
		value, ok := raw.(float64)
		if !ok || math.IsNaN(value) || math.IsInf(value, 0) || key != "added" && value < 0 {
			return false
		}
	}
	if category, present := item["category"]; present {
		switch value := category.(type) {
		case string:
		case []any:
			for _, raw := range value {
				if _, ok := raw.(string); !ok {
					return false
				}
			}
		default:
			return false
		}
	}
	return true
}
