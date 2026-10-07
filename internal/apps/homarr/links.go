package homarr

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// secret is one integration credential: Homarr stores it encrypted under the
// exact kind string.
type secret struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

// target is one App Homarr links to: an app tile, and for most a dedicated
// integration with its connection secrets.
type target struct {
	id   string
	name string
	// kind is the Homarr integration kind; empty means tile only.
	kind     string
	internal func(to *helpers.H) string
	secrets  func(from, to *helpers.H) []secret
}

func fixed(u string) func(*helpers.H) string { return func(*helpers.H) string { return u } }

func apiKeySecret(_, to *helpers.H) []secret {
	return []secret{{Kind: "apiKey", Value: to.Secret(to.Key("api_key"))}}
}

// targets are the Apps Homarr supports here, in the order they are declared.
// Other Apps are reached by Compose service name, never localhost.
func targets() []target {
	return []target{
		{id: "sonarr", name: "Sonarr", kind: "sonarr", internal: fixed("http://sonarr:8989"), secrets: apiKeySecret},
		{id: "radarr", name: "Radarr", kind: "radarr", internal: fixed("http://radarr:7878"), secrets: apiKeySecret},
		{id: "prowlarr", name: "Prowlarr", kind: "prowlarr", internal: fixed("http://prowlarr:9696"), secrets: apiKeySecret},
		{id: "jellyfin", name: "Jellyfin", kind: "jellyfin", internal: fixed("http://jellyfin:8096"), secrets: apiKeySecret},
		{id: "seerr", name: "Seerr", kind: "seerr", internal: fixed("http://seerr:5055"), secrets: apiKeySecret},
		{
			id: "qbittorrent", name: "qBittorrent", kind: "qBittorrent",
			internal: func(to *helpers.H) string { return "http://qbittorrent:" + strconv.Itoa(to.Port) },
			secrets: func(from, _ *helpers.H) []secret {
				return []secret{{Kind: "username", Value: from.AdminUser()}, {Kind: "password", Value: from.AdminPassword()}}
			},
		},
		{id: "ntfy", name: "ntfy", internal: fixed("http://ntfy:80")},
		{id: "vaultwarden", name: "Vaultwarden", internal: fixed("http://vaultwarden:80")},
	}
}

func (App) Links() []app.Link {
	all := targets()
	links := make([]app.Link, 0, len(all))
	for _, t := range all {
		links = append(links, t.link())
	}
	return links
}

func iconURL(id string) string {
	return "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/" + id + ".svg"
}

func (t target) hint(from *helpers.H) string {
	if t.kind == "" {
		return "Open " + from.URL + "/manage/apps, add the " + t.name + " app tile, then place it on a board."
	}
	return "Open " + from.URL + "/manage/integrations to add the " + t.name + " integration and " +
		from.URL + "/manage/apps to add and place its app tile."
}

// apiKeyProcedure runs a tRPC call with the stored API key instead of a session.
func apiKeyProcedure(ctx context.Context, h *helpers.H, proc string, input any) (any, error) {
	if input == nil {
		resp, err := h.HTTP(ctx, helpers.Request{Path: "/api/trpc/" + proc, Header: apiKeyHeader(h)})
		if err != nil {
			return nil, err
		}
		return decodeProcedure(resp)
	}
	raw, err := json.Marshal(map[string]any{"json": input})
	if err != nil {
		return nil, err
	}
	path := "/api/trpc/" + proc + "?input=" + url.QueryEscape(string(raw))
	resp, err := h.HTTP(ctx, helpers.Request{Path: path, Header: apiKeyHeader(h)})
	if err != nil {
		return nil, err
	}
	return decodeProcedure(resp)
}

func apiKeyWrite(ctx context.Context, h *helpers.H, proc string, input any) (any, error) {
	req := helpers.Request{Method: "POST", Path: "/api/trpc/" + proc, Header: apiKeyHeader(h)}
	if input == nil {
		req.Body = []byte("{}")
		req.Header["Content-Type"] = "application/json"
	} else {
		req.JSON = map[string]any{"json": input}
	}
	resp, err := h.HTTP(ctx, req)
	if err != nil {
		return nil, err
	}
	return decodeProcedure(resp)
}

func stringField(record map[string]any, key string) string {
	value, _ := record[key].(string)
	return value
}

// appID reads the identifier Homarr uses for an app; POST returns both appId
// and id, GET returns id.
func appID(record map[string]any) string {
	if id := stringField(record, "appId"); id != "" {
		return id
	}
	return stringField(record, "id")
}

func listApps(ctx context.Context, h *helpers.H) ([]map[string]any, error) {
	resp, err := h.Expect(ctx, helpers.Request{Path: "/api/apps", Header: apiKeyHeader(h)})
	if err != nil {
		return nil, err
	}
	var apps []map[string]any
	return apps, resp.Decode(&apps)
}

func findApp(ctx context.Context, h *helpers.H, pingURL string) (string, bool, error) {
	apps, err := listApps(ctx, h)
	if err != nil {
		return "", false, err
	}
	for _, item := range apps {
		if stringField(item, "pingUrl") == pingURL {
			return appID(item), true, nil
		}
	}
	return "", false, nil
}

func listIntegrations(ctx context.Context, h *helpers.H) ([]map[string]any, error) {
	value, err := apiKeyProcedure(ctx, h, "integration.all", nil)
	if err != nil {
		return nil, err
	}
	items, _ := value.([]any)
	integrations := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if record, ok := item.(map[string]any); ok {
			integrations = append(integrations, record)
		}
	}
	return integrations, nil
}

