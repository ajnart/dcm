package cli_test

import (
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"go.yaml.in/yaml/v3"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

var updateGolden = flag.Bool("update", false, "rewrite golden files")

func golden(t *testing.T, name, got string) {
	t.Helper()
	path := filepath.Join("testdata", name+".golden")
	if *updateGolden {
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("missing golden %s (run go test -update): %v", path, err)
	}
	if string(want) != got {
		t.Fatalf("%s changed (run go test -update to accept):\n%s", name, got)
	}
}

// accessApp is an echo App whose Info a test shapes.
type accessApp struct {
	*echoApp
	info func(app.Info) app.Info
}

func (a accessApp) Info() app.Info { return a.info(a.echoApp.Info()) }

func accessSample(t *testing.T) (*system.Deps, *catalog.Catalog) {
	t.Helper()
	deps := systemtest.NewDeps(t)
	done := map[string]bool{}
	apps := []app.App{
		accessApp{&echoApp{id: "media", done: done}, func(i app.Info) app.Info {
			i.Name, i.Port, i.ContainerPort, i.WebSockets, i.LongTimeouts = "Media Server", 8096, 8096, true, true
			return i
		}},
		accessApp{&echoApp{id: "notes", done: done}, func(i app.Info) app.Info {
			i.Name, i.Port, i.ContainerPort = "Notes", 3000, 3000
			return i
		}},
		accessApp{&echoApp{id: "chat", done: done}, func(i app.Info) app.Info {
			i.Name, i.Port, i.ContainerPort, i.WebSockets = "Chat", 8080, 8080, true
			return i
		}},
		accessApp{&echoApp{id: "queue", done: done}, func(i app.Info) app.Info {
			i.Name, i.Port, i.ContainerPort, i.NoWebUI = "Queue", 5672, 5672, true
			return i
		}},
	}
	cat := testCatalog(apps...)
	if code, out := runWith(t, deps, cat, "install", "--yes", "media", "notes", "chat", "queue"); code != 0 {
		t.Fatalf("install: %d\n%s", code, out)
	}
	return deps, cat
}

func TestAccessExportRendersEachFormatForTheSampleProject(t *testing.T) {
	for _, format := range []string{"caddy", "nginx", "traefik", "json"} {
		t.Run(format, func(t *testing.T) {
			deps, cat := accessSample(t)

			code, out := runWith(t, deps, cat, "access", "export", "--format", format)

			if code != 0 {
				t.Fatalf("exit %d\n%s", code, out)
			}
			golden(t, "access-export-"+format, out)
		})
	}
}

func TestAccessExportJSONListsEveryAppWithAWebPageAndOmitsTheRest(t *testing.T) {
	deps, cat := accessSample(t)

	_, out := runWith(t, deps, cat, "access", "export", "--format", "json")

	var export struct {
		Network string `json:"network"`
		Apps    []struct {
			ID            string `json:"id"`
			Name          string `json:"name"`
			Hostname      string `json:"hostname"`
			Upstream      string `json:"upstream"`
			HostUpstream  string `json:"host_upstream"`
			ContainerPort int    `json:"container_port"`
			WebSockets    *bool  `json:"websockets"`
			LongTimeouts  *bool  `json:"long_timeouts"`
		} `json:"apps"`
	}
	if err := json.Unmarshal([]byte(out), &export); err != nil {
		t.Fatalf("not JSON: %v\n%s", err, out)
	}
	var ids []string
	for _, a := range export.Apps {
		ids = append(ids, a.ID)
	}
	if strings.Join(ids, ",") != "chat,media,notes" {
		t.Fatalf("apps %v: Queue has no web page and must be left out", ids)
	}
	media := export.Apps[1]
	if media.Name != "Media Server" || media.Hostname != "media.example.com" || media.Upstream != "media:8096" ||
		!strings.HasPrefix(media.HostUpstream, "192.168.1.20:") || media.WebSockets == nil || !*media.WebSockets || media.LongTimeouts == nil {
		t.Fatalf("media %+v", media)
	}
	if notes := export.Apps[2]; notes.WebSockets != nil || notes.LongTimeouts != nil {
		t.Fatalf("what is not known is omitted, not false: %+v", notes)
	}
}

func TestAccessExportChangesNothing(t *testing.T) {
	deps, cat := accessSample(t)
	root := projectRoot(t, deps)
	before := treeListing(t, root)
	commands := len(deps.Runner.(*systemtest.Runner).Calls())

	for _, format := range []string{"caddy", "nginx", "traefik", "json"} {
		runWith(t, deps, cat, "access", "export", "--format", format)
	}

	if after := treeListing(t, root); after != before {
		t.Fatalf("the Project changed:\n%s\n---\n%s", before, after)
	}
	if got := len(deps.Runner.(*systemtest.Runner).Calls()); got != commands {
		t.Fatalf("export ran %d commands, want none", got-commands)
	}
}

func TestAccessExportRejectsAnUnknownFormat(t *testing.T) {
	deps, cat := accessSample(t)

	code, out := runWith(t, deps, cat, "access", "export", "--format", "apache")

	if code == 0 || !strings.Contains(out, "caddy, nginx, traefik or json") {
		t.Fatalf("exit %d, want a clear error naming the formats\n%s", code, out)
	}
}

func TestAccessExportForDocumentedCatalogWebSockets(t *testing.T) {
	for _, id := range []string{"headscale", "gotify", "beszel"} {
		t.Run(id, func(t *testing.T) {
			deps, _ := accessSample(t)
			cat := catalog.Default()
			a, found := cat.App(id)
			if !found {
				t.Fatal("App missing from Catalog")
			}
			p := &project.Project{Root: projectRoot(t, deps)}
			if err := p.WriteFragment(id, a.Compose(app.RenderContext{Port: a.Info().Port})); err != nil {
				t.Fatal(err)
			}
			state, err := p.LoadState()
			if err != nil {
				t.Fatal(err)
			}
			state.Apps[id] = &project.AppState{Port: a.Info().Port}
			if err := p.SaveState(state); err != nil {
				t.Fatal(err)
			}
			code, out := runWith(t, deps, cat, "access", "export", "--format", "nginx")
			if code != 0 || !strings.Contains(out, "proxy_pass http://"+a.Info().Service+":") ||
				!strings.Contains(out, "proxy_set_header Upgrade $http_upgrade;") ||
				!strings.Contains(out, "proxy_set_header Connection \"upgrade\";") {
				t.Fatalf("documented WebSocket forwarding missing: exit %d\n%s", code, out)
			}
			_, out = runWith(t, deps, cat, "access", "export", "--format", "json")
			var export service.AccessExport
			if err := json.Unmarshal([]byte(out), &export); err != nil {
				t.Fatal(err)
			}
			for _, item := range export.Apps {
				if item.ID == id && (item.WebSockets == nil || !*item.WebSockets || item.LongTimeouts != nil) {
					t.Fatalf("requirements: %+v", item)
				}
			}
		})
	}
}

func TestAccessExportUnmanagedWebApp(t *testing.T) {
	for _, folder := range []string{"extra", "apps"} {
		t.Run(folder, func(t *testing.T) {
			deps, cat := accessSample(t)
			root := projectRoot(t, deps)
			dir := filepath.Join(root, folder, "whoami")
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "compose.yml"), []byte("services:\n  whoami-web:\n    image: traefik/whoami\n    ports: [\"8099:80\"]\n    environment:\n      PRIVATE: synthetic-private-value\n    env_file: never-read.env\n"), 0o644); err != nil {
				t.Fatal(err)
			}
			before := treeListing(t, root)
			commands := len(deps.Runner.(*systemtest.Runner).Calls())
			for _, format := range []string{"caddy", "nginx", "traefik", "json"} {
				code, out := runWith(t, deps, cat, "access", "export", "--format", format)
				if code != 0 || !strings.Contains(out, "whoami-web:80") || !strings.Contains(out, "192.168.1.20:8099") || strings.Contains(out, "synthetic-private-value") || strings.Contains(out, "never-read.env") {
					t.Fatalf("exit %d\n%s", code, out)
				}
				if format == "json" {
					var export service.AccessExport
					if err := json.Unmarshal([]byte(out), &export); err != nil {
						t.Fatal(err)
					}
					item := export.Apps[len(export.Apps)-1]
					if item.ID != "whoami" || item.Hostname != "whoami.example.com" || item.HostPort != 8099 || item.ContainerPort != 80 || item.WebSockets != nil || item.LongTimeouts != nil {
						t.Fatalf("Unmanaged app: %+v", item)
					}
				}
				golden(t, "access-export-unmanaged-"+format, out)
			}
			if treeListing(t, root) != before || len(deps.Runner.(*systemtest.Runner).Calls()) != commands {
				t.Fatal("export changed the Project or ran a command")
			}
		})
	}
}

