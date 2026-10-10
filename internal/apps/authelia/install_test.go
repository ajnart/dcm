package authelia_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/authelia"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	"go.yaml.in/yaml/v3"
)

type portalTransport struct {
	config         string
	user, password string
}

func (p *portalTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Scheme != "https" || req.URL.Host != "auth.example.com" {
		return nil, fmt.Errorf("loopback request cannot match the configured portal cookie domain")
	}
	data, err := os.ReadFile(p.config)
	if err != nil {
		return nil, err
	}
	var cfg struct {
		Session struct {
			Cookies []struct {
				URL      string `yaml:"authelia_url"`
				Redirect string `yaml:"default_redirection_url"`
			} `yaml:"cookies"`
		} `yaml:"session"`
	}
	if err = yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	// Pinned 4.39.25 validateSessionCookiesURLs rejects this before listen.
	if len(cfg.Session.Cookies) != 1 || cfg.Session.Cookies[0].URL == cfg.Session.Cookies[0].Redirect {
		return nil, fmt.Errorf("pinned portal refuses identical portal and redirection URLs")
	}
	body := `{"status":"OK"}`
	headers := http.Header{}
	if req.URL.Path == "/api/firstfactor" {
		var login struct{ Username, Password string }
		if err = json.NewDecoder(req.Body).Decode(&login); err != nil {
			return nil, err
		}
		if p.user != "" && (login.Username != p.user || login.Password != p.password) {
			return nil, fmt.Errorf("saved fixture credentials changed")
		}
		p.user, p.password = login.Username, login.Password
		headers.Set("Set-Cookie", "authelia_session=fixture-session; Secure; HttpOnly")
	} else if req.URL.Path == "/api/state" {
		if req.Header.Get("Cookie") != "authelia_session=fixture-session" {
			return nil, fmt.Errorf("authenticated session missing")
		}
		state, err := json.Marshal(map[string]any{"status": "OK", "data": map[string]any{"username": p.user, "authentication_level": 1, "factor_knowledge": true}})
		if err != nil {
			return nil, err
		}
		body = string(state)
	}
	return &http.Response{StatusCode: 200, Header: headers, Body: io.NopCloser(strings.NewReader(body))}, nil
}

func TestInstallSeedsValidPortalConfiguration(t *testing.T) {
	deps := systemtest.NewDeps(t)
	root := clitest.Root(t, deps)
	transport := &portalTransport{config: filepath.Join(root, "apps", "authelia", "config", "configuration.yml")}
	deps.HTTP = &http.Client{Transport: transport}
	cat := catalog.New([]app.App{authelia.App{}}, nil)
	if r := clitest.Run(t, deps, cat, "install", "authelia", "--yes", "--set", "authelia.origin=https://auth.example.com"); r.Code != 0 {
		t.Fatal("generated configuration cannot start the pinned portal")
	}
}

func TestReinstallPreservesPortalConfigurationUsersAndData(t *testing.T) {
	deps := systemtest.NewDeps(t)
	root := clitest.Root(t, deps)
	config := filepath.Join(root, "apps", "authelia", "config", "configuration.yml")
	deps.HTTP = &http.Client{Transport: &portalTransport{config: config}}
	cat := catalog.New([]app.App{authelia.App{}}, nil)
	args := []string{"install", "authelia", "--yes", "--set", "authelia.origin=https://auth.example.com"}
	if r := clitest.Run(t, deps, cat, args...); r.Code != 0 {
		t.Fatal("initial install failed")
	}
	users := filepath.Join(root, "apps", "authelia", "config", "users_database.yml")
	beforeUsers := clitest.Read(t, users)
	custom := clitest.Read(t, config) + "# approved owner configuration\n"
	if err := os.WriteFile(config, []byte(custom), 0o600); err != nil {
		t.Fatal(err)
	}
	database := filepath.Join(root, "apps", "authelia", "config", "db.sqlite3")
	if err := os.WriteFile(database, []byte("existing private state"), 0o600); err != nil {
		t.Fatal(err)
	}
	if r := clitest.Run(t, deps, cat, args...); r.Code != 0 {
		t.Fatal("reinstall rejected saved portal configuration")
	}
	if clitest.Read(t, config) != custom {
		t.Fatal("reinstall replaced owner configuration")
	}
	if clitest.Read(t, users) != beforeUsers || clitest.Read(t, database) != "existing private state" {
		t.Fatal("reinstall changed users or persisted state")
	}
}

