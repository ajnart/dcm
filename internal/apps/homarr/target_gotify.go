package homarr

import (
	"context"
	"errors"
	"math"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/apps/gotify"
	"github.com/ajnart/self-host/internal/helpers"
)

func gotifyTarget() target {
	return target{
		id: "gotify", name: "Gotify", kind: "gotify", internal: fixed("http://gotify:80"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{
				{Kind: "username", Value: to.Secret(to.Key("homarr_username"))},
				{Kind: "password", Value: to.Secret(to.Key("homarr_password"))},
			}
		},
		widgets: []widget{{kind: "notifications", options: map[string]any{"hideLogos": false, "messageFormat": "plain"}}, statWidget("messages")},
		verify:  verifyGotify,
	}
}

func verifyGotify(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := gotify.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.stats.catalog", map[string]any{"integrationId": integrationID})
	if err != nil {
		return errors.New("Homarr could not read Gotify Stats capabilities; retry self-host setup homarr")
	}
	catalog, ok := value.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return Gotify Stats capabilities")
	}
	metrics, ok := catalog["metrics"].([]any)
	found := false
	for _, raw := range metrics {
		metric, _ := raw.(map[string]any)
		if stringField(metric, "key") == "messages" && stringField(metric, "unit") == "count" {
			found = true
		}
	}
	if !ok || !found {
		return errors.New("Homarr does not support Gotify's messages statistic; use Homarr 2.4.1 and retry Setup")
	}
	value, err = apiKeyProcedure(ctx, from, "widget.notifications.getNotifications", map[string]any{
		"integrationIds": []string{integrationID}, "hideLogos": false, "messageFormat": "plain",
	})
	if err != nil {
		return errors.New("Homarr could not read Gotify notifications; run self-host setup gotify, then self-host setup homarr")
	}
	results, ok := value.([]any)
	if !ok || len(results) != 1 {
		return errors.New("Homarr did not return the Gotify notification result")
	}
	result, ok := results[0].(map[string]any)
	if !ok || result["error"] != nil {
		return errors.New("Homarr reported a Gotify notification error; retry Setup")
	}
	integration, _ := result["integration"].(map[string]any)
	if stringField(integration, "id") != integrationID || stringField(integration, "kind") != "gotify" {
		return errors.New("Homarr returned notifications for a different integration")
	}
	notifications, ok := result["data"].([]any)
	if !ok || len(notifications) > 100 {
		return errors.New("Homarr returned incomplete Gotify notifications")
	}
	for _, raw := range notifications {
		notification, ok := raw.(map[string]any)
		id, idErr := strconv.ParseUint(stringField(notification, "id"), 10, 64)
		date, dateErr := time.Parse(time.RFC3339Nano, stringField(notification, "time"))
		_, hasTitle := notification["title"].(string)
		_, hasBody := notification["body"].(string)
		if !ok || idErr != nil || id == 0 || dateErr != nil || date.IsZero() || !hasTitle || !hasBody {
			return errors.New("Homarr returned an incomplete Gotify notification")
		}
	}
	refreshStarted := from.Now().UnixMilli()
	value, err = apiKeyWrite(ctx, from, "widget.stats.refresh", map[string]any{"integrationId": integrationID, "force": true})
	if err != nil {
		return errors.New("Homarr could not refresh Gotify's read-only message statistic; retry Setup")
	}
	snapshot, ok := value.(map[string]any)
	if !ok {
		return errors.New("Homarr did not return Gotify statistics")
	}
	failed, hasError := snapshot["error"].(bool)
	stale, hasStale := snapshot["stale"].(bool)
	updated, hasUpdated := snapshot["updatedAt"].(float64)
	if !hasError || failed || !hasStale || stale || !hasUpdated || updated <= 0 || updated < float64(refreshStarted) || math.IsNaN(updated) || math.IsInf(updated, 0) {
		return errors.New("Homarr could not refresh Gotify statistics; run self-host setup gotify, then self-host setup homarr")
	}
	statistics, _ := snapshot["values"].(map[string]any)
	count, ok := statistics["messages"].(float64)
	if !ok || math.IsNaN(count) || math.IsInf(count, 0) || math.Trunc(count) != count || count < 0 || count > 100 {
		return errors.New("Homarr returned an invalid Gotify message statistic")
	}
	return nil
}
