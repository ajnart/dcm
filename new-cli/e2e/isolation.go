package e2e

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"go.yaml.in/yaml/v3"
	"golang.org/x/sys/unix"
)

// One slot shared by all harness processes. Serial execution bounds heavy
// Recipes too: never more than the largest Recipe (12 App environments).
func acquireGlobal(ctx context.Context, path string) (func(), error) {
	fd, err := unix.Open(path, unix.O_CREAT|unix.O_RDWR|unix.O_NOFOLLOW, 0o600)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), path)
	var stat unix.Stat_t
	if err := unix.Fstat(fd, &stat); err != nil {
		f.Close()
		return nil, err
	}
	if stat.Uid != uint32(os.Getuid()) || stat.Mode&unix.S_IFMT != unix.S_IFREG || stat.Mode&0o077 != 0 {
		f.Close()
		return nil, errors.New("global lock is not a private owned regular file")
	}
	for {
		err = unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB)
		if err == nil {
			var once sync.Once
			return func() { once.Do(func() { unix.Flock(fd, unix.LOCK_UN); f.Close() }) }, nil
		}
		if err != unix.EWOULDBLOCK && err != unix.EAGAIN {
			f.Close()
			return nil, err
		}
		select {
		case <-ctx.Done():
			f.Close()
			return nil, ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
	}
}

type publishedPort struct {
	port     int
	protocol string
}

func fmtPort(port int) string { return strconv.Itoa(port) }

func publishedPorts(source string) ([]publishedPort, error) {
	var doc struct {
		Services map[string]struct {
			Ports []any `yaml:"ports"`
		} `yaml:"services"`
	}
	if err := yaml.Unmarshal([]byte(source), &doc); err != nil {
		return nil, errors.New("invalid published port source")
	}
	var ports []publishedPort
	for _, svc := range doc.Services {
		for _, raw := range svc.Ports {
			text, ok := raw.(string)
			if !ok {
				return nil, errors.New("unsupported published port syntax")
			}
			text = strings.ReplaceAll(text, "${BIND_IP}", "127.0.0.1")
			parts := strings.Split(text, ":")
			if len(parts) != 3 || parts[0] != "127.0.0.1" {
				return nil, errors.New("published port does not use the selected loopback bind")
			}
			port, err := strconv.Atoi(parts[1])
			if err != nil || port < 1 || port > 65535 {
				return nil, errors.New("unsupported host port")
			}
			protocol := "tcp"
			if strings.HasSuffix(parts[2], "/udp") {
				protocol = "udp"
			}
			ports = append(ports, publishedPort{port, protocol})
		}
	}
	return ports, nil
}

type portRegistry struct {
	mu   sync.Mutex
	used map[publishedPort]*portReservation
}

type portReservation struct {
	pool      *portRegistry
	owned     []publishedPort
	primary   map[string]int
	listeners []io.Closer
}

func (r *portReservation) closeSockets() {
	for _, l := range r.listeners {
		l.Close()
	}
	r.listeners = nil
}
func (r *portReservation) releaseLocked() {
	r.closeSockets()
	for _, p := range r.owned {
		if r.pool.used[p] == r {
			delete(r.pool.used, p)
		}
	}
	r.owned = nil
}
func (r *portReservation) release() { r.pool.mu.Lock(); defer r.pool.mu.Unlock(); r.releaseLocked() }
func (p *portRegistry) owns(r *portReservation, port publishedPort) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.used[port] == r
}

func reserveTargetPorts(c *catalog.Catalog, t targetSpec, pools ...*portRegistry) (*portReservation, error) {
	pool := &portRegistry{used: map[publishedPort]*portReservation{}}
	if len(pools) > 0 && pools[0] != nil {
		pool = pools[0]
	}
	pool.mu.Lock()
	defer pool.mu.Unlock()
	if pool.used == nil {
		pool.used = map[publishedPort]*portReservation{}
	}
	r := &portReservation{primary: map[string]int{}, pool: pool}
	fail := func(err error) (*portReservation, error) { r.releaseLocked(); return nil, err }
	claim := func(p publishedPort) { pool.used[p] = r; r.owned = append(r.owned, p) }
	for _, id := range t.Apps {
		a, ok := c.App(id)
		if !ok {
			return fail(blockerError("unknown App"))
		}
		primary := 0
		if a.Info().Port > 0 {
			for attempts := 0; attempts < 1024; attempts++ {
				listener, err := net.Listen("tcp4", "127.0.0.1:0")
				if err != nil {
					return fail(blockerError(id + ": loopback primary port reservation failed"))
				}
				candidate := listener.Addr().(*net.TCPAddr).Port
				p := publishedPort{candidate, "tcp"}
				if pool.used[p] != nil {
					listener.Close()
					continue
				}
				primary = candidate
				r.primary[id] = primary
				r.listeners = append(r.listeners, listener)
				claim(p)
				break
			}
			if primary == 0 {
				return fail(blockerError(id + ": no isolated primary port available"))
			}
		}
		source := a.Compose(app.RenderContext{Port: primary, Inputs: localInputs[id]})
		if err := validateComposeIsolation(source); err != nil {
			return fail(blockerError(id + ": Compose isolation refused: " + err.Error()))
		}
		ports, err := publishedPorts(source)
		if err != nil {
			return fail(blockerError(id + ": port isolation refused: " + err.Error()))
		}
		for _, p := range ports {
			if owner := pool.used[p]; owner != nil {
				if owner == r {
					continue
				}
				return fail(blockerError(fmt.Sprintf("%s: required %s host port %d already reserved", id, p.protocol, p.port)))
			}
			addr := net.JoinHostPort("127.0.0.1", fmtPort(p.port))
			var listener io.Closer
			if p.protocol == "udp" {
				listener, err = net.ListenPacket("udp4", addr)
			} else {
				listener, err = net.Listen("tcp4", addr)
			}
			if err != nil {
				return fail(blockerError(fmt.Sprintf("%s: required %s host port %d is unavailable", id, p.protocol, p.port)))
			}
			r.listeners = append(r.listeners, listener)
			claim(p)
		}
	}
	return r, nil
}

