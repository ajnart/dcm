package homarr

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ajnart/self-host/internal/helpers"
)

func sharedWidget(kind string) bool { return kind == "stats" || kind == "calendar" }

func freshStatsSnapshot(ctx context.Context, h *helpers.H, integrationID string) (map[string]any, error) {
	sample, err := refreshStatsSample(ctx, h, integrationID)
	return sample.values, err
}

func (t target) verifyData(ctx context.Context, from, to *helpers.H, integrationID string) error {
	if t.verify == nil {
		return nil
	}
	if err := t.verify(ctx, from, to, integrationID); err != nil {
		return err
	}
	if t.stats != nil {
		metrics := t.statsMetrics()
		if len(metrics) == 0 {
			return nil
		}
		sample, err := readStatsSample(ctx, from, integrationID, metrics)
		if err != nil {
			return err
		}
		return t.stats(sample)
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
	entries := []any{}
	for _, item := range itemsOf(current) {
		if stringField(item, "kind") != w.kind || !owned[stringField(item, "id")] {
			continue
		}
		count++
		if w.kind == "stats" {
			options, _ := item["options"].(map[string]any)
			partition, _ := options["entries"].([]any)
			if len(partition) > 100 || smallSharedWidget(current, item) {
				return false
			}
			if wiredTo(item, w.kind, integrationID) {
				entries = append(entries, partition...)
				found = true
			}
			continue
		}
		if wiredTo(item, w.kind, integrationID) {
			found = widgetCurrent(item, w, integrationID) && !smallSharedWidget(current, item)
		}
	}
	// An explicitly unowned widget is left alone.
	if count == 0 {
		return hasWidget(itemsOf(current), w.kind, integrationID)
	}
	if w.kind == "stats" {
		return found && widgetCurrent(map[string]any{"options": map[string]any{"entries": entries}}, w, integrationID)
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
	partitions := []map[string]any{}
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
		if w.kind == "stats" {
			partitions = append(partitions, item)
		}
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
	if w.kind == "stats" {
		return ensureStatsPartitions(ctx, h, current, partitions, ids, entries, integrationID, owned)
	}
	if shared == nil {
		options := w.options
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

// Homarr 2.4.1 accepts at most 100 entries per Stats item. Keep entry IDs and
// display options while spreading only recorded owned items across that limit.
func ensureStatsPartitions(ctx context.Context, h *helpers.H, current map[string]any, previous []map[string]any, ids, entries []any, integrationID string, owned map[string]bool) error {
	count := max(1, (len(entries)+99)/100)
	partitions := make([]map[string]any, 0, count)
	bindings := map[string]bool{}
	for index := 0; index < count; index++ {
		partitionEntries := entries[min(index*100, len(entries)):min((index+1)*100, len(entries))]
		partitionIDs := []any{}
		seen := map[string]bool{}
		for _, raw := range partitionEntries {
			entry, _ := raw.(map[string]any)
			id := stringField(entry, "integrationId")
			if id != "" && !seen[id] {
				partitionIDs = append(partitionIDs, id)
				seen[id], bindings[id] = true, true
			}
		}
		options := map[string]any{}
		var item map[string]any
		if index < len(previous) {
			item = previous[index]
		} else if len(previous) > 0 {
			item = map[string]any{"options": previous[0]["options"]}
		} else {
			item = map[string]any{}
		}
		existing, _ := item["options"].(map[string]any)
		for key, value := range existing {
			options[key] = value
		}
		options["entries"] = partitionEntries
		if index >= len(previous) {
			id, err := addItemID(ctx, h, map[string]any{
				"boardId": stringField(current, "id"), "kind": "stats", "options": options,
				"size": widgetInitialSize("stats"), "integrationIds": partitionIDs,
			})
			if err != nil {
				return err
			}
			item = map[string]any{"id": id, "kind": "stats"}
			// Record creation before the board save so a rejected save can retry
			// against this owned partition rather than leaving an unclaimed item.
			for _, raw := range partitionIDs {
				boundID, _ := raw.(string)
				ownership := ownedWidgets(h, boundID)
				ownership[id] = true
				data, _ := json.Marshal(ownership)
				if err := h.SetSecret(h.Key("widgets_"+boundID), string(data)); err != nil {
					return err
				}
				if boundID == integrationID {
					owned[id] = true
				}
			}
		}
		item["options"], item["integrationIds"] = options, partitionIDs
		partitions = append(partitions, item)
	}
	// Preserve selected bindings even when the person left them without entries.
	for _, raw := range ids {
		id, _ := raw.(string)
		if !bindings[id] {
			partitions[0]["integrationIds"] = append(partitions[0]["integrationIds"].([]any), raw)
		}
	}
	latest, err := board(ctx, h)
	if err != nil {
		return err
	}
	byID := map[string]map[string]any{}
	retired := map[string]bool{}
	for _, item := range previous {
		retired[stringField(item, "id")] = true
	}
	for _, item := range partitions {
		id := stringField(item, "id")
		byID[id] = item
		delete(retired, id)
	}
	kept := []map[string]any{}
	for _, item := range itemsOf(latest) {
		id := stringField(item, "id")
		if retired[id] {
			continue
		}
		if update, ok := byID[id]; ok {
			item["options"], item["integrationIds"] = update["options"], update["integrationIds"]
		}
		kept = append(kept, item)
	}
	for _, item := range kept {
		if byID[stringField(item, "id")] != nil && smallSharedWidget(latest, item) {
			resizeItem(latest, item, kept, 4, 3, true)
		}
	}
	if err := saveItems(ctx, h, latest, kept); err != nil {
		return err
	}
	for _, raw := range ids {
		id, _ := raw.(string)
		ownership := ownedWidgets(h, id)
		for _, item := range previous {
			delete(ownership, stringField(item, "id"))
		}
		for _, item := range partitions {
			if wiredTo(item, "stats", id) {
				ownership[stringField(item, "id")] = true
			}
		}
		data, _ := json.Marshal(ownership)
		if err := h.SetSecret(h.Key("widgets_"+id), string(data)); err != nil {
			return err
		}
		if id == integrationID {
			for _, item := range previous {
				delete(owned, stringField(item, "id"))
			}
			for itemID, yes := range ownership {
				owned[itemID] = yes
			}
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
