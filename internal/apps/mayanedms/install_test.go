package mayanedms_test

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/mayanedms"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	"go.yaml.in/yaml/v3"
)

func TestComposeConnectsServerEventsToConfiguredRedis(t *testing.T) {
	var doc struct {
		Services map[string]struct {
			Environment map[string]string `yaml:"environment"`
		} `yaml:"services"`
	}
	if err := yaml.Unmarshal([]byte((mayanedms.App{}).Compose(app.RenderContext{Port: 34321})), &doc); err != nil {
		t.Fatal(err)
	}
	var arguments map[string]string
	value := doc.Services["mayan-edms"].Environment["MAYAN_SERVER_SIDE_EVENTS_BACKEND_ARGUMENTS"]
	if err := json.Unmarshal([]byte(strings.ReplaceAll(value, "'", "\"")), &arguments); err != nil {
		t.Fatal(err)
	}
	// RedisServerEventStreamBackend accepts url; redis_url is an ignored
	// keyword that would silently leave it connected to localhost.
	if arguments["url"] != "redis://:${MAYAN_EDMS_REDIS_PASSWORD}@mayan-edms-redis:6379/3" || len(arguments) != 1 {
		t.Fatal("server events do not use the configured private Redis service")
	}
}

func TestComposeWaitsForHealthyMayanDependencies(t *testing.T) {
	var doc struct {
		Services map[string]struct {
			DependsOn map[string]struct {
				Condition string `yaml:"condition"`
			} `yaml:"depends_on"`
			Healthcheck struct {
				Test []string `yaml:"test"`
			} `yaml:"healthcheck"`
		} `yaml:"services"`
	}
	if err := yaml.Unmarshal([]byte((mayanedms.App{}).Compose(app.RenderContext{Port: 34321})), &doc); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"mayan-edms-postgresql", "mayan-edms-rabbitmq", "mayan-edms-redis"} {
		if doc.Services["mayan-edms"].DependsOn[name].Condition != "service_healthy" || len(doc.Services[name].Healthcheck.Test) == 0 {
			t.Fatalf("Mayan startup does not wait for %s readiness", name)
		}
	}
}

type installedMayanTransport struct{}

func (installedMayanTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	body := "{}"
	if req.URL.Path == "/api/v4/users/current/" {
		body = `{"id":1,"username":"admin","is_active":true}`
	}
	return &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}, nil
}

func TestInstallKeepsRedisConfiguredUserAndPrivateConfigAcrossReruns(t *testing.T) {
	for _, tc := range []struct {
		name, security, wantUser string
		explicit                 bool
	}{
		{name: "rootless", security: `["name=rootless"]`, wantUser: "0:0"},
		{name: "rootful", security: `["name=seccomp"]`, wantUser: "1000:1000"},
		{name: "explicit", security: `["name=rootless"]`, wantUser: "1234:5678", explicit: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			deps := systemtest.NewDeps(t)
			runner := deps.Runner.(*systemtest.Runner)
			runner.On("docker info", system.Result{Stdout: []byte(tc.security)})
			deps.HTTP = &http.Client{Transport: installedMayanTransport{}}
			cat := catalog.New([]app.App{mayanedms.App{}}, nil)
			args := []string{"install", "mayan-edms", "--yes", "--set", "mayan-edms.port=34321"}
			if r := clitest.Run(t, deps, cat, args...); r.Code != 0 {
				t.Fatalf("install failed with exit %d", r.Code)
			}
			if tc.explicit {
				if r := clitest.Run(t, deps, cat, "config", "set", "PUID=1234", "PGID=5678"); r.Code != 0 {
					t.Fatalf("config failed with exit %d", r.Code)
				}
			}
			root := clitest.Root(t, deps)
			configPath := filepath.Join(root, "apps", "mayan-edms", "redis-config")
			before := clitest.Read(t, configPath)
			if r := clitest.Run(t, deps, cat, args...); r.Code != 0 {
				t.Fatalf("rerun failed with exit %d", r.Code)
			}
			var doc struct {
				Services map[string]struct {
					User       string   `yaml:"user"`
					Entrypoint []string `yaml:"entrypoint"`
					Command    []string `yaml:"command"`
					Ports      []string `yaml:"ports"`
				} `yaml:"services"`
			}
			if err := yaml.Unmarshal([]byte(clitest.Read(t, filepath.Join(root, "apps", "mayan-edms", "compose.yml"))), &doc); err != nil {
				t.Fatal(err)
			}
			settings, err := (&project.Project{Root: root}).LoadSettings()
			if err != nil {
				t.Fatal(err)
			}
			redis := doc.Services["mayan-edms-redis"]
			if got := os.Expand(redis.User, func(key string) string { return settings[key] }); got != tc.wantUser {
				t.Fatalf("Redis user changed: got %s, want %s", got, tc.wantUser)
			}
			if len(redis.Entrypoint) < 3 || redis.Entrypoint[0] != "sh" || !strings.Contains(strings.Join(redis.Entrypoint, " "), "umask 0077; exec redis-server") {
				t.Fatal("Redis startup can replace the configured user and lose access to its private config")
			}
			if !reflect.DeepEqual(redis.Command, []string{"/run/secrets/redis-config"}) {
				t.Fatal("Redis argv must contain only its config pathname")
			}
			if ports := doc.Services["mayan-edms"].Ports; len(ports) != 1 || !strings.HasSuffix(ports[0], ":34321:8000") {
				t.Fatal("selected primary port was changed")
			}
			info, err := os.Stat(configPath)
			if err != nil || info.Mode().Perm() != 0o600 || clitest.Read(t, configPath) != before {
				t.Fatal("rerun changed the private saved Redis configuration")
			}
			password := strings.TrimSpace(strings.TrimPrefix(before, "requirepass "))
			if password == "" || password == before {
				t.Fatal("Redis authentication config was not generated")
			}
			for _, cmd := range runner.Cmds() {
				if strings.Contains(systemtest.Line(cmd), password) {
					t.Fatal("Redis authentication escaped into process argv")
				}
			}
		})
	}
}
