package arr

import (
	"context"
	"fmt"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/servarr"
	"github.com/ajnart/self-host/internal/helpers"
)

// object is a Servarr resource (download client, application) that keeps
// every field the schema gave it; only named fields are changed.
type object map[string]any

// setField sets the value of the field called name.
func (o object) setField(name string, value any) error {
	fields, _ := o["fields"].([]any)
	for _, f := range fields {
		if field, _ := f.(map[string]any); field["name"] == name {
			field["value"] = value
			return nil
		}
	}
	return fmt.Errorf("the schema has no field %q", name)
}

func (o object) field(name string) any {
	fields, _ := o["fields"].([]any)
	for _, f := range fields {
		if field, _ := f.(map[string]any); field["name"] == name {
			return field["value"]
		}
	}
	return nil
}

func list(ctx context.Context, h *helpers.H, api, path string) ([]object, error) {
	resp, err := h.Expect(ctx, servarr.Request(h, api, helpers.Request{Path: path}))
	if err != nil {
		return nil, err
	}
	var items []object
	return items, resp.Decode(&items)
}

// schemaFor returns the new-resource template of an implementation.
func schemaFor(ctx context.Context, h *helpers.H, api, path, implementation string) (object, error) {
	items, err := list(ctx, h, api, path+"/schema")
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if item["implementation"] == implementation {
			return item, nil
		}
	}
	return nil, fmt.Errorf("%s has no %s implementation", h.App, implementation)
}

func create(ctx context.Context, h *helpers.H, api, path string, item object) error {
	_, err := h.Expect(ctx, servarr.Request(h, api, helpers.Request{Method: "POST", Path: path, JSON: item}))
	return err
}

// owned is the resources of the list at path that match accepts.
func owned(api, path string, match func(to *helpers.H) func(object) bool) app.Owned {
	return app.Owned{
		Find: func(ctx context.Context, from, to *helpers.H) ([]string, error) {
			items, err := list(ctx, from, api, path)
			if err != nil {
				return nil, err
			}
			var ids []string
			for _, item := range items {
				if match(to)(item) {
					id, _ := item["id"].(float64)
					ids = append(ids, strconv.Itoa(int(id)))
				}
			}
			return ids, nil
		},
		Delete: func(ctx context.Context, from, _ *helpers.H, id string) error {
			_, err := from.Expect(ctx, servarr.Request(from, api, helpers.Request{Method: "DELETE", Path: path + "/" + id}))
			return err
		},
	}
}

// field is one schema field to set, kept in a slice so errors come out in a
// stable order.
type field struct {
	name  string
	value any
}

// isQBittorrent matches the download client this Link manages: qBittorrent
// reached by its Compose service name, never a client the user added for
// another host.
func isQBittorrent(item object) bool {
	return item["implementation"] == "QBittorrent" && item.field("host") == "qbittorrent"
}

// downloadClientLink makes Sonarr or Radarr send downloads to qBittorrent,
// reached by its Compose service name and the Admin login.
func downloadClientLink(categoryField, category string) app.Link {
	const target = "qbittorrent"
	clients := owned(apiV3, "/downloadclient", func(*helpers.H) func(object) bool { return isQBittorrent })
	return app.NewOwnedLink("link-qbittorrent", target, "download client: qBittorrent", clients,
		app.LinkStep{
			Message: "use qBittorrent as the download client",
			Do: func(ctx context.Context, from, to *helpers.H) error {
				client, err := schemaFor(ctx, from, apiV3, "/downloadclient", "QBittorrent")
				if err != nil {
					return err
				}
				client["name"], client["enable"] = "qBittorrent", true
				for _, f := range []field{
					{"host", target}, {"port", to.Port},
					{"username", from.AdminUser()}, {"password", from.AdminPassword()},
					{categoryField, category},
				} {
					name, value := f.name, f.value
					if err := client.setField(name, value); err != nil {
						return err
					}
				}
				return create(ctx, from, apiV3, "/downloadclient", client)
			},
			Hint: func(from, to *helpers.H) string {
				return "Open " + from.URL + " > Settings > Download Clients > add qBittorrent with host " + target +
					", port " + strconv.Itoa(to.Port) + " and the Admin login."
			},
		},
		app.LinkStep{
			Message: "remove the qBittorrent download client",
			Hint: func(from, _ *helpers.H) string {
				return "Open " + from.URL + " > Settings > Download Clients and delete qBittorrent."
			},
		})
}

// applicationImplementations are the Apps Prowlarr syncs indexers to.
var applicationImplementations = map[string]string{
	"sonarr": "Sonarr",
	"radarr": "Radarr",
}

// applicationLink makes Prowlarr sync indexers to Sonarr or Radarr, which it
// reaches by Compose service name with their API key.
func applicationLink(target string) app.Link {
	implementation := applicationImplementations[target]
	points := func(to *helpers.H) func(object) bool {
		return func(item object) bool {
			return item["implementation"] == implementation && item.field("baseUrl") == to.InternalURL()
		}
	}
	return app.NewOwnedLink("link-"+target, target, "sync indexers to "+implementation, owned(apiV1, "/applications", points),
		app.LinkStep{
			Message: "sync indexers to " + implementation,
			Do: func(ctx context.Context, from, to *helpers.H) error {
				application, err := schemaFor(ctx, from, apiV1, "/applications", implementation)
				if err != nil {
					return err
				}
				application["name"], application["syncLevel"] = implementation, "fullSync"
				for _, f := range []field{
					{"prowlarrUrl", from.InternalURL()}, {"baseUrl", to.InternalURL()}, {"apiKey", to.Secret(to.Key("api_key"))},
				} {
					name, value := f.name, f.value
					if err := application.setField(name, value); err != nil {
						return err
					}
				}
				return create(ctx, from, apiV1, "/applications", application)
			},
			Hint: func(from, to *helpers.H) string {
				return "Open " + from.URL + " > Settings > Apps > add " + implementation + " with Prowlarr server " +
					from.InternalURL() + ", server " + to.InternalURL() + " and its API key."
			},
		},
		app.LinkStep{
			Message: "stop syncing indexers to " + implementation,
			Hint: func(from, _ *helpers.H) string {
				return "Open " + from.URL + " > Settings > Apps and delete " + implementation + "."
			},
		})
}
