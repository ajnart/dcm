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
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/beszel"
	"github.com/ajnart/self-host/internal/helpers"
)

// secret is one integration credential: Homarr stores it encrypted under the
// exact kind string.
type secret struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

// widget is one board widget from the App's catalog entry: the kind Homarr
// stores, its options and, for a stats widget, the metric keys it shows. A
// widget that shows one thing the target knows by id gets its options from
// bind, which reads that id from the target when the widget is added.
type widget struct {
	kind    string
	options map[string]any
	metrics []string
	bind    func(ctx context.Context, to *helpers.H, integrationID string) (map[string]any, error)
}

func plain(kind string) widget { return widget{kind: kind, options: map[string]any{}} }

func statWidget(metrics ...string) widget {
	return widget{kind: "stats", options: map[string]any{}, metrics: metrics}
}

// beszelSystemStats shows this machine's CPU, memory, disk and network.
// Homarr selects the system as "<integration id>:<system id>".
func beszelSystemStats() widget {
	return widget{kind: "beszelSystemStats", bind: func(ctx context.Context, to *helpers.H, integrationID string) (map[string]any, error) {
		id, err := beszel.MachineID(ctx, to)
		if err != nil {
			return nil, err
		}
		options := map[string]any{"systemId": integrationID + ":" + id, "timePeriod": "1h"}
		for _, key := range []string{"showCpu", "showMemory", "showDisk", "showDiskIO", "showNetwork", "showGpuUsage", "showGpuMemory", "showGpuPower", "showDockerCpu", "showDockerMemory", "showDockerNetwork"} {
			options[key] = true
		}
		return options, nil
	}}
}

// target is one App Homarr links to: an app tile, for most a dedicated
// integration with its connection secrets, and the widgets that use it.
type target struct {
	id   string
	name string
	// kind is the Homarr integration kind; empty means tile only.
	kind      string
	internal  func(to *helpers.H) string
	secrets   func(from, to *helpers.H) []secret
	widgets   []widget
	recovery  string
	preflight func(ctx context.Context, from, to *helpers.H) error
	verify    func(ctx context.Context, from, to *helpers.H, integrationID string) error
	stats     func(statsSample) error
}

func fixed(u string) func(*helpers.H) string { return func(*helpers.H) string { return u } }

func (t target) credentials(from, to *helpers.H) []secret {
	if t.secrets == nil {
		return []secret{}
	}
	return t.secrets(from, to)
}

func apiKeySecret(_, to *helpers.H) []secret {
	return []secret{{Kind: "apiKey", Value: to.Secret(to.Key("api_key"))}}
}

// ntfySecret wires Homarr's ntfy integration to the topic and to the
// administrator access token ntfy issued for Homarr.
func ntfySecret(_, to *helpers.H) []secret {
	return []secret{
		{Kind: "topic", Value: to.Secret(to.Key("topic"))},
		{Kind: "apiKey", Value: to.Secret(to.Key("homarr_token"))},
	}
}

