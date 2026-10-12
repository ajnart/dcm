package homarr

import (
	"context"
	"fmt"
	"strings"

	"github.com/ajnart/self-host/internal/helpers"
)

const installedTileMarker = "self-host tile:"
const retainedTileMarker = "self-host retained tile:"

// Generic tiles advertise navigation only. Dedicated integrations and widgets
// remain the responsibility of the App's Links.
func genericApps(ctx context.Context, h *helpers.H) (map[string]helpers.InstalledApp, error) {
	installed, err := h.InstalledApps(ctx)
	if err != nil {
		return nil, err
	}
	desired := map[string]helpers.InstalledApp{}
	for _, item := range installed {
		if item.ID == "homarr" || item.URL == "" {
			continue
		}
		desired[installedTileMarker+item.ID] = item
	}
	return desired, nil
}

func installedTiles(ctx context.Context, h *helpers.H, apply bool) (bool, error) {
	desired, err := genericApps(ctx, h)
	if err != nil {
		return false, err
	}
	apps, err := listApps(ctx, h)
	if err != nil {
		return false, err
	}
	current, err := board(ctx, h)
	if err != nil {
		return false, err
	}
	complete := true
	for _, id := range managedAppIDs(h) {
		found := false
		for _, existing := range apps {
			if appID(existing) == id {
				found = true
				break
			}
		}
		if found || !hasTile(itemsOf(current), id) {
			continue
		}
		complete = false
		if apply {
			if err := removeAppTiles(ctx, h, id); err != nil {
				return false, err
			}
		}
	}
	for _, existing := range apps {
		marker := stringField(existing, "description")
		adopt := false
		if !strings.HasPrefix(marker, installedTileMarker) {
			if marker != "" {
				continue
			}
			for _, t := range existingTargets() {
				candidate, wanted := desired[installedTileMarker+t.id]
				if !wanted || stringField(existing, "name") != t.name || stringField(existing, "pingUrl") != genericPing(candidate) {
					continue
				}
				matches := 0
				for _, other := range apps {
					if stringField(other, "name") == t.name && stringField(other, "pingUrl") == genericPing(candidate) {
						matches++
					}
				}
				if matches != 1 {
					return false, fmt.Errorf("Homarr has ambiguous %s App records; keep the owned record, mark its description %q, then run self-host setup homarr", t.name, installedTileMarker+t.id)
				}
				marker = installedTileMarker + t.id
				adopt = true
				break
			}
			if !adopt {
				continue
			}
		}
		item, wanted := desired[marker]
		id := appID(existing)
		if !wanted {
			complete = false
			if apply {
				if err := removeAppTiles(ctx, h, id); err != nil {
					return false, err
				}
				if _, err := h.Expect(ctx, helpers.Request{Method: "DELETE", Path: "/api/apps/" + id, Header: apiKeyHeader(h)}); err != nil {
					return false, err
				}
			}
			continue
		}
		if apply {
			if err := rememberAppID(h, item.ID, id); err != nil {
				return false, err
			}
		}
		if adopt || stringField(existing, "href") != item.URL {
			complete = false
			if apply {
				if _, err := h.Expect(ctx, helpers.Request{Method: "PATCH", Path: "/api/apps/" + id, Header: apiKeyHeader(h), JSON: map[string]any{
					"name": item.Name, "description": marker, "iconUrl": existing["iconUrl"], "href": item.URL, "pingUrl": genericPing(item),
				}}); err != nil {
					return false, err
				}
			}
		}
		if !hasTile(itemsOf(current), id) {
			complete = false
			if apply {
				if err := addTile(ctx, h, stringField(current, "id"), id); err != nil {
					return false, err
				}
			}
		}
		delete(desired, marker)
	}
	for marker, item := range desired {
		complete = false
		if !apply {
			continue
		}
		resp, err := h.Expect(ctx, helpers.Request{Method: "POST", Path: "/api/apps", Header: apiKeyHeader(h), JSON: map[string]any{
			"name": item.Name, "description": marker, "iconUrl": iconURL(item.ID), "href": item.URL, "pingUrl": genericPing(item),
		}})
		if err != nil {
			return false, err
		}
		var created map[string]any
		if err := resp.Decode(&created); err != nil {
			return false, err
		}
		id := appID(created)
		if id == "" {
			return false, fmt.Errorf("Homarr did not return the %s tile ID; run self-host setup homarr", item.Name)
		}
		if err := rememberAppID(h, item.ID, id); err != nil {
			return false, err
		}
		if err := addTile(ctx, h, stringField(current, "id"), id); err != nil {
			return false, err
		}
	}
	return complete, nil
}

func genericPing(item helpers.InstalledApp) string {
	if item.Service != "" && item.ContainerPort > 0 {
		return fmt.Sprintf("http://%s:%d", item.Service, item.ContainerPort)
	}
	return item.URL
}
