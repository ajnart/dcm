package netbird_test

import (
	"encoding/base64"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/netbird"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	"go.yaml.in/yaml/v3"
)

type startupTransport struct {
	ready, created bool
	ownerReads     int
}

func (f *startupTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	status, body := http.StatusBadGateway, `{}`
	if f.ready {
		status = http.StatusOK
		switch req.URL.Path {
		case "/api/instance":
			body = `{"setup_required":true}`
			if f.created {
				body = `{"setup_required":false}`
			}
		case "/api/setup":
			f.created = true
			body = `{"personal_access_token":"fixture-pat"}`
		case "/api/users/current":
			if !f.created || req.Header.Get("Authorization") != "Token fixture-pat" {
				status = http.StatusUnauthorized
			} else {
				f.ownerReads++
				body = `{"id":"fixture-owner","email":"admin@selfhost.local","role":"owner"}`
			}
		}
	}
	return &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}, nil
}

func TestInstallStartsWithSupportedStoreKeyAndRetainsItOnRerun(t *testing.T) {
	deps := systemtest.NewDeps(t)
	dir := filepath.Join(clitest.Root(t, deps), "apps", "netbird")
	transport := &startupTransport{}
	deps.HTTP = &http.Client{Transport: transport}
	var startedKey string
	runner := deps.Runner.(*systemtest.Runner)
	runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if !strings.Contains(systemtest.Line(cmd), " up ") {
			return system.Result{}
		}
		var config struct {
			Server struct {
				Store struct {
					Key string `yaml:"encryptionKey"`
				} `yaml:"store"`
			} `yaml:"server"`
		}
		if err := yaml.Unmarshal([]byte(clitest.Read(t, filepath.Join(dir, "server-config"))), &config); err != nil {
			t.Fatal(err)
		}
		decoded, err := base64.StdEncoding.DecodeString(config.Server.Store.Key)
		// The pinned process exits when event-store initialization rejects this key.
		transport.ready = err == nil && len(decoded) == 32
		if transport.ready {
			if startedKey != "" && startedKey != config.Server.Store.Key {
				t.Fatal("reinstall rotated persisted encryption material")
			}
			startedKey = config.Server.Store.Key
		}
		return system.Result{}
	})
	cat := catalog.New([]app.App{netbird.App{}}, nil)
	args := []string{"install", "netbird", "--yes", "--set", "netbird.NETBIRD_CANONICAL_ORIGIN=https://netbird.fixture.test"}
	if result := clitest.Run(t, deps, cat, args...); result.Code != 0 {
		t.Fatal(result.Out)
	}
	info, err := os.Stat(filepath.Join(dir, "server-config"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatal("server configuration is not private")
	}
	if err := os.MkdirAll(filepath.Join(dir, "state"), 0o700); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(dir, "state", "fixture.db")
	if err := os.WriteFile(sentinel, []byte("persisted state"), 0o600); err != nil {
		t.Fatal(err)
	}
	if result := clitest.Run(t, deps, cat, args...); result.Code != 0 {
		t.Fatal(result.Out)
	}
	if transport.ownerReads < 2 || clitest.Read(t, sentinel) != "persisted state" {
		t.Fatal("reinstall did not preserve state and authenticate the saved owner")
	}
	if strings.Contains(clitest.Read(t, filepath.Join(dir, "compose.yml")), startedKey) {
		t.Fatal("datastore key escaped into Compose")
	}
	for _, cmd := range runner.Cmds() {
		if strings.Contains(systemtest.Line(cmd), startedKey) {
			t.Fatal("datastore key escaped into process arguments")
		}
	}
}
