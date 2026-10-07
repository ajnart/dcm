//go:build e2e

package e2e

import (
	"fmt"
	"strings"
	"testing"
)

// The public API shape retains upstream bookmarks and general widgets beside
// the CLI's managed inventory. No runtime data or credentials are used.
// Seed expectations come from Homarr image revision
// eb1d449dca35991013843683bee5aafd53a99cc0: db/migrations/seed.ts,
// db/queries/widget-placement.ts and definitions/src/widget-integration-map.ts.
func hfSeededInventoryFixture() hfInventory {
	inv := hfInventory{Board: hfBoard{ID: "home", Name: "Home"}}
	seeds := []struct{ name, href string }{
		{"Homarr Docs", "https://homarr.dev/docs/getting-started"},
		{"Homarr GitHub", "https://github.com/homarr-labs/homarr"},
		{"Help Translate", "https://homarr.dev/docs/community/translations"},
		{"Support Homarr", "https://opencollective.com/homarr"},
	}
	seedIDs := []any{}
	for i, seed := range seeds {
		id := fmt.Sprintf("seed-%d", i)
		inv.Apps = append(inv.Apps, hfApp{ID: id, Name: seed.name, Href: seed.href})
		inv.Board.Items = append(inv.Board.Items, hfItem{ID: "tile-" + id, Kind: "app", Options: map[string]any{"appId": id, "openInNewTab": true, "showTitle": true}})
		seedIDs = append(seedIDs, id)
	}
	inv.Board.Items = append(inv.Board.Items,
		hfItem{ID: "clock", Kind: "clock", Options: map[string]any{}},
		hfItem{ID: "weather", Kind: "weather", Options: map[string]any{"showHumidity": false, "showCity": false, "hasForecast": false}},
		hfItem{ID: "bookmarks", Kind: "bookmarks", Options: map[string]any{"title": "Useful Links", "layout": "grid", "openNewTab": true, "items": seedIDs}},
	)
	description, ping := "self-host tile:ntfy", "http://ntfy:80"
	inv.Apps = append(inv.Apps, hfApp{ID: "owned-ntfy", Name: "ntfy", Href: "http://127.0.0.1:8080", Description: &description, PingURL: &ping})
	inv.Integrations = []hfIntegration{{ID: "integration-ntfy", Kind: "ntfy"}}
	inv.Board.Items = append(inv.Board.Items,
		hfItem{ID: "tile-ntfy", Kind: "app", Options: map[string]any{"appId": "owned-ntfy", "openInNewTab": true, "showTitle": true}},
		hfItem{ID: "notifications", Kind: "notifications", IntegrationIDs: []string{"integration-ntfy"}},
		hfItem{ID: "stats", Kind: "stats", IntegrationIDs: []string{"integration-ntfy"}, Options: map[string]any{"entries": []any{map[string]any{
			"id": "auto-stack-f5cccfb737512bedd4f2e39e7d72425a", "metric": "messages", "integrationId": "integration-ntfy", "label": "", "hidden": false, "compact": false,
		}}}},
		hfItem{ID: "notebook", Kind: "notebook", Options: map[string]any{"content": "Your homelab at a glance ntfy http://127.0.0.1:8080"}},
	)
	return inv
}

// Owning links.go declares messages for ntfy and sessions for Jellyfin. These
// literal entry IDs are the documented auto-stack + truncated SHA256 contract.
func hfStatsInventoryFixture(kind string) hfInventory {
	inv := hfSeededInventoryFixture()
	if kind == "ntfy" {
		return inv
	}
	description, ping := "self-host tile:jellyfin", "http://jellyfin:8096"
	inv.Apps[4] = hfApp{ID: "owned-jellyfin", Name: "Jellyfin", Href: "http://127.0.0.1:8080", Description: &description, PingURL: &ping}
	inv.Integrations[0] = hfIntegration{ID: "integration-jellyfin", Kind: "jellyfin"}
	inv.Board.Items[7].Options["appId"] = "owned-jellyfin"
	inv.Board.Items[8].Kind = "mediaServer"
	inv.Board.Items[8].IntegrationIDs = []string{"integration-jellyfin"}
	inv.Board.Items[9].IntegrationIDs = []string{"integration-jellyfin"}
	inv.Board.Items[9].Options = map[string]any{"entries": []any{map[string]any{
		"id": "auto-stack-1225ae6c1ae69dcb4ee4781b703e1220", "metric": "sessions", "integrationId": "integration-jellyfin", "label": "", "hidden": false, "compact": false,
	}}}
	inv.Board.Items[10].Options["content"] = strings.ReplaceAll(inv.Board.Items[10].Options["content"].(string), "ntfy", "Jellyfin")
	inv.Board.Items = append(inv.Board.Items, hfItem{ID: "releases", Kind: "mediaReleases", IntegrationIDs: []string{"integration-jellyfin"}})
	return inv
}