func TestAccessExportExplainsUnsupportedUnmanagedFragments(t *testing.T) {
	for name, fragment := range map[string]string{
		"ambiguous":       "services:\n  one:\n    ports: [\"8099:80\"]\n  two:\n    ports: [\"8100:80\"]\n",
		"variable":        "services:\n  web:\n    ports: [\"${PRIVATE}:80\"]\n    environment:\n      PRIVATE: synthetic-private-value\n",
		"malformed":       "services: [synthetic-private-value",
		"non-web":         "services:\n  database:\n    ports: [\"5432:5432\"]\n",
		"range":           "services:\n  web:\n    ports: [\"8099-8100:80\"]\n",
		"host-network":    "services:\n  web:\n    network_mode: host\n    ports: [\"8099:80\"]\n",
		"include":         "include: [never-read.env]\nservices:\n  web:\n    ports: [\"8099:80\"]\n",
		"collision":       "services:\n  notes:\n    ports: [\"8099:80\"]\n",
		"profile":         "services:\n  web:\n    profiles: [optional]\n    ports: [\"8099:80\"]\n",
		"renamed-network": "networks:\n  default:\n    name: different\nservices:\n  web:\n    ports: [\"8099:80\"]\n",
	} {
		t.Run(name, func(t *testing.T) {
			deps, cat := accessSample(t)
			root := projectRoot(t, deps)
			dir := filepath.Join(root, "extra", "unsupported")
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "compose.yml"), []byte(fragment), 0o644); err != nil {
				t.Fatal(err)
			}
			before := treeListing(t, root)
			commands := len(deps.Runner.(*systemtest.Runner).Calls())
			for _, format := range []string{"caddy", "nginx", "traefik", "json"} {
				code, out := runWith(t, deps, cat, "access", "export", "--format", format)
				if code != 0 || !strings.Contains(out, "configure the proxy manually") || strings.Contains(out, "synthetic-private-value") || strings.Contains(out, "never-read.env") || strings.Contains(out, "unsupported.example.com") {
					t.Fatalf("safe explanation missing: exit %d\n%s", code, out)
				}
				if format == "json" {
					var export struct {
						Warnings []struct {
							ID     string `json:"id"`
							Reason string `json:"reason"`
						} `json:"warnings"`
					}
					if err := json.Unmarshal([]byte(out), &export); err != nil || len(export.Warnings) != 1 || export.Warnings[0].ID != "unsupported" || export.Warnings[0].Reason == "" {
						t.Fatalf("warnings %+v: %v", export.Warnings, err)
					}
				}
				if name == "ambiguous" {
					golden(t, "access-export-ambiguous-"+format, out)
				}
			}
			if treeListing(t, root) != before || len(deps.Runner.(*systemtest.Runner).Calls()) != commands {
				t.Fatal("export changed the Project or ran a command")
			}
		})
	}
}