// targets are the Apps Homarr supports here, in the order they are declared.
// Other Apps are reached by Compose service name, never localhost.
func existingTargets() []target {
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
		{
			id: "beszel", name: "Beszel", kind: "beszel", internal: fixed("http://beszel:8090"),
			secrets: func(_, to *helpers.H) []secret {
				return []secret{{Kind: "username", Value: beszel.AdminEmail(to)}, {Kind: "password", Value: to.AdminPassword()}}
			},
			widgets: []widget{beszelSystemStats()},
		},
		{id: "ntfy", name: "ntfy", kind: "ntfy", internal: fixed("http://ntfy:80"), secrets: ntfySecret,
			widgets: []widget{plain("notifications"), statWidget("messages")}},
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
	if t.recovery != "" {
		return t.recovery
	}
	if t.id == "ntfy" {
		return "Run self-host setup ntfy to repair its saved Homarr token, then run self-host setup homarr."
	}
	if t.id == "frigate" {
		return "Frigate's Homarr Link requires trusted HTTPS on authenticated port 8971. The default HTTP starter cannot be linked. Obtain explicit approval for Project-scoped private TLS and certificate trust in both Homarr and the CLI, then retry self-host setup frigate and self-host setup homarr. Keep authentication enabled on port 8971; do not use port 5000, bypass certificate verification, or enable public Access."
	}
	if t.id == "nzbget" {
		return "NZBGet activation is on hold for credential-safety issue #354. Do not manually create its Homarr integration or bypass credential checks while this is unresolved. Resolve #354 with supported upstream credential transport and a complete privacy review of every error and log destination; verify the exact Homarr source and version, then obtain separate activation approval before retrying self-host setup homarr. A transport change alone does not establish safety. Standalone NZBGet Setup and owned Link removal are separate."
	}
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

func (t target) findApp(ctx context.Context, h *helpers.H, pingURL string) (string, bool, error) {
	apps, err := listApps(ctx, h)
	if err != nil {
		return "", false, err
	}
	recorded := managedAppIDs(h)[t.id]
	if recorded != "" {
		for _, item := range apps {
			if appID(item) == recorded && !strings.HasPrefix(stringField(item, "description"), retainedTileMarker) {
				return recorded, true, nil
			}
		}
	}
	for _, item := range apps {
		owned := stringField(item, "description") == installedTileMarker+t.id
		if owned && stringField(item, "pingUrl") == pingURL {
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
	items, ok := value.([]any)
	if !ok {
		return nil, errors.New("Homarr did not return an integration list; inspect its connection before retrying Setup")
	}
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
func createIntegration(ctx context.Context, h *helpers.H, body map[string]any) (string, error) {
	value, err := apiKeyWrite(ctx, h, "integration.create", body)
	if err != nil {
		return "", err
	}
	if record, ok := value.(map[string]any); ok {
		if failure, found := record["error"]; found && failure != nil {
			return "", fmt.Errorf("Homarr could not reach the integration: %v", failure)
		}
		integration, _ := record["integration"].(map[string]any)
		if id := stringField(integration, "id"); id != "" {
			return id, nil
		}
	}
	return "", errors.New("Homarr did not return the created integration ID; inspect integrations before retrying Setup")
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
	name := ""
	for _, candidate := range boards {
		if stringField(candidate, "name") == "Home" {
			name = "Home"
			break
		}
	}
	if name == "" {
		return nil, errors.New("Homarr Home board is missing; restore or rename the managed board to Home, then run self-host setup homarr")
	}
	value, err := apiKeyProcedure(ctx, h, "board.getBoardByName", map[string]any{"name": name})
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
			"id": statsEntryID(integrationID + ":" + metric), "integrationId": integrationID,
			"metric": metric, "label": "", "hidden": false, "compact": false,
		})
	}
	return map[string]any{"entries": entries}
}

func widgetCurrent(item map[string]any, w widget, integrationID string) bool {
	if w.kind != "stats" {
		return true
	}
	options, _ := item["options"].(map[string]any)
	entries, _ := options["entries"].([]any)
	for _, metric := range w.metrics {
		found := false
		for _, raw := range entries {
			entry, _ := raw.(map[string]any)
			id := stringField(entry, "id")
			if stringField(entry, "metric") == metric && stringField(entry, "integrationId") == integrationID && id != "" {
				found = true
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func addItem(ctx context.Context, h *helpers.H, body map[string]any) (helpers.Response, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Method: "POST", Path: "/api/boards/items", Header: apiKeyHeader(h), JSON: body})
	if err != nil {
		return resp, err
	}
	if !resp.OK() {
		return resp, fmt.Errorf("Homarr rejected %s creation (HTTP %d)", stringField(body, "kind"), resp.Status)
	}
	var created struct{ ItemID string }
	if err := resp.Decode(&created); err != nil {
		return resp, err
	}
	if created.ItemID == "" {
		return resp, errors.New("Homarr did not return the board item ID; run self-host setup homarr")
	}
	return resp, nil
}

func addItemID(ctx context.Context, h *helpers.H, body map[string]any) (string, error) {
	resp, err := addItem(ctx, h, body)
	if err != nil {
		return "", err
	}
	var created struct{ ItemID string }
	if err := resp.Decode(&created); err != nil {
		return "", err
	}
	return created.ItemID, nil
}

func ownedWidgets(h *helpers.H, integrationID string) map[string]bool {
	ids := map[string]bool{}
	json.Unmarshal([]byte(h.Secret(h.Key("widgets_"+integrationID))), &ids)
	return ids
}

// The old CLI emitted one widget per kind, empty plain options, and
// deterministic stats entries. Only that complete, unique shape is adopted.
// Anything ambiguous requires an explicit ownership decision before mutation.
func widgetOwnership(h *helpers.H, integrationID string, widgets []widget, items []map[string]any) (map[string]bool, error) {
	key := h.Key("widgets_" + integrationID)
	if raw := h.Secret(key); raw != "" {
		ids := map[string]bool{}
		if err := json.Unmarshal([]byte(raw), &ids); err != nil || ids == nil {
			return nil, fmt.Errorf("invalid Homarr widget ownership; review %s as a JSON object of owned widget IDs, then run self-host setup homarr", key)
		}
		return ids, nil
	}
	owned := map[string]bool{}
	matching := false
	complete := true
	stats := false
	for _, w := range widgets {
		candidates := []map[string]any{}
		for _, item := range items {
			if wiredTo(item, w.kind, integrationID) {
				candidates = append(candidates, item)
			}
		}
		if len(candidates) > 0 {
			matching = true
		}
		if len(candidates) != 1 {
			complete = false
			continue
		}
		item := candidates[0]
		ids, _ := item["integrationIds"].([]any)
		options, _ := item["options"].(map[string]any)
		if len(ids) != 1 || stringField(item, "id") == "" {
			complete = false
			continue
		}
		if w.kind == "stats" {
			entries, _ := options["entries"].([]any)
			if len(entries) != len(w.metrics) || !widgetCurrent(item, w, integrationID) {
				complete = false
				continue
			}
			generated := true
			for _, raw := range entries {
				entry, _ := raw.(map[string]any)
				metric := stringField(entry, "metric")
				id := stringField(entry, "id")
				if id != statsEntryID(metric) && id != statsEntryID(integrationID+":"+metric) {
					generated = false
				}
			}
			if !generated {
				complete = false
				continue
			}
			stats = true
		} else if len(options) != 0 {
			complete = false
			continue
		}
		owned[stringField(item, "id")] = true
	}
	if matching && (!complete || !stats) {
		return nil, fmt.Errorf("legacy Homarr widget ownership is ambiguous; review Home widgets and save confirmed owned widget IDs as a JSON object in %s (use {} to preserve all existing widgets), then run self-host setup homarr", key)
	}
	raw, _ := json.Marshal(owned)
	if err := h.SetSecret(key, string(raw)); err != nil {
		return nil, err
	}
	return owned, nil
}

func addTile(ctx context.Context, h *helpers.H, boardID, appID string) error {
	_, err := addItem(ctx, h, map[string]any{
		"boardId":        boardID,
		"kind":           "app",
		"options":        map[string]any{"appId": appID, "openInNewTab": true, "showTitle": true},
		"size":           map[string]any{"width": 1, "height": 1},
		"integrationIds": []any{},
	})
	return err
}

func managedAppIDs(h *helpers.H) map[string]string {
	ids := map[string]string{}
	json.Unmarshal([]byte(h.Secret(h.Key("app_ids"))), &ids)
	return ids
}

func rememberAppID(h *helpers.H, targetID, appID string) error {
	ids := managedAppIDs(h)
	ids[targetID] = appID
	raw, _ := json.Marshal(ids)
	return h.SetSecret(h.Key("app_ids"), string(raw))
}

func removeAppTiles(ctx context.Context, h *helpers.H, appID string) error {
	if appID == "" {
		return nil
	}
	current, err := board(ctx, h)
	if err != nil {
		return err
	}
	items := itemsOf(current)
	kept := make([]map[string]any, 0, len(items))
	for _, item := range items {
		options, _ := item["options"].(map[string]any)
		if stringField(item, "kind") == "app" && stringField(options, "appId") == appID {
			continue
		}
		kept = append(kept, item)
	}
	if len(kept) == len(items) {
		return nil
	}
	_, err = apiKeyWrite(ctx, h, "board.saveBoard", map[string]any{"id": stringField(current, "id"), "sections": current["sections"], "items": kept})
	return err
}

// ensureIntegration returns the integration id, creating it only when the
// listed integrations do not already match by kind and internal URL.
func ensureIntegration(ctx context.Context, from, to *helpers.H, t target, appID string) (string, error) {
	internal := t.internal(to)
	previous := from.Secret(from.Key("linked_" + t.id))
	match := func(integrations []map[string]any) string {
		for _, item := range integrations {
			if stringField(item, "id") == previous && stringField(item, "kind") == t.kind {
				return stringField(item, "id")
			}
		}
		return ""
	}
	integrations, err := listIntegrations(ctx, from)
	if err != nil {
		return "", err
	}
	// The pinned Homarr ntfy connection test resolves even HTTP401, so it
	// cannot prove token validity. Verify new/changed tokens directly before
	// storing them or a fingerprint; unchanged routine Checks publish nothing.
	if id := match(integrations); t.id == "ntfy" && (id == "" || from.Secret(integrationFingerprintKey(from, id)) != integrationFingerprint(t, from, to)) {
		if err := verifyNTFYToken(ctx, to); err != nil {
			return "", err
		}
	}
	if id := match(integrations); id != "" {
		if from.Secret(integrationFingerprintKey(from, id)) != integrationFingerprint(t, from, to) || !integrationAddressCurrent(integrations, id, internal) {
			value, err := apiKeyWrite(ctx, from, "integration.update", map[string]any{
				"id": id, "name": t.name, "url": internal, "secrets": t.credentials(from, to), "appId": appID,
			})
			if err != nil {
				return "", err
			}
			if record, ok := value.(map[string]any); ok {
				if failure, found := record["error"]; found && failure != nil {
					return "", fmt.Errorf("Homarr rejected the %s integration update: %v; correct its connection or credentials, then run self-host setup homarr", t.name, failure)
				}
			}
			if err := from.SetSecret(integrationFingerprintKey(from, id), integrationFingerprint(t, from, to)); err != nil {
				return "", err
			}
		}
		return id, nil
	}
	if previous != "" {
		if err := removeWidgets(ctx, from, previous, t.widgets); err != nil {
			return "", err
		}
	}
	id, err := createIntegration(ctx, from, map[string]any{
		"name": t.name, "url": internal, "kind": t.kind,
		"secrets": t.credentials(from, to), "attemptSearchEngineCreation": false,
		"app": map[string]any{"id": appID},
	})
	if err != nil {
		return "", err
	}
	if err := from.SetSecret(from.Key("linked_"+t.id), id); err != nil {
		return "", err
	}
	if err := from.SetSecret(from.Key("widgets_"+id), "{}"); err != nil {
		return "", err
	}
	if err := from.SetSecret(integrationFingerprintKey(from, id), integrationFingerprint(t, from, to)); err != nil {
		return "", err
	}
	return id, nil
}

func integrationAddressCurrent(integrations []map[string]any, id, address string) bool {
	for _, item := range integrations {
		if stringField(item, "id") == id {
			return stringField(item, "url") == address
		}
	}
	return false
}

func verifyNTFYToken(ctx context.Context, to *helpers.H) error {
	const failure = "ntfy Homarr token did not authenticate the existing administrator account"
	token := to.Secret(to.Key("homarr_token"))
	if token == "" {
		return errors.New(failure)
	}
	response, err := to.HTTP(ctx, helpers.Request{Path: "/v1/account", NoRedirect: true, Header: map[string]string{"Authorization": "Bearer " + token}})
	if err != nil || response.Status != 200 {
		return errors.New(failure)
	}
	var account struct{ Username, Role string }
	if response.Decode(&account) != nil || account.Username != to.AdminUser() || account.Role != "admin" {
		return errors.New(failure)
	}
	return nil
}

func integrationFingerprintKey(h *helpers.H, id string) string { return h.Key("integration_" + id) }

func integrationFingerprint(t target, from, to *helpers.H) string {
	raw, _ := json.Marshal(t.credentials(from, to))
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// REST item creation defaults to one grid cell, independently of Homarr's UI
// widgetDefaultSizes. Give integration lists enough space for actual content.
func widgetInitialSize(kind string) map[string]any {
	switch kind {
	case "notifications", "mediaReleases":
		return map[string]any{"width": 4, "height": 3}
	case "stats", "calendar":
		return map[string]any{"width": 4, "height": 3}
	case "mediaServer":
		return map[string]any{"width": 3, "height": 2}
	case "beszelSystemStats":
		return map[string]any{"width": 6, "height": 4}
	case "downloads":
		return map[string]any{"width": 4, "height": 2}
	case "mediaMissing", "mediaRequests-requestStats":
		return map[string]any{"width": 2, "height": 2}
	case "indexerManager":
		return map[string]any{"width": 2, "height": 3}
	case "mediaRequests-requestList":
		return map[string]any{"width": 3, "height": 2}
	default:
		return map[string]any{"width": 3, "height": 2}
	}
}

func (t target) addWidgets(ctx context.Context, h, to *helpers.H, boardID, integrationID string, items []map[string]any) error {
	owned, err := widgetOwnership(h, integrationID, t.widgets, items)
	if err != nil {
		return err
	}
	for _, w := range t.widgets {
		if sharedWidget(w.kind) {
			if err := ensureSharedWidget(ctx, h, w, integrationID, owned); err != nil {
				return err
			}
			continue
		}
		if hasWidget(items, w.kind, integrationID) {
			continue
		}
		options := widgetOptions(w, integrationID)
		if w.bind != nil {
			if options, err = w.bind(ctx, to, integrationID); err != nil {
				return err
			}
		}
		id, err := addItemID(ctx, h, map[string]any{
			"boardId": boardID, "kind": w.kind,
			"size":           widgetInitialSize(w.kind),
			"options":        options,
			"integrationIds": []any{integrationID},
		})
		if err != nil {
			return err
		}
		owned[id] = true
		raw, _ := json.Marshal(owned)
		if err := h.SetSecret(h.Key("widgets_"+integrationID), string(raw)); err != nil {
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
	items := itemsOf(current)
	owned, err := widgetOwnership(h, integrationID, widgets, items)
	if err != nil {
		return err
	}
	kept := make([]map[string]any, 0, len(items))
	removed := false
	for _, item := range items {
		if owned[stringField(item, "id")] {
			if sharedWidget(stringField(item, "kind")) {
				removeWidgetIntegration(item, integrationID)
				ids, _ := item["integrationIds"].([]any)
				if len(ids) > 0 {
					kept = append(kept, item)
				}
				removed = true
				continue
			}
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
	if t.preflight != nil {
		if err := t.preflight(ctx, from, to); err != nil {
			return false, err
		}
	}
	if err := t.compatible(ctx, from, to); err != nil {
		return false, err
	}
	browser, err := browserAddress(ctx, from, to)
	if err != nil {
		return false, err
	}
	internal := t.internal(to)
	id, found, err := t.findApp(ctx, from, internal)
	if err != nil || !found {
		return false, err
	}
	apps, err := listApps(ctx, from)
	if err != nil {
		return false, err
	}
	for _, item := range apps {
		if appID(item) == id && stringField(item, "href") != browser {
			return false, nil
		}
	}
	current, err := board(ctx, from)
	if err != nil {
		return false, err
	}
	if !hasTile(itemsOf(current), id) {
		return false, nil
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
		if stringField(item, "id") == from.Secret(from.Key("linked_"+t.id)) && stringField(item, "kind") == t.kind && stringField(item, "url") == internal {
			integrationID = stringField(item, "id")
			break
		}
	}
	if integrationID == "" {
		return false, nil
	}
	if from.Secret(integrationFingerprintKey(from, integrationID)) != integrationFingerprint(t, from, to) {
		return false, nil
	}
	if err := t.verifyData(ctx, from, to, integrationID); err != nil {
		return false, err
	}
	if len(t.widgets) == 0 {
		return true, nil
	}
	rawOwnership := from.Secret(from.Key("widgets_" + integrationID))
	if rawOwnership == "" {
		return false, nil
	}
	var ownership map[string]bool
	if err := json.Unmarshal([]byte(rawOwnership), &ownership); err != nil || ownership == nil {
		return false, errors.New("Homarr widget ownership must be reviewed; run self-host setup homarr for the recovery operation")
	}
	items := itemsOf(current)
	for _, w := range t.widgets {
		if sharedWidget(w.kind) && !sharedWidgetCurrent(from, current, w, integrationID) {
			return false, nil
		}
		if !hasWidget(items, w.kind, integrationID) {
			return false, nil
		}
		owned := ownedWidgets(from, integrationID)
		for _, item := range items {
			if w.kind == "stats" {
				continue
			}
			if owned[stringField(item, "id")] && wiredTo(item, w.kind, integrationID) && !widgetCurrent(item, w, integrationID) {
				return false, nil
			}
		}
	}
	return true, nil
}

func (t target) add(ctx context.Context, from, to *helpers.H) error {
	if t.preflight != nil {
		if err := t.preflight(ctx, from, to); err != nil {
			return err
		}
	}
	if err := t.compatible(ctx, from, to); err != nil {
		return err
	}
	browser, err := browserAddress(ctx, from, to)
	if err != nil {
		return err
	}
	internal := t.internal(to)
	current, err := board(ctx, from)
	if err != nil {
		return err
	}
	boardID := stringField(current, "id")
	id, found, err := t.findApp(ctx, from, internal)
	if err != nil {
		return err
	}
	if !found {
		previous := managedAppIDs(from)[t.id]
		retained := false
		if previous != "" {
			apps, err := listApps(ctx, from)
			if err != nil {
				return err
			}
			for _, item := range apps {
				if appID(item) == previous && strings.HasPrefix(stringField(item, "description"), retainedTileMarker) {
					retained = true
					break
				}
			}
		}
		if !retained {
			if err := removeAppTiles(ctx, from, previous); err != nil {
				return err
			}
		}
		resp, err := from.Expect(ctx, helpers.Request{
			Method: "POST", Path: "/api/apps", Header: apiKeyHeader(from),
			JSON: map[string]any{
				"name": t.name, "description": installedTileMarker + t.id, "iconUrl": iconURL(t.id),
				"href": browser, "pingUrl": internal,
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
	} else {
		apps, err := listApps(ctx, from)
		if err != nil {
			return err
		}
		for _, item := range apps {
			if appID(item) != id || stringField(item, "href") == browser {
				continue
			}
			_, err := from.Expect(ctx, helpers.Request{Method: "PATCH", Path: "/api/apps/" + id, Header: apiKeyHeader(from), JSON: map[string]any{
				"name": item["name"], "description": item["description"], "iconUrl": item["iconUrl"], "href": browser, "pingUrl": item["pingUrl"],
			}})
			if err != nil {
				return err
			}
		}
	}
	if err := rememberAppID(from, t.id, id); err != nil {
		return err
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
		if err := t.verifyData(ctx, from, to, integrationID); err != nil {
			return err
		}
		if err := t.addWidgets(ctx, from, to, boardID, integrationID, items); err != nil {
			return err
		}
	}
	return ensureNotebook(ctx, from)
}

func browserAddress(ctx context.Context, from, to *helpers.H) (string, error) {
	if from.InstalledApps == nil {
		return to.URL, nil
	}
	installed, err := from.InstalledApps(ctx)
	if err != nil {
		return "", err
	}
	for _, item := range installed {
		if item.ID == to.App {
			return item.URL, nil
		}
	}
	return to.URL, nil
}

func (t target) remove(ctx context.Context, from, to *helpers.H) error {
	internal := t.internal(to)
	keepIntegration := false
	if t.kind != "" {
		if id := from.Secret(from.Key("linked_" + t.id)); id != "" {
			if err := removeWidgets(ctx, from, id, t.widgets); err != nil {
				return err
			}
		}
		integrations, err := listIntegrations(ctx, from)
		if err != nil {
			return err
		}
		for _, item := range integrations {
			if stringField(item, "id") == from.Secret(from.Key("linked_"+t.id)) && stringField(item, "kind") == t.kind {
				id := stringField(item, "id")
				if len(t.widgets) > 0 {
					if err := removeWidgets(ctx, from, id, t.widgets); err != nil {
						return err
					}
				}
				used, err := integrationUsedByWidgets(ctx, from, id)
				if err != nil {
					return err
				}
				if used {
					from.Info("keeping the " + t.name + " integration because other widgets still use it")
					keepIntegration = true
					continue
				}
				if err := deleteIntegration(ctx, from, id); err != nil {
					return err
				}
			}
		}
	}
	id, found, err := t.findApp(ctx, from, internal)
	if err != nil {
		return err
	}
	if !found {
		recordedID := managedAppIDs(from)[t.id]
		if err := removeAppTiles(ctx, from, recordedID); err != nil {
			return err
		}
		if keepIntegration {
			if err := t.releaseApp(ctx, from, recordedID); err != nil {
				return err
			}
		}
		return ensureNotebook(ctx, from)
	}
	if err := removeAppTiles(ctx, from, id); err != nil {
		return err
	}
	if keepIntegration {
		if err := t.releaseApp(ctx, from, id); err != nil {
			return err
		}
		return ensureNotebook(ctx, from)
	}
	if _, err = from.Expect(ctx, helpers.Request{Method: "DELETE", Path: "/api/apps/" + id, Header: apiKeyHeader(from)}); err != nil {
		return err
	}
	return ensureNotebook(ctx, from)
}

func (t target) releaseApp(ctx context.Context, h *helpers.H, id string) error {
	apps, err := listApps(ctx, h)
	if err != nil {
		return err
	}
	for _, item := range apps {
		if appID(item) != id {
			continue
		}
		description := stringField(item, "description")
		if description != "" && description != installedTileMarker+t.id {
			continue
		}
		if _, err := h.Expect(ctx, helpers.Request{Method: "PATCH", Path: "/api/apps/" + id, Header: apiKeyHeader(h), JSON: map[string]any{
			"name": item["name"], "description": retainedTileMarker + t.id, "iconUrl": item["iconUrl"], "href": item["href"], "pingUrl": item["pingUrl"],
		}}); err != nil {
			return err
		}
	}
	ids := managedAppIDs(h)
	delete(ids, t.id)
	raw, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	if err := h.SetSecret(h.Key("app_ids"), string(raw)); err != nil {
		return err
	}
	return h.SetSecret(h.Key("linked_"+t.id), "")
}

func integrationUsedByWidgets(ctx context.Context, h *helpers.H, integrationID string) (bool, error) {
	resp, err := h.Expect(ctx, helpers.Request{Path: "/api/boards", Header: apiKeyHeader(h)})
	if err != nil {
		return false, err
	}
	var boards []map[string]any
	if err := resp.Decode(&boards); err != nil {
		return false, err
	}
	for _, candidate := range boards {
		value, err := apiKeyProcedure(ctx, h, "board.getBoardByName", map[string]any{"name": stringField(candidate, "name")})
		if err != nil {
			return false, err
		}
		current, ok := value.(map[string]any)
		if !ok {
			return false, errors.New("Homarr did not return a board while checking remaining integration bindings")
		}
		for _, item := range itemsOf(current) {
			if wiredTo(item, stringField(item, "kind"), integrationID) {
				return true, nil
			}
		}
	}
	return false, nil
}

func (t target) absent(ctx context.Context, from, to *helpers.H) (bool, error) {
	internal := t.internal(to)
	_, found, err := t.findApp(ctx, from, internal)
	if err != nil || found {
		return false, err
	}
	if id := managedAppIDs(from)[t.id]; id != "" {
		current, err := board(ctx, from)
		if err != nil {
			return false, err
		}
		if hasTile(itemsOf(current), id) {
			return false, nil
		}
	}
	if t.kind != "" {
		integrations, err := listIntegrations(ctx, from)
		if err != nil {
			return false, err
		}
		for _, item := range integrations {
			if stringField(item, "id") == from.Secret(from.Key("linked_"+t.id)) && stringField(item, "kind") == t.kind {
				return false, nil
			}
		}
		if id := from.Secret(from.Key("linked_" + t.id)); id != "" {
			current, err := board(ctx, from)
			if err != nil {
				return false, err
			}
			owned := ownedWidgets(from, id)
			for _, item := range itemsOf(current) {
				if owned[stringField(item, "id")] {
					if sharedWidget(stringField(item, "kind")) && !wiredTo(item, stringField(item, "kind"), id) {
						continue
					}
					return false, nil
				}
			}
		}
	}
	return true, nil
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
					return t.absent(ctx, from, to)
				},
				Do:         func(ctx context.Context) error { return t.remove(ctx, from, to) },
				Hint:       t.hint(from),
				Credential: "admin",
			})
		},
	}
}
