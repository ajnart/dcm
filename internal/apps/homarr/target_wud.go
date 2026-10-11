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
			return []secret{{Kind: "username", Value: to.AdminUser()}, {Kind: "password", Value: to.AdminPassword()}}
		},
		widgets: []widget{{kind: "wud", options: map[string]any{
			"showTitle": true, "showRing": true, "layout": "horizontal", "showUpdateList": true,
		}}, statWidget("totalContainers", "updatesAvailable")},
		preflight: preflightWUD,
		verify:    verifyWUD,
	}
}

func preflightWUD(ctx context.Context, from, to *helpers.H) error {
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
	expected, err := wud.ReadHomarrStats(ctx, to)
	if err != nil {
		return err
	}
	started := from.Now()
	value, err := apiKeyWrite(ctx, from, "widget.stats.refresh", map[string]any{"integrationId": integrationID, "force": true})
	if err != nil {
		return err
	}
	snapshot, ok := value.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return WUD statistics; retry self-host setup homarr")
	}
	failed, hasError := snapshot["error"].(bool)
	stale, hasStale := snapshot["stale"].(bool)
	updatedAt, hasTime := snapshot["updatedAt"].(float64)
	if !hasError || failed || !hasStale || stale || !hasTime || math.IsNaN(updatedAt) || math.IsInf(updatedAt, 0) || updatedAt < float64(started.UnixMilli()) || updatedAt > float64(from.Now().Add(time.Second).UnixMilli()) {
		return errors.New("Homarr could not refresh authenticated WUD statistics; check its saved connection and retry self-host setup homarr")
	}
	statistics, ok := snapshot["values"].(map[string]any)
	if !ok || !wudCountsMatch(statistics, expected) {
		return errors.New("Homarr WUD statistics are incomplete or differ from its current inventory; retry self-host setup homarr")
	}
	value, err = apiKeyProcedure(ctx, from, "widget.wud.getStats", map[string]any{"integrationId": integrationID})
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
	statistics, ok = result["stats"].(map[string]any)
	if !ok || !wudCountsMatch(statistics, expected) {
		return errors.New("Homarr WUD widget counts differ from its current inventory; retry self-host setup homarr")
	}
	updates, ok := statistics["updates"].([]any)
	if !ok || len(updates) != expected.UpdatesAvailable {
		return errors.New("Homarr returned incomplete WUD container updates; retry self-host setup homarr")
	}
	for index, raw := range updates {
		update, ok := raw.(map[string]any)
		if !ok {
			return errors.New("Homarr returned malformed WUD container updates; retry self-host setup homarr")
		}
		if !wudUpdateMatches(update, expected.Updates[index]) {
			return errors.New("Homarr WUD container updates differ from its current inventory; retry self-host setup homarr")
		}
	}
	return nil
}

func wudUpdateMatches(actual map[string]any, expected wud.HomarrUpdate) bool {
	id, hasID := actual["id"].(string)
	name, hasName := actual["name"].(string)
	if !hasID || !hasName || id != expected.ID || name != expected.Name {
		return false
	}
	for key, expected := range map[string]*string{
		"currentVersion": expected.CurrentVersion, "newVersion": expected.NewVersion, "link": expected.Link,
	} {
		value, exists := actual[key]
		if !exists {
			return false
		}
		if expected == nil {
			if value != nil {
				return false
			}
			continue
		}
		if value != *expected {
			return false
		}
	}
	return true
}

func wudCountsMatch(statistics map[string]any, expected wud.HomarrStatistics) bool {
	total, hasTotal := statistics["totalContainers"].(float64)
	updates, hasUpdates := statistics["updatesAvailable"].(float64)
	return hasTotal && hasUpdates && total == float64(expected.TotalContainers) && updates == float64(expected.UpdatesAvailable)
}
