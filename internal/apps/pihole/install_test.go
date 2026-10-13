package pihole_test

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/pihole"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	"go.yaml.in/yaml/v3"
)

type passwordFileTransport struct {
	password string
	appHash  string
	logins   int
}

func (f *passwordFileTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	status, body := http.StatusOK, `{}`
	switch req.URL.Path {
	case "/api/auth":
		if req.Method == http.MethodDelete {
			status = http.StatusNoContent
			break
		}
		if req.Method == http.MethodGet {
			if req.Header.Get("X-FTL-SID") != "fixture-session" {
				status = http.StatusUnauthorized
			} else {
				body = `{"session":{"valid":true,"sid":"fixture-session"}}`
			}
			break
		}
		if req.Method != http.MethodPost {
			status = http.StatusMethodNotAllowed
			break
		}
		var login struct {
			Password string `json:"password"`
		}
		if err := json.NewDecoder(req.Body).Decode(&login); err != nil {
			return nil, err
		}
		if login.Password == "fixture-app-password" && f.appHash == "fixture-app-hash" {
			body = `{"session":{"valid":true,"sid":"fixture-app-session"}}`
		} else if login.Password != f.password {
			status = http.StatusUnauthorized
		} else {
			f.logins++
			body = `{"session":{"valid":true,"sid":"fixture-session"}}`
		}
	case "/api/info/login":
		body = `{"dns":true,"https_port":443}`
	case "/api/config/webserver/api/app_sudo":
		if req.Header.Get("X-FTL-SID") != "fixture-session" && req.Header.Get("X-FTL-SID") != "fixture-app-session" {
			status = http.StatusUnauthorized
		} else {
			body = `{"config":{"webserver":{"api":{"app_sudo":false}}}}`
		}
	case "/api/config/webserver/api/app_pwhash":
		if req.Header.Get("X-FTL-SID") != "fixture-session" && req.Header.Get("X-FTL-SID") != "fixture-app-session" {
			status = http.StatusUnauthorized
		} else {
			raw, err := json.Marshal(map[string]any{"config": map[string]any{"webserver": map[string]any{"api": map[string]string{"app_pwhash": f.appHash}}}})
			if err != nil {
				return nil, err
			}
			body = string(raw)
		}
	case "/api/auth/app":
		if req.Header.Get("X-FTL-SID") != "fixture-session" || f.appHash != "" {
			status = http.StatusForbidden
		} else {
			body = `{"app":{"password":"fixture-app-password","hash":"fixture-app-hash"}}`
		}
	case "/api/config":
		var config map[string]map[string]map[string]map[string]string
		if req.Method != http.MethodPatch || req.Header.Get("X-FTL-SID") != "fixture-session" || json.NewDecoder(req.Body).Decode(&config) != nil || len(config) != 1 || len(config["config"]) != 1 || len(config["config"]["webserver"]) != 1 || len(config["config"]["webserver"]["api"]) != 1 || config["config"]["webserver"]["api"]["app_pwhash"] != "fixture-app-hash" || f.appHash != "" {
			status = http.StatusForbidden
		} else {
			f.appHash = "fixture-app-hash"
			body = `{"config":{"webserver":{"api":{"app_pwhash":"fixture-app-hash"}}}}`
		}
	case "/api/auth/sessions":
		if req.Header.Get("X-FTL-SID") != "fixture-app-session" {
			status = http.StatusUnauthorized
		} else {
			body = `{"sessions":[{"current_session":true,"valid":true,"app":true,"cli":false}]}`
		}
	case "/api/stats/summary":
		if req.Header.Get("X-FTL-SID") != "fixture-app-session" {
			status = http.StatusUnauthorized
		} else {
			body = `{"queries":{"total":0,"blocked":0,"percent_blocked":0},"gravity":{"domains_being_blocked":0}}`
		}
	case "/api/dns/blocking":
		if req.Method != http.MethodGet {
			status = http.StatusMethodNotAllowed
		} else if req.Header.Get("X-FTL-SID") != "fixture-session" && req.Header.Get("X-FTL-SID") != "fixture-app-session" {
			status = http.StatusUnauthorized
		} else {
			body = `{"blocking":"enabled","timer":null}`
		}
	}
	return &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}, nil
}

func TestInstallReadsPinnedPasswordFileAndPreservesDNSPorts(t *testing.T) {
	deps := systemtest.NewDeps(t)
	root := clitest.Root(t, deps)
	dir := filepath.Join(root, "apps", "pihole")
	transport := &passwordFileTransport{password: "image-generated-fallback"}
	deps.HTTP = &http.Client{Transport: transport}
	runner := deps.Runner.(*systemtest.Runner)
	type service struct {
		Environment map[string]string `yaml:"environment"`
		Volumes     []string          `yaml:"volumes"`
		Ports       []string          `yaml:"ports"`
	}
	var doc struct {
		Services map[string]service `yaml:"services"`
	}
	runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if !strings.Contains(systemtest.Line(cmd), " up ") {
			return system.Result{}
		}
		if err := yaml.Unmarshal([]byte(clitest.Read(t, filepath.Join(dir, "compose.yml"))), &doc); err != nil {
			t.Fatal(err)
		}
		svc := doc.Services["pihole"]
		// Pinned 2026.09.0 setup_web_password reads /run/secrets/${WEBPASSWORD_FILE}.
		// An unreadable path leaves the image's existing/generated password in place.
		passwordPath := "/run/secrets/" + svc.Environment["WEBPASSWORD_FILE"]
		for _, volume := range svc.Volumes {
			parts := strings.Split(volume, ":")
			if len(parts) == 3 && parts[1] == passwordPath && parts[2] == "ro" {
				transport.password = clitest.Read(t, filepath.Join(dir, parts[0]))
			}
		}
		return system.Result{}
	})
	cat := catalog.New([]app.App{pihole.App{}}, nil)
	args := []string{"install", "pihole", "--yes", "--set", "pihole.port=31031", "--set", "pihole.dns-port=31053"}
	if result := clitest.Run(t, deps, cat, args...); result.Code != 0 {
		t.Fatal(result.Out)
	}
	password := transport.password
	info, err := os.Stat(filepath.Join(dir, "admin-password"))
	if err != nil {
		t.Fatal(err)
	}
	if password == "" || info.Mode().Perm() != 0o600 {
		t.Fatal("password file must be nonempty and private")
	}
	ports := strings.Join(doc.Services["pihole"].Ports, "\n")
	for _, want := range []string{"${BIND_IP}:31053:53/udp", "${BIND_IP}:31053:53/tcp", "${BIND_IP}:31031:80"} {
		if !strings.Contains(ports, want) {
			t.Fatalf("missing selected port mapping %s", want)
		}
	}
	if err := os.MkdirAll(filepath.Join(dir, "config"), 0o700); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(dir, "config", "fixture-config")
	if err := os.WriteFile(sentinel, []byte("saved configuration"), 0o600); err != nil {
		t.Fatal(err)
	}
	if result := clitest.Run(t, deps, cat, args...); result.Code != 0 {
		t.Fatal(result.Out)
	}
	if transport.password != password || transport.logins < 2 {
		t.Fatal("reinstall did not authenticate with the persisted password")
	}
	if clitest.Read(t, sentinel) != "saved configuration" {
		t.Fatal("reinstall changed persisted configuration")
	}
	if strings.Contains(clitest.Read(t, filepath.Join(dir, "compose.yml")), password) {
		t.Fatal("password escaped into Compose")
	}
	for _, cmd := range runner.Cmds() {
		if strings.Contains(systemtest.Line(cmd), password) {
			t.Fatal("password escaped into process arguments")
		}
	}
}
