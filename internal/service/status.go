package service

import (
	"context"
	"fmt"
	"os"
	"slices"
	"sort"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/compose"
	"github.com/ajnart/self-host/internal/project"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"go.yaml.in/yaml/v3"
)

type StepStatus struct {
	ID     string          `json:"id"`
	Status stepstatus.Step `json:"status"`
	Msg    string          `json:"msg,omitempty"`
	Error  string          `json:"error,omitempty"`
	Hint   string          `json:"hint,omitempty"`
}

type AppStatus struct {
	localURL string
	ID       string `json:"id"`
	Name     string `json:"name"`
	Managed  bool   `json:"managed"`
	// Description says in plain words what the App is for.
	Description string `json:"description,omitempty"`
	// Recipe is the Recipe the App was installed through; empty when it was
	// installed directly.
	Recipe string `json:"recipe,omitempty"`
	URL    string `json:"url,omitempty"`
	// Addresses lists every way to reach the App, friendliest first; url is
	// the first.
	Addresses []string `json:"addresses,omitempty"`
	Port      int      `json:"port,omitempty"`
	Image     string   `json:"image,omitempty"`
	// State is the container state (running, exited, …), "missing" when no
	// container exists and "unknown" when Docker could not be asked.
	State  string `json:"state"`
	Health string `json:"health,omitempty"`
	// Setup is ok, manual, incomplete, pending, or unmanaged.
	Setup    stepstatus.Setup `json:"setup"`
	Steps    []StepStatus     `json:"steps,omitempty"`
	Services []string         `json:"services,omitempty"`
	// Update is available, current or unknown; empty when not checked.
	Update string `json:"update,omitempty"`
}

type Status struct {
	AccessWarnings    []string `json:"access_warnings,omitempty"`
	CloudflareCleanup bool     `json:"cloudflare_cleanup,omitempty"`
	Project           string   `json:"project"`
	Exposure          string   `json:"exposure"`
	// Access lists the ways the Apps can be reached, by id: "home" or "local".
	Access []string     `json:"access"`
	Names  *NamesStatus `json:"names,omitempty"`
	LANIP  string       `json:"lan_ip"`
	// LANIPStale is true when LAN_IP is no longer an address of this
	// machine; HostIPs then lists the addresses it has now.
	LANIPStale bool              `json:"lan_ip_stale,omitempty"`
	HostIPs    []string          `json:"host_ips,omitempty"`
	Settings   map[string]string `json:"settings"`
	Apps       []AppStatus       `json:"apps"`
	// Home is the Home folder, where self-host keeps everything.
	Home string `json:"home"`
	// Dashboard is Homarr's Address when Homarr is installed.
	Dashboard string `json:"dashboard,omitempty"`
	// DockerError is set when container state could not be read.
	DockerError string `json:"docker_error,omitempty"`
	// Profile is the person's Profile; present once a Project exists.
	Profile *project.Profile `json:"profile,omitempty"`
}

// accessIDs names the Access an Exposure value stands for.
func accessIDs(exposure string) []string {
	if exposure == ExposureLocal {
		return []string{"local"}
	}
	return []string{"home"}
}

const dashboardAppID = "homarr"

