package homarr

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"github.com/ajnart/self-host/internal/apps/adguard"
	"github.com/ajnart/self-host/internal/helpers"
)

func adguardTarget() target {
	return target{
		id: "adguard-home", name: "AdGuard Home", kind: "adGuardHome",
		internal: fixed("http://adguard-home:3000"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "username", Value: to.AdminUser()}, {Kind: "password", Value: to.AdminPassword()}}
		},
		widgets: []widget{
			plain("dnsHoleSummary"),
			{kind: "dnsHoleControls", options: map[string]any{"showToggleAllButtons": false}},
			statWidget("dnsQueriesToday", "adsBlockedToday", "domainsBeingBlocked"),
		},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			return adguardNativeReady(ctx, from, to)
		},
		verify: verifyAdguard,
		stats:  verifyAdguardStats,
	}
}

func adguardNativeReady(ctx context.Context, from, h *helpers.H) error {
	if err := (adguard.App{}).Check(ctx, h); err != nil {
		return err
	}
	response, err := h.HTTP(ctx, helpers.Request{Path: "/control/filtering/status", User: h.AdminUser(), Password: h.AdminPassword(), NoRedirect: true})
	if err != nil {
		return err
	}
	if response.Status != 200 {
		return fmt.Errorf("AdGuard Home native filtering probe returned HTTP %d; retry self-host setup adguard-home", response.Status)
	}
	var filtering struct{ Filters json.RawMessage }
	if response.Decode(&filtering) != nil || filtering.Filters == nil {
		return errors.New("AdGuard Home did not return its DNS filters; retry self-host setup adguard-home")
	}
	var filters []struct {
		URL        *string  `json:"url"`
		Name       *string  `json:"name"`
		ID         *float64 `json:"id"`
		RulesCount *float64 `json:"rules_count"`
		Enabled    *bool    `json:"enabled"`
	}
	if json.Unmarshal(filtering.Filters, &filters) != nil {
		return errors.New("AdGuard Home returned malformed DNS filters; retry self-host setup adguard-home")
	}
	if filters == nil {
		version, err := readHomarrVersion(ctx, from)
		if err != nil {
			return errors.New("cannot verify Homarr's null DNS-filter support; preserve the current DNS settings and retry self-host setup homarr")
		}
		if credentialSafeHomarrVersion(version) {
			return nil
		}
		return errors.New("AdGuard Home has a valid null filters list, which this Link supports only with authenticated Homarr 2.5.1 or newer; preserve the current DNS settings and review the supported Homarr version before retrying self-host setup homarr")
	}
	for _, filter := range filters {
		if filter.URL == nil || filter.Name == nil || filter.Enabled == nil || filter.ID == nil || filter.RulesCount == nil ||
			!adguardCount(*filter.ID) || !adguardCount(*filter.RulesCount) {
			return errors.New("AdGuard Home returned incomplete native filter metadata or rule counts; retry self-host setup adguard-home")
		}
	}
	return nil
}

func adguardCount(value any) bool {
	count, ok := value.(float64)
	return ok && count >= 0 && !math.IsNaN(count) && !math.IsInf(count, 0) && math.Trunc(count) == count
}

func verifyAdguard(ctx context.Context, from, _ *helpers.H, integrationID string) error {
	value, err := apiKeyProcedure(ctx, from, "widget.dnsHole.summary", map[string]any{"integrationIds": []string{integrationID}})
	if err != nil {
		return err
	}
	results, ok := value.([]any)
	if !ok || len(results) != 1 {
		return errors.New("Homarr did not return AdGuard Home's native DNS summary; retry self-host setup homarr")
	}
	result, _ := results[0].(map[string]any)
	integration, _ := result["integration"].(map[string]any)
	if integrationID == "" || integrationID != from.Secret(from.Key("linked_adguard-home")) ||
		stringField(result, "integrationId") != integrationID || stringField(integration, "id") != integrationID ||
		stringField(integration, "kind") != "adGuardHome" || result["error"] != nil {
		return errors.New("Homarr could not read its owned AdGuard Home integration; retry self-host setup homarr")
	}
	summary, _ := result["summary"].(map[string]any)
	for _, key := range []string{"dnsQueriesToday", "adsBlockedToday", "domainsBeingBlocked"} {
		if !adguardCount(summary[key]) {
			return errors.New("Homarr returned unavailable or invalid AdGuard Home DNS counts; retry self-host setup homarr")
		}
	}
	state := stringField(summary, "status")
	if state != "enabled" && state != "disabled" {
		return errors.New("Homarr did not return AdGuard Home's DNS protection state; retry self-host setup homarr")
	}
	if !adguardBlockingCounts(summary) || !adguardPercentage(summary["adsBlockedTodayPercentage"], summary) {
		return errors.New("Homarr returned inconsistent AdGuard Home DNS blocking counts or percentage; resolve the upstream native summary before retrying self-host setup homarr")
	}
	return nil
}

func verifyAdguardStats(sample statsSample) error {
	for _, key := range []string{"dnsQueriesToday", "adsBlockedToday", "domainsBeingBlocked"} {
		if sample.units[key] != "count" || !adguardCount(sample.values[key]) {
			return errors.New("Homarr returned unavailable or invalid AdGuard Home Stats counts; retry self-host setup homarr")
		}
	}
	if !adguardBlockingCounts(sample.values) {
		return errors.New("Homarr returned more blocked AdGuard Home queries than total queries; retry self-host setup homarr")
	}
	return nil
}

func adguardBlockingCounts(values map[string]any) bool {
	queries, queriesOK := values["dnsQueriesToday"].(float64)
	blocked, blockedOK := values["adsBlockedToday"].(float64)
	return queriesOK && blockedOK && blocked <= queries
}

func adguardPercentage(value any, counts map[string]any) bool {
	percentage, ok := value.(float64)
	if !ok || math.IsNaN(percentage) || math.IsInf(percentage, 0) || percentage < 0 || percentage > 100 {
		return false
	}
	queries := counts["dnsQueriesToday"].(float64)
	blocked := counts["adsBlockedToday"].(float64)
	expected := float64(0)
	if queries > 0 {
		expected = blocked / queries * 100
	}
	return math.Abs(percentage-expected) <= 1e-9
}
