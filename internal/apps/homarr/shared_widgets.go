package homarr

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/ajnart/self-host/internal/helpers"
)

func sharedWidget(kind string) bool { return kind == "stats" || kind == "calendar" }

func freshStatsSnapshot(ctx context.Context, h *helpers.H, integrationID string) (map[string]any, error) {
	input := map[string]any{"integrationId": integrationID}
	value, err := apiKeyProcedure(ctx, h, "widget.stats.snapshot", input)
	if err != nil {
		return nil, err
	}
	before, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("Homarr did not return a Stats snapshot")
	}
	previous, present := before["updatedAt"]
	timestamp, numeric := previous.(float64)
	if !present || previous != nil && (!numeric || timestamp <= 0) {
		return nil, errors.New("Homarr did not return a valid Stats refresh timestamp")
	}
	input["force"] = true
	value, err = apiKeyWrite(ctx, h, "widget.stats.refresh", input)
	if err != nil {
		return nil, err
	}
	after, ok := value.(map[string]any)
	if !ok || after["error"] != false || after["stale"] != false {
		return nil, errors.New("Homarr Stats refresh failed; retry self-host setup homarr")
	}
	updated, ok := after["updatedAt"].(float64)
	if !ok || updated <= timestamp {
		return nil, errors.New("Homarr Stats refresh did not advance; retry self-host setup homarr")
	}
	values, ok := after["values"].(map[string]any)
	if !ok {
		return nil, errors.New("Homarr did not return refreshed Stats values")
	}
	return values, nil
}

func (t target) verifyData(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if t.verify == nil {
		return nil
	}
	if err := t.verify(ctx, from, to, integrationID); err != nil {
		return err
	}
	for _, w := range t.widgets {
		if w.kind != "stats" || len(w.metrics) == 0 {
			continue
		}
		values, err := freshStatsSnapshot(ctx, from, integrationID)
		if err != nil {
			return err
		}
		for _, metric := range w.metrics {
			if values[metric] == nil {
				return fmt.Errorf("Homarr did not return refreshed %s Stats; retry self-host setup homarr", metric)
			}
		}
	}
	return nil
}

// Ownership stays per integration, even when several integrations share an item.
func allOwnedWidgets(h *helpers.H) map[string]bool {
	owned := map[string]bool{}
	for _, t := range targets() {
		id := h.Secret(h.Key("linked_" + t.id))
		for itemID, yes := range ownedWidgets(h, id) {
			if yes {
				owned[itemID] = true
			}
		}
	}
	return owned
}

func sharedWidgetCurrent(h *helpers.H, current map[string]any, w widget, integrationID string) bool {
	owned := allOwnedWidgets(h)
	count := 0
	found := false
	for _, item := range itemsOf(current) {
		if stringField(item, "kind") != w.kind || !owned[stringField(item, "id")] {
			continue
		}
		count++
		if wiredTo(item, w.kind, integrationID) {
			found = widgetCurrent(item, w, integrationID) && !smallSharedWidget(current, item)
		}
	}
	// An explicitly unowned widget is left alone.
	if count == 0 {
		return hasWidget(itemsOf(current), w.kind, integrationID)
	}
	return count == 1 && found
}

func smallSharedWidget(current, item map[string]any) bool {
	if size, ok := item["size"].(map[string]any); ok {
		return gridNumber(size, "width") < 4 || gridNumber(size, "height") < 3
	}
	layouts, _ := item["layouts"].([]any)
	for _, raw := range layouts {
		layout, _ := raw.(map[string]any)
		width := 4
		if columns := placementColumns(current, layout); columns > 0 {
			width = min(width, columns)
		}
		if gridNumber(layout, "width") < width || gridNumber(layout, "height") < 3 {
			return true
		}
	}
	return false
}

