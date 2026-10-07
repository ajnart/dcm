package headscale_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/headscale"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	"go.yaml.in/yaml/v3"
)

func TestInstallSuppliesDERPThenPreservesCustomConfigAndData(t *testing.T) {
	deps := systemtest.NewDeps(t)
	root := clitest.Root(t, deps)
	configPath := filepath.Join(root, "apps", "headscale", "config.yaml")
	runner := deps.Runner.(*systemtest.Runner)
	runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), "/ko-app/headscale health") {
			// Pinned Serve() refuses an empty DERP map before serving the
			// health RPC. No source is implicitly configured by its loader.
			var cfg struct {
				DERP struct {
					URLs []string `yaml:"urls"`
				} `yaml:"derp"`
			}
			data, err := os.ReadFile(configPath)
			if err != nil || yaml.Unmarshal(data, &cfg) != nil || len(cfg.DERP.URLs) == 0 {
				return system.Result{ExitCode: 1}
			}
		}
		return system.Result{}
	})
	cat := catalog.New([]app.App{headscale.App{}}, nil)
	args := []string{"install", "headscale", "--yes", "--set", "headscale.canonical-origin=https://control.example.com", "--set", "headscale.magic-dns-domain=mesh.example.com", "--set", "headscale.port=34322"}
	if r := clitest.Run(t, deps, cat, args...); r.Code != 0 {
		t.Fatalf("generated configuration cannot start the pinned health service: exit %d", r.Code)
	}
	config := clitest.Read(t, configPath)
	var cfg struct {
		ServerURL string `yaml:"server_url"`
		DERP      struct {
			URLs       []string `yaml:"urls"`
			AutoUpdate bool     `yaml:"auto_update_enabled"`
			Server     struct {
				Enabled bool `yaml:"enabled"`
			} `yaml:"server"`
		} `yaml:"derp"`
	}
	if err := yaml.Unmarshal([]byte(config), &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.ServerURL != "https://control.example.com" || len(cfg.DERP.URLs) != 1 || cfg.DERP.URLs[0] != "https://controlplane.tailscale.com/derpmap/default" || !cfg.DERP.AutoUpdate || cfg.DERP.Server.Enabled {
		t.Fatal("generated configuration did not preserve the canonical identity and upstream relay defaults")
	}
	custom := strings.ReplaceAll(config, "https://controlplane.tailscale.com/derpmap/default", "https://relay.example.com/custom-map") + "# owner configuration\n"
	if err := os.WriteFile(configPath, []byte(custom), 0o600); err != nil {
		t.Fatal(err)
	}
	dataDir := filepath.Join(root, "apps", "headscale", "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(dataDir, "existing-state")
	if err := os.WriteFile(statePath, []byte("existing fixture state"), 0o600); err != nil {
		t.Fatal(err)
	}
	if r := clitest.Run(t, deps, cat, args...); r.Code != 0 {
		t.Fatalf("rerun rejected the saved configuration: exit %d", r.Code)
	}
	if clitest.Read(t, configPath) != custom || clitest.Read(t, statePath) != "existing fixture state" {
		t.Fatal("rerun replaced saved configuration or data")
	}
}

func TestSavedConfigWithoutDERPIsPreservedWithRecoveryHint(t *testing.T) {
	deps := systemtest.NewDeps(t)
	root := clitest.Root(t, deps)
	runner := deps.Runner.(*systemtest.Runner)
	runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), "/ko-app/headscale health") {
			return system.Result{ExitCode: 1}
		}
		return system.Result{}
	})
	configPath := filepath.Join(root, "apps", "headscale", "config.yaml")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatal(err)
	}
	saved := "server_url: https://control.example.com\noidc:\n  client_secret: owner-private-fixture\n"
	if err := os.WriteFile(configPath, []byte(saved), 0o600); err != nil {
		t.Fatal(err)
	}
	cat := catalog.New([]app.App{headscale.App{}}, nil)
	r := clitest.Run(t, deps, cat, "install", "headscale", "--yes", "--json", "--set", "headscale.canonical-origin=https://control.example.com", "--set", "headscale.magic-dns-domain=mesh.example.com")
	if r.Code == 0 || !strings.Contains(r.Out, "derp.urls") || !strings.Contains(r.Out, "derp.paths") || !strings.Contains(r.Out, "self-host restart headscale") {
		t.Fatal("missing DERP sources did not produce actionable saved-config recovery instructions")
	}
	if strings.Contains(r.Out, "owner-private-fixture") || clitest.Read(t, configPath) != saved {
		t.Fatal("invalid saved configuration was disclosed or replaced")
	}
	for _, cmd := range runner.Cmds() {
		if strings.Contains(systemtest.Line(cmd), "/ko-app/headscale health") {
			t.Fatal("known missing DERP source was retried as an opaque health failure")
		}
	}
}

func TestSavedCustomRelaySourcesArePreserved(t *testing.T) {
	for _, tc := range []struct {
		name string
		derp string
	}{
		{"private URL", "derp:\n  urls: [https://relay.example.com/private-map]\n"},
		{"local map", "derp:\n  paths: [/etc/headscale/private-map.yaml]\n"},
		{"embedded relay", "derp:\n  server:\n    enabled: true\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			deps := systemtest.NewDeps(t)
			root := clitest.Root(t, deps)
			configPath := filepath.Join(root, "apps", "headscale", "config.yaml")
			if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
				t.Fatal(err)
			}
			saved := "server_url: https://control.example.com\n" + tc.derp
			if err := os.WriteFile(configPath, []byte(saved), 0o600); err != nil {
				t.Fatal(err)
			}
			cat := catalog.New([]app.App{headscale.App{}}, nil)
			r := clitest.Run(t, deps, cat, "install", "headscale", "--yes", "--set", "headscale.canonical-origin=https://control.example.com", "--set", "headscale.magic-dns-domain=mesh.example.com")
			if r.Code != 0 {
				t.Fatalf("valid custom relay source rejected: exit %d", r.Code)
			}
			if clitest.Read(t, configPath) != saved {
				t.Fatal("custom relay configuration was replaced")
			}
		})
	}
}

func TestInvalidSavedYAMLDoesNotDisclosePrivateValues(t *testing.T) {
	deps := systemtest.NewDeps(t)
	root := clitest.Root(t, deps)
	configPath := filepath.Join(root, "apps", "headscale", "config.yaml")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatal(err)
	}
	// A type error from YAML includes the scalar value unless explicitly redacted.
	saved := "derp:\n  urls: owner-private-fixture\n"
	if err := os.WriteFile(configPath, []byte(saved), 0o600); err != nil {
		t.Fatal(err)
	}
	cat := catalog.New([]app.App{headscale.App{}}, nil)
	r := clitest.Run(t, deps, cat, "install", "headscale", "--yes", "--json", "--set", "headscale.canonical-origin=https://control.example.com", "--set", "headscale.magic-dns-domain=mesh.example.com")
	if r.Code == 0 || !strings.Contains(r.Out, "invalid YAML") {
		t.Fatal("invalid saved YAML was not rejected")
	}
	if strings.Contains(r.Out, "owner-private-fixture") || clitest.Read(t, configPath) != saved {
		t.Fatal("invalid saved YAML was disclosed or replaced")
	}
}
