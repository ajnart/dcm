package homarr

import (
	"context"
	"html"
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
		rows = append(rows, `<li><strong><a href="`+html.EscapeString(service.href)+`">`+
			html.EscapeString(service.name)+`</a></strong></li>`)
	}
	return "<h2>" + notebookMarker + "</h2>" +
		"<p>This private board links your self-hosted Apps. A tile or widget does not by itself prove a working integration.</p>" +
		"<h3>Services</h3><ul>" + strings.Join(rows, "") + "</ul>" +
		"<h3>Admin login</h3><p>Sign in with the Admin login from <code>self-host credentials</code>. " +
		"This notebook never contains a password or API key.</p>" +
		"<h3>Request media</h3><p>Press Ctrl+K in Homarr, choose a media request, verify the exact title, " +
		"and request only authorized content.</p>"
}

// notebookServices lists the Apps Homarr knows, plus Homarr itself, so the
// notebook gains a line whenever a Link adds an App and loses it on removal.
func notebookServices(ctx context.Context, h *helpers.H) ([]notebookService, error) {
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
			"size":           map[string]any{"width": 8, "height": 8},
			"integrationIds": []any{},
		})
	}
	options, _ := found["options"].(map[string]any)
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
	return stringField(options, "content") == notebookContent(services), nil
}