// createIntegration tests the connection before saving. Homarr answers HTTP
// 200 with data.json.error when the test fails, so the body decides.
func createIntegration(ctx context.Context, h *helpers.H, body map[string]any) error {
	value, err := apiKeyWrite(ctx, h, "integration.create", body)
	if err != nil {
		return err
	}
	if record, ok := value.(map[string]any); ok {
		if failure, found := record["error"]; found && failure != nil {
			return fmt.Errorf("Homarr could not reach the integration: %v", failure)
		}
	}
	return nil
}

func deleteIntegration(ctx context.Context, h *helpers.H, id string) error {
	_, err := apiKeyWrite(ctx, h, "integration.delete", map[string]any{"id": id})
	return err
}

func addTile(ctx context.Context, h *helpers.H, appID string) error {
	resp, err := h.Expect(ctx, helpers.Request{Path: "/api/boards", Header: apiKeyHeader(h)})
	if err != nil {
		return err
	}
	var boards []map[string]any
	if err := resp.Decode(&boards); err != nil {
		return err
	}
	if len(boards) == 0 || stringField(boards[0], "id") == "" {
		return errors.New("Homarr has no board to place the tile on")
	}
	_, err = h.Expect(ctx, helpers.Request{
		Method: "POST", Path: "/api/boards/items", Header: apiKeyHeader(h),
		JSON: map[string]any{
			"boardId":        stringField(boards[0], "id"),
			"kind":           "app",
			"options":        map[string]any{"appId": appID, "openInNewTab": true, "showTitle": true},
			"size":           map[string]any{"width": 1, "height": 1},
			"integrationIds": []any{},
		},
	})
	return err
}

// linked reports whether the app tile exists and, for an integration kind, the
// integration is listed with the same kind and internal URL. It deliberately
// does not claim the tile: that is what a rerun proves.
func (t target) linked(ctx context.Context, from, to *helpers.H) (bool, error) {
	internal := t.internal(to)
	_, found, err := findApp(ctx, from, internal)
	if err != nil || !found {
		return false, err
	}
	if t.kind == "" {
		return true, nil
	}
	integrations, err := listIntegrations(ctx, from)
	if err != nil {
		return false, err
	}
	for _, item := range integrations {
		if stringField(item, "kind") == t.kind && stringField(item, "url") == internal {
			return true, nil
		}
	}
	return false, nil
}

func (t target) add(ctx context.Context, from, to *helpers.H) error {
	internal := t.internal(to)
	id, found, err := findApp(ctx, from, internal)
	if err != nil {
		return err
	}
	if !found {
		resp, err := from.Expect(ctx, helpers.Request{
			Method: "POST", Path: "/api/apps", Header: apiKeyHeader(from),
			JSON: map[string]any{
				"name": t.name, "description": nil, "iconUrl": iconURL(t.id),
				"href": to.URL, "pingUrl": internal,
			},
		})
		if err != nil {
			return err
		}
		var created map[string]any
		if err := resp.Decode(&created); err != nil {
			return err
		}
		id = appID(created)
		if id == "" {
			return errors.New("Homarr did not return an app id")
		}
	}
	if t.kind != "" {
		if err := createIntegration(ctx, from, map[string]any{
			"name": t.name, "url": internal, "kind": t.kind,
			"secrets": t.secrets(from, to), "attemptSearchEngineCreation": false,
			"app": map[string]any{"id": id},
		}); err != nil {
			return err
		}
	}
	return addTile(ctx, from, id)
}

func (t target) remove(ctx context.Context, from, to *helpers.H) error {
	internal := t.internal(to)
	if t.kind != "" {
		integrations, err := listIntegrations(ctx, from)
		if err != nil {
			return err
		}
		for _, item := range integrations {
			if stringField(item, "kind") == t.kind && stringField(item, "url") == internal {
				if err := deleteIntegration(ctx, from, stringField(item, "id")); err != nil {
					return err
				}
			}
		}
	}
	id, found, err := findApp(ctx, from, internal)
	if err != nil || !found {
		return err
	}
	_, err = from.Expect(ctx, helpers.Request{Method: "DELETE", Path: "/api/apps/" + id, Header: apiKeyHeader(from)})
	return err
}

// link wires Homarr to one target. The framework runs Apply only once the
// target's own Setup finished, so `to` is always ready.
func (t target) link() app.Link {
	id := "link-" + t.id
	title := "link " + t.name
	if t.kind == "" {
		title = "add a " + t.name + " tile"
	}
	return app.Link{
		ID:     id,
		Target: t.id,
		Title:  title,
		Apply: func(ctx context.Context, from, to *helpers.H) error {
			return from.Step(ctx, id, "add "+t.name+" to Homarr", helpers.StepSpec{
				Check:      func(ctx context.Context) (bool, error) { return t.linked(ctx, from, to) },
				Do:         func(ctx context.Context) error { return t.add(ctx, from, to) },
				Hint:       t.hint(from),
				Credential: "admin",
			})
		},
		Remove: func(ctx context.Context, from, to *helpers.H) error {
			return from.Step(ctx, "un"+id, "remove "+t.name+" from Homarr", helpers.StepSpec{
				Check: func(ctx context.Context) (bool, error) {
					found, err := t.linked(ctx, from, to)
					return !found, err
				},
				Do:         func(ctx context.Context) error { return t.remove(ctx, from, to) },
				Hint:       t.hint(from),
				Credential: "admin",
			})
		},
	}
}