// Status reads the Project and asks Docker for container state. It does
// not take the lock.
func (s *Service) Status(ctx context.Context) (Status, error) {
	ss, err := s.open(ctx)
	if err != nil {
		return Status{}, err
	}
	status := Status{Project: ss.p.Root, Exposure: ss.settings["EXPOSURE"], Access: accessIDs(ss.settings["EXPOSURE"]), LANIP: ss.settings["LAN_IP"], Settings: ss.settings, Home: ss.p.Root}
	rec, cleanup, err := loadCloudflareRecord(ss.p)
	if err != nil {
		return Status{}, err
	} else {
		status.CloudflareCleanup = cleanup || rec.Suspended
		if rec.Warning != "" {
			status.AccessWarnings = append(status.AccessWarnings, rec.Warning)
		}
	}
	if profile, err := ss.p.LoadProfile(); err == nil {
		status.Profile = &profile
	}
	if stale, current := s.lanStale(ss.settings); stale {
		status.LANIPStale, status.HostIPs = true, current
	}
	containers, psErr := ss.compose.Ps(ctx)
	ss.navigationError = psErr
	if psErr != nil {
		status.DockerError = s.Log.Redact(psErr.Error())
		containers = nil
	}
	byService := map[string]compose.Container{}
	for _, c := range containers {
		byService[c.Service] = c
	}
	if len(rec.Hosts) > 0 && !rec.Suspended && ss.state.Apps[cloudflareConnector] != nil && byService[cloudflareConnector].State == "running" {
		status.Access = append(status.Access, CloudflareAccess)
	}
	if ss.tailscaleOn() {
		status.Access = append(status.Access, tailscaleID)
	}
	ids, err := ss.p.AppIDs()
	if err != nil {
		return Status{}, err
	}
	ss.observeNavigation(ctx, ids, byService, rec)
	status.AccessWarnings = append(status.AccessWarnings, ss.navigationWarnings...)
	status.Names = ss.namesStatus(ctx, ss.nameFailure)
	if ss.namesOn() {
		status.Access = append(status.Access, "names")
	}
	for _, id := range ids {
		as := AppStatus{ID: id, Name: id, Setup: stepstatus.SetupUnmanaged, State: "missing"}
		services, _ := fragmentServices(ss.p.FragmentPath(id))
		as.Services = services
		mainService := id
		if a, found := s.Catalog.App(id); found && ss.state.Apps[id] != nil {
			info := a.Info()
			st := ss.state.Apps[id]
			as.Description, as.Recipe = info.Description, st.Recipe
			as.Name, as.Managed, as.Port, as.Image, as.Setup = info.Name, true, st.Port, info.Image, st.Setup
			if !info.NoWebUI && st.Port > 0 && info.ContainerPort > 0 {
				as.URL = AppURL(ss.settings, st.Port, info.Path)
			}
			mainService = info.Service
			for _, stepID := range st.StepOrder {
				r := st.Steps[stepID]
				if omitAbsentPeerWait(a, stepID, r, ids) {
					continue
				}
				as.Steps = append(as.Steps, StepStatus{ID: stepID, Status: r.Status, Msg: s.Log.Redact(r.Msg), Error: s.Log.Redact(r.Error), Hint: s.Log.Redact(r.Hint)})
			}
		}
		if psErr != nil {
			as.State = "unknown"
		} else {
			completed := fragmentCompletionDependencies(ss.p.FragmentPath(id))
			var deferred []string
			if a, found := s.Catalog.App(id); found {
				if deferrer, ok := a.(app.DeferredStarter); ok {
					deferred = deferrer.Deferred(ss.helpers(a))
				}
			}
			fillContainer(&as, byService, mainService, services, completed, deferred, ss.settings)
		}
		as.localURL = as.URL
		as.Addresses = ss.browserAddresses(id, as.URL)
		if len(as.Addresses) > 0 {
			as.URL = as.Addresses[0]
		}
		if id == dashboardAppID && len(as.Addresses) > 0 {
			status.Dashboard = as.Addresses[0]
		}
		status.Apps = append(status.Apps, as)
	}
	return status, nil
}

// fillContainer sets state and health from the main service, and the
// worst state among the App's other services.
func (as AppStatus) observationURL() string {
	if as.localURL != "" {
		return as.localURL
	}
	return as.URL
}

func fillContainer(as *AppStatus, byService map[string]compose.Container, main string, services []string, completed map[string]bool, deferred []string, settings map[string]string) {
	c, found := byService[main]
	if !found && !as.Managed && len(services) > 0 {
		c, found = byService[services[0]]
	}
	if !found {
		return
	}
	as.State, as.Health = c.State, c.Health
	if as.Image == "" {
		as.Image = c.Image
	}
	if !as.Managed {
		for _, pub := range c.Publishers {
			if pub.PublishedPort != 0 {
				as.Port = pub.PublishedPort
				as.URL = AppURL(settings, pub.PublishedPort, "")
				break
			}
		}
	}
	for _, name := range services {
		other, found := byService[name]
		if !found {
			if !slices.Contains(deferred, name) {
				as.State = "degraded"
			}
			continue
		}
		if name != main && completed[name] {
			if other.State != "exited" || other.ExitCode == nil || *other.ExitCode != 0 {
				as.State = "degraded"
			}
			continue
		}
		if other.State != "running" && as.State == "running" {
			as.State = "degraded"
		}
		if other.Health == "unhealthy" {
			as.Health = "unhealthy"
		}
	}
}

