package valkey_test

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/valkey"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	"go.yaml.in/yaml/v3"
)

func TestInstallPreservesConfiguredUserAndPrivateAuthentication(t *testing.T) {
	for _, tc := range []struct {
		name, options, want string
		explicit            bool
	}{
		{name: "rootless", options: `["name=rootless"]`, want: "0:0"},
		{name: "rootful", options: `["name=seccomp"]`, want: "1000:1000"},
		{name: "explicit", options: `["name=rootless"]`, want: "1234:5678", explicit: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			deps := systemtest.NewDeps(t)
			runner := deps.Runner.(*systemtest.Runner)
			runner.On("docker info", system.Result{Stdout: []byte(tc.options)})
			runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
				if strings.Contains(systemtest.Line(cmd), "valkey-cli") {
					return system.Result{Stdout: []byte("PONG\n")}
				}
				return system.Result{}
			})
			cat := catalog.New([]app.App{valkey.App{}}, nil)
			if r := clitest.Run(t, deps, cat, "install", "valkey", "--yes"); r.Code != 0 {
				t.Fatal(r.Out)
			}
			if tc.explicit {
				if r := clitest.Run(t, deps, cat, "config", "set", "PUID=1234", "PGID=5678"); r.Code != 0 {
					t.Fatal(r.Out)
				}
				if r := clitest.Run(t, deps, cat, "install", "valkey", "--yes"); r.Code != 0 {
					t.Fatal(r.Out)
				}
			}
			root := clitest.Root(t, deps)
			var doc struct {
				Services map[string]struct {
					User       string   `yaml:"user"`
					Entrypoint []string `yaml:"entrypoint"`
					Command    []string `yaml:"command"`
				} `yaml:"services"`
			}
			if err := yaml.Unmarshal([]byte(clitest.Read(t, filepath.Join(root, "apps", "valkey", "compose.yml"))), &doc); err != nil {
				t.Fatal(err)
			}
			settings, err := (&project.Project{Root: root}).LoadSettings()
			if err != nil {
				t.Fatal(err)
			}
			svc := doc.Services["valkey"]
			if got := os.Expand(svc.User, func(key string) string { return settings[key] }); got != tc.want {
				t.Fatalf("server user = %q, want %s", got, tc.want)
			}
			if len(svc.Entrypoint) < 5 || svc.Entrypoint[0] != "tini" || !strings.Contains(strings.Join(svc.Entrypoint, " "), "umask 0077; exec /usr/local/bin/valkey-server") {
				t.Fatal("server entrypoint can replace the configured user or lose private umask")
			}
			if !reflect.DeepEqual(svc.Command, []string{"/usr/local/etc/valkey/valkey.conf"}) {
				t.Fatal("server argv must contain only its config pathname")
			}
			config := filepath.Join(root, "apps", "valkey", "valkey.conf")
			info, err := os.Stat(config)
			if err != nil {
				t.Fatal(err)
			}
			if info.Mode().Perm() != 0o600 {
				t.Fatal("authentication config is not private")
			}
			_, password, found := strings.Cut(clitest.Read(t, config), "requirepass ")
			password = strings.TrimSpace(password)
			if !found || password == "" {
				t.Fatal("Valkey authentication password was not generated")
			}
			for _, cmd := range runner.Cmds() {
				if strings.Contains(systemtest.Line(cmd), password) {
					t.Fatal("authentication escaped into command argv")
				}
				if strings.Contains(systemtest.Line(cmd), "valkey-cli") && clitest.Env(cmd)["VALKEYCLI_AUTH"] != password {
					t.Fatal("authentication probe did not use environment credentials")
				}
			}
		})
	}
}
