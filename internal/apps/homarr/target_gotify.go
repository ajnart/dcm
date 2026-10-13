package homarr

import (
	"context"
	"errors"
	"math"
	"net/http"
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
		stats:   verifyGotifyStats,
	}
}

func verifyGotify(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := gotify.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	recordedID, err := strconv.ParseUint(to.Secret(to.Key("homarr_user_id")), 10, 64)
	if err != nil || recordedID == 0 || recordedID > 1<<53-1 {
		return errors.New("Gotify Homarr account ID is invalid; run self-host setup gotify")
	}
	value, err := apiKeyWrite(ctx, from, "integration.request", map[string]any{
		"integrationId": integrationID, "method": http.MethodGet, "path": "/current/user",
	})
	if err != nil {
		return errors.New("Homarr could not verify its saved Gotify login; run self-host setup gotify, then self-host setup homarr")
	}
	response, ok := value.(map[string]any)
	integration, _ := response["integration"].(map[string]any)
	status, _ := response["status"].(float64)
	if !ok || response["ok"] != true || status != http.StatusOK || stringField(integration, "id") != integrationID || stringField(integration, "kind") != "gotify" {
		return errors.New("Homarr did not verify the saved Gotify connection; run self-host setup homarr")
	}
	account, _ := response["data"].(map[string]any)
	accountID, hasID := account["id"].(float64)
	if !hasID || accountID != float64(recordedID) || account["admin"] != false || stringField(account, "name") == "" {
		return errors.New("Homarr's Gotify login must belong to the recorded non-admin account; run self-host setup gotify, then self-host setup homarr")
	}
	return verifyGotifyNotifications(ctx, from, integrationID)
}

func verifyGotifyStats(sample statsSample) error {
	if sample.units["messages"] != "count" {
		return errors.New("Homarr does not support Gotify's messages statistic; use Homarr 2.4.1 and retry Setup")
	}
	if sample.updatedAt < sample.startedAt {
		return errors.New("Homarr could not refresh Gotify statistics; run self-host setup gotify, then self-host setup homarr")
	}
	count, ok := sample.values["messages"].(float64)
	if !ok || math.IsNaN(count) || math.IsInf(count, 0) || math.Trunc(count) != count || count < 0 || count > 100 {
		return errors.New("Homarr returned an invalid Gotify message statistic")
	}
	return nil
}

func verifyGotifyNotifications(ctx context.Context, h *helpers.H, integrationID string) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	started := h.Now()
	err := h.Poll(ctx, 30*time.Second, func(ctx context.Context) (bool, error) {
		value, err := apiKeyProcedure(ctx, h, "widget.notifications.getNotifications", map[string]any{
			"integrationIds": []string{integrationID}, "hideLogos": false, "messageFormat": "plain",
		})
		if err != nil {
			return false, errors.New("Homarr could not read Gotify notifications")
		}
		results, ok := value.([]any)
		if !ok || len(results) != 1 {
			return false, errors.New("Homarr did not return the Gotify notification result")
		}
		result, ok := results[0].(map[string]any)
		if !ok || result["error"] != nil {
			return false, errors.New("Homarr reported a Gotify notification error")
		}
		integration, _ := result["integration"].(map[string]any)
		if stringField(integration, "id") != integrationID || stringField(integration, "kind") != "gotify" {
			return false, errors.New("Homarr returned notifications for a different integration")
		}
		updated, err := time.Parse(time.RFC3339Nano, stringField(integration, "updatedAt"))
		if err != nil || updated.IsZero() || updated.Before(started) || updated.After(h.Now()) {
			return false, errors.New("Homarr did not return Gotify notifications fetched during this attempt")
		}
		notifications, ok := result["data"].([]any)
		if !ok || len(notifications) > 100 {
			return false, errors.New("Homarr returned incomplete Gotify notifications")
		}
		for _, raw := range notifications {
			notification, ok := raw.(map[string]any)
			id, idErr := strconv.ParseUint(stringField(notification, "id"), 10, 64)
			date, dateErr := time.Parse(time.RFC3339Nano, stringField(notification, "time"))
			_, hasTitle := notification["title"].(string)
			_, hasBody := notification["body"].(string)
			if !ok || idErr != nil || id == 0 || dateErr != nil || date.IsZero() || !hasTitle || !hasBody {
				return false, errors.New("Homarr returned an incomplete Gotify notification")
			}
		}
		return true, nil
	})
	if err != nil {
		return errors.New("Homarr could not verify fresh Gotify notifications; run self-host setup gotify, then self-host setup homarr")
	}
	return nil
}
