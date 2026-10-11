package homarr

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/ajnart/self-host/internal/apps/lidarr"
	"github.com/ajnart/self-host/internal/helpers"
)

func lidarrTarget() target {
	return target{
		id: "lidarr", name: "Lidarr", kind: "lidarr",
		internal: fixed("http://lidarr:8686"), secrets: apiKeySecret,
		widgets: []widget{plain("calendar"), statWidget("artists", "monitored", "upcoming")},
		verify:  verifyLidarr,
	}
}

func verifyLidarr(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := (lidarr.App{}).Check(ctx, to); err != nil {
		return errors.New("Lidarr's saved API key or Admin login is not ready; run self-host setup lidarr, then self-host setup homarr")
	}
	value, err := apiKeyWrite(ctx, from, "widget.stats.refresh", map[string]any{
		"integrationId": integrationID, "force": true,
	})
	if err != nil {
		return errors.New("Homarr could not refresh Lidarr statistics; check the integration and retry self-host setup homarr")
	}
	snapshot, ok := value.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return Lidarr statistics; retry self-host setup homarr")
	}
	failed, hasError := snapshot["error"].(bool)
	stale, hasStale := snapshot["stale"].(bool)
	updatedAt, hasUpdatedAt := snapshot["updatedAt"].(float64)
	if !hasError || failed || !hasStale || stale || !hasUpdatedAt || updatedAt <= 0 {
		return errors.New("Homarr's Lidarr statistics are unavailable or stale, not an empty library; retry self-host setup homarr")
	}
	values, ok := snapshot["values"].(map[string]any)
	if !ok {
		return errors.New("Homarr returned incomplete Lidarr statistics; retry self-host setup homarr")
	}
	for _, key := range []string{"artists", "monitored", "upcoming"} {
		count, ok := values[key].(float64)
		if !ok || count < 0 || math.IsNaN(count) || math.IsInf(count, 0) || count != math.Trunc(count) {
			return errors.New("Homarr returned incomplete Lidarr statistics; retry self-host setup homarr")
		}
	}
	if values["monitored"].(float64) > values["artists"].(float64) {
		return errors.New("Homarr returned inconsistent Lidarr artist statistics; retry self-host setup homarr")
	}
	now := time.Now().UTC()
	value, err = apiKeyProcedure(ctx, from, "widget.calendar.findAllEvents", map[string]any{
		"integrationIds": []string{integrationID}, "year": now.Year(), "month": int(now.Month()),
		"releaseType": []string{}, "showUnmonitored": true,
	})
	if err != nil {
		return errors.New("Homarr could not read Lidarr's calendar; check the integration and retry self-host setup homarr")
	}
	results, ok := value.([]any)
	if !ok || len(results) != 1 {
		return errors.New("Homarr did not return Lidarr's calendar; retry self-host setup homarr")
	}
	result, ok := results[0].(map[string]any)
	if !ok || result["error"] != nil {
		return errors.New("Homarr's Lidarr calendar failed, not an empty calendar; retry self-host setup homarr")
	}
	integration, ok := result["integration"].(map[string]any)
	if !ok || stringField(integration, "id") != integrationID || stringField(integration, "kind") != "lidarr" {
		return errors.New("Homarr returned another integration's calendar; retry self-host setup homarr")
	}
	events, ok := result["events"].([]any)
	if !ok {
		return errors.New("Homarr returned incomplete Lidarr calendar data; retry self-host setup homarr")
	}
	for _, value := range events {
		event, ok := value.(map[string]any)
		if !ok || stringField(event, "title") == "" || stringField(event, "subTitle") == "" {
			return errors.New("Homarr returned incomplete Lidarr release data; retry self-host setup homarr")
		}
		if _, err := time.Parse(time.RFC3339Nano, stringField(event, "startDate")); err != nil {
			return errors.New("Homarr returned an invalid Lidarr release date; retry self-host setup homarr")
		}
	}
	return nil
}