func TestAccessExportUnmanagedExplicitHTTPPort(t *testing.T) {
	deps, cat := accessSample(t)
	dir := filepath.Join(projectRoot(t, deps), "extra", "whoami")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	fragment := "services:\n  whoami:\n    ports:\n      - target: 3000\n        published: \"8099\"\n        host_ip: 127.0.0.1\n        protocol: tcp\n        app_protocol: http\n"
	if err := os.WriteFile(filepath.Join(dir, "compose.yml"), []byte(fragment), 0o644); err != nil {
		t.Fatal(err)
	}
	code, out := runWith(t, deps, cat, "access", "export", "--format", "json")
	var export service.AccessExport
	if err := json.Unmarshal([]byte(out), &export); err != nil || code != 0 {
		t.Fatalf("exit %d: %v\n%s", code, err, out)
	}
	item := export.Apps[len(export.Apps)-1]
	if item.ID != "whoami" || item.Upstream != "whoami:3000" || item.HostUpstream != "127.0.0.1:8099" || item.WebSockets != nil || item.LongTimeouts != nil {
		t.Fatalf("explicit HTTP upstream: %+v", item)
	}
}

func TestAccessExportDoesNotLoadSecrets(t *testing.T) {
	deps, cat := accessSample(t)
	path := filepath.Join(projectRoot(t, deps), "secrets.env")
	if err := os.Rename(path, path+".fixture"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path, 0o700); err != nil {
		t.Fatal(err)
	}
	code, out := runWith(t, deps, cat, "access", "export", "--format", "json")
	if code != 0 || !strings.Contains(out, "media:8096") {
		t.Fatalf("export must not load secrets: exit %d\n%s", code, out)
	}
}

