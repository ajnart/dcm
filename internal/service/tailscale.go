package service

import (
	"context"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/compose"
	"github.com/ajnart/self-host/internal/host"
	ts "github.com/ajnart/self-host/internal/tailscale"
)

const tailscaleID = "tailscale"

// nodeReadsFor is how long a node's status is reused, so the Dashboard's
// refresh does not run a command in every node every few seconds.
const nodeReadsFor = 20 * time.Second

var nodeReads = struct {
	sync.Mutex
	byService map[string]nodeRead
}{byService: map[string]nodeRead{}}

type nodeRead struct {
	node ts.Node
	at   time.Time
}

// tailscaleOn reports whether the Tailscale Access is in use: its App is installed.
func (ss *session) tailscaleOn() bool { return ss.state.Apps[tailscaleID] != nil }

// webTargets lists the installed Apps that have a web page, for the Access
// Apps that front each of them.
func (ss *session) webTargets() []app.WebTarget {
	var targets []app.WebTarget
	for id, st := range ss.state.Apps {
		a, found := ss.s.Catalog.App(id)
		if !found || st == nil || id == tailscaleID {
			continue
		}
		info := a.Info()
		if info.NoWebUI || st.Port <= 0 || info.ContainerPort <= 0 {
			continue
		}
		targets = append(targets, app.WebTarget{ID: id, Service: info.Service, ContainerPort: info.ContainerPort, Path: info.Path})
	}
	sort.Slice(targets, func(i, j int) bool { return targets[i].ID < targets[j].ID })
	return targets
}

// renderTailscale writes the Tailscale App's Compose file and files for the
// web Apps installed now, and reports whether the Compose file changed.
func (ss *session) renderTailscale() (bool, error) {
	a, found := ss.s.Catalog.App(tailscaleID)
	st := ss.state.Apps[tailscaleID]
	if !found || st == nil {
		return false, nil
	}
	inputs := map[string]string{"auth_key": ss.secrets.Get(SecretKey(tailscaleID, "auth_key"))}
	for key, value := range st.Inputs {
		inputs[key] = value
	}
	rc := app.RenderContext{Port: st.Port, Inputs: inputs, Web: ss.webTargets()}
	fragment := a.Compose(rc)
	if err := ss.p.ValidateFragment(tailscaleID, fragment); err != nil {
		return false, err
	}
	previous, _ := os.ReadFile(ss.p.FragmentPath(tailscaleID))
	changed := !strings.HasSuffix(string(previous), fragment)
	if err := ss.writeFiles(a, rc); err != nil {
		return false, err
	}
	if !changed {
		return false, nil
	}
	return true, ss.p.WriteFragment(tailscaleID, fragment)
}

// retireNode stops and removes an App's node before the App goes.
func (ss *session) retireNode(ctx context.Context, id string) error {
	if !ss.tailscaleOn() || id == tailscaleID {
		return nil
	}
	services, err := fragmentServices(ss.p.FragmentPath(tailscaleID))
	if err != nil {
		return err
	}
	if !contains(services, ts.ServiceName(id)) {
		return nil
	}
	return ss.compose.Remove(ctx, ts.ServiceName(id))
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// tailscaleNodes reads each running node's own view of the tailnet, by App.
func (ss *session) tailscaleNodes(ctx context.Context, byService map[string]compose.Container) map[string]ts.Node {
	if !ss.tailscaleOn() {
		return nil
	}
	var (
		wg    sync.WaitGroup
		mu    sync.Mutex
		nodes = map[string]ts.Node{}
	)
	for service, container := range byService {
		id, found := ts.AppOf(service)
		if !found || container.State != "running" {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			if node, ok := ss.readNode(ctx, service); ok {
				mu.Lock()
				nodes[id] = node
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	return nodes
}

func (ss *session) readNode(ctx context.Context, service string) (ts.Node, bool) {
	key := ss.p.Root + "\x00" + ss.p.ComposeName + "\x00" + service
	now := ss.s.Deps.Now()
	nodeReads.Lock()
	cached, found := nodeReads.byService[key]
	nodeReads.Unlock()
	if found && now.Sub(cached.at) < nodeReadsFor {
		return cached.node, true
	}
	result, err := ss.compose.Exec(ctx, service, nil, ts.StatusCommand()...)
	if err != nil {
		return ts.Node{}, false
	}
	node, err := ts.ParseStatus(result.Stdout)
	if err != nil {
		return ts.Node{}, false
	}
	nodeReads.Lock()
	nodeReads.byService[key] = nodeRead{node: node, at: now}
	nodeReads.Unlock()
	return node, true
}

// accessAddresses lists the Addresses each App has under the Access options
// in use besides the Home network one, by App ID. Each option adds its own.
func (ss *session) accessAddresses(ctx context.Context, byService map[string]compose.Container) map[string][]string {
	addresses := map[string][]string{}
	for id, node := range ss.tailscaleNodes(ctx, byService) {
		path := ""
		if a, found := ss.s.Catalog.App(id); found {
			path = a.Info().Path
		}
		if address := node.Address(path); address != "" {
			addresses[id] = append(addresses[id], address)
		}
	}
	return addresses
}

// tailscaleChecks turns what the nodes say into Needs attention items.
func (ss *session) tailscaleChecks(ctx context.Context, byService map[string]compose.Container) []host.Check {
	nodes := map[string]ts.Node{}
	for id, node := range ss.tailscaleNodes(ctx, byService) {
		name := id
		if a, found := ss.s.Catalog.App(id); found {
			name = a.Info().Name
		}
		nodes[name] = node
	}
	var checks []host.Check
	for _, finding := range ts.Assess(nodes, ss.s.Deps.Now()) {
		level := host.Warn
		if finding.Broken {
			level = host.Fail
		}
		checks = append(checks, host.Check{ID: "tailscale-" + finding.ID, App: tailscaleID, Title: "Tailscale",
			Level: level, Detail: finding.Detail, Hint: finding.Hint})
	}
	return checks
}