// A dependency may finish instead of remaining running only when every
// reference to that declared service requires successful completion.
// Short-form and conflicting dependency conditions retain the running rule.
func fragmentCompletionDependencies(path string) map[string]bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var doc struct {
		Services map[string]struct {
			DependsOn yaml.Node `yaml:"depends_on"`
		} `yaml:"services"`
	}
	if yaml.Unmarshal(data, &doc) != nil {
		return nil
	}
	completed := map[string]bool{}
	for _, service := range doc.Services {
		node := service.DependsOn
		if node.Kind == yaml.SequenceNode {
			for _, name := range node.Content {
				completed[name.Value] = false
			}
		}
		if node.Kind != yaml.MappingNode {
			continue
		}
		for i := 0; i+1 < len(node.Content); i += 2 {
			name := node.Content[i].Value
			var dependency struct{ Condition string }
			ok := node.Content[i+1].Decode(&dependency) == nil && dependency.Condition == "service_completed_successfully"
			if _, declared := doc.Services[name]; !declared {
				continue
			}
			previous, seen := completed[name]
			completed[name] = ok && (!seen || previous)
		}
	}
	return completed
}

type Credentials struct {
	Admin struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Email    string `json:"email,omitempty"`
		// Aliases maps an App ID to the App-local Admin login username it needs
		// when the shared username is reserved upstream.
		Aliases map[string]string `json:"aliases,omitempty"`
	} `json:"admin"`
	// Apps maps App ID to its secrets by name.
	Apps map[string]map[string]string `json:"apps"`
}

func (s *Service) Credentials(ctx context.Context) (Credentials, error) {
	ss, err := s.open(ctx)
	if err != nil {
		return Credentials{}, err
	}
	var creds Credentials
	creds.Admin.Username = ss.secrets.values["ADMIN_USER"]
	creds.Admin.Password = ss.secrets.values["ADMIN_PASSWORD"]
	creds.Admin.Email = ss.secrets.values["ADMIN_EMAIL"]
	creds.Admin.Aliases = map[string]string{}
	creds.Apps = map[string]map[string]string{}
	ids, _ := ss.p.AppIDs()
	sort.Slice(ids, func(i, j int) bool { return len(ids[i]) > len(ids[j]) })
	for key, value := range ss.secrets.values {
		if strings.HasPrefix(key, "ADMIN_") {
			continue
		}
		owner := "other"
		for _, id := range ids {
			prefix := SecretKey(id, "")
			if strings.HasPrefix(key, prefix) {
				owner = id
				break
			}
		}
		// The reserved-username alias is part of the Admin login, not an App secret.
		if strings.HasSuffix(key, "_ADMIN_USER") {
			if value != creds.Admin.Username {
				creds.Admin.Aliases[owner] = value
			}
			continue
		}
		if creds.Apps[owner] == nil {
			creds.Apps[owner] = map[string]string{}
		}
		creds.Apps[owner][key] = value
	}
	return creds, nil
}

func sortStrings(values []string) { sort.Strings(values) }

// ContainerStatus is one container of the Project: which App owns it, what
// image it runs, its state and health, its uptime text and its published ports.
type ContainerStatus struct {
	App     string   `json:"app,omitempty"`
	Service string   `json:"service"`
	Image   string   `json:"image,omitempty"`
	State   string   `json:"state"`
	Health  string   `json:"health,omitempty"`
	Status  string   `json:"status,omitempty"`
	Ports   []string `json:"ports,omitempty"`
}

// Containers lists every container in the Project's Compose project.
func (s *Service) Containers(ctx context.Context) ([]ContainerStatus, error) {
	ss, err := s.open(ctx)
	if err != nil {
		return nil, err
	}
	containers, err := ss.compose.Ps(ctx)
	if err != nil {
		return nil, err
	}
	byService := map[string]string{}
	ids, err := ss.p.AppIDs()
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		services, _ := fragmentServices(ss.p.FragmentPath(id))
		for _, service := range services {
			byService[service] = id
		}
	}
	out := make([]ContainerStatus, 0, len(containers))
	for _, c := range containers {
		cs := ContainerStatus{App: byService[c.Service], Service: c.Service, Image: c.Image,
			State: c.State, Health: c.Health, Status: c.Status}
		for _, pub := range c.Publishers {
			cs.Ports = append(cs.Ports, formatPublisher(pub))
		}
		out = append(out, cs)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].App != out[j].App {
			return out[i].App < out[j].App
		}
		return out[i].Service < out[j].Service
	})
	return out, nil
}

// formatPublisher renders one published port as "ip:published→target".
func formatPublisher(p compose.Publisher) string {
	ip := p.URL
	if ip == "" {
		ip = "0.0.0.0"
	}
	return fmt.Sprintf("%s:%d→%d", ip, p.PublishedPort, p.TargetPort)
}
