package catalog

import (
	"context"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
	"go.yaml.in/yaml/v3"
)

var hostSettings = map[string]bool{
	"TZ": true, "PUID": true, "PGID": true, "UMASK": true, "BIND_IP": true,
	"LAN_IP": true, "MEDIA_ROOT": true, "DOWNLOADS_ROOT": true,
	// The Admin login is in secrets.env for Apps that take it as env.
	"ADMIN_USER": true, "ADMIN_PASSWORD": true,
}

var composeRef = regexp.MustCompile(`\$\{([^}]+)\}`)

// recipeCommands mirrors the non-null recipe commands the generated Apps ship;
// each argument must survive into the rendered Compose.
var recipeCommands = map[string][]string{
	"victoria-metrics": {"-storageDataPath=/victoria-metrics-data", "-selfScrapeInterval=5s"},
}

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

func TestGeneratedAppsCompose(t *testing.T) {
	for _, a := range generatedApps() {
		a := a
		t.Run(a.Info().ID, func(t *testing.T) {
			info := a.Info()
			compose := a.Compose(app.RenderContext{Port: info.Port})

			var doc struct {
				Services map[string]struct {
					Image string   `yaml:"image"`
					Ports []string `yaml:"ports"`
				} `yaml:"services"`
			}
			if err := yaml.Unmarshal([]byte(compose), &doc); err != nil {
				t.Fatalf("Compose is not valid YAML: %v\n%s", err, compose)
			}
			if len(doc.Services) != 1 {
				t.Fatalf("want exactly one service, got %d", len(doc.Services))
			}
			svc, ok := doc.Services[info.Service]
			if !ok {
				t.Fatalf("missing service %q", info.Service)
			}
			if svc.Image != info.Image {
				t.Errorf("image = %q, want %q", svc.Image, info.Image)
			}
			tag := imageTag(svc.Image)
			if tag == "" || tag == "latest" {
				t.Errorf("image %q has no pinned tag", svc.Image)
			}
			if len(svc.Ports) == 0 {
				t.Fatalf("service %q has no ports", info.Service)
			}
			for _, p := range svc.Ports {
				if !strings.HasPrefix(p, "${BIND_IP}:") {
					t.Errorf("port %q does not bind via ${BIND_IP}", p)
				}
			}

			secrets := map[string]bool{}
			if d, ok := a.(app.SecretDeclarer); ok {
				prefix := strings.ToUpper(strings.ReplaceAll(info.ID, "-", "_")) + "_"
				for _, s := range d.Secrets() {
					secrets[prefix+strings.ToUpper(s.Name)] = true
				}
			}
			for _, m := range composeRef.FindAllStringSubmatch(compose, -1) {
				name := m[1]
				if hostSettings[name] || secrets[name] {
					continue
				}
				t.Errorf("Compose references %q, which is neither a host setting nor a declared secret", name)
			}

			for _, arg := range recipeCommands[info.ID] {
				if !strings.Contains(compose, arg) {
					t.Errorf("Compose is missing recipe command argument %q", arg)
				}
			}
		})
	}
}

func TestGeneratedAppsOnboard(t *testing.T) {
	for _, a := range generatedApps() {
		a := a
		t.Run(a.Info().ID, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			}))
			defer srv.Close()
			info := a.Info()
			deps := systemtest.NewDeps(t)
			h := helpers.New(helpers.Config{
				App:     info.ID,
				Service: info.Service,
				BaseURL: srv.URL,
				URL:     srv.URL,
				HTTP:    srv.Client(),
				Secrets: fakeSecrets{},
				Log:     events.Discard(),
				Now:     deps.Now,
				Sleep:   deps.Sleep,
			})
			ctx := context.Background()
			if err := a.Setup(ctx, h); err != nil {
				t.Fatalf("Setup: %v", err)
			}
			if err := a.Check(ctx, h); err != nil {
				t.Fatalf("Check: %v", err)
			}
		})
	}
}

func TestDefaultAppIDsUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, a := range Default().Apps() {
		id := a.Info().ID
		if seen[id] {
			t.Errorf("duplicate App ID %q", id)
		}
		seen[id] = true
	}
}

func imageTag(image string) string {
	idx := strings.LastIndex(image, ":")
	if idx < 0 {
		return ""
	}
	return image[idx+1:]
}
