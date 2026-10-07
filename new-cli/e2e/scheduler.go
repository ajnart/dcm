package e2e

import (
	"context"
	"errors"
	"sync"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
)

func newSweepGuard(workers int) *sweepGuard {
	return &sweepGuard{workers: workers, changed: make(chan struct{}), ProjectNames: map[string]string{}, ports: &portRegistry{used: map[publishedPort]*portReservation{}}}
}

type targetLease struct {
	guard     *sweepGuard
	weight    int
	exclusive bool
	once      sync.Once
}

func (g *sweepGuard) signalLocked() {
	if g.changed != nil {
		close(g.changed)
	}
	g.changed = make(chan struct{})
}

func (g *sweepGuard) acquire(ctx context.Context, weight int, exclusive bool) (*targetLease, error) {
	if weight < 1 || weight > 20 {
		return nil, errors.New("target exceeds App environment budget")
	}
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		g.mu.Lock()
		if g.Blocked {
			g.mu.Unlock()
			return nil, errors.New("sweep blocked by owned teardown failure")
		}
		if g.changed == nil {
			g.changed = make(chan struct{})
		}
		workers := g.workers
		if workers == 0 {
			workers = 1
		}
		if g.activeJobs < workers && g.activeApps+weight <= 20 && !g.exclusive && (!exclusive || g.activeJobs == 0) {
			g.activeJobs++
			g.activeApps += weight
			g.exclusive = exclusive
			g.mu.Unlock()
			return &targetLease{guard: g, weight: weight, exclusive: exclusive}, nil
		}
		changed := g.changed
		g.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-changed:
		}
	}
}

// Successful cleanup releases the whole target reservation. Failed teardown
// keeps its budget and ports occupied and prevents every queued admission.
func (l *targetLease) finish(clean bool) {
	l.once.Do(func() {
		g := l.guard
		g.mu.Lock()
		defer g.mu.Unlock()
		if clean {
			g.activeJobs--
			g.activeApps -= l.weight
			if l.exclusive {
				g.exclusive = false
			}
		} else {
			g.Blocked = true
		}
		g.signalLocked()
	})
}

func (g *sweepGuard) capacity() (int, int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.activeJobs, g.activeApps
}

func exclusiveTarget(c *catalog.Catalog, t targetSpec) bool {
	if t.Kind == "recipe" || len(t.Apps) > 1 || len(expectedServices(t)) > 1 {
		return true
	}
	heavy := map[string]bool{"ollama": true, "open-webui": true, "frigate": true, "tdarr": true, "netdata": true, "jellyfin": true, "emby": true, "plex": true}
	for _, id := range t.Apps {
		if heavy[id] {
			return true
		}
		a, ok := c.App(id)
		if !ok {
			return true
		}
		ports, err := publishedPorts(a.Compose(app.RenderContext{Port: 30001, Inputs: localInputs[id]}))
		if err != nil {
			return true
		}
		for _, p := range ports {
			if p.port != 30001 {
				return true
			}
		}
	}
	return false
}
