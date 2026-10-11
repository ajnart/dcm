package homarr

import (
	"context"
	"errors"
	"fmt"

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
		verify: verifyHomeAssistant,
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
	if !ok || stringField(details, "entity_id") != entity.ID || stringField(details, "state") != entity.State || stringField(details, "last_changed") == "" || stringField(details, "last_updated") == "" {
		return errors.New("Homarr did not return the selected Home Assistant entity's real state and timestamps; run self-host setup home-assistant, then self-host setup homarr")
	}
	value, err = apiKeyWrite(ctx, from, "widget.stats.refresh", map[string]any{"integrationId": integrationID, "force": false})
	if err != nil {
		return err
	}
	snapshot, _ := value.(map[string]any)
	values, _ := snapshot["values"].(map[string]any)
	if snapshot["error"] != false || snapshot["stale"] != false {
		return errors.New("Homarr could not refresh Home Assistant statistics; check its saved token and retry Setup")
	}
	updated, ok := snapshot["updatedAt"].(float64)
	if !ok || updated <= 0 {
		return errors.New("Homarr returned Home Assistant statistics without a refresh timestamp")
	}
	for _, key := range []string{"entities", "unavailable"} {
		count, ok := values[key].(float64)
		if !ok || count < 0 {
			return errors.New("Homarr returned incomplete Home Assistant statistics")
		}
	}
	if values["entities"].(float64) < 1 || values["unavailable"].(float64) > values["entities"].(float64) {
		return errors.New("Homarr returned Home Assistant statistics inconsistent with the selected entity")
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
