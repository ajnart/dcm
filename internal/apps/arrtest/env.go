package arrtest

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
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
	Sonarr      *Arr
	Radarr      *Arr
	Prowlarr    *Arr
	Jellyfin    *Jellyfin
	Seerr       *Seerr

	servers map[string]*httptest.Server
	arrs    map[string]*Arr
	mu      sync.Mutex
	execs   []string
}

// New returns an Env for cat. Servers are added with Serve.
func New(t *testing.T, cat *catalog.Catalog) *Env {
	e := &Env{
		T:           t,
		Deps:        systemtest.NewDeps(t),
		Catalog:     cat,
		QBittorrent: NewQBittorrent(),
		Sonarr:      NewArr("sonarr"),
		Radarr:      NewArr("radarr"),
		Prowlarr:    NewArr("prowlarr"),
		Jellyfin:    NewJellyfin(),
		Seerr:       NewSeerr(),
		servers:     map[string]*httptest.Server{},
	}
	e.arrs = map[string]*Arr{"sonarr": e.Sonarr, "radarr": e.Radarr, "prowlarr": e.Prowlarr}
	e.Serve("qbittorrent", e.QBittorrent.Handler())
	for id, arr := range e.arrs {
		arr.FolderExists = e.folderExists
		e.Serve(id, arr.Handler())
	}
	for _, arr := range []*Arr{e.Sonarr, e.Radarr} {
		arr.AcceptDownloadClient = e.acceptDownloadClient
	}
	e.Prowlarr.AcceptApplication = e.acceptApplication
	e.Jellyfin.FolderExists = e.folderExists
	e.Serve("jellyfin", e.Jellyfin.Handler())
	e.Seerr.Jellyfin = func(host string, port int, user, password string) bool {
		return host == "jellyfin" && port == 8096 && e.Jellyfin.SignIn(user, password)
	}
	e.Seerr.JellyfinLibraries = e.Jellyfin.Libraries
	e.Seerr.Servarr = e.servarr
	e.Serve("seerr", e.Seerr.Handler())
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
	case strings.HasPrefix(verb, "restart "):
		for _, service := range strings.Fields(strings.TrimPrefix(verb, "restart ")) {
			if arr := e.arrs[service]; arr != nil {
				arr.Restart()
			}
		}
	case strings.HasPrefix(verb, "logs "):
		return system.Result{Stdout: []byte(e.logs(strings.Fields(verb)))}
	case strings.HasPrefix(verb, "exec -T "):
		e.mu.Lock()
		e.execs = append(e.execs, strings.TrimPrefix(verb, "exec -T "))
		e.mu.Unlock()
	}
	return system.Result{}
}

func (e *Env) folderExists(path string) bool {
	return slices.ContainsFunc([]string{"sonarr", "radarr", "jellyfin"}, func(service string) bool {
		return slices.Contains(e.Execs(), service+" s6-setuidgid abc mkdir -p "+path)
	})
}

// servarr plays Sonarr or Radarr answering Seerr's connection test: right
// container name, port and API key.
func (e *Env) servarr(kind, host string, port int, apiKey string) ([]string, bool) {
	arr, ports := e.arrs[kind], map[string]int{"sonarr": 8989, "radarr": 7878}
	if arr == nil || host != kind || port != ports[kind] || apiKey != arr.Key {
		return nil, false
	}
	return arr.RootFolders(), true
}

// acceptDownloadClient plays qBittorrent answering a connection test from
// Sonarr or Radarr: right container name, port and Admin login.
func (e *Env) acceptDownloadClient(host string, port int, user, password string) bool {
	wantUser, wantPass := e.QBittorrent.Credentials()
	return host == "qbittorrent" && strconv.Itoa(port) == e.Port("qbittorrent") && user == wantUser && password == wantPass
}

// acceptApplication plays Sonarr or Radarr answering Prowlarr's connection
// test: right container address and API key.
func (e *Env) acceptApplication(baseURL, apiKey string) bool {
	switch baseURL {
	case "http://sonarr:8989":
		return apiKey == e.Sonarr.Key
	case "http://radarr:7878":
		return apiKey == e.Radarr.Key
	}
	return false
}

func (e *Env) start(services []string) {
	for _, service := range services {
		if service == "seerr" {
			e.Seerr.mu.Lock()
			e.Seerr.APIKey = e.secret("SEERR_API_KEY")
			e.Seerr.mu.Unlock()
		}
		arr := e.arrs[service]
		if arr == nil {
			continue
		}
		key := arr.Key
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

// secret reads a value the CLI saved to secrets.env, like Compose passing it
// to a container.
func (e *Env) secret(key string) string {
	data, err := os.ReadFile(filepath.Join(clitest.Root(e.T, e.Deps), "secrets.env"))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		if value, found := strings.CutPrefix(line, key+"="); found {
			return strings.Trim(value, `'"`)
		}
	}
	return ""
}