func TestAccessExportWithoutAProjectSaysToInstallFirst(t *testing.T) {
	deps := systemtest.NewDeps(t)

	code, out := runWith(t, deps, testCatalog(), "access", "export", "--format", "caddy")

	if code == 0 || !strings.Contains(out, "self-host install") {
		t.Fatalf("exit %d\n%s", code, out)
	}
}

func treeListing(t *testing.T, root string) string {
	t.Helper()
	var b strings.Builder
	filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		b.WriteString(path + " " + info.ModTime().String() + "\n")
		if !info.IsDir() && !strings.HasPrefix(info.Name(), ".env") && !strings.HasSuffix(info.Name(), ".env") {
			data, _ := os.ReadFile(path)
			b.WriteString(string(data) + "\n")
		}
		return nil
	})
	return b.String()
}

func TestAccessExportTraefikIsDynamicConfigWhoseRoutersAllPointAtAService(t *testing.T) {
	deps, cat := accessSample(t)

	_, out := runWith(t, deps, cat, "access", "export", "--format", "traefik")

	var config struct {
		HTTP struct {
			Routers map[string]struct {
				Rule    string `yaml:"rule"`
				Service string `yaml:"service"`
			} `yaml:"routers"`
			Services map[string]struct {
				LoadBalancer struct {
					Servers []struct {
						URL string `yaml:"url"`
					} `yaml:"servers"`
				} `yaml:"loadBalancer"`
			} `yaml:"services"`
		} `yaml:"http"`
	}
	if err := yaml.Unmarshal([]byte(out), &config); err != nil {
		t.Fatalf("not YAML: %v\n%s", err, out)
	}
	if len(config.HTTP.Routers) != 3 || config.HTTP.Routers["selfhost-media"].Rule != "Host(`media.example.com`)" {
		t.Fatalf("routers %+v", config.HTTP.Routers)
	}
	for name, router := range config.HTTP.Routers {
		servers := config.HTTP.Services[router.Service].LoadBalancer.Servers
		if len(servers) != 1 || !strings.HasPrefix(servers[0].URL, "http://") {
			t.Errorf("router %s has no service with a server: %+v", name, servers)
		}
	}
	if strings.Contains(out, "docker.sock") || strings.Contains(out, "labels") {
		t.Errorf("the file provider needs no Docker socket or labels\n%s", out)
	}
}

func TestAccessExportOfAProjectWithoutWebPagesIsStillValid(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(accessApp{&echoApp{id: "queue", done: map[string]bool{}}, func(i app.Info) app.Info {
		i.NoWebUI = true
		return i
	}})
	if code, out := runWith(t, deps, cat, "install", "--yes", "queue"); code != 0 {
		t.Fatalf("install: %d\n%s", code, out)
	}

	_, asJSON := runWith(t, deps, cat, "access", "export", "--format", "json")
	_, asTraefik := runWith(t, deps, cat, "access", "export", "--format", "traefik")

	if !strings.Contains(asJSON, `"apps": []`) {
		t.Errorf("no Apps is an empty list, not null\n%s", asJSON)
	}
	var config map[string]any
	if err := yaml.Unmarshal([]byte(asTraefik), &config); err != nil || config["http"] == nil {
		t.Errorf("an empty Traefik file still parses: %v\n%s", err, asTraefik)
	}
}
