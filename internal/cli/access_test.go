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
		if !info.IsDir() {
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
