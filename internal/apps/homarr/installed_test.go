package homarr_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/homarr"
	"github.com/ajnart/self-host/internal/helpers"
)

func serveLinkedApps(t *testing.T, fake *fakeHomarr) *httptest.Server {
	t.Helper()
	fallback := fake.handler()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/trpc/integration.all" {
			fake.mu.Lock()
			defer fake.mu.Unlock()
			if !fake.keyOK(r) {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			integrations := []any{}
			for _, integration := range fake.integrations {
				integrations = append(integrations, map[string]any{"id": integration["id"], "name": integration["name"], "kind": integration["kind"], "url": integration["url"]})
			}
			trpc(w, integrations)
			return
		}
		if r.Method == "DELETE" && strings.HasPrefix(r.URL.Path, "/api/apps/") {
			id := strings.TrimPrefix(r.URL.Path, "/api/apps/")
			fake.mu.Lock()
			for _, integration := range fake.integrations {
				if integration["appId"] == id {
					integration["appId"] = nil
				}
			}
			fake.mu.Unlock()
			fallback.ServeHTTP(w, r)
			return
		}
		if r.URL.Path == "/api/trpc/integration.byId" {
			var input struct {
				JSON struct {
					ID string `json:"id"`
				} `json:"json"`
			}
			json.Unmarshal([]byte(r.URL.Query().Get("input")), &input)
			fake.mu.Lock()
			defer fake.mu.Unlock()
			for _, integration := range fake.integrations {
				if integration["id"] == input.JSON.ID {
					var app any
					if integration["appId"] != nil {
						app = map[string]any{"id": integration["appId"]}
					}
					trpc(w, map[string]any{"id": integration["id"], "kind": integration["kind"], "url": integration["url"], "secrets": []any{}, "app": app})
					return
				}
			}
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.Method == "POST" && r.URL.Path == "/api/trpc/integration.create" {
			data, _ := io.ReadAll(r.Body)
			var body struct {
				JSON map[string]any `json:"json"`
			}
			json.Unmarshal(data, &body)
			r.Body = io.NopCloser(bytes.NewReader(data))
			fallback.ServeHTTP(w, r)
			linkedApp, _ := body.JSON["app"].(map[string]any)
			fake.mu.Lock()
			fake.integrations[len(fake.integrations)-1]["appId"] = linkedApp["id"]
			fake.mu.Unlock()
			return
		}
		fallback.ServeHTTP(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestSetupRepairsInterruptedAppOwnershipAndPreservesUserAssociations(t *testing.T) {
	fake := newFake()
	fake.apiKey, fake.adminExists, fake.adminName, fake.adminPassword, fake.step = "keyid.secret", true, "admin", "pw", "finish"
	srv := serveLinkedApps(t, fake)
	secrets := allSecrets()
	h := homarrH(t, srv, secrets)
	installed := []helpers.InstalledApp{{ID: "sonarr", Name: "Sonarr", URL: "http://host.example:8988", Service: "sonarr", ContainerPort: 8988}}
	h.InstalledApps = func(context.Context) ([]helpers.InstalledApp, error) { return installed, nil }
	if err := (homarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	genericID := fake.apps[0]["id"].(string)
	fake.mu.Unlock()
	if err := linkFor(t, "sonarr").Apply(context.Background(), h, targetH(t, srv, "sonarr", 8989, secrets)); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	linkedID := "interrupted-native-app"
	fake.apps = append(fake.apps, map[string]any{"id": linkedID, "appId": linkedID, "name": "Sonarr", "description": "self-host tile:sonarr", "href": installed[0].URL, "pingUrl": "http://sonarr:8989", "iconUrl": "https://example.test/native.svg"})
	fake.integrations[0]["appId"] = linkedID
	fake.integrations = append(fake.integrations, map[string]any{"id": "user-integration", "kind": "sonarr", "url": "http://sonarr:8988", "appId": genericID})
	fake.items = append(fake.items, map[string]any{"id": "user-tile", "kind": "app", "options": map[string]any{"appId": genericID}})
	fake.apps = append(fake.apps, map[string]any{"id": "user-app", "name": "Sonarr", "description": "My bookmark", "href": "http://user.example", "pingUrl": "http://sonarr:8989", "iconUrl": "https://example.test/user.svg"})
	fake.mu.Unlock()
	checkpoint, _ := json.Marshal(map[string]string{"sonarr": genericID})
	secrets["HOMARR_APP_IDS"] = string(checkpoint)
	for attempt := 0; attempt < 2; attempt++ {
		if err := (homarr.App{}).Setup(context.Background(), h); err != nil {
			t.Fatalf("interrupted retry: %v", err)
		}
	}
	var owned map[string]string
	json.Unmarshal([]byte(secrets["HOMARR_APP_IDS"]), &owned)
	if owned["sonarr"] != linkedID {
		t.Fatal("retry did not recover the App attached to the owned integration")
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.apps) != 3 || len(fake.integrations) != 2 || fake.integrations[0]["appId"] != linkedID || fake.integrations[1]["appId"] != genericID {
		t.Fatal("retry changed a user association or duplicated App/integration records")
	}
	for _, record := range fake.apps {
		if record["id"] == genericID && record["description"] != "self-host retained tile:sonarr" {
			t.Fatal("referenced duplicate was not released as retained")
		}
		if record["id"] == "user-app" && (record["description"] != "My bookmark" || record["href"] != "http://user.example") {
			t.Fatal("manual App was changed")
		}
	}
	for _, item := range fake.items {
		if item["id"] == "user-tile" {
			return
		}
	}
	t.Fatal("retry removed a user tile")
}

func TestSetupPreservesLinkedAppWhenBrowserAndNativePortsDiffer(t *testing.T) {
	fake := newFake()
	fake.apiKey, fake.adminExists, fake.adminName, fake.adminPassword, fake.step = "keyid.secret", true, "admin", "pw", "finish"
	srv := serveLinkedApps(t, fake)
	secrets := allSecrets()
	h := homarrH(t, srv, secrets)
	installed := []helpers.InstalledApp{{ID: "sonarr", Name: "Sonarr", URL: "http://host.example:8988", Service: "sonarr", ContainerPort: 8988}}
	h.InstalledApps = func(context.Context) ([]helpers.InstalledApp, error) { return installed, nil }
	if err := (homarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	if err := linkFor(t, "sonarr").Apply(context.Background(), h, targetH(t, srv, "sonarr", 8989, secrets)); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	linkedID := fake.integrations[0]["appId"]
	for _, record := range fake.apps {
		if record["id"] == linkedID {
			record["name"] = "My Sonarr"
			record["iconUrl"] = "https://example.test/custom.svg"
		}
	}
	fake.mu.Unlock()
	installed[0].URL = "http://host.example:8990"
	for attempt := 0; attempt < 2; attempt++ {
		if err := (homarr.App{}).Setup(context.Background(), h); err != nil {
			t.Fatalf("retry: %v", err)
		}
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.apps) != 1 || len(fake.integrations) != 1 || fake.apps[0]["id"] != linkedID || fake.integrations[0]["appId"] != linkedID {
		t.Fatal("retry replaced the linked App or its native integration")
	}
	if fake.apps[0]["pingUrl"] != "http://sonarr:8988" || fake.integrations[0]["url"] != "http://sonarr:8989" || fake.apps[0]["href"] != installed[0].URL || fake.apps[0]["name"] != "My Sonarr" || fake.apps[0]["iconUrl"] != "https://example.test/custom.svg" {
		t.Fatal("retry changed the native ping or customized App fields")
	}
}

func TestSetupPreservesUserIntegrationOnUnmarkedDuplicate(t *testing.T) {
	fake := newFake()
	fake.apiKey, fake.adminExists, fake.adminName, fake.adminPassword, fake.step = "keyid.secret", true, "admin", "pw", "finish"
	fake.apps = []map[string]any{
		{"id": "marked-sonarr", "name": "My Sonarr", "description": "self-host tile:sonarr", "href": "http://host.example:8989", "pingUrl": "http://sonarr:8989", "iconUrl": "https://example.test/custom.svg"},
		{"id": "user-sonarr", "name": "Sonarr", "description": "", "href": "http://user.example", "pingUrl": "http://sonarr:8989", "iconUrl": "https://example.test/user.svg"},
	}
	fake.integrations = []map[string]any{{"id": "user-integration", "name": "User Sonarr", "kind": "sonarr", "url": "http://sonarr:8989", "appId": "user-sonarr"}}
	beforeIntegration, _ := json.Marshal(fake.integrations[0])
	srv := serveLinkedApps(t, fake)
	secrets := allSecrets()
	h := homarrH(t, srv, secrets)
	h.InstalledApps = func(context.Context) ([]helpers.InstalledApp, error) {
		return []helpers.InstalledApp{{ID: "sonarr", Name: "Sonarr", URL: "http://host.example:8989", Service: "sonarr", ContainerPort: 8989}}, nil
	}
	for attempt := 0; attempt < 2; attempt++ {
		if err := (homarr.App{}).Setup(context.Background(), h); err != nil {
			t.Fatal(err)
		}
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	afterIntegration, _ := json.Marshal(fake.integrations[0])
	if len(fake.apps) != 2 || !bytes.Equal(beforeIntegration, afterIntegration) {
		t.Fatal("Setup deleted the unmarked App or detached its user integration")
	}
	for _, record := range fake.apps {
		if record["id"] == "user-sonarr" && (record["href"] != "http://user.example" || record["name"] != "Sonarr" || record["pingUrl"] != "http://sonarr:8989" || record["iconUrl"] != "https://example.test/user.svg") {
			t.Fatal("Setup changed the referenced App's navigation fields")
		}
		if record["id"] == "marked-sonarr" && (record["description"] != "self-host tile:sonarr" || record["name"] != "My Sonarr") {
			t.Fatal("Setup replaced the owned App or its customized name")
		}
	}
}

func TestLinkRetryPreservesOwnedAppWithCustomPing(t *testing.T) {
	fake := newFake()
	fake.apiKey, fake.adminExists, fake.adminName, fake.adminPassword, fake.step = "keyid.secret", true, "admin", "pw", "finish"
	srv := serveLinkedApps(t, fake)
	secrets := allSecrets()
	from := homarrH(t, srv, secrets)
	installed := []helpers.InstalledApp{{ID: "sonarr", Name: "Sonarr", URL: "http://host.example:8988", Service: "sonarr", ContainerPort: 8988}}
	from.InstalledApps = func(context.Context) ([]helpers.InstalledApp, error) { return installed, nil }
	to := targetH(t, srv, "sonarr", 8989, secrets)
	link := linkFor(t, "sonarr")
	if err := (homarr.App{}).Setup(context.Background(), from); err != nil {
		t.Fatal(err)
	}
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	if err := (homarr.App{}).Setup(context.Background(), from); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	appID, integrationID := fake.apps[0]["id"], fake.integrations[0]["id"]
	widgetIDs := map[any]bool{}
	for _, item := range fake.items {
		widgetIDs[item["id"]] = true
	}
	fake.apps[0]["name"] = "My Sonarr"
	fake.apps[0]["iconUrl"] = "https://example.test/custom.svg"
	fake.apps[0]["pingUrl"] = "http://health.example:9999/status"
	fake.mu.Unlock()
	installed[0].URL = "http://host.example:8990"
	for attempt := 0; attempt < 3; attempt++ {
		if err := link.Apply(context.Background(), from, to); err != nil {
			t.Fatalf("Link retry: %v", err)
		}
		if err := (homarr.App{}).Setup(context.Background(), from); err != nil {
			t.Fatalf("Setup retry: %v", err)
		}
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.apps) != 1 || len(fake.integrations) != 1 || fake.apps[0]["id"] != appID || fake.integrations[0]["id"] != integrationID || fake.integrations[0]["appId"] != appID {
		t.Fatal("custom ping caused App replacement or changed an integration association")
	}
	if len(fake.items) != len(widgetIDs) {
		t.Fatal("custom ping grew retained tiles or widgets")
	}
	for _, item := range fake.items {
		if !widgetIDs[item["id"]] {
			t.Fatal("custom ping replaced a widget or created a tile")
		}
	}
	if fake.apps[0]["pingUrl"] != "http://health.example:9999/status" || fake.apps[0]["href"] != installed[0].URL || fake.apps[0]["name"] != "My Sonarr" || fake.apps[0]["iconUrl"] != "https://example.test/custom.svg" {
		t.Fatal("Link retry rewrote custom App fields instead of updating its browser Address")
	}
}

func TestLinkDoesNotReclaimRetainedAppFromStaleOwnership(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serveLinkedApps(t, fake)
	secrets := allSecrets()
	from := homarrH(t, srv, secrets)
	to := targetH(t, srv, "sonarr", 8989, secrets)
	link := linkFor(t, "sonarr")
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	retainedID := fake.apps[0]["id"].(string)
	oldIntegrationID := fake.integrations[0]["id"]
	fake.items = append(fake.items, map[string]any{"id": "user-calendar", "kind": "calendar", "integrationIds": []any{oldIntegrationID}, "options": map[string]any{}})
	fake.mu.Unlock()
	if err := link.Remove(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	fake.items = append(fake.items, map[string]any{"id": "user-retained-tile", "kind": "app", "options": map[string]any{"appId": retainedID, "showTitle": false, "openInNewTab": false}, "layouts": []any{map[string]any{"x": 4, "y": 2, "width": 2, "height": 1}}})
	fake.mu.Unlock()
	stale, _ := json.Marshal(map[string]string{"sonarr": retainedID})
	secrets["HOMARR_APP_IDS"] = string(stale)
	fake.mu.Lock()
	beforeRemoval, _ := json.Marshal([]any{fake.apps, fake.integrations, fake.items})
	fake.mu.Unlock()
	if err := link.Remove(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	afterRemoval, _ := json.Marshal([]any{fake.apps, fake.integrations, fake.items})
	fake.mu.Unlock()
	if !bytes.Equal(beforeRemoval, afterRemoval) {
		t.Fatal("stale removal changed the retained App, integration, calendar or user tile")
	}
	var released map[string]string
	json.Unmarshal([]byte(secrets["HOMARR_APP_IDS"]), &released)
	if released["sonarr"] != "" {
		t.Fatal("stale removal kept the retained App ownership pointer")
	}
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.apps) != 2 || len(fake.integrations) != 2 || fake.integrations[0]["id"] != oldIntegrationID || fake.integrations[0]["appId"] != retainedID || fake.integrations[1]["appId"] == retainedID {
		t.Fatal("stale ownership reclaimed a retained App or changed its user integration")
	}
	for _, record := range fake.apps {
		if record["id"] == retainedID && record["description"] != "self-host retained tile:sonarr" {
			t.Fatal("retained App marker changed")
		}
	}
	calendar, tile := false, false
	for _, item := range fake.items {
		if item["id"] == "user-calendar" {
			calendar = true
		}
		if item["id"] == "user-retained-tile" {
			tile = true
			options, _ := item["options"].(map[string]any)
			if options["appId"] != retainedID || options["showTitle"] != false || options["openInNewTab"] != false {
				t.Fatal("reinstallation changed the retained user tile")
			}
			layout, _ := json.Marshal(item["layouts"])
			if string(layout) != `[{"height":1,"width":2,"x":4,"y":2}]` {
				t.Fatal("reinstallation changed the retained user tile's layout")
			}
		}
	}
	if !calendar || !tile {
		t.Fatal("reinstallation removed a user widget or retained App tile")
	}
}
