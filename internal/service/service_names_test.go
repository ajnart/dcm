package service

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"go.yaml.in/yaml/v3"
)

// This seam exercises real catalog rendering without App HTTP Setup.
type renderOnlyApp struct{ app.App }

func (renderOnlyApp) Setup(context.Context, *helpers.H) error { return nil }
func (renderOnlyApp) Check(context.Context, *helpers.H) error { return nil }

func TestReinstallRetiresLegacyServicesWithinProject(t *testing.T) {
	for _, tc := range []struct {
		id       string
		oldNames []string
		mounts   map[string][]string
	}{
		{"bookstack", []string{"db"}, map[string][]string{"bookstack-db": {"./database:/var/lib/mysql"}}},
		{"docmost", []string{"db", "redis"}, map[string][]string{"docmost-db": {"./database:/var/lib/postgresql"}, "docmost-redis": {"./redis:/data"}}},
		{"nextcloud", []string{"db", "redis", "cron"}, map[string][]string{"nextcloud-db": {"./db:/var/lib/mysql"}, "nextcloud-cron": {"./html:/var/www/html"}}},
	} {
		t.Run(tc.id, func(t *testing.T) {
			a, found := catalog.Default().App(tc.id)
			if !found {
				t.Fatal("App missing")
			}
			h := newHarness(t, renderOnlyApp{a}, &testApp{id: "other", done: map[string]bool{}})
			h.deps.Getenv = func(key string) string {
				if key == "SELF_HOST_COMPOSE_PROJECT" {
					return "upgrade-project"
				}
				if key == "SELF_HOST_ALLOW_UNAVAILABLE" {
					return "1"
				}
				return ""
			}
			if err := h.install(tc.id, "other"); err != nil {
				t.Fatal(err)
			}
			p, err := h.svc.Project()
			if err != nil {
				t.Fatal(err)
			}
			legacy := a.Compose(app.RenderContext{Port: a.Info().Port})
			for _, name := range tc.oldNames {
				legacy = strings.ReplaceAll(legacy, tc.id+"-"+name, name)
			}
			if err := os.WriteFile(p.FragmentPath(tc.id), []byte(legacy), 0600); err != nil {
				t.Fatal(err)
			}
			var sentinels []string
			for _, mounts := range tc.mounts {
				for _, mount := range mounts {
					source, _, _ := strings.Cut(mount, ":")
					path := p.Path("apps", tc.id, source, "sentinel")
					if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(path, []byte("existing-data"), 0600); err != nil {
						t.Fatal(err)
					}
					sentinels = append(sentinels, path)
				}
			}
			containers := map[string]bool{"upgrade-project/other": true, "another-project/db": true, "another-project/redis": true}
			for _, name := range tc.oldNames {
				containers["upgrade-project/"+name] = true
			}
			h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
				if !slices.Contains(cmd.Args, "up") {
					return system.Result{}
				}
				if cmd.Dir != p.Root || !strings.Contains(strings.Join(cmd.Args, " "), "-p upgrade-project ") {
					t.Fatal("cleanup escaped the Project")
				}
				for _, flag := range []string{"-v", "--volumes", "--renew-anon-volumes"} {
					if slices.Contains(cmd.Args, flag) {
						t.Fatal("upgrade requested volume deletion")
					}
				}
				data, err := os.ReadFile(p.FragmentPath(tc.id))
				if err != nil {
					t.Fatal(err)
				}
				var doc struct {
					Services map[string]struct{ Volumes []string }
				}
				if err := yaml.Unmarshal(data, &doc); err != nil {
					t.Fatal(err)
				}
				for service, mounts := range tc.mounts {
					for _, mount := range mounts {
						if !slices.Contains(doc.Services[service].Volumes, mount) {
							t.Fatal("upgrade changed a persistent data path")
						}
					}
				}
				if slices.Contains(cmd.Args, "--remove-orphans") {
					for _, name := range tc.oldNames {
						if _, configured := doc.Services[name]; !configured {
							delete(containers, "upgrade-project/"+name)
						}
					}
				}
				return system.Result{}
			})
			if err := h.install(tc.id); err != nil {
				t.Fatal(err)
			}
			for _, name := range tc.oldNames {
				if containers["upgrade-project/"+name] {
					t.Errorf("legacy service %s remains in the Project", name)
				}
			}
			for _, name := range []string{"upgrade-project/other", "another-project/db", "another-project/redis"} {
				if !containers[name] {
					t.Errorf("unrelated container %s was removed", name)
				}
			}
			for _, path := range sentinels {
				data, err := os.ReadFile(path)
				if err != nil || string(data) != "existing-data" {
					t.Fatal("upgrade changed existing data")
				}
			}
		})
	}
}
