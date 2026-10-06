package arr

import (
	"context"
	"fmt"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
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
	resp, err := h.Expect(ctx, apiRequest(h, api, helpers.Request{Path: path}))
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
	_, err := h.Expect(ctx, apiRequest(h, api, helpers.Request{Method: "POST", Path: path, JSON: item}))
	return err
}

// remove deletes every resource of the list at path that match accepts.
func remove(ctx context.Context, h *helpers.H, api, path string, match func(object) bool) error {
	items, err := list(ctx, h, api, path)
	if err != nil {
		return err
	}
	for _, item := range items {
		if !match(item) {
			continue
		}
		id, _ := item["id"].(float64)
		req := apiRequest(h, api, helpers.Request{Method: "DELETE", Path: fmt.Sprintf("%s/%d", path, int(id))})
		if _, err := h.Expect(ctx, req); err != nil {
			return err
		}
	}
	return nil
}

func exists(ctx context.Context, h *helpers.H, api, path string, match func(object) bool) (bool, error) {
	items, err := list(ctx, h, api, path)
	if err != nil {
		return false, err
	}
	for _, item := range items {
		if match(item) {
			return true, nil
		}
	}
	return false, nil
}

const (
	v3 = "/api/v3"
	v1 = "/api/v1"
)

// isQBittorrent matches the download client this Link manages: qBittorrent
// reached by its Compose service name, never a client the user added for
// another host.
func isQBittorrent(item object) bool {
	return item["implementation"] == "QBittorrent" && item.field("host") == "qbittorrent"
}

// downloadClientLink makes Sonarr or Radarr send downloads to qBittorrent,
// reached by its Compose service name and the Admin login.
func downloadClientLink(categoryField, category string) app.Link {
	const id, target = "link-qbittorrent", "qbittorrent"
	return app.Link{
		ID:     id,
		Target: target,
		Title:  "download client: qBittorrent",
		Apply: func(ctx context.Context, from, to *helpers.H) error {
			return from.Step(ctx, id, "use qBittorrent as the download client", helpers.StepSpec{
				Check: func(ctx context.Context) (bool, error) {
					return exists(ctx, from, v3, "/downloadclient", isQBittorrent)
				},
				Do: func(ctx context.Context) error {
					client, err := schemaFor(ctx, from, v3, "/downloadclient", "QBittorrent")
					if err != nil {
						return err
					}
					client["name"], client["enable"] = "qBittorrent", true
					for name, value := range map[string]any{
						"host": target, "port": to.Port,
						"username": from.AdminUser(), "password": from.AdminPassword(),
						categoryField: category,
					} {
						if err := client.setField(name, value); err != nil {
							return err
						}
					}
					return create(ctx, from, v3, "/downloadclient", client)
				},
				Hint: "Open " + from.URL + " > Settings > Download Clients > add qBittorrent with host " + target +
					", port " + strconv.Itoa(to.Port) + " and the Admin login.",
				Credential: "admin",
			})
		},
		Remove: func(ctx context.Context, from, to *helpers.H) error {
			return from.Step(ctx, "un"+id, "remove the qBittorrent download client", helpers.StepSpec{
				Check: func(ctx context.Context) (bool, error) {
					found, err := exists(ctx, from, v3, "/downloadclient", isQBittorrent)
					return !found, err
				},
				Do:         func(ctx context.Context) error { return remove(ctx, from, v3, "/downloadclient", isQBittorrent) },
				Hint:       "Open " + from.URL + " > Settings > Download Clients and delete qBittorrent.",
				Credential: "admin",
			})
		},
	}
}

// applicationTargets are the Apps Prowlarr syncs indexers to.
var applicationTargets = map[string]struct{ implementation, baseURL string }{
	"sonarr": {"Sonarr", "http://sonarr:8989"},
	"radarr": {"Radarr", "http://radarr:7878"},
}

const prowlarrURL = "http://prowlarr:9696"

// applicationLink makes Prowlarr sync indexers to Sonarr or Radarr, which it
// reaches by Compose service name with their API key.
func applicationLink(target string) app.Link {
	t := applicationTargets[target]
	id := "link-" + target
	points := func(item object) bool {
		return item["implementation"] == t.implementation && item.field("baseUrl") == t.baseURL
	}
	return app.Link{
		ID:     id,
		Target: target,
		Title:  "sync indexers to " + t.implementation,
		Apply: func(ctx context.Context, from, to *helpers.H) error {
			return from.Step(ctx, id, "sync indexers to "+t.implementation, helpers.StepSpec{
				Check: func(ctx context.Context) (bool, error) { return exists(ctx, from, v1, "/applications", points) },
				Do: func(ctx context.Context) error {
					application, err := schemaFor(ctx, from, v1, "/applications", t.implementation)
					if err != nil {
						return err
					}
					application["name"], application["syncLevel"] = t.implementation, "fullSync"
					for name, value := range map[string]any{
						"prowlarrUrl": prowlarrURL, "baseUrl": t.baseURL, "apiKey": to.Secret(to.Key("api_key")),
					} {
						if err := application.setField(name, value); err != nil {
							return err
						}
					}
					return create(ctx, from, v1, "/applications", application)
				},
				Hint: "Open " + from.URL + " > Settings > Apps > add " + t.implementation + " with Prowlarr server " +
					prowlarrURL + ", server " + t.baseURL + " and its API key.",
				Credential: "admin",
			})
		},
		Remove: func(ctx context.Context, from, to *helpers.H) error {
			return from.Step(ctx, "un"+id, "stop syncing indexers to "+t.implementation, helpers.StepSpec{
				Check: func(ctx context.Context) (bool, error) {
					found, err := exists(ctx, from, v1, "/applications", points)
					return !found, err
				},
				Do:         func(ctx context.Context) error { return remove(ctx, from, v1, "/applications", points) },
				Hint:       "Open " + from.URL + " > Settings > Apps and delete " + t.implementation + ".",
				Credential: "admin",
			})
		},
	}
}
