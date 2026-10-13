package homarr

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/ajnart/self-host/internal/apps/umami"
	"github.com/ajnart/self-host/internal/helpers"
)

func umamiTarget() target {
	return target{
		id: "umami", name: "Umami", kind: "umami", internal: fixed("http://umami:3000/api"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{
				{Kind: "username", Value: to.Secret(to.Key("homarr_username"))},
				{Kind: "password", Value: to.Secret(to.Key("homarr_password"))},
			}
		},
		widgets: []widget{{kind: "umami", bind: func(ctx context.Context, to *helpers.H, _ string) (map[string]any, error) {
			id, err := umami.HomarrWebsiteID(ctx, to)
			if err != nil {
				return nil, err
			}
			return map[string]any{
				"websiteId": id, "timeFrame": "24h", "viewMode": "chart",
				"chartType": "bar", "chartStyle": "grouped", "eventName": "", "eventNames": []string{}, "topCount": 5,
			}, nil
		}}, statWidget("websites")},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			if err := umami.VerifyHomarr(ctx, to); err != nil {
				if errors.Is(err, helpers.ErrManual) {
					from.Info("Run self-host setup umami to repair its recorded Homarr account and fixture website, then retry self-host setup homarr; no manual website or account is adopted")
				}
				return err
			}
			return nil
		},
		verify: verifyUmami,
		stats:  verifyUmamiStats,
	}
}

func verifyUmami(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := umami.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	websiteID := to.Secret(to.Key("homarr_website_id"))
	value, err := apiKeyProcedure(ctx, from, "widget.umami.getWebsites", map[string]any{"integrationId": integrationID})
	if err != nil {
		return err
	}
	websites, ok := value.([]any)
	if !ok || len(websites) != 1 {
		return errors.New("Homarr did not return the isolated Umami fixture website; retry self-host setup umami and self-host setup homarr")
	}
	website, _ := websites[0].(map[string]any)
	if stringField(website, "id") != websiteID || stringField(website, "name") != "self-host Homarr fixture" || stringField(website, "domain") != "self-host.invalid" {
		return errors.New("Homarr returned a different or incomplete Umami website")
	}
	value, err = apiKeyProcedure(ctx, from, "widget.umami.getVisitorStats", map[string]any{
		"integrationIds": []string{integrationID}, "websiteId": websiteID, "timeFrame": "24h",
	})
	if err != nil {
		return err
	}
	results, ok := value.([]any)
	if !ok || len(results) != 1 {
		return errors.New("Homarr did not return Umami visitor statistics")
	}
	result, _ := results[0].(map[string]any)
	stats, _ := result["visitorStats"].(map[string]any)
	if result["error"] != nil || stringField(result, "integrationId") != integrationID || stringField(stats, "websiteId") != websiteID || stringField(stats, "timeFrame") != "24h" ||
		stringField(stats, "websiteName") != stringField(website, "name") || stringField(stats, "domain") != stringField(website, "domain") {
		return errors.New("Homarr returned Umami statistics for a different website or time window")
	}
	updatedAt, err := time.Parse(time.RFC3339Nano, stringField(result, "updatedAt"))
	now := from.Now()
	if err != nil || now.Sub(updatedAt) > time.Minute || updatedAt.After(now.Add(time.Minute)) {
		return errors.New("Homarr returned missing or stale Umami statistics; check the Host clock and retry self-host setup homarr")
	}
	for _, metric := range []string{"totalVisitors", "totalPageviews", "totalVisits", "bounceRate", "avgDuration"} {
		count, ok := stats[metric].(float64)
		if !ok || count < 0 || math.IsNaN(count) || math.IsInf(count, 0) {
			return errors.New("Homarr returned incomplete Umami statistics; missing values are not zero")
		}
		if math.Trunc(count) != count || metric == "bounceRate" && count > 100 {
			return errors.New("Homarr returned invalid Umami counts or bounce percentage")
		}
	}
	points, ok := stats["dataPoints"].([]any)
	if !ok {
		return errors.New("Homarr did not return the Umami visitor series")
	}
	for _, raw := range points {
		point, _ := raw.(map[string]any)
		visitors, ok := point["visitors"].(float64)
		if !ok || visitors < 0 || math.IsNaN(visitors) || math.IsInf(visitors, 0) || math.Trunc(visitors) != visitors || !validUmamiTimestamp(stringField(point, "timestamp")) {
			return errors.New("Homarr returned an invalid Umami visitor data point")
		}
	}
	value, err = apiKeyProcedure(ctx, from, "widget.umami.getActiveVisitors", map[string]any{
		"integrationId": integrationID, "websiteId": websiteID,
	})
	if err != nil {
		return err
	}
	active, ok := value.(float64)
	if !ok || active < 0 || math.IsNaN(active) || math.IsInf(active, 0) || math.Trunc(active) != active {
		return errors.New("Homarr did not explicitly return Umami active visitors")
	}
	return nil
}

func validUmamiTimestamp(timestamp string) bool {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05"} {
		if _, err := time.Parse(layout, timestamp); err == nil {
			return true
		}
	}
	return false
}

func verifyUmamiStats(sample statsSample) error {
	websites, ok := sample.values["websites"].(float64)
	if sample.units["websites"] != "count" || !ok || websites < 0 || math.IsNaN(websites) || math.IsInf(websites, 0) || math.Trunc(websites) != websites {
		return errors.New("Homarr returned invalid Umami website Stats or units; retry self-host setup homarr")
	}
	return nil
}
