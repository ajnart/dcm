package homarr

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"slices"

	"github.com/ajnart/self-host/internal/apps/uptimekuma"
	"github.com/ajnart/self-host/internal/helpers"
)

func uptimeKumaTarget() target {
	return target{
		id: "uptime-kuma", name: "Uptime Kuma", kind: "uptimeKuma", internal: fixed("http://uptime-kuma:3001"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "slug", Value: uptimekuma.HomarrSlug(to)}}
		},
		widgets: []widget{{kind: "uptimeKuma", options: map[string]any{
			"showAverageUptime": true, "showUptimeRing": true, "showTotalMonitors": true,
			"showUpCount": true, "showDownCount": true, "showPausedCount": true,
		}}, statWidget("totalMonitors", "upCount", "downCount", "averageUptimePercent")},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			_, err := uptimekuma.HomarrMonitors(ctx, to)
			if errors.Is(err, helpers.ErrManual) {
				from.Info("Run self-host setup uptime-kuma to review its administrator and explicitly selected status page, then retry self-host setup homarr. No page or monitor will be created or published by this Link.")
			}
			return err
		},
		verify: verifyUptimeKuma,
	}
}

func verifyUptimeKuma(ctx context.Context, from, to *helpers.H, integrationID string) error {
	monitors, err := uptimekuma.HomarrMonitors(ctx, to)
	if err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.uptimeKuma.getDashboard", map[string]any{"integrationIds": []string{integrationID}})
	if err != nil {
		return err
	}
	var results []struct {
		IntegrationID string `json:"integrationId"`
		Error         any    `json:"error"`
		Dashboard     *struct {
			Total    *int64   `json:"totalMonitors"`
			Up       *int64   `json:"upCount"`
			Down     *int64   `json:"downCount"`
			Paused   *int64   `json:"pausedCount"`
			Average  *float64 `json:"averageUptimePercent"`
			Monitors *[]struct {
				ID     *int64          `json:"id"`
				Name   *string         `json:"name"`
				Status *string         `json:"status"`
				Uptime json.RawMessage `json:"uptimePercent24h"`
			} `json:"monitors"`
		} `json:"dashboard"`
	}
	raw, err := json.Marshal(value)
	if err != nil || json.Unmarshal(raw, &results) != nil || len(results) != 1 || results[0].IntegrationID != integrationID || results[0].Error != nil {
		return errors.New("Homarr did not return the owned Uptime Kuma dashboard; retry self-host setup homarr")
	}
	dashboard := results[0].Dashboard
	if dashboard == nil || dashboard.Total == nil || dashboard.Up == nil || dashboard.Down == nil || dashboard.Paused == nil || dashboard.Average == nil || dashboard.Monitors == nil || *dashboard.Total != int64(len(monitors)) || len(*dashboard.Monitors) != len(monitors) {
		return errors.New("Homarr returned incomplete Uptime Kuma statistics; retry self-host setup homarr")
	}
	counts := map[string]int64{}
	remaining := map[int64]int{}
	for _, monitor := range monitors {
		remaining[monitor.ID]++
	}
	uptimeSum := 0.0
	uptimeCount := 0.0
	for _, monitor := range *dashboard.Monitors {
		if monitor.ID == nil || monitor.Name == nil || monitor.Status == nil || !slices.Contains([]string{"up", "down", "paused"}, *monitor.Status) || len(monitor.Uptime) == 0 {
			return errors.New("Homarr returned invalid Uptime Kuma monitor statuses")
		}
		if remaining[*monitor.ID] == 0 || !slices.ContainsFunc(monitors, func(expected uptimekuma.HomarrMonitor) bool {
			return expected.ID == *monitor.ID && expected.Name == *monitor.Name
		}) {
			return errors.New("Homarr did not return the explicitly selected Uptime Kuma monitors; retry Setup")
		}
		var uptime *float64
		if json.Unmarshal(monitor.Uptime, &uptime) != nil || uptime != nil && (*uptime < 0 || *uptime > 100) {
			return errors.New("Homarr returned an invalid Uptime Kuma uptime percentage")
		}
		if uptime != nil {
			uptimeSum += *uptime
			uptimeCount++
		}
		remaining[*monitor.ID]--
		counts[*monitor.Status]++
	}
	if *dashboard.Up != counts["up"] || *dashboard.Down != counts["down"] || *dashboard.Paused != counts["paused"] || math.Abs(*dashboard.Average-uptimeSum/math.Max(uptimeCount, 1)) > 0.000001 {
		return errors.New("Homarr returned inconsistent Uptime Kuma status counts or uptime")
	}
	value, err = apiKeyProcedure(ctx, from, "widget.stats.catalog", map[string]any{"integrationId": integrationID})
	if err != nil {
		return err
	}
	catalog, _ := value.(map[string]any)
	metrics, _ := catalog["metrics"].([]any)
	for _, key := range []string{"totalMonitors", "upCount", "downCount", "averageUptimePercent"} {
		if !slices.ContainsFunc(metrics, func(raw any) bool {
			metric, _ := raw.(map[string]any)
			return stringField(metric, "key") == key
		}) {
			return errors.New("Homarr is missing a supported Uptime Kuma Stats field; retry Setup with Homarr 2.4.1")
		}
	}
	if len(monitors) == 0 {
		from.Info("The selected Uptime Kuma status page is valid but empty; no monitor health or rendered widget result has been verified.")
	}
	return nil
}