type sweepGuard struct {
	blockerMu       sync.Mutex
	retainedPaths   map[string]bool
	mu              sync.Mutex
	workers         int
	activeJobs      int
	activeApps      int
	exclusive       bool
	changed         chan struct{}
	ports           *portRegistry
	ProjectNames    map[string]string
	Blocked         bool
	RetainedProject string
	OnBlock         func(string)
}

func (g *sweepGuard) CanRunNext() bool {
	if g == nil {
		return true
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	return !g.Blocked
}

func (g *sweepGuard) RegisterProject(project, name string) {
	if g == nil {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.ProjectNames == nil {
		g.ProjectNames = map[string]string{}
	}
	g.ProjectNames[project] = name
}
func (g *sweepGuard) ProjectName(project string) string {
	if g == nil {
		return ""
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.ProjectNames[project]
}
func (g *sweepGuard) Retained() (string, string) {
	if g == nil {
		return "", ""
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.RetainedProject, g.ProjectNames[g.RetainedProject]
}

type retainedProject struct {
	Project        string `json:"project"`
	ComposeProject string `json:"compose_project"`
}

func (g *sweepGuard) RetainedProjects() []retainedProject {
	g.mu.Lock()
	defer g.mu.Unlock()
	keys := []string{}
	for project := range g.retainedPaths {
		keys = append(keys, project)
	}
	sort.Strings(keys)
	var out []retainedProject
	for _, project := range keys {
		out = append(out, retainedProject{project, g.ProjectNames[project]})
	}
	return out
}
func (g *sweepGuard) Retains(project string) bool {
	if g == nil {
		return false
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.RetainedProject == project || g.retainedPaths[project]
}
func (g *sweepGuard) Block(project string) {
	if g == nil {
		return
	}
	// Serialize persistence callbacks too, so a later failure cannot overwrite
	// the blocker with an older, incomplete recovery inventory.
	g.blockerMu.Lock()
	defer g.blockerMu.Unlock()
	g.mu.Lock()
	g.Blocked = true
	if g.retainedPaths == nil {
		g.retainedPaths = map[string]bool{}
	}
	first := !g.retainedPaths[project]
	g.retainedPaths[project] = true
	if g.RetainedProject == "" {
		g.RetainedProject = project
	}
	callback := g.OnBlock
	g.signalLocked()
	g.mu.Unlock()
	if first && callback != nil {
		callback(project)
	}
}

func cleanupOwned(down func() error, remove func(), guard *sweepGuard, project string) error {
	if guard.Retains(project) {
		return errors.New("owned Project retained after teardown failure")
	}
	if err := down(); err != nil {
		guard.Block(project)
		return err
	}
	remove()
	return nil
}

func validateComposeIsolation(source string) error {
	var doc struct {
		Name     string `yaml:"name"`
		Services map[string]struct {
			ContainerName string `yaml:"container_name"`
			NetworkMode   string `yaml:"network_mode"`
			Volumes       []any  `yaml:"volumes"`
			Labels        any    `yaml:"labels"`
		} `yaml:"services"`
		Networks map[string]map[string]any `yaml:"networks"`
		Volumes  map[string]map[string]any `yaml:"volumes"`
	}
	if err := yaml.Unmarshal([]byte(source), &doc); err != nil {
		return errors.New("invalid Compose isolation source")
	}
	if doc.Name != "" {
		return errors.New("fixed Compose name")
	}
	for _, resources := range []map[string]map[string]any{doc.Networks, doc.Volumes} {
		for _, resource := range resources {
			if _, ok := resource["name"]; ok {
				return errors.New("fixed global resource name")
			}
			if external, ok := resource["external"]; ok && external != false {
				return errors.New("external resource")
			}
		}
	}
	for _, svc := range doc.Services {
		if svc.ContainerName != "" {
			return errors.New("fixed container name")
		}
		if svc.NetworkMode != "" && svc.NetworkMode != "none" && !strings.HasPrefix(svc.NetworkMode, "service:") {
			return errors.New("external network namespace")
		}
		for _, volume := range svc.Volumes {
			if strings.Contains(fmt.Sprint(volume), "docker.sock") {
				return errors.New("Docker socket mount")
			}
		}
		switch labels := svc.Labels.(type) {
		case map[string]any:
			for key := range labels {
				if strings.HasPrefix(key, "com.docker.compose.") {
					return errors.New("Compose ownership label")
				}
			}
		case []any:
			for _, label := range labels {
				if strings.HasPrefix(fmt.Sprint(label), "com.docker.compose.") {
					return errors.New("Compose ownership label")
				}
			}
		}
	}
	return nil
}
