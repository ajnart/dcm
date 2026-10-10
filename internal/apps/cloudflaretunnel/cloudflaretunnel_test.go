package cloudflaretunnel_test

import (
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/cloudflaretunnel"
	"go.yaml.in/yaml/v3"
)

func TestConnectorFragmentUsesOnlyRunTokenEnvironmentAndNoPublishedPorts(t *testing.T) {
	a := cloudflaretunnel.App{}
	var doc struct {
		Services map[string]struct {
			Ports       []string
			Command     []string
			Environment map[string]string
		}
	}
	fragment := a.Compose(app.RenderContext{Inputs: map[string]string{"token": "never-in-compose"}})
	if err := yaml.Unmarshal([]byte(fragment), &doc); err != nil {
		t.Fatal(err)
	}
	c := doc.Services["cloudflare-tunnel"]
	if len(doc.Services) != 1 || len(c.Ports) != 0 || c.Environment["TUNNEL_TOKEN"] != "${CLOUDFLARE_TUNNEL_TOKEN}" || strings.Join(c.Command, " ") != "tunnel --no-autoupdate run" || strings.Contains(fragment, "never-in-compose") {
		t.Fatal(fragment)
	}
	if !a.Info().NoWebUI {
		t.Fatal("connector must not be offered as a web App")
	}
}
