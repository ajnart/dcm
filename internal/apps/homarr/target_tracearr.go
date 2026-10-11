package homarr

import (
	"context"
	"errors"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/apps/tracearr"
	"github.com/ajnart/self-host/internal/helpers"
)

func tracearrMetrics() []string {
	return []string{"activeStreams", "totalUsers", "totalSessions", "recentViolations"}
}

func tracearrTarget() target {
	return target{
		id: "tracearr", name: "Tracearr", kind: "tracearr", internal: fixed("http://tracearr:3000"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "apiKey", Value: to.Secret(to.Key("homarr_api_key"))}}
		},
		widgets: []widget{{kind: "tracearr", options: map[string]any{
			"showStreams": true, "showStats": true, "showRecentActivity": false, "showViolations": false,
		}}, statWidget(tracearrMetrics()...)},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			err := tracearr.VerifyHomarr(ctx, to)
			if errors.Is(err, helpers.ErrManual) {
				from.Info(err.Error())
			}
			return err
		},
		verify: verifyTracearr,
	}
}

func verifyTracearr(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := tracearr.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.stats.catalog", map[string]any{"integrationId": integrationID})
	if err != nil {
		return err
	}
	catalog, _ := value.(map[string]any)
	metrics, _ := catalog["metrics"].([]any)
	for _, key := range tracearrMetrics() {
		found := false
		for _, raw := range metrics {
			metric, _ := raw.(map[string]any)
			if stringField(metric, "key") == key && stringField(metric, "unit") == "count" {
				found = true
			}
		}
		if !found {
			return errors.New("Homarr lacks the supported Tracearr count metrics; use Homarr 2.4.1 and retry Setup")
		}
	}
	value, err = apiKeyProcedure(ctx, from, "widget.tracearr.getDashboard", map[string]any{"integrationIds": []string{integrationID}})
	if err != nil {
		return err
	}
	results, ok := value.([]any)
	if !ok || len(results) != 1 {
		return errors.New("Homarr did not return the owned Tracearr dashboard")
	}
	result, _ := results[0].(map[string]any)
	if stringField(result, "integrationId") != integrationID || result["error"] != nil {
		return errors.New("Homarr could not read the owned Tracearr integration; retry self-host setup tracearr and self-host setup homarr")
	}
	if !tracearrFresh(from, stringField(result, "updatedAt")) {
		return errors.New("Homarr returned a stale Tracearr dashboard; check the Host clock and retry Setup")
	}
	dashboard, _ := result["dashboard"].(map[string]any)
	statistics, _ := dashboard["stats"].(map[string]any)
	if !tracearrFresh(from, stringField(statistics, "timestamp")) {
		return errors.New("Homarr returned stale or incomplete Tracearr statistics")
	}
	for _, key := range tracearrMetrics() {
		if !tracearrCount(statistics, key) {
			return errors.New("Homarr returned incomplete Tracearr statistics; missing counts are not zero")
		}
	}
	streams, _ := dashboard["streams"].(map[string]any)
	data, ok := streams["data"].([]any)
	summary, _ := streams["summary"].(map[string]any)
	if !ok {
		return errors.New("Homarr did not return Tracearr's stream dataset; missing data is not an idle server")
	}
	for _, key := range []string{"total", "transcodes", "directStreams", "directPlays"} {
		if !tracearrCount(summary, key) {
			return errors.New("Homarr returned incomplete Tracearr stream counts")
		}
	}
	if summary["total"] != float64(len(data)) || summary["transcodes"].(float64)+summary["directStreams"].(float64)+summary["directPlays"].(float64) != summary["total"] {
		return errors.New("Homarr returned inconsistent Tracearr stream counts; retry Setup")
	}
	if !tracearrBitrate(stringField(summary, "totalBitrate")) {
		return errors.New("Homarr did not return Tracearr's supported formatted bitrate; unavailable bandwidth is not zero")
	}
	for _, raw := range data {
		stream, _ := raw.(map[string]any)
		if stringField(stream, "id") == "" || stringField(stream, "serverId") == "" || stringField(stream, "username") == "" || stringField(stream, "mediaTitle") == "" || !tracearrCount(stream, "progressMs") {
			return errors.New("Homarr returned incomplete Tracearr stream data")
		}
		switch stringField(stream, "state") {
		case "playing", "paused", "stopped":
		default:
			return errors.New("Homarr returned an unsupported Tracearr playback state")
		}
	}
	value, err = apiKeyWrite(ctx, from, "widget.stats.refresh", map[string]any{"integrationId": integrationID, "force": true})
	if err != nil {
		return err
	}
	snapshot, _ := value.(map[string]any)
	if snapshot["error"] != false || snapshot["stale"] != false || !tracearrCount(snapshot, "updatedAt") {
		return errors.New("Homarr returned failed, stale or incomplete Tracearr Stats; retry self-host setup homarr")
	}
	updatedAt := snapshot["updatedAt"].(float64)
	age := float64(from.Now().UnixMilli()) - updatedAt
	if updatedAt <= 0 || age < -5000 || age > 30000 {
		return errors.New("Homarr did not freshly refresh Tracearr Stats; retry Setup after the refresh queue clears")
	}
	values, _ := snapshot["values"].(map[string]any)
	for _, key := range tracearrMetrics() {
		if !tracearrCount(values, key) {
			return errors.New("Homarr returned incomplete Tracearr Stats; missing values are not zero")
		}
	}
	return nil
}

func tracearrBitrate(value string) bool {
	if value == "—" {
		return true
	}
	parts := strings.Fields(value)
	if len(parts) != 2 {
		return false
	}
	rate, err := strconv.ParseFloat(parts[0], 64)
	if err != nil || rate < 0 || math.IsInf(rate, 0) || math.IsNaN(rate) {
		return false
	}
	return parts[1] == "kbps" || parts[1] == "Mbps" || parts[1] == "Gbps"
}

func tracearrCount(record map[string]any, key string) bool {
	count, ok := record[key].(float64)
	return ok && count >= 0 && !math.IsInf(count, 0) && !math.IsNaN(count) && math.Trunc(count) == count
}

func tracearrFresh(h *helpers.H, timestamp string) bool {
	at, err := time.Parse(time.RFC3339Nano, timestamp)
	if err != nil {
		return false
	}
	age := h.Now().Sub(at)
	return age >= -5*time.Second && age <= 30*time.Second
}
