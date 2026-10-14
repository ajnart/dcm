package lldap_test

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/lldap"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	"go.yaml.in/yaml/v3"
)

type readyTransport struct{ username string }

func (r *readyTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	body := "{}"
	switch req.URL.Path {
	case "/auth/simple/login":
		var login struct {
			Username string `json:"username"`
		}
		if err := json.NewDecoder(req.Body).Decode(&login); err != nil {
			return nil, err
		}
		r.username = login.Username
		body = `{"token":"fixture-session"}`
	case "/api/graphql":
		result, err := json.Marshal(map[string]any{"data": map[string]any{"user": map[string]any{"id": r.username, "groups": []map[string]string{{"displayName": "lldap_admin"}}}}})
		if err != nil {
			return nil, err
		}
		body = string(result)
	}
	return &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}, nil
}

func TestInstallPreservesConfiguredIdentityAndCredentials(t *testing.T) {
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
			deps.HTTP = &http.Client{Transport: &readyTransport{}}
			cat := catalog.New([]app.App{lldap.App{}}, nil)
			args := []string{"install", "lldap", "--yes"}
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
					Environment map[string]string `yaml:"environment"`
					Command     []string          `yaml:"command"`
					Volumes     []string          `yaml:"volumes"`
					Secrets     []any             `yaml:"secrets"`
				} `yaml:"services"`
				Secrets map[string]any `yaml:"secrets"`
			}
			if err := yaml.Unmarshal([]byte(clitest.Read(t, filepath.Join(root, "apps", "lldap", "compose.yml"))), &doc); err != nil {
				t.Fatal(err)
			}
			settings, err := (&project.Project{Root: root}).LoadSettings()
			if err != nil {
				t.Fatal(err)
			}
			if got := os.Expand(doc.Services["lldap"].Environment["UID"]+":"+doc.Services["lldap"].Environment["GID"], func(key string) string { return settings[key] }); got != tc.want {
				t.Fatalf("post-entrypoint user = %q, want configured %s", got, tc.want)
			}
			svc := doc.Services["lldap"]
			if len(svc.Secrets) != 0 || len(doc.Secrets) != 0 {
				t.Fatalf("Compose secret injection remains: service=%#v top-level=%#v", svc.Secrets, doc.Secrets)
			}
			if !slices.Contains(svc.Volumes, "./admin-password:/run/secrets/admin-password:ro") {
				t.Fatalf("administrator password is not mounted as a read-only private file: %#v", svc.Volumes)
			}
			for _, name := range []string{"jwt-secret", "key-seed", "admin-password"} {
				path := filepath.Join(root, "apps", "lldap", name)
				info, err := os.Stat(path)
				if err != nil {
					t.Fatal(err)
				}
				if info.Mode().Perm() != 0o600 {
					t.Fatal("credential file is not private")
				}
				before := clitest.Read(t, path)
				if before == "" {
					t.Fatal("credential file missing content")
				}
				if r := clitest.Run(t, deps, cat, args...); r.Code != 0 {
					t.Fatal(r.Out)
				}
				if clitest.Read(t, path) != before {
					t.Fatal("reinstall changed saved credentials")
				}
				if strings.Contains(strings.Join(svc.Command, " "), before) {
					t.Fatal("credential escaped into process argv")
				}
			}
			for key, want := range map[string]string{
				"LLDAP_JWT_SECRET_FILE":     "/run/secrets/jwt-secret",
				"LLDAP_KEY_SEED_FILE":       "/run/secrets/key-seed",
				"LLDAP_LDAP_USER_PASS_FILE": "/run/secrets/admin-password",
			} {
				if svc.Environment[key] != want {
					t.Fatalf("%s does not use the private file", key)
				}
			}
		})
	}
}
