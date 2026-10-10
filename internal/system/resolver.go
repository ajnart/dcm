package system

import (
	"context"
	"net"
	"sync"
	"time"
)

const (
	lookupTimeout = 3 * time.Second
	lookupTTL     = 30 * time.Second
)

// netResolver asks this computer's resolver, and keeps each answer, failures
// included, for lookupTTL so the Dashboard's refreshes do not repeat the same
// slow lookup.
type netResolver struct {
	lookup func(ctx context.Context, name string) ([]string, error)
	now    func() time.Time

	mu    sync.Mutex
	cache map[string]cachedLookup
}

type cachedLookup struct {
	addresses []string
	err       error
	at        time.Time
}

func newResolver() *netResolver {
	return &netResolver{
		lookup: func(ctx context.Context, name string) ([]string, error) {
			return net.DefaultResolver.LookupHost(ctx, name)
		},
		now:   time.Now,
		cache: map[string]cachedLookup{},
	}
}

func (r *netResolver) LookupHost(ctx context.Context, name string) ([]string, error) {
	r.mu.Lock()
	if hit, found := r.cache[name]; found && r.now().Sub(hit.at) < lookupTTL {
		r.mu.Unlock()
		return hit.addresses, hit.err
	}
	r.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, lookupTimeout)
	defer cancel()
	addresses, err := r.lookup(ctx, name)
	r.mu.Lock()
	r.cache[name] = cachedLookup{addresses: addresses, err: err, at: r.now()}
	r.mu.Unlock()
	return addresses, err
}

// LookupHostVia sends the query to server over UDP, not to the system's.
func (r *netResolver) LookupHostVia(ctx context.Context, server, name string) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, lookupTimeout)
	defer cancel()
	direct := &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: lookupTimeout}).DialContext(ctx, "udp", server)
	}}
	return direct.LookupHost(ctx, name)
}
