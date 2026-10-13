package homarr

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/ajnart/self-host/internal/apps/wud"
	"github.com/ajnart/self-host/internal/helpers"
)

func wudTarget() target {
	return target{
		id: "wud", name: "What's Up Docker", kind: "wud", internal: fixed("http://wud:3000"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "username", Value: to.Secret(to.Key("homarr_username"))}, {Kind: "password", Value: to.Secret(to.Key("homarr_password"))}}
		},
		widgets: []widget{{kind: "wud", options: map[string]any{
			"showTitle": true, "showRing": true, "layout": "horizontal", "showUpdateList": true,
		}}, statWidget("totalContainers", "updatesAvailable")},
		preflight: preflightWUD,
		verify:    verifyWUD,
		stats:     verifyWUDStats,
	}
}

func preflightWUD(ctx context.Context, from, to *helpers.H) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := (wud.App{}).Preflight(ctx, to); err != nil {
		from.Info("WUD needs a separately approved Project-only Docker TLS endpoint and owned valid CA/client trust files. Resolve those prerequisites, then retry self-host setup wud and self-host setup homarr. This Link does not discover endpoints, mount a Docker socket or weaken TLS.")
		return helpers.ErrManual
	}
	statistics, err := wud.ReadHomarrStats(ctx, to)
	if err != nil {
		return err
	}
	if statistics.TotalContainers == 0 {
		from.Info("WUD authenticated successfully but returned an empty inventory. Approve a Project-only read-only Docker endpoint and an owned watched image, then retry self-host setup wud and self-host setup homarr. This Link does not configure discovery or mount a Docker socket.")
		return helpers.ErrManual
	}
	return nil
}

func verifyWUD(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if _, err := wud.ReadHomarrStats(ctx, to); err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.wud.getStats", map[string]any{"integrationId": integrationID})
	if err != nil {
		return err
	}
	result, ok := value.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return WUD container updates; retry self-host setup homarr")
	}
	stamp, ok := result["updatedAt"].(string)
	fetchedAt, err := time.Parse(time.RFC3339Nano, stamp)
	if !ok || err != nil || fetchedAt.Before(from.Now().Add(-10*time.Second)) || fetchedAt.After(from.Now().Add(time.Second)) {
		return errors.New("Homarr WUD widget returned missing or stale data; retry self-host setup homarr")
	}
	statistics, ok := result["stats"].(map[string]any)
	if !ok || !validWUDCounts(statistics) {
		return errors.New("Homarr WUD widget returned invalid container counts; retry self-host setup homarr")
	}
	updates, ok := statistics["updates"].([]any)
	if !ok || float64(len(updates)) != statistics["updatesAvailable"].(float64) {
		return errors.New("Homarr returned incomplete WUD container updates; retry self-host setup homarr")
	}
	seen := map[string]bool{}
	for _, raw := range updates {
		update, ok := raw.(map[string]any)
		if !ok {
			return errors.New("Homarr returned malformed WUD container updates; retry self-host setup homarr")
		}
		if !validWUDUpdate(update) || seen[stringField(update, "id")] {
			return errors.New("Homarr WUD container updates are incomplete or duplicated; retry self-host setup homarr")
		}
		seen[stringField(update, "id")] = true
	}
	return nil
}

func validWUDUpdate(actual map[string]any) bool {
	if stringField(actual, "id") == "" || stringField(actual, "name") == "" {
		return false
	}
	for _, key := range []string{"currentVersion", "newVersion", "link"} {
		value, exists := actual[key]
		if !exists {
			return false
		}
		if value != nil {
			if _, ok := value.(string); !ok {
				return false
			}
		}
	}
	return true
}

func validWUDCounts(values map[string]any) bool {
	for _, key := range []string{"totalContainers", "updatesAvailable"} {
		count, ok := values[key].(float64)
		if !ok || math.IsNaN(count) || math.IsInf(count, 0) || count < 0 || math.Trunc(count) != count {
			return false
		}
	}
	return values["updatesAvailable"].(float64) <= values["totalContainers"].(float64)
}

func verifyWUDStats(sample statsSample) error {
	if sample.updatedAt < sample.startedAt || sample.updatedAt > sample.completedAt+float64(time.Second.Milliseconds()) {
		return errors.New("Homarr WUD statistics have an invalid refresh time; retry self-host setup homarr")
	}
	if sample.units["totalContainers"] != "count" || sample.units["updatesAvailable"] != "count" || !validWUDCounts(sample.values) {
		return errors.New("Homarr WUD statistics have invalid container counts or units; retry self-host setup homarr")
	}
	return nil
}
