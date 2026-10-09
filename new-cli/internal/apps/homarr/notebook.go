package homarr

import (
	"context"
	"fmt"
	"html"
	"slices"
	"sort"
	"strings"

	"github.com/ajnart/self-host/internal/helpers"
)

// notebookMarker is what identifies the one board notebook this package owns.
// It matches the marker the earlier CLI used for its homelab recap.
const notebookMarker = "Your homelab at a glance"

type notebookService struct {
	name string
	href string
}

// notebookContent is the recap the board carries: the installed Apps and their
// URLs, where the Admin login is, and nothing secret. A password or API key is
// never written here.
func notebookContent(services []notebookService) string {
	sort.Slice(services, func(i, j int) bool { return services[i].name < services[j].name })
	rows := make([]string, 0, len(services))
	for _, service := range services {
		if service.href == "" {
			rows = append(rows, "<tr><td><p>"+html.EscapeString(service.name)+"</p></td><td><p>No browser endpoint</p></td></tr>")
			continue
		}
		rows = append(rows, `<tr><td><p><a href="`+html.EscapeString(service.href)+`" target="_blank" rel="noopener noreferrer">`+
			html.EscapeString(service.name)+`</a></p></td><td><p>`+html.EscapeString(service.href)+`</p></td></tr>`)
	}
	return "<h2>" + notebookMarker + "</h2>" +
		"<p>This private board links your self-hosted Apps. A tile or widget does not by itself prove a working integration.</p>" +
		"<h3>Services</h3><table><tbody><tr><th><p>Service</p></th><th><p>Access</p></th></tr>" + strings.Join(rows, "") + "</tbody></table>" +
		"<h3>Admin login</h3><p>Sign in with the Admin login from <code>self-host credentials</code>. " +
		"This notebook never contains a password or API key.</p>" +
		"<h3>Request media</h3><p>Press Ctrl+K in Homarr, choose a media request, verify the exact title, " +
		"and request only authorized content.</p>" +
		"<p>Need help? Ask your agent or the Homarr assistant when available.</p>"
}

// notebookServices lists the Apps Homarr knows, plus Homarr itself, so the
// notebook gains a line whenever a Link adds an App and loses it on removal.
func notebookServices(ctx context.Context, h *helpers.H) ([]notebookService, error) {
	if h.InstalledApps != nil {
		installed, err := h.InstalledApps(ctx)
		if err != nil {
			return nil, err
		}
		services := []notebookService{{name: "Homarr", href: h.URL}}
		for _, item := range installed {
			if item.ID != "homarr" {
				services = append(services, notebookService{name: item.Name, href: item.URL})
			}
		}
		return services, nil
	}
	apps, err := listApps(ctx, h)
	if err != nil {
		return nil, err
	}
	services := []notebookService{{name: "Homarr", href: h.URL}}
	for _, item := range apps {
		name, href := stringField(item, "name"), stringField(item, "href")
		if name == "" || href == "" {
			continue
		}
		services = append(services, notebookService{name: name, href: href})
	}
	return services, nil
}

func findNotebook(items []map[string]any) (map[string]any, bool) {
	for _, item := range items {
		if stringField(item, "kind") != "notebook" {
			continue
		}
		options, _ := item["options"].(map[string]any)
		if strings.Contains(stringField(options, "content"), notebookMarker) {
			return item, true
		}
	}
	return nil, false
}

// ensureNotebook creates the notebook once and keeps its content in step with
// the linked Apps by updating the existing item, never adding a second one.
func ensureNotebook(ctx context.Context, h *helpers.H) error {
	if err := ensureAssistant(ctx, h); err != nil {
		return err
	}
	current, err := board(ctx, h)
	if err != nil {
		return err
	}
	services, err := notebookServices(ctx, h)
	if err != nil {
		return err
	}
	content := notebookContent(services)
	found, ok := findNotebook(itemsOf(current))
	if !ok {
		return addItem(ctx, h, map[string]any{
			"boardId":        stringField(current, "id"),
			"kind":           "notebook",
			"options":        map[string]any{"content": content, "showToolbar": false, "allowReadOnlyCheck": true},
			"size":           map[string]any{"width": 3, "height": 5},
			"integrationIds": []any{},
		})
	}
	options, _ := found["options"].(map[string]any)
	if !itemSizeMatches(current, found, 3, 5) {
		resizeItem(current, found, itemsOf(current), 3, 5, false)
		if err := saveItems(ctx, h, current, itemsOf(current)); err != nil {
			return err
		}
	}
	if stringField(options, "content") == content {
		return nil
	}
	_, err = apiKeyWrite(ctx, h, "widget.notebook.updateContent", map[string]any{
		"itemId": stringField(found, "id"), "boardId": stringField(current, "id"), "content": content,
	})
	return err
}

func notebookCurrent(ctx context.Context, h *helpers.H) (bool, error) {
	current, err := board(ctx, h)
	if err != nil {
		return false, err
	}
	services, err := notebookServices(ctx, h)
	if err != nil {
		return false, err
	}
	found, ok := findNotebook(itemsOf(current))
	if !ok {
		return false, nil
	}
	options, _ := found["options"].(map[string]any)
	return stringField(options, "content") == notebookContent(services) && itemSizeMatches(current, found, 3, 5), nil
}

func hasAssistant(items []map[string]any) bool {
	for _, item := range items {
		if stringField(item, "kind") == "assistant" {
			return true
		}
	}
	return false
}

// Place the widget without changing the owner's assistant provider/settings.
func ensureAssistant(ctx context.Context, h *helpers.H) error {
	current, err := board(ctx, h)
	if err != nil || hasAssistant(itemsOf(current)) {
		return err
	}
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/api/boards/items", Header: apiKeyHeader(h),
		JSON: map[string]any{
			"boardId": stringField(current, "id"), "kind": "assistant", "options": map[string]any{},
			"size": map[string]any{"width": 4, "height": 3}, "integrationIds": []any{},
		},
	})
	if err != nil {
		return err
	}
	if resp.OK() {
		var created struct{ ItemID string }
		if err := resp.Decode(&created); err != nil {
			return err
		}
		if created.ItemID == "" {
			return fmt.Errorf("Homarr did not return the assistant item ID; run self-host setup homarr")
		}
		return nil
	}
	var rejection struct {
		Message string
		Issues  []struct {
			Code     string
			Path     []string
			Values   []string
			Options  []string
			Received string
		}
	}
	if resp.Status == 400 && resp.Decode(&rejection) == nil {
		if strings.EqualFold(rejection.Message, "Unknown widget kind: assistant") {
			return nil
		}
		if rejection.Message == "Input validation failed" && len(rejection.Issues) == 1 {
			issue := rejection.Issues[0]
			kinds := issue.Values
			if issue.Code == "invalid_enum_value" && issue.Received == "assistant" {
				kinds = issue.Options
			}
			if len(issue.Path) == 1 && issue.Path[0] == "kind" &&
				(issue.Code == "invalid_value" || issue.Code == "invalid_enum_value") &&
				len(kinds) > 0 && !slices.Contains(kinds, "assistant") {
				return nil
			}
		}
	}
	return fmt.Errorf("Homarr rejected assistant creation (HTTP %d)", resp.Status)
}
