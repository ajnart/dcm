package service

import (
	"context"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/compose"
	"github.com/ajnart/self-host/internal/events"
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
	node  ts.Node
	at    time.Time
	known bool
}

func (ss *session) pendingTailscaleServices(targets []string, containers []compose.Container) []string {
	if !ss.tailscaleOn() {
		return nil
	}
	active := slices.ContainsFunc(containers, func(c compose.Container) bool { return c.Service == tailscaleID && c.State == "running" })
	if !active {
		return nil
	}
	var nodes []string
	for _, target := range ss.webTargets() {
		service := ts.ServiceName(target.ID)
		present := slices.ContainsFunc(containers, func(c compose.Container) bool { return c.Service == service })
		if slices.Contains(targets, target.ID) && !present {
			nodes = append(nodes, service)
		}
	}
	if len(nodes) > 0 {
		ss.s.Log.Emit(events.Event{Event: events.Info, App: tailscaleID, Msg: "Start private Access for the approved Apps: " + strings.Join(nodes, ", ")})
	}
	return nodes
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
	previous, _ := ss.p.ReadFragment(tailscaleID)
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
	services, err := ss.p.FragmentServices(tailscaleID)
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
func (ss *session) tailscaleNodes(ctx context.Context, byService map[string]compose.Container) map[string]nodeRead {
	if !ss.tailscaleOn() {
		return nil
	}
	var (
		wg    sync.WaitGroup
		mu    sync.Mutex
		nodes = map[string]nodeRead{}
	)
	for service, container := range byService {
		id, found := ts.AppOf(service)
		if !found {
			continue
		}
		if container.State == "unknown" || container.State == "" {
			mu.Lock()
			nodes[id] = nodeRead{}
			mu.Unlock()
		}
		if container.State != "running" {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			node, known := ss.readNode(ctx, service)
			mu.Lock()
			nodes[id] = nodeRead{node: node, known: known}
			mu.Unlock()
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
		return cached.node, cached.known
	}
	result, err := ss.compose.Exec(ctx, service, nil, ts.StatusCommand()...)
	var node ts.Node
	if err == nil {
		node, err = ts.ParseStatus(result.Stdout)
	}
	nodeReads.Lock()
	nodeReads.byService[key] = nodeRead{node: node, at: now, known: err == nil}
	nodeReads.Unlock()
	return node, err == nil
}

// accessAddresses lists the Addresses each App has under the Access options
// in use besides the Home network one, by App ID. Each option adds its own.
func (ss *session) accessAddresses(nodes map[string]nodeRead) map[string][]string {
	addresses := map[string][]string{}
	for id, node := range nodes {
		if !node.known {
			continue
		}
		path := ""
		if a, found := ss.s.Catalog.App(id); found {
			path = a.Info().Path
		}
		if address := node.node.Address(path); address != "" {
			addresses[id] = append(addresses[id], address)
		}
	}
	return addresses
}

// tailscaleChecks turns what the nodes say into Needs attention items.
func (ss *session) tailscaleChecks(ctx context.Context, byService map[string]compose.Container) []host.Check {
	return ss.tailscaleFindings(ss.tailscaleNodes(ctx, byService))
}

func (ss *session) tailscaleFindings(observations map[string]nodeRead) []host.Check {
	nodes := map[string]ts.Node{}
	var checks []host.Check
	for id, node := range observations {
		name := id
		if a, found := ss.s.Catalog.App(id); found {
			name = a.Info().Name
		}
		if !node.known {
			checks = append(checks, host.Check{ID: "tailscale-inspection-" + id, App: tailscaleID, Title: "Tailscale", Level: host.Warn,
				Detail: name + ": private Access could not be inspected; its sign-in and HTTPS state are unknown.",
				Hint:   "Inspect it with: self-host logs tailscale; docker compose --project-directory " + ss.p.Root + " exec -T " + ts.ServiceName(id) + " " + strings.Join(ts.StatusCommand(), " ")})
			continue
		}
		nodes[name] = node.node
	}
	sort.Slice(checks, func(i, j int) bool { return checks[i].ID < checks[j].ID })
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
