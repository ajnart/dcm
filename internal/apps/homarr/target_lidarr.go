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
		widgets:   []widget{plain("calendar"), statWidget("artists", "monitored", "upcoming")},
		preflight: verifyLidarrReady,
		verify:    verifyLidarr,
		stats:     verifyLidarrStats,
	}
}

func verifyLidarrReady(ctx context.Context, from, to *helpers.H) error {
	if err := (lidarr.App{}).Check(ctx, to); err != nil {
		if errors.Is(err, helpers.ErrManual) {
			from.Info(err.Error())
			return err
		}
		return errors.New("Lidarr's saved API key or Admin login is not ready; run self-host setup lidarr, then self-host setup homarr")
	}
	return nil
}

func verifyLidarr(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := verifyLidarrReady(ctx, from, to); err != nil {
		return err
	}
	libraryCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	resp, err := to.HTTP(libraryCtx, helpers.Request{
		Path: "/api/v1/artist", NoRedirect: true,
		Header: map[string]string{"X-Api-Key": to.Secret(to.Key("api_key"))},
	})
	cancel()
	if err != nil {
		return err
	}
	var artists []struct{ Monitored *bool }
	if resp.Status != 200 || resp.Decode(&artists) != nil || artists == nil {
		return errors.New("Lidarr did not return its authenticated artist library; retry self-host setup lidarr")
	}
	for _, artist := range artists {
		if artist.Monitored == nil {
			return errors.New("Lidarr returned incomplete artist monitoring data; retry self-host setup lidarr")
		}
	}
	now := from.Now().UTC()
	value, err := apiKeyProcedure(ctx, from, "widget.calendar.findAllEvents", map[string]any{
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
		if !ok || stringField(event, "title") == "" {
			return errors.New("Homarr returned incomplete Lidarr release data; retry self-host setup homarr")
		}
		subtitle, present := event["subTitle"]
		_, text := subtitle.(string)
		if !present || subtitle != nil && !text {
			return errors.New("Homarr returned invalid Lidarr artist data; retry self-host setup homarr")
		}
		if _, err := time.Parse(time.RFC3339Nano, stringField(event, "startDate")); err != nil {
			return errors.New("Homarr returned an invalid Lidarr release date; retry self-host setup homarr")
		}
	}
	return nil
}

func verifyLidarrStats(sample statsSample) error {
	for _, key := range []string{"artists", "monitored", "upcoming"} {
		count, ok := sample.values[key].(float64)
		if sample.units[key] != "count" || !ok || count < 0 || math.IsNaN(count) || math.IsInf(count, 0) || count != math.Trunc(count) {
			return errors.New("Homarr returned invalid Lidarr count statistics; retry self-host setup homarr")
		}
	}
	if sample.values["monitored"].(float64) > sample.values["artists"].(float64) {
		return errors.New("Homarr returned inconsistent Lidarr artist statistics; retry self-host setup homarr")
	}
	return nil
}
