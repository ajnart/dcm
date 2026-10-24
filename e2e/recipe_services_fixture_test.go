package e2e

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"go.yaml.in/yaml/v3"
)

func TestRecipeServiceInventoryHasDistinctAppDependencies(t *testing.T) {
	for _, recipe := range catalog.Default().Recipes() {
		t.Run(recipe.ID, func(t *testing.T) {
			expected := expectedServices(targetSpec{Apps: recipe.Apps})
			seen := map[string]bool{}
			var rows []containerEntry
			for _, name := range expected {
				if seen[name] {
					t.Fatalf("distinct Apps define the same Compose service %s", name)
				}
				seen[name] = true
				rows = append(rows, containerEntry{Service: name, State: "running"})
			}
			document, _ := json.Marshal(rows)
			if !containersReadyJSON(string(document), expected) {
				t.Fatal("exact healthy recipe service inventory was rejected")
			}
		})
	}
}

func TestPhotoAndFileRedisReferencesUseTheirOwnedSidecar(t *testing.T) {
	for _, tc := range []struct{ id, env, cache, image string }{
		{"immich", "REDIS_HOSTNAME", "immich-redis", "docker.io/valkey/valkey:latest"},
		{"nextcloud", "REDIS_HOST", "nextcloud-redis", "redis:alpine"},
	} {
		t.Run(tc.id, func(t *testing.T) {
			a, _ := catalog.Default().App(tc.id)
			var doc struct {
				Services map[string]struct {
					Image       string            `yaml:"image"`
					Environment map[string]string `yaml:"environment"`
					DependsOn   []string          `yaml:"depends_on"`
					Volumes     []string          `yaml:"volumes"`
				} `yaml:"services"`
			}
			if err := yaml.Unmarshal([]byte(a.Compose(app.RenderContext{Port: 31001})), &doc); err != nil {
				t.Fatal(err)
			}
			if doc.Services[tc.cache].Image != tc.image || doc.Services[tc.id].Environment[tc.env] != tc.cache || !slices.Contains(doc.Services[tc.id].DependsOn, tc.cache) {
				t.Fatal("App does not connect to its distinct original Redis sidecar image")
			}
			if tc.id == "nextcloud" && (doc.Services["nextcloud-cron"].Environment[tc.env] != tc.cache || !slices.Contains(doc.Services["nextcloud"].Volumes, "./html:/var/www/html") || !slices.Contains(doc.Services["nextcloud-db"].Volumes, "./db:/var/lib/mysql")) {
				t.Fatal("Nextcloud cron or persistent paths changed")
			}
			if tc.id == "immich" && (!slices.Contains(doc.Services["immich"].Volumes, "./uploads:/data") || !slices.Contains(doc.Services["immich-database"].Volumes, "./database:/var/lib/postgresql/data")) {
				t.Fatal("Immich persistent paths changed")
			}
		})
	}
}