func ensureSharedWidget(ctx context.Context, h *helpers.H, w widget, integrationID string, owned map[string]bool) error {
	current, err := board(ctx, h)
	if err != nil {
		return err
	}
	items := itemsOf(current)
	// Adopt only complete legacy generated sets, using the existing conservative gate.
	for _, t := range targets() {
		id := h.Secret(h.Key("linked_" + t.id))
		if id != "" && id != integrationID && h.Secret(h.Key("widgets_"+id)) == "" {
			if _, err := widgetOwnership(h, id, t.widgets, items); err != nil {
				return err
			}
		}
	}
	allOwned := allOwnedWidgets(h)
	for id, yes := range owned {
		if yes {
			allOwned[id] = true
		}
	}
	var shared map[string]any
	removed := map[string]bool{}
	kept := make([]map[string]any, 0, len(items))
	ids := []any{}
	entries := []any{}
	seenIDs := map[string]bool{}
	seenEntries := map[string]bool{}
	seenEntryIDs := map[string]bool{}
	collect := func(item map[string]any, defaults bool) {
		integrationIDs, _ := item["integrationIds"].([]any)
		for _, raw := range integrationIDs {
			id, _ := raw.(string)
			if id != "" && !seenIDs[id] {
				ids = append(ids, id)
				seenIDs[id] = true
			}
		}
		options, _ := item["options"].(map[string]any)
		oldEntries, _ := options["entries"].([]any)
		for _, raw := range oldEntries {
			entry, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			key := stringField(entry, "integrationId") + ":" + stringField(entry, "metric")
			if defaults && seenEntries[key] {
				continue
			}
			// Old generated IDs collided across integrations. Keep custom IDs,
			// labels and display options, including repeated custom metrics.
			id := stringField(entry, "id")
			if id == statsEntryID(stringField(entry, "metric")) || id == "" {
				entry["id"] = statsEntryID(key)
			}
			id = stringField(entry, "id")
			if !seenEntryIDs[id] {
				entries = append(entries, entry)
				seenEntryIDs[id] = true
			}
			seenEntries[key] = true
		}
	}
	for _, item := range items {
		if stringField(item, "kind") != w.kind || !allOwned[stringField(item, "id")] {
			kept = append(kept, item)
			continue
		}
		collect(item, false)
		if shared == nil {
			shared = item
			kept = append(kept, item)
		} else {
			removed[stringField(item, "id")] = true
		}
	}
	if shared == nil && hasWidget(items, w.kind, integrationID) {
		return nil
	}
	collect(map[string]any{"integrationIds": []any{integrationID}, "options": widgetOptions(w, integrationID)}, true)
	if shared == nil {
		options := w.options
		if w.kind == "stats" {
			options = map[string]any{"entries": entries}
		}
		id, err := addItemID(ctx, h, map[string]any{
			"boardId": stringField(current, "id"), "kind": w.kind, "options": options,
			"size": widgetInitialSize(w.kind), "integrationIds": ids,
		})
		if err != nil {
			return err
		}
		shared = map[string]any{"id": id}
	} else {
		shared["integrationIds"] = ids
		if w.kind == "stats" {
			options, _ := shared["options"].(map[string]any)
			if options == nil {
				options = map[string]any{}
			}
			options["entries"] = entries
			shared["options"] = options
		}
		if smallSharedWidget(current, shared) {
			resizeItem(current, shared, kept, 4, 3, true)
		}
		if err := saveItems(ctx, h, current, kept); err != nil {
			return err
		}
	}
	for _, raw := range ids {
		id, _ := raw.(string)
		ownership := ownedWidgets(h, id)
		for removedID := range removed {
			delete(ownership, removedID)
		}
		ownership[stringField(shared, "id")] = true
		data, _ := json.Marshal(ownership)
		if err := h.SetSecret(h.Key("widgets_"+id), string(data)); err != nil {
			return err
		}
		if id == integrationID {
			for removedID := range removed {
				delete(owned, removedID)
			}
			owned[stringField(shared, "id")] = true
		}
	}
	return nil
}

func removeWidgetIntegration(item map[string]any, integrationID string) {
	ids, _ := item["integrationIds"].([]any)
	keptIDs := []any{}
	for _, id := range ids {
		if id != integrationID {
			keptIDs = append(keptIDs, id)
		}
	}
	item["integrationIds"] = keptIDs
	if stringField(item, "kind") == "stats" {
		options, _ := item["options"].(map[string]any)
		entries, _ := options["entries"].([]any)
		keptEntries := []any{}
		for _, raw := range entries {
			entry, _ := raw.(map[string]any)
			if stringField(entry, "integrationId") != integrationID {
				keptEntries = append(keptEntries, raw)
			}
		}
		if options != nil {
			options["entries"] = keptEntries
		}
	}
}

func saveItems(ctx context.Context, h *helpers.H, current map[string]any, items []map[string]any) error {
	_, err := apiKeyWrite(ctx, h, "board.saveBoard", map[string]any{
		"id": stringField(current, "id"), "sections": current["sections"], "items": items,
	})
	return err
}
