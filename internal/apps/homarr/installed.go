package homarr

import (
	"context"
	"errors"
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
	remaining := map[string]helpers.InstalledApp{}
	counts := map[string]int{}
	inspectReferences := false
	for marker, item := range desired {
		remaining[marker] = item
	}
	for _, existing := range apps {
		marker := stringField(existing, "description")
		if !strings.HasPrefix(marker, installedTileMarker) {
			continue
		}
		counts[marker]++
		if _, wanted := desired[marker]; !wanted || counts[marker] > 1 {
			inspectReferences = true
		}
	}
	referenced := map[string]bool{}
	linkedApps := map[string]string{}
	if inspectReferences {
		referenced, linkedApps, err = installedAppReferences(ctx, h)
		if err != nil {
			return false, err
		}
	}
	canonical := map[string]string{}
	recorded := managedAppIDs(h)
	for marker, item := range desired {
		preferred := linkedApps[item.ID]
		if preferred == "" {
			preferred = recorded[item.ID]
		}
		for _, existing := range apps {
			if stringField(existing, "description") != marker {
				continue
			}
			id := appID(existing)
			if canonical[marker] == "" || id == preferred {
				canonical[marker] = id
			}
			if id == preferred {
				break
			}
		}
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
		duplicate := wanted && canonical[marker] != "" && canonical[marker] != id
		if !wanted || duplicate {
			complete = false
			if apply {
				if err := retireInstalledApp(ctx, h, existing, referenced[id], duplicate); err != nil {
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
					"name": existing["name"], "description": marker, "iconUrl": existing["iconUrl"], "href": item.URL, "pingUrl": existing["pingUrl"],
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
		delete(remaining, marker)
	}
	for marker, item := range remaining {
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

func installedAppReferences(ctx context.Context, h *helpers.H) (map[string]bool, map[string]string, error) {
	integrations, err := listIntegrations(ctx, h)
	if err != nil {
		return nil, nil, err
	}
	referenced := map[string]bool{}
	owned := map[string]string{}
	for _, integration := range integrations {
		id := stringField(integration, "id")
		value, err := apiKeyProcedure(ctx, h, "integration.byId", map[string]any{"id": id})
		if err != nil {
			return nil, nil, err
		}
		detail, ok := value.(map[string]any)
		if !ok || stringField(detail, "id") != id {
			return nil, nil, errors.New("Homarr did not return integration App associations; preserve its App records and retry self-host setup homarr")
		}
		if _, present := detail["app"]; !present {
			return nil, nil, errors.New("Homarr omitted an integration App association; preserve its App records and retry self-host setup homarr")
		}
		if detail["app"] == nil {
			continue
		}
		linked, _ := detail["app"].(map[string]any)
		appID := stringField(linked, "id")
		if appID == "" {
			return nil, nil, errors.New("Homarr returned an invalid integration App association; preserve its App records and retry self-host setup homarr")
		}
		referenced[appID] = true
		for _, target := range targets() {
			if id == h.Secret(h.Key("linked_"+target.id)) && stringField(detail, "kind") == target.kind {
				owned[target.id] = appID
			}
		}
	}
	return referenced, owned, nil
}

func retireInstalledApp(ctx context.Context, h *helpers.H, existing map[string]any, referenced, duplicate bool) error {
	id := appID(existing)
	if !referenced {
		response, err := h.Expect(ctx, helpers.Request{Path: "/api/boards", Header: apiKeyHeader(h)})
		if err != nil {
			return err
		}
		var boards []map[string]any
		if err := response.Decode(&boards); err != nil {
			return err
		}
		for _, candidate := range boards {
			name := stringField(candidate, "name")
			if name == "Home" && !duplicate {
				continue
			}
			value, err := apiKeyProcedure(ctx, h, "board.getBoardByName", map[string]any{"name": name})
			if err != nil {
				return err
			}
			current, ok := value.(map[string]any)
			if !ok {
				return errors.New("Homarr did not return App tile references; preserve its App records and retry self-host setup homarr")
			}
			if hasTile(itemsOf(current), id) {
				referenced = true
				break
			}
		}
	}
	if referenced {
		marker := strings.TrimPrefix(stringField(existing, "description"), installedTileMarker)
		_, err := h.Expect(ctx, helpers.Request{Method: "PATCH", Path: "/api/apps/" + id, Header: apiKeyHeader(h), JSON: map[string]any{
			"name": existing["name"], "description": retainedTileMarker + marker, "iconUrl": existing["iconUrl"], "href": existing["href"], "pingUrl": existing["pingUrl"],
		}})
		return err
	}
	if err := removeAppTiles(ctx, h, id); err != nil {
		return err
	}
	_, err := h.Expect(ctx, helpers.Request{Method: "DELETE", Path: "/api/apps/" + id, Header: apiKeyHeader(h)})
	return err
}

func genericPing(item helpers.InstalledApp) string {
	if item.Service != "" && item.ContainerPort > 0 {
		return fmt.Sprintf("http://%s:%d", item.Service, item.ContainerPort)
	}
	return item.URL
}
