package service

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net"
	"slices"
	"strings"
	"sync"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/compose"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/names"
	"github.com/ajnart/self-host/internal/project"
)

// settingNames is the Host setting that turns Easy names at home on. It adds
// to EXPOSURE, which keeps its meaning.
const settingNames = "EASY_NAMES"

const namesOn = "on"

func (s *Service) validateNames(ctx context.Context, settings map[string]string, state *project.State) error {
	if settings[settingNames] != namesOn {
		return nil
	}
	if settings["EXPOSURE"] == ExposureLocal {
		return fmt.Errorf("Easy names need Home network")
	}
	if check := s.checkEasyNames(ctx, settings["LAN_IP"]); !check.Available {
		return &NamesBlocked{check}
	}
	for id, st := range state.Apps {
		if st.Port == 80 {
			return fmt.Errorf("%s already uses port 80; Easy names need it, so nothing was changed", id)
		}
	}
	return nil
}

// Why Easy names cannot be turned on.
const (
	problemPortHeld = "port-held"
	problemRootless = "rootless"
	problemNetwork  = "network"
)

const rootlessFix = "Rootless Docker cannot publish port 80. Either let it bind low ports, as root: " +
	"sudo setcap cap_net_bind_service=ep $(which rootlesskit), then restart the Docker user service " +
	"(systemctl --user restart docker); or lower the limit for every program: " +
	"echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/99-unprivileged-port-80.conf && sudo sysctl --system"

const keepsWorking = " The addresses with numbers keep working."

// NamesCheck says whether Easy names at home can be turned on now, and if
// not why, in plain words.
type NamesCheck struct {
	Available bool `json:"available"`
	// Problem is port-held, rootless or network.
	Problem string `json:"problem,omitempty"`
	// Holder is the program that uses port 80, when it could be found.
	Holder  string `json:"holder,omitempty"`
	Message string `json:"message,omitempty"`
	// Technical is the detail and the fix, for a Technical details section.
	Technical string `json:"technical,omitempty"`
}

// NamesBlocked is the error for turning Easy names on when they cannot be.
// Nothing was changed.
type NamesBlocked struct{ NamesCheck }

func (e *NamesBlocked) Error() string {
	if e.Technical == "" {
		return e.Message
	}
	return e.Message + "\n\nTechnical details:\n" + e.Technical
}

// CheckEasyNames tests whether the Caddy can own port 80, with a real bind
// rather than a look at who listens. This Project's own Caddy already holding
// the port is fine. It changes nothing.
func (s *Service) CheckEasyNames(ctx context.Context) NamesCheck {
	return s.checkEasyNames(ctx, "")
}

func EasyNamesAddressCheck(lan string) NamesCheck {
	ip := net.ParseIP(lan)
	if ip != nil && ip.To4() != nil && ip.IsPrivate() {
		return NamesCheck{Available: true}
	}
	message := fmt.Sprintf("Easy names need a private home-network IPv4 address; %s is not one.", lan)
	if v4 := ip.To4(); v4 != nil && v4[0] == 192 && v4[1] == 0 && v4[2] == 0 && v4[3] < 8 {
		message = fmt.Sprintf("%s is an IPv4 service-continuity address used by CLAT on IPv6 networks, not a private home-network IPv4 address. Easy names do not support it or IPv6 yet.", lan)
	}
	return NamesCheck{Problem: problemNetwork, Message: message + " Change the LAN address to this computer's private home-network IPv4 address, or choose another Access option. Reachability of addresses with numbers is not verified."}
}

func (s *Service) checkEasyNames(ctx context.Context, lan string) NamesCheck {
	ownCaddy := false
	if p, err := s.Project(); err == nil && p.Exists() {
		if err := p.ValidateServiceOwnership(nil); err != nil {
			return NamesCheck{Problem: "ownership", Message: "An App uses a reserved service name, so nothing was changed.", Technical: err.Error()}
		}
		if settings, err := p.LoadSettings(); err == nil && lan == "" {
			lan = settings["LAN_IP"]
		}
		ownCaddy = s.ownCaddyRuns(ctx, p)
	}
	if lan == "" {
		lan, _ = s.Deps.LANIP()
	}
	if check := EasyNamesAddressCheck(lan); !check.Available {
		return check
	}
	if s.Deps.HomeNetwork != nil && !s.Deps.HomeNetwork(lan) {
		return NamesCheck{Problem: problemNetwork, Message: "This computer's address is not on an active home network, so nothing was changed. Change the LAN address or choose another Access option. Reachability of addresses with numbers is not verified."}
	}
	rootless, err := host.Rootless(ctx, s.Deps)
	if err != nil {
		return NamesCheck{Problem: "inspection", Message: "Docker could not be checked, so nothing was changed.", Technical: err.Error()}
	}
	if rootless {
		return NamesCheck{Problem: problemRootless, Technical: rootlessFix,
			Message: "Docker on this computer runs without administrator rights, so it can't use port 80 and nothing was changed." + keepsWorking}
	}
	if !ownCaddy && !s.Deps.PortFree(80) {
		holder := host.PortHolder(ctx, s.Deps, 80)
		message := "Port 80 is already in use or cannot be checked by binding, so nothing was changed."
		if holder != "" {
			message = "Another program (" + holder + ") already uses port 80, so nothing was changed."
		}
		return NamesCheck{Problem: problemPortHeld, Holder: holder,
			Message: message + keepsWorking}
	}
	return NamesCheck{Available: true}
}

