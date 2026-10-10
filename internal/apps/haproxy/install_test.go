package haproxy_test

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/haproxy"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	"go.yaml.in/yaml/v3"
)

const installPassword = "FixtureOwner!234ABcd"

type statsTransport struct {
	user, mode, password string
	denials, logins      int
}

func (f *statsTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	status := http.StatusUnauthorized
	user, password, ok := req.BasicAuth()
	if !ok {
		f.denials++
	} else if user == f.user && f.mode == "insecure-password" && password == f.password {
		// HAProxy 3.2 userlist password uses crypt(3); plaintext only matches insecure-password.
		status = http.StatusOK
		f.logins++
	}
	return &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("stats fixture"))}, nil
}

func TestInstallAuthenticatesPlaintextEnvironmentPasswordAndPreservesPorts(t *testing.T) {
	deps := systemtest.NewDeps(t)
	getenv := deps.Getenv
	deps.Getenv = func(key string) string {
		if key == "SELF_HOST_ADMIN_PASSWORD" {
			return installPassword
		}
		return getenv(key)
	}
	dir := filepath.Join(clitest.Root(t, deps), "apps", "haproxy")
	transport := &statsTransport{}
	deps.HTTP = &http.Client{Transport: transport}
	runner := deps.Runner.(*systemtest.Runner)
	runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if !strings.Contains(systemtest.Line(cmd), " up ") {
			return system.Result{}
		}
		config := clitest.Read(t, filepath.Join(dir, "haproxy.cfg"))
		for _, line := range strings.Split(config, "\n") {
			fields := strings.Fields(line)
			if len(fields) == 4 && fields[0] == "user" {
				transport.user = fields[1]
				if fields[1] == `"$HAPROXY_ADMIN_USER"` {
					transport.user = "fixture-owner"
				}
				transport.mode = fields[2]
				if fields[3] == `"$HAPROXY_ADMIN_PASSWORD"` {
					transport.password = installPassword
				}
			}
		}
		return system.Result{}
	})
	cat := catalog.New([]app.App{haproxy.App{}}, nil)
	args := []string{"install", "haproxy", "--yes", "--set", "haproxy.port=31081", "--set", "haproxy.target-app=ntfy", "--set", "haproxy.target-port=80"}
	initialArgs := append(append([]string(nil), args...), "--admin-user", "fixture-owner")
	if result := clitest.Run(t, deps, cat, initialArgs...); result.Code != 0 {
		t.Fatal(result.Out)
	}
	// Remove the initial password and username overrides. Reinstall must hydrate
	// the persisted credentials used by both the rendered server and its Check.
	deps.Getenv = getenv
	if result := clitest.Run(t, deps, cat, args...); result.Code != 0 {
		t.Fatal(result.Out)
	}
	if transport.logins < 2 || transport.denials < 2 {
		t.Fatal("install and reinstall did not prove saved authentication and anonymous denial")
	}
	var compose struct {
		Services map[string]struct {
			Environment map[string]string `yaml:"environment"`
			Ports       []string          `yaml:"ports"`
			Volumes     []string          `yaml:"volumes"`
		} `yaml:"services"`
	}
	fragment := clitest.Read(t, filepath.Join(dir, "compose.yml"))
	if err := yaml.Unmarshal([]byte(fragment), &compose); err != nil {
		t.Fatal(err)
	}
	svc := compose.Services["haproxy"]
	if svc.Environment["HAPROXY_ADMIN_PASSWORD"] != "${ADMIN_PASSWORD}" {
		t.Fatal("container password must use saved environment reference")
	}
	if svc.Environment["HAPROXY_ADMIN_USER"] != "${ADMIN_USER}" {
		t.Fatal("container username must use the selected saved administrator reference")
	}
	if len(svc.Ports) != 1 || svc.Ports[0] != "${BIND_IP}:31081:8080" {
		t.Fatal("selected host port no longer maps to internal listener")
	}
	config := clitest.Read(t, filepath.Join(dir, "haproxy.cfg"))
	if !strings.Contains(config, "bind :8080") || !strings.Contains(config, "server app ntfy:80 check") {
		t.Fatal("internal listener or selected backend changed")
	}
	info, err := os.Stat(filepath.Join(dir, "haproxy.cfg"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o004 == 0 || len(svc.Volumes) != 1 || !strings.HasSuffix(svc.Volumes[0], ":ro") {
		t.Fatal("nonsecret config must remain readable by pinned image user through readonly mount")
	}
	if strings.Contains(config+fragment, installPassword) {
		t.Fatal("password escaped into rendered configuration")
	}
	for _, cmd := range runner.Cmds() {
		if strings.Contains(systemtest.Line(cmd), installPassword) {
			t.Fatal("password escaped into command arguments")
		}
	}
}
