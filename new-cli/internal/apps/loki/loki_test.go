package loki_test

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/loki"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	"go.yaml.in/yaml/v3"
)

type readyTransport struct{}

func (readyTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("{}"))}, nil
}

func TestInstallUsesConfiguredStorageUser(t *testing.T) {
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
			deps.Runner.(*systemtest.Runner).On("docker info", system.Result{Stdout: []byte(tc.options)})
			deps.HTTP = &http.Client{Transport: readyTransport{}}
			cat := catalog.New([]app.App{loki.App{}}, nil)
			args := []string{"install", "loki", "--yes"}
			if r := clitest.Run(t, deps, cat, args...); r.Code != 0 {
				t.Fatal(r.Out)
			}
			if tc.explicit {
				if r := clitest.Run(t, deps, cat, "config", "set", "PUID=1234", "PGID=5678"); r.Code != 0 {
					t.Fatal(r.Out)
				}
				if r := clitest.Run(t, deps, cat, args...); r.Code != 0 {
					t.Fatal(r.Out)
				}
			}
			root := clitest.Root(t, deps)
			var doc struct {
				Services map[string]struct {
					User string `yaml:"user"`
				} `yaml:"services"`
			}
			if err := yaml.Unmarshal([]byte(clitest.Read(t, filepath.Join(root, "apps", "loki", "compose.yml"))), &doc); err != nil {
				t.Fatal(err)
			}
			settings, err := (&project.Project{Root: root}).LoadSettings()
			if err != nil {
				t.Fatal(err)
			}
			if got := os.Expand(doc.Services["loki"].User, func(key string) string { return settings[key] }); got != tc.want {
				t.Fatalf("storage user = %q, want configured %s", got, tc.want)
			}
		})
	}
}