func TestHomarrInventoryRequiresUsefulGeneratedStats(t *testing.T) {
	for _, kind := range []string{"ntfy", "jellyfin"} {
		inv := hfStatsInventoryFixture(kind)
		if err := inv.validate(map[string]int{kind: 8080}, nil, []string{kind}); err != nil {
			t.Fatal(err)
		}
		for _, tc := range []struct {
			name   string
			mutate func(*hfItem)
		}{
			{"blank", func(item *hfItem) { item.Options = nil }},
			{"empty", func(item *hfItem) { item.Options["entries"] = []any{} }},
			{"malformed", func(item *hfItem) { item.Options["entries"] = []any{"invalid"} }},
			{"wrong metric", func(item *hfItem) { item.Options["entries"].([]any)[0].(map[string]any)["metric"] = "unconfigured" }},
			{"wrong integration", func(item *hfItem) {
				item.Options["entries"].([]any)[0].(map[string]any)["integrationId"] = "unconfigured"
			}},
			{"wrong id", func(item *hfItem) { item.Options["entries"].([]any)[0].(map[string]any)["id"] = "unconfigured" }},
			{"hidden", func(item *hfItem) { item.Options["entries"].([]any)[0].(map[string]any)["hidden"] = true }},
			{"compact", func(item *hfItem) { item.Options["entries"].([]any)[0].(map[string]any)["compact"] = true }},
			{"missing label", func(item *hfItem) { delete(item.Options["entries"].([]any)[0].(map[string]any), "label") }},
			{"duplicate", func(item *hfItem) {
				entries := item.Options["entries"].([]any)
				item.Options["entries"] = append(entries, entries[0])
			}},
		} {
			t.Run(kind+"/"+tc.name, func(t *testing.T) {
				inv := hfStatsInventoryFixture(kind)
				tc.mutate(&inv.Board.Items[9])
				if inv.validate(map[string]int{kind: 8080}, nil, []string{kind}) == nil {
					t.Fatal("unusable generated stats configuration accepted")
				}
			})
		}
	}
}

func TestHomarrInventoryRequiresManagedTileFlags(t *testing.T) {
	for _, flag := range []string{"openInNewTab", "showTitle"} {
		for _, value := range []any{nil, false, "true"} {
			t.Run(fmt.Sprintf("%s-%v", flag, value), func(t *testing.T) {
				inv := hfSeededInventoryFixture()
				inv.Board.Items[7].Options[flag] = value
				if inv.validate(map[string]int{"ntfy": 8080}, nil, []string{"ntfy"}) == nil {
					t.Fatal("managed tile without the generated flags accepted")
				}
			})
		}
	}
}

func TestHomarrInventoryAcceptsExactUpstreamSeedBoard(t *testing.T) {
	inv := hfSeededInventoryFixture()
	if err := inv.validate(map[string]int{"ntfy": 8080}, nil, []string{"ntfy"}); err != nil {
		t.Fatal(err)
	}
}

func TestHomarrInventoryRejectsUnexpectedOrMalformedBoardItems(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*hfInventory)
	}{
		{"orphan tile", func(inv *hfInventory) { inv.Board.Items[0].Options["appId"] = "unknown" }},
		{"duplicate seed tile", func(inv *hfInventory) {
			item := inv.Board.Items[0]
			item.ID = "extra"
			inv.Board.Items = append(inv.Board.Items, item)
		}},
		{"duplicate managed tile", func(inv *hfInventory) {
			item := inv.Board.Items[7]
			item.ID = "extra"
			inv.Board.Items = append(inv.Board.Items, item)
		}},
		{"malformed seed tile", func(inv *hfInventory) { inv.Board.Items[0].Options["showTitle"] = false }},
		{"malformed seed record", func(inv *hfInventory) { inv.Apps[0].Href = "https://example.invalid" }},
		{"unknown widget", func(inv *hfInventory) { inv.Board.Items = append(inv.Board.Items, hfItem{ID: "extra", Kind: "timer"}) }},
		{"duplicate default widget", func(inv *hfInventory) {
			item := inv.Board.Items[4]
			item.ID = "extra"
			inv.Board.Items = append(inv.Board.Items, item)
		}},
		{"malformed default widget", func(inv *hfInventory) { inv.Board.Items[5].Options["showCity"] = true }},
		{"malformed bookmarks", func(inv *hfInventory) { inv.Board.Items[6].Options["items"] = []any{"unknown"} }},
		{"unowned notebook", func(inv *hfInventory) {
			inv.Board.Items = append(inv.Board.Items, hfItem{ID: "extra", Kind: "notebook", Options: map[string]any{"content": "Welcome"}})
		}},
		{"duplicate item identity", func(inv *hfInventory) { inv.Board.Items[1].ID = inv.Board.Items[0].ID }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			inv := hfSeededInventoryFixture()
			tc.mutate(&inv)
			if inv.validate(map[string]int{"ntfy": 8080}, nil, []string{"ntfy"}) == nil {
				t.Fatal("unexpected board item accepted")
			}
		})
	}
}
