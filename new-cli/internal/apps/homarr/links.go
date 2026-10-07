package homarr

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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

// widget is one board widget from the App's catalog entry: the kind Homarr
// stores, its options and, for a stats widget, the metric keys it shows.
type widget struct {
	kind    string
	options map[string]any
	metrics []string
}

func plain(kind string) widget { return widget{kind: kind, options: map[string]any{}} }

func statWidget(metrics ...string) widget {
	return widget{kind: "stats", options: map[string]any{}, metrics: metrics}
}

// target is one App Homarr links to: an app tile, for most a dedicated
// integration with its connection secrets, and the widgets that use it.
type target struct {
	id   string
	name string
	// kind is the Homarr integration kind; empty means tile only.
	kind     string
	internal func(to *helpers.H) string
	secrets  func(from, to *helpers.H) []secret
	widgets  []widget
}

func fixed(u string) func(*helpers.H) string { return func(*helpers.H) string { return u } }

func apiKeySecret(_, to *helpers.H) []secret {
	return []secret{{Kind: "apiKey", Value: to.Secret(to.Key("api_key"))}}
}

// targets are the Apps Homarr supports here, in the order they are declared.
// Other Apps are reached by Compose service name, never localhost.
func targets() []target {
	return []target{
		{
			id: "sonarr", name: "Sonarr", kind: "sonarr", internal: fixed("http://sonarr:8989"), secrets: apiKeySecret,
			widgets: []widget{plain("calendar"), plain("mediaMissing"), statWidget("shows", "downloaded", "missing", "queued")},
		},
		{
			id: "radarr", name: "Radarr", kind: "radarr", internal: fixed("http://radarr:7878"), secrets: apiKeySecret,
			widgets: []widget{plain("calendar"), plain("mediaMissing"), statWidget("movies", "downloaded", "missing", "queued")},
		},
		{
			id: "prowlarr", name: "Prowlarr", kind: "prowlarr", internal: fixed("http://prowlarr:9696"), secrets: apiKeySecret,
			widgets: []widget{plain("indexerManager"), statWidget("indexers")},
		},
		{
			id: "jellyfin", name: "Jellyfin", kind: "jellyfin", internal: fixed("http://jellyfin:8096"), secrets: apiKeySecret,
			widgets: []widget{plain("mediaServer"), plain("mediaReleases"), statWidget("sessions")},
		},
		{
			id: "seerr", name: "Seerr", kind: "seerr", internal: fixed("http://seerr:5055"), secrets: apiKeySecret,
			widgets: []widget{plain("mediaRequests-requestList"), plain("mediaRequests-requestStats"), statWidget("pending", "approved", "available")},
		},
		{
			id: "qbittorrent", name: "qBittorrent", kind: "qBittorrent",
			internal: func(to *helpers.H) string { return "http://qbittorrent:" + strconv.Itoa(to.Port) },
			secrets: func(from, _ *helpers.H) []secret {
				return []secret{{Kind: "username", Value: from.AdminUser()}, {Kind: "password", Value: from.AdminPassword()}}
			},
			widgets: []widget{plain("downloads"), statWidget("download", "upload", "paused")},
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
	hint := "Open " + from.URL + "/manage/integrations to add the " + t.name + " integration and " +
		from.URL + "/manage/apps to add and place its app tile"
	if len(t.widgets) > 0 {
		hint += " and its widgets"
	}
	return hint + "."
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

// board reads the board Homarr created during onboarding, together with its
// items. The item list is read through tRPC board.getBoardByName because Homarr
// exposes no REST route for a single board's items.
func board(ctx context.Context, h *helpers.H) (map[string]any, error) {
	resp, err := h.Expect(ctx, helpers.Request{Path: "/api/boards", Header: apiKeyHeader(h)})
	if err != nil {
		return nil, err
	}
	var boards []map[string]any
	if err := resp.Decode(&boards); err != nil {
		return nil, err
	}
	if len(boards) == 0 || stringField(boards[0], "name") == "" {
		return nil, errors.New("Homarr has no board to place items on")
	}
	value, err := apiKeyProcedure(ctx, h, "board.getBoardByName", map[string]any{"name": stringField(boards[0], "name")})
	if err != nil {
		return nil, err
	}
	record, _ := value.(map[string]any)
	if record == nil {
		return nil, errors.New("Homarr did not return the board")
	}
	return record, nil
}

func itemsOf(board map[string]any) []map[string]any {
	raw, _ := board["items"].([]any)
	items := make([]map[string]any, 0, len(raw))
	for _, value := range raw {
		if record, ok := value.(map[string]any); ok {
			items = append(items, record)
		}
	}
	return items
}

func hasTile(items []map[string]any, appID string) bool {
	for _, item := range items {
		if stringField(item, "kind") != "app" {
			continue
		}
		options, _ := item["options"].(map[string]any)
		if stringField(options, "appId") == appID {
			return true
		}
	}
	return false
}

func wiredTo(item map[string]any, kind, integrationID string) bool {
	if stringField(item, "kind") != kind {
		return false
	}
	ids, _ := item["integrationIds"].([]any)
	for _, id := range ids {
		if id == integrationID {
			return true
		}
	}
	return false
}

func hasWidget(items []map[string]any, kind, integrationID string) bool {
	for _, item := range items {
		if wiredTo(item, kind, integrationID) {
			return true
		}
	}
	return false
}

// statsEntryID reproduces the deterministic per-metric id Homarr expects in a
// stats widget's options.
func statsEntryID(metric string) string {
	sum := sha256.Sum256([]byte(metric))
	return "auto-stack-" + hex.EncodeToString(sum[:])[:32]
}

func widgetOptions(w widget, integrationID string) map[string]any {
	if w.kind != "stats" {
		return w.options
	}
	entries := make([]any, 0, len(w.metrics))
	for _, metric := range w.metrics {
		entries = append(entries, map[string]any{
			"id": statsEntryID(metric), "integrationId": integrationID,
			"metric": metric, "label": "", "hidden": false, "compact": false,
		})
	}
	return map[string]any{"entries": entries}
}

func addItem(ctx context.Context, h *helpers.H, body map[string]any) error {
	_, err := h.Expect(ctx, helpers.Request{Method: "POST", Path: "/api/boards/items", Header: apiKeyHeader(h), JSON: body})
	return err
}

func addTile(ctx context.Context, h *helpers.H, boardID, appID string) error {
	return addItem(ctx, h, map[string]any{
		"boardId":        boardID,
		"kind":           "app",
		"options":        map[string]any{"appId": appID, "openInNewTab": true, "showTitle": true},
		"size":           map[string]any{"width": 1, "height": 1},
		"integrationIds": []any{},
	})
}

// ensureIntegration returns the integration id, creating it only when the
// listed integrations do not already match by kind and internal URL.
func ensureIntegration(ctx context.Context, from, to *helpers.H, t target, appID string) (string, error) {
	internal := t.internal(to)
	match := func(integrations []map[string]any) string {
		for _, item := range integrations {
			if stringField(item, "kind") == t.kind && stringField(item, "url") == internal {
				return stringField(item, "id")
			}
		}
		return ""
	}
	integrations, err := listIntegrations(ctx, from)
	if err != nil {
		return "", err
	}
	if id := match(integrations); id != "" {
		return id, nil
	}
	if err := createIntegration(ctx, from, map[string]any{
		"name": t.name, "url": internal, "kind": t.kind,
		"secrets": t.secrets(from, to), "attemptSearchEngineCreation": false,
		"app": map[string]any{"id": appID},
	}); err != nil {
		return "", err
	}
	integrations, err = listIntegrations(ctx, from)
	if err != nil {
		return "", err
	}
	id := match(integrations)
	if id == "" {
		return "", errors.New("Homarr did not keep the " + t.name + " integration")
	}
	return id, nil
}

func (t target) addWidgets(ctx context.Context, h *helpers.H, boardID, integrationID string, items []map[string]any) error {
	for _, w := range t.widgets {
		if hasWidget(items, w.kind, integrationID) {
			continue
		}
		if err := addItem(ctx, h, map[string]any{
			"boardId": boardID, "kind": w.kind,
			"options":        widgetOptions(w, integrationID),
			"integrationIds": []any{integrationID},
		}); err != nil {
			return err
		}
	}
	return nil
}

// removeWidgets drops the target's widget items through the full-board save,
// the only removal Homarr exposes (no REST delete-item).
func removeWidgets(ctx context.Context, h *helpers.H, integrationID string, widgets []widget) error {
	current, err := board(ctx, h)
	if err != nil {
		return err
	}
	kinds := make(map[string]bool, len(widgets))
	for _, w := range widgets {
		kinds[w.kind] = true
	}
	items := itemsOf(current)
	kept := make([]map[string]any, 0, len(items))
	removed := false
	for _, item := range items {
		kind := stringField(item, "kind")
		if kinds[kind] && wiredTo(item, kind, integrationID) {
			removed = true
			continue
		}
		kept = append(kept, item)
	}
	if !removed {
		return nil
	}
	_, err = apiKeyWrite(ctx, h, "board.saveBoard", map[string]any{
		"id": stringField(current, "id"), "sections": current["sections"], "items": kept,
	})
	return err
}

// linked reports whether the app tile, the integration and every widget wired
// to it exist. It deliberately does not claim them: that is what a rerun
// proves.
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
	integrationID := ""
	for _, item := range integrations {
		if stringField(item, "kind") == t.kind && stringField(item, "url") == internal {
			integrationID = stringField(item, "id")
			break
		}
	}
	if integrationID == "" {
		return false, nil
	}
	if len(t.widgets) == 0 {
		return true, nil
	}
	current, err := board(ctx, from)
	if err != nil {
		return false, err
	}
	items := itemsOf(current)
	for _, w := range t.widgets {
		if !hasWidget(items, w.kind, integrationID) {
			return false, nil
		}
	}
	return true, nil
}

func (t target) add(ctx context.Context, from, to *helpers.H) error {
	internal := t.internal(to)
	current, err := board(ctx, from)
	if err != nil {
		return err
	}
	boardID := stringField(current, "id")
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
	items := itemsOf(current)
	if !hasTile(items, id) {
		if err := addTile(ctx, from, boardID, id); err != nil {
			return err
		}
	}
	if t.kind != "" {
		integrationID, err := ensureIntegration(ctx, from, to, t, id)
		if err != nil {
			return err
		}
		if err := t.addWidgets(ctx, from, boardID, integrationID, items); err != nil {
			return err
		}
	}
	return ensureNotebook(ctx, from)
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
				id := stringField(item, "id")
				if len(t.widgets) > 0 {
					if err := removeWidgets(ctx, from, id, t.widgets); err != nil {
						return err
					}
				}
				if err := deleteIntegration(ctx, from, id); err != nil {
					return err
				}
			}
		}
	}
	id, found, err := findApp(ctx, from, internal)
	if err != nil || !found {
		return err
	}
	if _, err = from.Expect(ctx, helpers.Request{Method: "DELETE", Path: "/api/apps/" + id, Header: apiKeyHeader(from)}); err != nil {
		return err
	}
	return ensureNotebook(ctx, from)
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
