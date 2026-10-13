package system

import (
	"context"
	"time"
)

type Clock interface {
	Now() time.Time
	// Sleep waits d or until ctx ends.
	Sleep(ctx context.Context, d time.Duration) error
}

type Network interface {
	// LANIP returns the address of the interface on the default route.
	LANIP() (string, error)
	// HostIPs returns the IPv4 addresses of this machine's active network
	// interfaces, without loopback and container bridges.
	HostIPs() ([]string, error)
	// PortFree reports whether a TCP port can be bound on the host.
	PortFree(port int) bool
}

type Host interface {
	// TimeZone returns the host's IANA time zone.
	TimeZone() string
	// ListFolders returns the names of the folders inside dir.
	ListFolders(dir string) ([]string, error)
	// ProcessAlive reports whether a PID belongs to a running process.
	ProcessAlive(pid int) bool
}

type Environment interface {
	Getenv(key string) string
}

type Accounts interface {
	CurrentUser() (User, error)
	LookupUser(name string) (User, error)
}

// depsView reads the Network funcs of d on every call, so a test that swaps
// d.LANIP is seen by whoever holds the view.
type depsView struct{ d *Deps }

func (v depsView) LANIP() (string, error) { return v.d.LANIP() }

func (v depsView) HostIPs() ([]string, error) { return v.d.HostIPs() }

func (v depsView) PortFree(port int) bool { return v.d.PortFree(port) }

func (d *Deps) Network() Network { return depsView{d} }

func (d *Deps) WithClock(c Clock) *Deps {
	d.Now, d.Sleep = c.Now, c.Sleep
	return d
}

func (d *Deps) WithNetwork(n Network) *Deps {
	d.LANIP, d.HostIPs, d.PortFree = n.LANIP, n.HostIPs, n.PortFree
	return d
}

func (d *Deps) WithHost(h Host) *Deps {
	d.TimeZone, d.ListFolders, d.ProcessAlive = h.TimeZone, h.ListFolders, h.ProcessAlive
	return d
}

func (d *Deps) WithEnvironment(e Environment) *Deps {
	d.Getenv = e.Getenv
	return d
}

func (d *Deps) WithAccounts(a Accounts) *Deps {
	d.CurrentUser, d.LookupUser = a.CurrentUser, a.LookupUser
	return d
}

func (d *Deps) WithResolver(r Resolver) *Deps {
	d.Resolver = r
	return d
}

func (d *Deps) WithRunner(r Runner) *Deps {
	d.Runner = r
	return d
}

var (
	_ Network = depsView{}
)