// ownCaddyRuns reports whether this Project's Caddy is up and so holds port 80.
func (s *Service) ownCaddyRuns(ctx context.Context, p *project.Project) bool {
	if !p.HasNames() {
		return false
	}
	containers, err := s.compose(p).Ps(ctx)
	if err != nil {
		return false
	}
	return caddyRuns(containers)
}

func caddyRuns(containers []compose.Container) bool {
	for _, c := range containers {
		if c.Service == names.Service && c.State == "running" {
			for _, pub := range c.Publishers {
				if pub.PublishedPort == 80 && pub.TargetPort == 80 && pub.Protocol == "tcp" && pub.URL != "127.0.0.1" && pub.URL != "::1" {
					return true
				}
			}
		}
	}
	return false
}

func (ss *session) namesOn() bool { return ss.settings[settingNames] == namesOn }

// webApp is an App with a page in a browser, as Info says: what Easy names
// route to.
func (ss *session) webApp(id string) (app.Info, bool) {
	a, found := ss.s.Catalog.App(id)
	if !found || ss.state.Apps[id] == nil {
		return app.Info{}, false
	}
	info := a.Info()
	return info, !info.NoWebUI && ss.state.Apps[id].Port > 0 && info.ContainerPort > 0
}

// webApps lists the Apps with a page, in order.
func (ss *session) webApps() []string {
	ids, _ := ss.p.AppIDs()
	var web []string
	for _, id := range ids {
		if _, ok := ss.webApp(id); ok {
			web = append(web, id)
		}
	}
	return web
}

// syncNames makes the Caddy match the settings: written and started with a
// route per App while Easy names are on, removed otherwise. It touches Compose
// only when there is a Caddy to start or to remove.
func (ss *session) syncNames(ctx context.Context, start bool, configured []string) error {
	if !ss.namesOn() {
		runtime, err := ss.p.LoadNamesRuntime()
		if err != nil {
			return err
		}
		if runtime.StartAction != "" {
			return nil
		}
		if ss.p.HasNames() {
			if err := ss.compose.Remove(ctx, names.Service); err != nil {
				return err
			}
		}
		if err := ss.p.RemoveNames(); err != nil {
			return err
		}
		return ss.p.WriteRoot()
	}
	var routes []names.Route
	containers, err := ss.compose.Ps(ctx)
	if err != nil {
		return err
	}
	running := map[string]bool{}
	for _, container := range containers {
		running[container.Service] = container.State == "running"
	}
	for _, id := range ss.webApps() {
		info, _ := ss.webApp(id)
		if a, _ := ss.s.Catalog.App(id); (configured == nil || slices.Contains(configured, id)) && ss.ready(id) && running[info.Service] {
			if configurer, ok := a.(app.AccessConfigurer); ok {
				if err := configurer.ConfigureAccess(ctx, ss.helpers(a)); err != nil {
					return err
				}
			}
		}
		if host, ok := names.Host(id, ss.settings["LAN_IP"]); ok {
			routes = append(routes, names.Route{Host: host, Upstream: helpers.InternalAddress(info.Service, info.ContainerPort)})
		}
	}
	content := names.Caddyfile(routes)
	_, err = ss.p.WriteNamesCaddyfile(content)
	if err != nil {
		return err
	}
	if err := ss.p.WriteNamesFragment(names.Fragment()); err != nil {
		return err
	}
	if err := ss.p.WriteRoot(); err != nil {
		return err
	}
	if start {
		if err := ss.compose.Up(ctx, names.Service); err != nil {
			return err
		}
	}
	runtime, err := ss.p.LoadNamesRuntime()
	if err != nil {
		return err
	}
	generation := fmt.Sprintf("%x", sha256.Sum256([]byte(content)))
	if start || runtime.Applied != generation && ss.s.ownCaddyRuns(ctx, ss.p) {
		if runtime.Applied != generation && (!start || running[names.Service]) {
			if err := ss.compose.Restart(ctx, names.Service); err != nil {
				return err
			}
		}
		runtime.Applied = generation
		if start {
			runtime.StartAction = ""
		}
		return ss.p.SaveNamesRuntime(runtime)
	}
	return nil
}