type portalRoundTrip func(*http.Request) (*http.Response, error)

func (f portalRoundTrip) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func TestCheckRequiresTrustedPrivateRoute(t *testing.T) {
	deps := systemtest.NewDeps(t)
	calls := 0
	transport := portalRoundTrip(func(req *http.Request) (*http.Response, error) {
		calls++
		if req.URL.Scheme != "https" || req.URL.Host != "auth.example.com" {
			t.Fatal("credential probe bypassed the approved HTTPS portal")
		}
		return nil, fmt.Errorf("fixture private TLS route unavailable")
	})
	h := helpers.New(helpers.Config{App: "authelia", BaseURL: "http://127.0.0.1:9091", Inputs: map[string]string{"origin": "https://auth.example.com"}, HTTP: &http.Client{Transport: transport}, Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass}, Log: events.Discard(), Now: deps.Now, Sleep: deps.Sleep})
	err := (authelia.App{}).Check(context.Background(), h)
	if err == nil || !strings.Contains(err.Error(), "private DNS/TLS route") || calls != 1 {
		t.Fatal("unavailable private route must fail administrator verification with a precise prerequisite")
	}
}

func TestCheckRejectsHTTP200WithoutAuthenticatedOwner(t *testing.T) {
	for _, tc := range []struct {
		name   string
		cookie bool
		state  string
	}{
		{name: "no session"},
		{name: "wrong owner", cookie: true, state: `{"status":"OK","data":{"username":"other","authentication_level":1,"factor_knowledge":true}}`},
		{name: "unauthenticated owner", cookie: true, state: `{"status":"OK","data":{"username":"admin","authentication_level":0,"factor_knowledge":false}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			transport := portalRoundTrip(func(req *http.Request) (*http.Response, error) {
				header := http.Header{}
				body := `{"status":"OK"}`
				if req.URL.Path == "/api/firstfactor" && tc.cookie {
					header.Set("Set-Cookie", "authelia_session=fixture-session; Secure")
				}
				if req.URL.Path == "/api/state" {
					body = tc.state
				}
				return &http.Response{StatusCode: 200, Header: header, Body: io.NopCloser(strings.NewReader(body))}, nil
			})
			h := helpers.New(helpers.Config{App: "authelia", Inputs: map[string]string{"origin": "https://auth.example.com"}, HTTP: &http.Client{Transport: transport}, Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass}, Log: events.Discard()})
			if err := (authelia.App{}).Check(context.Background(), h); err == nil {
				t.Fatal("HTTP200 is not authenticated owner acceptance")
			}
		})
	}
}

func TestInstallPreservesConfiguredProcessIdentity(t *testing.T) {
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
			root := clitest.Root(t, deps)
			deps.HTTP = &http.Client{Transport: &portalTransport{config: filepath.Join(root, "apps", "authelia", "config", "configuration.yml")}}
			cat := catalog.New([]app.App{authelia.App{}}, nil)
			args := []string{"install", "authelia", "--yes", "--set", "authelia.origin=https://auth.example.com"}
			if r := clitest.Run(t, deps, cat, args...); r.Code != 0 {
				t.Fatal("install failed")
			}
			if tc.explicit {
				if r := clitest.Run(t, deps, cat, "config", "set", "PUID=1234", "PGID=5678"); r.Code != 0 {
					t.Fatal("config failed")
				}
				if r := clitest.Run(t, deps, cat, args...); r.Code != 0 {
					t.Fatal("reinstall failed")
				}
			}
			var compose struct {
				Services map[string]struct {
					Environment map[string]string `yaml:"environment"`
				} `yaml:"services"`
			}
			if err := yaml.Unmarshal([]byte(clitest.Read(t, filepath.Join(root, "apps", "authelia", "compose.yml"))), &compose); err != nil {
				t.Fatal(err)
			}
			settings, err := (&project.Project{Root: root}).LoadSettings()
			if err != nil {
				t.Fatal(err)
			}
			env := compose.Services["authelia"].Environment
			got := os.Expand(env["PUID"]+":"+env["PGID"], func(key string) string { return settings[key] })
			if got != tc.want {
				t.Fatalf("post-entrypoint identity = %q, want %s", got, tc.want)
			}
		})
	}
}
