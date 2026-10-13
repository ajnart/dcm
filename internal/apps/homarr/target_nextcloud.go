package homarr

import (
	"context"
	"errors"
	"math"

	"github.com/ajnart/self-host/internal/apps/nextcloud"
	"github.com/ajnart/self-host/internal/helpers"
)

func nextcloudTarget() target {
	return target{
		id: "nextcloud", name: "Nextcloud", kind: "nextcloud", internal: fixed("http://nextcloud:80"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{
				{Kind: "username", Value: to.AdminUser()},
				{Kind: "password", Value: to.Secret(to.Key("homarr_app_password"))},
			}
		},
		widgets: []widget{plain("calendar"), plain("notifications"), statWidget("messages")},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			err := nextcloud.VerifyHomarr(ctx, to)
			if errors.Is(err, helpers.ErrManual) {
				from.Info(nextcloud.HomarrRecoveryHint(to))
			}
			return err
		},
		verify: verifyNextcloud,
		stats:  verifyNextcloudStats,
	}
}

func verifyNextcloud(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := nextcloud.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "integration.byId", map[string]any{"id": integrationID})
	if err != nil {
		return err
	}
	saved, ok := value.(map[string]any)
	if !ok || stringField(saved, "id") != integrationID || stringField(saved, "kind") != "nextcloud" {
		return errors.New("Homarr did not return the saved Nextcloud integration")
	}
	credentials, ok := saved["secrets"].([]any)
	if !ok || len(credentials) != 2 {
		return errors.New("Homarr returned incomplete saved Nextcloud credential metadata; retry self-host setup homarr")
	}
	username, password := false, false
	for _, raw := range credentials {
		credential, _ := raw.(map[string]any)
		switch stringField(credential, "kind") {
		case "username":
			if username || to.AdminUser() == "" || stringField(credential, "value") != to.AdminUser() {
				return errors.New("Homarr's saved Nextcloud account does not match the Project administrator; retry self-host setup homarr")
			}
			username = true
		case "password":
			redacted, present := credential["value"]
			if password || !present || redacted != nil {
				return errors.New("Homarr returned invalid saved Nextcloud password metadata")
			}
			password = true
		}
	}
	if !username || !password {
		return errors.New("Homarr did not return the saved Nextcloud username and password metadata")
	}
	value, err = apiKeyProcedure(ctx, from, "widget.notifications.getNotifications", map[string]any{"integrationIds": []string{integrationID}})
	if err != nil {
		return err
	}
	results, ok := value.([]any)
	if !ok || len(results) != 1 {
		return errors.New("Homarr did not return Nextcloud notifications")
	}
	result, ok := results[0].(map[string]any)
	if !ok || result["error"] != nil {
		return errors.New("Homarr could not read Nextcloud notifications; run self-host setup nextcloud, then self-host setup homarr")
	}
	integration, _ := result["integration"].(map[string]any)
	if stringField(integration, "id") != integrationID || stringField(integration, "kind") != "nextcloud" {
		return errors.New("Homarr returned notifications for another integration")
	}
	if _, ok := result["data"].([]any); !ok {
		return errors.New("Homarr returned an incomplete Nextcloud notification list")
	}
	now := from.Now()
	value, err = apiKeyProcedure(ctx, from, "widget.calendar.findAllEvents", map[string]any{
		"integrationIds": []string{integrationID}, "year": now.Year(), "month": int(now.Month()),
		"releaseType": []string{}, "showUnmonitored": false,
	})
	if err != nil {
		return err
	}
	results, ok = value.([]any)
	if !ok || len(results) != 1 {
		return errors.New("Homarr did not return Nextcloud calendar events")
	}
	result, ok = results[0].(map[string]any)
	if !ok || result["error"] != nil {
		return errors.New("Homarr could not read Nextcloud calendars; run self-host setup nextcloud, then self-host setup homarr")
	}
	integration, _ = result["integration"].(map[string]any)
	if stringField(integration, "id") != integrationID || stringField(integration, "kind") != "nextcloud" {
		return errors.New("Homarr returned calendar events for another integration")
	}
	if _, ok := result["events"].([]any); !ok {
		return errors.New("Homarr returned an incomplete Nextcloud calendar event list")
	}
	return nil
}

func verifyNextcloudStats(sample statsSample) error {
	if sample.units["messages"] != "count" {
		return errors.New("Homarr does not expose Nextcloud's notification-count statistic; use supported Homarr 2.4.1 and retry Setup")
	}
	if sample.updatedAt < sample.startedAt {
		return errors.New("Homarr did not return newly refreshed Nextcloud statistics; retry self-host setup homarr")
	}
	count, ok := sample.values["messages"].(float64)
	if !ok || math.IsNaN(count) || math.IsInf(count, 0) || count < 0 || count != float64(int64(count)) {
		return errors.New("Homarr returned incomplete Nextcloud notification statistics")
	}
	return nil
}
