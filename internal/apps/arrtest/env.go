package arrtest

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

// Env is a fake host with httptest servers standing in for the media Apps
// and a scripted `docker compose` that starts and inspects them.
type Env struct {
	T       *testing.T
	Deps    *system.Deps
	Catalog *catalog.Catalog

	QBittorrent *QBittorrent

	servers map[string]*httptest.Server
	mu      sync.Mutex
	execs   []string
	// arrKeys maps a started arr service to the API key it wrote.
	arrKeys map[string]string
}

// New returns an Env for cat. Servers are added with Serve.
func New(t *testing.T, cat *catalog.Catalog) *Env {
	e := &Env{
		T:           t,
		Deps:        systemtest.NewDeps(t),
		Catalog:     cat,
		QBittorrent: NewQBittorrent(),
		servers:     map[string]*httptest.Server{},
		arrKeys:     map[string]string{},
	}
	e.Serve("qbittorrent", e.QBittorrent.Handler())
	e.Deps.Runner.(*systemtest.Runner).OnFunc("docker compose --project-directory", e.docker)
	return e
}

// Serve starts an httptest server that plays the App id.
func (e *Env) Serve(id string, handler http.Handler) {
	server := httptest.NewServer(handler)
	e.T.Cleanup(server.Close)
	e.servers[id] = server
}

// Run runs the CLI. Install commands get --set <app>.port for every fake
// server so Setup talks to the fakes.
func (e *Env) Run(args ...string) clitest.Result {
	e.T.Helper()
	if len(args) > 0 && args[0] == "install" {
		for id, server := range e.servers {
			args = append(args, "--set", id+".port="+clitest.Port(server))
		}
	}
	return clitest.Run(e.T, e.Deps, e.Catalog, args...)
}

// Port returns the port the fake of App id listens on.
func (e *Env) Port(id string) string { return clitest.Port(e.servers[id]) }

// AppDir returns the host folder apps/<id> of the Project.
func (e *Env) AppDir(id string) string {
	return filepath.Join(clitest.Root(e.T, e.Deps), "apps", id)
}

// Execs lists the commands run inside containers, as "service command…".
func (e *Env) Execs() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]string(nil), e.execs...)
}

func (e *Env) docker(cmd system.Cmd) system.Result {
	line := systemtest.Line(cmd)
	_, verb, _ := strings.Cut(line, "secrets.env ")
	switch {
	case strings.HasPrefix(verb, "up -d"):
		e.start(strings.Fields(strings.TrimPrefix(verb, "up -d")))
	case strings.HasPrefix(verb, "logs "):
		return system.Result{Stdout: []byte(e.logs(strings.Fields(verb)))}
	case strings.HasPrefix(verb, "exec -T "):
		e.mu.Lock()
		e.execs = append(e.execs, strings.TrimPrefix(verb, "exec -T "))
		e.mu.Unlock()
	}
	return system.Result{}
}

func (e *Env) start(services []string) {
	for _, service := range services {
		if !isArr(service) {
			continue
		}
		e.mu.Lock()
		key := e.arrKeys[service]
		if key == "" {
			key = "key-" + service
			e.arrKeys[service] = key
		}
		e.mu.Unlock()
		dir := filepath.Join(e.AppDir(service), "config")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			e.T.Fatal(err)
		}
		xml := fmt.Sprintf("<Config>\n  <ApiKey>%s</ApiKey>\n  <Port>8989</Port>\n</Config>\n", key)
		if err := os.WriteFile(filepath.Join(dir, "config.xml"), []byte(xml), 0o644); err != nil {
			e.T.Fatal(err)
		}
	}
}

func (e *Env) logs(fields []string) string {
	var out strings.Builder
	for _, field := range fields {
		if field == "qbittorrent" {
			fmt.Fprintf(&out, "qbittorrent  | The WebUI administrator password was not set. A temporary password is provided for this session: %s\n", e.QBittorrent.TempPassword)
		}
	}
	return out.String()
}

func isArr(service string) bool {
	return service == "sonarr" || service == "radarr" || service == "prowlarr"
}
