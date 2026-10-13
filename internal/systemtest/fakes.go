package systemtest

import (
	"fmt"
	"sync"
	"time"

	"github.com/ajnart/self-host/internal/system"
)

var (
	_ system.Clock       = (*Clock)(nil)
	_ system.Network     = (*Network)(nil)
	_ system.Host        = (*Host)(nil)
	_ system.Environment = Env(nil)
	_ system.Accounts    = (*Accounts)(nil)
	_ system.Resolver    = (*Resolver)(nil)
	_ system.Runner      = (*Runner)(nil)
)

func NewClock(start time.Time) *Clock { return &Clock{now: start} }

// Network is a fake host network. HostIPs follows deps.LANIP until SetHostIPs
// is called.
type Network struct {
	mu         sync.Mutex
	ip         string
	hostIPs    []string
	hostIPsSet bool
	busy       map[int]bool
	source     system.Network
}

func NewNetwork() *Network { return &Network{ip: "192.168.1.20"} }

func (n *Network) SetLANIP(ip string) *Network {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.ip = ip
	return n
}

func (n *Network) SetHostIPs(ips ...string) *Network {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.hostIPs, n.hostIPsSet = append([]string(nil), ips...), true
	return n
}

func (n *Network) BusyPorts(ports ...int) *Network {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.busy == nil {
		n.busy = map[int]bool{}
	}
	for _, port := range ports {
		n.busy[port] = true
	}
	return n
}

func (n *Network) LANIP() (string, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.ip, nil
}

func (n *Network) HostIPs() ([]string, error) {
	n.mu.Lock()
	set, ips, source := n.hostIPsSet, append([]string(nil), n.hostIPs...), n.source
	n.mu.Unlock()
	if set {
		return ips, nil
	}
	if source == nil {
		source = n
	}
	ip, err := source.LANIP()
	return []string{ip}, err
}

func (n *Network) PortFree(port int) bool {
	n.mu.Lock()
	busy := n.busy[port]
	n.mu.Unlock()
	return !busy
}

// Host is a fake machine: its time zone, running processes and folders.
type Host struct {
	mu      sync.Mutex
	zone    string
	alive   map[int]bool
	Folders *Folders
}

func NewHost() *Host { return &Host{zone: "Europe/Paris", Folders: &Folders{}} }

func (h *Host) AliveProcesses(pids ...int) *Host {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.alive == nil {
		h.alive = map[int]bool{}
	}
	for _, pid := range pids {
		h.alive[pid] = true
	}
	return h
}

func (h *Host) TimeZone() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.zone
}

func (h *Host) ProcessAlive(pid int) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.alive[pid]
}

func (h *Host) ListFolders(dir string) ([]string, error) { return h.Folders.List(dir) }

// Env is a fake environment backed by the map it wraps.
type Env map[string]string

func (e Env) Getenv(key string) string { return e[key] }

// Accounts is a fake user database.
type Accounts struct {
	mu      sync.Mutex
	current system.User
	users   map[string]system.User
}

func NewAccounts(current system.User) *Accounts { return &Accounts{current: current} }

func (a *Accounts) Add(user system.User) *Accounts {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.users == nil {
		a.users = map[string]system.User{}
	}
	a.users[user.Name] = user
	return a
}

func (a *Accounts) CurrentUser() (system.User, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.current, nil
}

func (a *Accounts) LookupUser(name string) (system.User, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if user, ok := a.users[name]; ok {
		return user, nil
	}
	return system.User{}, fmt.Errorf("unknown user %s", name)
}

type fakes struct {
	home     string
	runner   system.Runner
	clock    system.Clock
	network  system.Network
	host     system.Host
	env      system.Environment
	accounts system.Accounts
	resolver system.Resolver
}

type Option func(*fakes)

func WithRunner(r system.Runner) Option { return func(f *fakes) { f.runner = r } }

func WithClock(c system.Clock) Option { return func(f *fakes) { f.clock = c } }

func WithNetwork(n system.Network) Option { return func(f *fakes) { f.network = n } }

func WithHost(h system.Host) Option { return func(f *fakes) { f.host = h } }

func WithEnv(env map[string]string) Option { return func(f *fakes) { f.env = Env(env) } }

func WithAccounts(a system.Accounts) Option { return func(f *fakes) { f.accounts = a } }

func WithResolver(r system.Resolver) Option { return func(f *fakes) { f.resolver = r } }

func (n *Network) follow(source system.Network) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.source == nil {
		n.source = source
	}
}