// nameHosts is the name of each App with a page, by App ID; empty while Easy
// names are off.
func (ss *session) nameHosts(ids []string) map[string]string {
	hosts := map[string]string{}
	if !ss.namesOn() {
		return hosts
	}
	for _, id := range ids {
		if _, ok := ss.webApp(id); !ok {
			continue
		}
		if host, ok := names.Host(id, ss.settings["LAN_IP"]); ok {
			hosts[id] = host
		}
	}
	return hosts
}

// workingNames resolves each name with this computer's resolver, all at once,
// and returns the Addresses of the ones that lead to the LAN address, by App ID.
func (ss *session) workingNames(ctx context.Context, ids []string) (working map[string]string, failed bool) {
	hosts := ss.nameHosts(ids)
	if len(hosts) > 0 && ss.namesRuntimeProblem(ctx) != "" {
		return map[string]string{}, true
	}
	results := make(map[string]bool, len(hosts))
	var mu sync.Mutex
	var wg sync.WaitGroup
	for id, host := range hosts {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ok := names.Resolves(ctx, ss.s.Deps.Resolver, host, ss.settings["LAN_IP"])
			mu.Lock()
			results[id] = ok
			mu.Unlock()
		}()
	}
	wg.Wait()
	working = map[string]string{}
	for id, host := range hosts {
		if !results[id] {
			failed = true
			continue
		}
		info, _ := ss.webApp(id)
		working[id] = "http://" + host + info.Path
	}
	return working, failed
}

// NamesStatus says whether the Easy names work on this network, as seen from
// this computer.
type NamesStatus struct {
	On      bool `json:"on"`
	Working bool `json:"working"`
	// Problem is blocked, offline, rewritten or unreachable.
	Problem string `json:"problem,omitempty"`
	// Message is the one plain sentence that says why the names do not work.
	Message   string `json:"message,omitempty"`
	Technical string `json:"technical,omitempty"`
}

// namesStatus is nil while Easy names are off.
func (ss *session) namesStatus(ctx context.Context, failed bool) *NamesStatus {
	if !ss.namesOn() {
		return nil
	}
	status := &NamesStatus{On: true, Working: !failed}
	if problem := ss.namesRuntimeProblem(ctx); problem != "" {
		status.Working, status.Problem = false, problem
		if problem == "lan-changed" {
			status.Message = "This computer's network address changed. Review the LAN address in Settings, then update bookmarks; use the addresses with numbers."
		} else if problem == "lan-unavailable" {
			status.Message = "This computer's current network address cannot be checked. Easy names are not offered; use the addresses with numbers."
		} else if problem == "pending" {
			status.Message = "Easy names have changes waiting to be applied. Retry the approved Action; use the addresses with numbers until it finishes."
		} else {
			status.Message = "Easy names are stopped or port 80 is unavailable. Use the addresses with numbers, or explicitly start the Project."
		}
		return status
	}
	if failed {
		verdict := names.Diagnose(ctx, ss.s.Deps.Resolver, ss.settings["LAN_IP"])
		if verdict == names.Working {
			verdict = names.Unreachable
		}
		status.Problem, status.Message, status.Technical = string(verdict), verdict.Sentence(), verdict.Technical()
	}
	return status
}

func (ss *session) namesRuntimeProblem(ctx context.Context) string {
	runtime, err := ss.p.LoadNamesRuntime()
	if err != nil || runtime.StartAction != "" {
		return "pending"
	}
	current := ss.s.addresses()
	if len(current) == 0 {
		return "lan-unavailable"
	}
	if !slices.Contains(current, ss.settings["LAN_IP"]) {
		return "lan-changed"
	}
	running := false
	if ss.navigationContainers != nil {
		running = caddyRuns([]compose.Container{ss.navigationContainers[names.Service]})
	} else {
		running = ss.s.ownCaddyRuns(ctx, ss.p)
	}
	if !ss.p.HasNames() || !running {
		return "binding"
	}
	data, err := ss.p.ReadNamesCaddyfile()
	if err != nil {
		return "binding"
	}
	if runtime.Applied != fmt.Sprintf("%x", sha256.Sum256(data)) {
		return "pending"
	}
	for _, id := range ss.webApps() {
		host, ok := names.Host(id, ss.settings["LAN_IP"])
		if !ok || !strings.Contains(string(data), "http://"+host+" {") {
			return "binding"
		}
	}
	return ""
}

// addresses lists every way to open an App, friendliest first. name is its
// working Easy name, if any; ipURL is the address with numbers, always last.
// The other Access options add their own Addresses ahead of ipURL.
func addresses(name, ipURL string) []string {
	var out []string
	if name != "" {
		out = append(out, name)
	}
	if ipURL != "" {
		out = append(out, ipURL)
	}
	return out
}
