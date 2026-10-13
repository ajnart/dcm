package homarr

import (
	"context"
	"errors"
	"math"
	"slices"

	"github.com/ajnart/self-host/internal/apps/nzbget"
	"github.com/ajnart/self-host/internal/helpers"
)

func nzbgetTarget() target {
	return target{
		id: "nzbget", name: "NZBGet", kind: "nzbGet", internal: fixed("http://nzbget:6789"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{
				{Kind: "username", Value: to.Secret(to.Key("homarr_username"))},
				{Kind: "password", Value: to.Secret(to.Key("homarr_password"))},
			}
		},
		widgets: []widget{{kind: "downloads", options: map[string]any{
			"columns":             []string{"name", "progress", "downSpeed", "time", "state"},
			"showCompletedUsenet": true, "limitPerIntegration": 50,
		}}, statWidget("download", "paused")},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			if err := requireCredentialSafeHomarr(ctx, from, "NZBGet credential-safety hold #354: use exactly Homarr 2.5.1 or 2.5.2 with the shipped privacy fix. Back up Homarr before changing its version, then retry self-host setup homarr. Older, unreadable or unreviewed versions remain Manual; do not bypass the hold or create a manual integration."); err != nil {
				return err
			}
			return nzbget.VerifyHomarr(ctx, to)
		},
		verify: verifyNZBGet,
		stats:  verifyNZBGetStats,
	}
}

func verifyNZBGet(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := verifyNZBGetIdentity(ctx, from, integrationID); err != nil {
		return err
	}
	if err := nzbget.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	queue, err := readDownloadsQueue(ctx, from, integrationID, "nzbGet")
	if err != nil {
		return err
	}
	status, items := queue.status, queue.items
	rates, _ := status["rates"].(map[string]any)
	rate, ok := rates["down"].(float64)
	if !ok || rate < 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
		return errors.New("Homarr did not return the NZBGet download rate; retry self-host setup homarr")
	}
	if _, ok := status["paused"].(bool); !ok {
		return errors.New("Homarr did not return the NZBGet queue state; retry self-host setup homarr")
	}
	types, ok := status["types"].([]any)
	if !ok || !slices.Contains(types, any("usenet")) {
		return errors.New("Homarr did not identify the NZBGet Usenet queue; retry self-host setup homarr")
	}
	if len(items) > 50 {
		return errors.New("Homarr did not return the bounded NZBGet download list; retry self-host setup homarr")
	}
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		progress, ok := item["progress"].(float64)
		if stringField(item, "id") == "" || stringField(item, "name") == "" || stringField(item, "type") != "usenet" || !slices.Contains([]string{"downloading", "queued", "paused", "completed", "failed", "processing"}, stringField(item, "state")) || !ok || progress < 0 || progress > 1 || math.IsNaN(progress) || math.IsInf(progress, 0) {
			return errors.New("Homarr returned incomplete NZBGet download data; retry self-host setup homarr")
		}
		for _, key := range []string{"size", "index", "time"} {
			value, ok := item[key].(float64)
			if !ok || math.IsNaN(value) || math.IsInf(value, 0) || key == "size" && value < 0 {
				return errors.New("Homarr returned incomplete NZBGet download data; retry self-host setup homarr")
			}
		}
	}
	return nil
}

func verifyNZBGetIdentity(ctx context.Context, from *helpers.H, integrationID string) error {
	if integrationID == "" {
		from.Info("Homarr's NZBGet Link has no saved integration identifier; review its owned record before retrying self-host setup homarr. No integration was adopted or changed.")
		return helpers.ErrManual
	}
	value, err := apiKeyProcedure(ctx, from, "integration.byId", map[string]any{"id": integrationID})
	if err != nil {
		return errors.New("Homarr could not read the saved NZBGet credential metadata; review its owned integration and retry self-host setup homarr")
	}
	integration, _ := value.(map[string]any)
	credentials, ok := integration["secrets"].([]any)
	valid := ok && len(credentials) == 2 && stringField(integration, "id") == integrationID && stringField(integration, "kind") == "nzbGet" && stringField(integration, "url") == "http://nzbget:6789"
	seen := map[string]bool{}
	for _, raw := range credentials {
		credential, _ := raw.(map[string]any)
		kind := stringField(credential, "kind")
		value, present := credential["value"]
		if seen[kind] || !present || kind != "username" && kind != "password" || kind == "username" && value != "self-host-homarr" || kind == "password" && value != nil {
			valid = false
		}
		seen[kind] = true
	}
	if !valid || !seen["username"] || !seen["password"] {
		from.Info("Homarr's saved NZBGet integration must use exactly the managed restricted username and a redacted password credential. Review and explicitly repair only the owned record; do not adopt an Admin or foreign account. Then retry self-host setup homarr. No credential was changed.")
		return helpers.ErrManual
	}
	return nil
}

func verifyNZBGetStats(sample statsSample) error {
	rate, ok := sample.values["download"].(float64)
	if sample.units["download"] != "bytesPerSecond" || !ok || rate < 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
		return errors.New("Homarr returned unsupported refreshed NZBGet byte-per-second Stats; retry self-host setup homarr")
	}
	if _, ok := sample.values["paused"].(bool); !ok || sample.units["paused"] != "text" {
		return errors.New("Homarr did not return supported refreshed NZBGet paused Stats; retry self-host setup homarr")
	}
	return nil
}
