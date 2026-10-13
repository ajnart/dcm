package homarr

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"time"

	"github.com/ajnart/self-host/internal/apps/speedtesttracker"
	"github.com/ajnart/self-host/internal/helpers"
)

func speedtestTrackerTarget() target {
	return target{
		id: "speedtest-tracker", name: "Speedtest Tracker", kind: "speedtestTracker",
		internal: fixed("http://speedtest-tracker:80"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "apiKey", Value: to.Secret(to.Key("homarr_api_key"))}}
		},
		widgets: []widget{{kind: "speedtestTracker", options: map[string]any{
			"showLatestResult": true, "showStats": true, "showRecentResults": true, "showPingGraph": true,
		}}, statWidget("ping", "download", "upload")},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			_, err := speedtesttracker.ReadHomarr(ctx, to)
			if errors.Is(err, helpers.ErrManual) {
				from.Info(err.Error())
			}
			return err
		},
		verify: verifySpeedtestTracker,
		stats:  verifySpeedtestTrackerStats,
	}
}

func verifySpeedtestTracker(ctx context.Context, from, to *helpers.H, integrationID string) error {
	actual, err := speedtesttracker.ReadHomarr(ctx, to)
	if err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.speedtestTracker.getDashboard", map[string]any{"integrationIds": []string{integrationID}})
	if err != nil {
		return err
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	var dashboards []struct {
		IntegrationID string                       `json:"integrationId"`
		Dashboard     *speedtesttracker.HomarrData `json:"dashboard"`
		UpdatedAt     string                       `json:"updatedAt"`
		Error         json.RawMessage              `json:"error"`
	}
	if json.Unmarshal(raw, &dashboards) != nil || len(dashboards) != 1 {
		return errors.New("Homarr did not return the Speedtest Tracker dashboard; retry self-host setup homarr")
	}
	current := dashboards[0]
	data := current.Dashboard
	updated, err := time.Parse(time.RFC3339Nano, current.UpdatedAt)
	if err != nil || updated.IsZero() || updated.Unix() <= 0 || current.IntegrationID != integrationID || len(current.Error) > 0 && string(current.Error) != "null" || data == nil || data.LatestResult == nil || data.Stats == nil || data.RecentResults == nil {
		return errors.New("Homarr returned an unavailable Speedtest Tracker dashboard; retry its connection and Setup")
	}
	if data.LatestResult.Validate() != nil || !data.LatestResult.SameMeasurement(*actual.LatestResult) || data.Stats.Validate() != nil || !reflect.DeepEqual(data.Stats, actual.Stats) {
		return errors.New("Homarr Speedtest Tracker values do not match fresh measured results; wait for its cache to refresh and retry Setup")
	}
	location := time.UTC
	if zone := from.Settings["TZ"]; zone != "" {
		location, err = time.LoadLocation(zone)
		if err != nil {
			return errors.New("Homarr time zone is unsupported; review Host settings and retry Setup")
		}
	}
	expected, err := actual.LatestResult.Timestamp(location)
	created, nativeErr := time.Parse(time.RFC3339Nano, data.LatestResult.CreatedAt)
	if err != nil || nativeErr != nil || !created.Equal(expected) {
		return errors.New("Homarr did not preserve the latest Speedtest Tracker timestamp; review time zones and retry Setup")
	}
	if len(data.RecentResults) != len(actual.RecentResults) {
		return errors.New("Homarr Speedtest Tracker history differs from its fresh source; wait for its cache to refresh and retry Setup")
	}
	for index, result := range data.RecentResults {
		if result.Validate() != nil || !speedtestHistoryCurrent(result, actual.RecentResults[index], location) {
			return errors.New("Homarr returned incomplete Speedtest Tracker history; retry Setup")
		}
	}
	return nil
}

func speedtestHistoryCurrent(native, actual speedtesttracker.Result, location *time.Location) bool {
	expected, err := actual.Timestamp(location)
	created, nativeErr := time.Parse(time.RFC3339Nano, native.CreatedAt)
	return err == nil && nativeErr == nil && created.Equal(expected) && reflect.DeepEqual(native.ID, actual.ID) && reflect.DeepEqual(native.Ping, actual.Ping) && reflect.DeepEqual(native.DownloadBits, actual.DownloadBits) && reflect.DeepEqual(native.UploadBits, actual.UploadBits) && string(native.Healthy) == string(actual.Healthy)
}

func verifySpeedtestTrackerStats(sample statsSample) error {
	for key, unit := range map[string]string{"ping": "milliseconds", "download": "bytesPerSecond", "upload": "bytesPerSecond"} {
		value, ok := sample.values[key].(float64)
		if !ok || sample.units[key] != unit || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
			return errors.New("Homarr returned incomplete Speedtest Tracker Stats; unknown speed is not zero")
		}
		if key != "ping" && (math.IsInf(value*8, 0) || math.Trunc(value*8) != value*8) {
			return errors.New("Homarr returned non-integral Speedtest Tracker bit rates; retry self-host setup homarr")
		}
	}
	return nil
}
