package homarr

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/ajnart/self-host/internal/apps/homeassistant"
	"github.com/ajnart/self-host/internal/helpers"
)

func homeAssistantTarget() target {
	return target{
		id: "home-assistant", name: "Home Assistant", kind: "homeAssistant", internal: fixed("http://home-assistant:8123"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "apiKey", Value: to.Secret(to.Key("homarr_token"))}}
		},
		widgets: []widget{{kind: "smartHome-entityState", bind: func(ctx context.Context, to *helpers.H, _ string) (map[string]any, error) {
			entity, err := homeassistant.HomarrEntity(ctx, to)
			if err != nil {
				return nil, err
			}
			name, _ := entity.Attributes["friendly_name"].(string)
			if name == "" {
				name = entity.ID
			}
			unit, _ := entity.Attributes["unit_of_measurement"].(string)
			return map[string]any{"entityId": entity.ID, "displayName": name, "entityUnit": unit, "clickable": false}, nil
		}}, statWidget("entities", "unavailable")},
		preflight: func(ctx context.Context, from, to *helpers.H) error {
			_, entityErr := homeassistant.HomarrEntity(ctx, to)
			if err := errors.Join((homeassistant.App{}).Check(ctx, to), homeassistant.VerifyHomarr(ctx, to), entityErr); err != nil {
				from.Info("Home Assistant needs its verified read-only Homarr token, an available selected entity and completed first-run choices. Run self-host setup home-assistant, resolve its Manual steps without enabling hardware or discovery implicitly, then self-host setup homarr. No Homarr resources were changed.")
				return err
			}
			return nil
		},
		verify: verifyHomeAssistant,
		stats:  verifyHomeAssistantStats,
	}
}

func verifyHomeAssistant(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if err := homeassistant.VerifyHomarr(ctx, to); err != nil {
		return err
	}
	entity, err := homeassistant.HomarrEntity(ctx, to)
	if err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.smartHome.entityDetails", map[string]any{"integrationId": integrationID, "entityId": entity.ID})
	if err != nil {
		return err
	}
	details, ok := value.(map[string]any)
	if !ok || stringField(details, "entity_id") != entity.ID || !validHomeAssistantDetails(details, from.Now()) {
		return errors.New("Homarr did not return the selected Home Assistant entity's available state, attributes and timestamps; run self-host setup home-assistant, then self-host setup homarr")
	}
	current, err := board(ctx, from)
	if err != nil {
		return err
	}
	owned := ownedWidgets(from, integrationID)
	for _, item := range itemsOf(current) {
		if !owned[stringField(item, "id")] || !wiredTo(item, "smartHome-entityState", integrationID) {
			continue
		}
		options, _ := item["options"].(map[string]any)
		if stringField(options, "entityId") != entity.ID || options["clickable"] != false {
			return fmt.Errorf("%w: edit only the owned Home Assistant Entity State widget in Homarr to the selected entity with clickable disabled, preserving its ID; then run self-host setup homarr", helpers.ErrManual)
		}
	}
	return nil
}

func validHomeAssistantDetails(details map[string]any, now time.Time) bool {
	state := stringField(details, "state")
	attributes, ok := details["attributes"].(map[string]any)
	if state == "" || state == "unknown" || state == "unavailable" || !ok || attributes == nil {
		return false
	}
	changed, changeErr := time.Parse(time.RFC3339Nano, stringField(details, "last_changed"))
	updated, updateErr := time.Parse(time.RFC3339Nano, stringField(details, "last_updated"))
	return changeErr == nil && updateErr == nil && !changed.After(updated) && !updated.After(now.Add(time.Second))
}

func verifyHomeAssistantStats(sample statsSample) error {
	counts := map[string]float64{}
	for _, key := range []string{"entities", "unavailable"} {
		count, ok := sample.values[key].(float64)
		if !ok || math.IsNaN(count) || math.IsInf(count, 0) || count < 0 || math.Trunc(count) != count || sample.units[key] != "count" {
			return errors.New("Homarr returned incomplete Home Assistant count statistics")
		}
		counts[key] = count
	}
	if counts["entities"] < 1 || counts["unavailable"] > counts["entities"] {
		return errors.New("Homarr returned Home Assistant statistics inconsistent with the selected entity")
	}
	return nil
}
