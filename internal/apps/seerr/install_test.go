package seerr_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/ajnart/self-host/internal/apps/seerr"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	"go.yaml.in/yaml/v3"
)

// The official image runs as node:node (1000:1000), but rootless Docker
// presents the host user's config mount as 0:0. Use the Project's selected
// container IDs rather than the image default, without rewriting saved choices.
func TestInstallUsesConfiguredConfigUserAndPreservesRerunSecrets(t *testing.T) {
	for _, tc := range []struct {
		name, options, want string
		explicit            bool
	}{
		{name: "rootless", options: `["name=rootless"]`, want: "0:0"},
		{name: "rootful", options: `["name=seccomp"]`, want: "1000:1000"},
		{name: "saved-override", options: `["name=rootless"]`, want: "1234:5678", explicit: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t, seerr.App{})
			e.Deps.Runner.(*systemtest.Runner).On("docker info", system.Result{Stdout: []byte(tc.options)})
			if r := e.Run("install", "seerr", "--yes"); r.Code != 0 {
				t.Fatal(r.Out)
			}
			if tc.explicit {
				if r := e.Run("config", "set", "PUID=1234", "PGID=5678"); r.Code != 0 {
					t.Fatal(r.Out)
				}
			}
			p := &project.Project{Root: clitest.Root(t, e.Deps)}
			before, err := p.LoadSecrets()
			if err != nil {
				t.Fatal(err)
			}
			if before["SEERR_API_KEY"] == "" {
				t.Fatal("Seerr API key was not generated")
			}
			if r := e.Run("install", "seerr", "--yes"); r.Code != 0 {
				t.Fatal(r.Out)
			}
			var doc struct {
				Services map[string]struct {
					User    string   `yaml:"user"`
					Ports   []string `yaml:"ports"`
					Volumes []string `yaml:"volumes"`
				} `yaml:"services"`
			}
			if err := yaml.Unmarshal([]byte(clitest.Read(t, filepath.Join(e.AppDir("seerr"), "compose.yml"))), &doc); err != nil {
				t.Fatal(err)
			}
			settings, err := p.LoadSettings()
			if err != nil {
				t.Fatal(err)
			}
			svc := doc.Services["seerr"]
			if got := os.Expand(svc.User, func(key string) string { return settings[key] }); got != tc.want {
				t.Fatalf("config writer user = %q, want configured %s instead of the image's fixed 1000:1000", got, tc.want)
			}
			if len(svc.Ports) != 1 || svc.Ports[0] != "${BIND_IP}:"+e.Port("seerr")+":5055" || len(svc.Volumes) != 1 || svc.Volumes[0] != "./config:/app/config" {
				t.Fatal("selected HTTP port or config mount changed")
			}
			after, err := p.LoadSecrets()
			if err != nil {
				t.Fatal(err)
			}
			if after["SEERR_API_KEY"] != before["SEERR_API_KEY"] || after["ADMIN_PASSWORD"] != before["ADMIN_PASSWORD"] {
				t.Fatal("rerun replaced saved credentials")
			}
		})
	}
}
