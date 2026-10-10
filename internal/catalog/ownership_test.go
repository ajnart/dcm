package catalog

import (
	"sort"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/project"
	"go.yaml.in/yaml/v3"
)

func TestCatalogAppsRenderTogether(t *testing.T) {
	p := &project.Project{Root: t.TempDir()}
	fragments := map[string]string{}
	owners := map[string][]string{}
	for _, a := range Default().Apps() {
		info := a.Info()
		inputs := map[string]string{}
		for _, input := range a.Inputs() {
			inputs[input.Key] = input.Default
		}
		fragment := a.Compose(app.RenderContext{Port: info.Port, Inputs: inputs})
		fragments[info.ID] = fragment
		var doc struct {
			Services map[string]any `yaml:"services"`
		}
		if err := yaml.Unmarshal([]byte(fragment), &doc); err != nil {
			t.Fatalf("%s: %v", info.ID, err)
		}
		for name := range doc.Services {
			owners[name] = append(owners[name], info.ID)
			if name != info.Service && !strings.HasPrefix(name, info.ID+"-") {
				t.Errorf("App %s auxiliary service %s needs an App-owned name", info.ID, name)
			}
		}
	}
	names := make([]string, 0, len(owners))
	for name := range owners {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if len(owners[name]) > 1 {
			t.Errorf("colliding service %s: %s", name, strings.Join(owners[name], ", "))
		}
	}
	if err := p.ValidateServiceOwnership(fragments); err != nil {
		t.Fatal(err)
	}
}

func TestCatalogAppOwnedServiceReferences(t *testing.T) {
	references := map[string][]string{
		"authentik":     {"AUTHENTIK_POSTGRESQL__HOST: authentik-postgresql"},
		"bookstack":     {"DB_HOST: bookstack-db"},
		"docmost":       {"redis://docmost-redis:6379", "@docmost-db:5432/docmost"},
		"firefly-iii":   {"DB_HOST: firefly-iii-db"},
		"immich":        {"DB_HOSTNAME: immich-database"},
		"keycloak":      {"--db-url-host=keycloak-db"},
		"linkwarden":    {"http://linkwarden-meilisearch:7700", "postgresql://postgres:${LINKWARDEN_DB_PASSWORD}@linkwarden-postgres:5432/postgres"},
		"mayan-edms":    {"'HOST': 'mayan-edms-postgresql'", "@mayan-edms-rabbitmq:5672", "@mayan-edms-redis:6379/1", "@mayan-edms-redis:6379/2", "@mayan-edms-redis:6379/3"},
		"nextcloud":     {"MYSQL_HOST: nextcloud-db", "REDIS_HOST: nextcloud-redis"},
		"paperless-ngx": {"redis://paperless-ngx-broker:6379", "PAPERLESS_DBHOST: paperless-ngx-db"},
		"passbolt":      {"DATASOURCES_DEFAULT_HOST: passbolt-db", "wait-for.sh -t 0 passbolt-db:3306"},
		"patchmon":      {"REDIS_HOST: patchmon-redis", "@patchmon-database:5432", "GUACD_ADDRESS: patchmon-guacd:4822"},
		"seafile":       {"SEAFILE_MYSQL_DB_HOST: seafile-db", "REDIS_HOST: seafile-redis"},
		"tracearr":      {"redis://tracearr-redis:6379", "@tracearr-timescale:5432"},
		"umami":         {"@umami-db:5432"},
	}
	for _, a := range Default().Apps() {
		t.Run(a.Info().ID, func(t *testing.T) {
			rc := app.RenderContext{Port: a.Info().Port}
			fragment := a.Compose(rc)
			for _, reference := range references[a.Info().ID] {
				if !strings.Contains(fragment, reference) {
					t.Error("App's connection does not reference its owned service")
				}
			}
			var doc struct {
				Services map[string]struct {
					DependsOn any `yaml:"depends_on"`
				} `yaml:"services"`
			}
			if err := yaml.Unmarshal([]byte(fragment), &doc); err != nil {
				t.Fatal(err)
			}
			for name, svc := range doc.Services {
				var dependencies []string
				switch deps := svc.DependsOn.(type) {
				case []any:
					for _, dep := range deps {
						dependencies = append(dependencies, dep.(string))
					}
				case map[string]any:
					for dep := range deps {
						dependencies = append(dependencies, dep)
					}
				}
				for _, dep := range dependencies {
					if _, found := doc.Services[dep]; !found {
						t.Errorf("%s depends on missing service %s", name, dep)
					}
				}
			}
			if a.Info().ID == "pangolin" {
				files := a.(app.FileDeclarer).Files(rc, func(string) string { return "" })
				for _, file := range files {
					if file.Path == "dynamic.yml" && (!strings.Contains(file.Content, "http://pangolin-server:3000") || !strings.Contains(file.Content, "http://pangolin-server:3002")) {
						t.Error("router does not target Pangolin's owned server")
					}
					if file.Path == "config.yml" && !strings.Contains(file.Content, `internal_hostname: "pangolin-server"`) {
						t.Error("Pangolin internal hostname does not target its owned server")
					}
				}
			}
		})
	}
}
