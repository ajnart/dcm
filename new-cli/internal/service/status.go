package service

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/ajnart/self-host/internal/compose"
)

type StepStatus struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Msg    string `json:"msg,omitempty"`
	Error  string `json:"error,omitempty"`
	Hint   string `json:"hint,omitempty"`
}

type AppStatus struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Managed bool   `json:"managed"`
	URL     string `json:"url,omitempty"`
	Port    int    `json:"port,omitempty"`
	Image   string `json:"image,omitempty"`
	// State is the container state (running, exited, …), "missing" when no
	// container exists and "unknown" when Docker could not be asked.
	State  string `json:"state"`
	Health string `json:"health,omitempty"`
	// Setup is ok, incomplete, pending, or unmanaged.
	Setup    string       `json:"setup"`
	Steps    []StepStatus `json:"steps,omitempty"`
	Services []string     `json:"services,omitempty"`
	// Update is available, current or unknown; empty when not checked.
	Update string `json:"update,omitempty"`
}

type Status struct {
	Project  string `json:"project"`
	Exposure string `json:"exposure"`
	LANIP    string `json:"lan_ip"`
	// LANIPStale is true when LAN_IP is no longer an address of this
	// machine; HostIPs then lists the addresses it has now.
	LANIPStale bool              `json:"lan_ip_stale,omitempty"`
	HostIPs    []string          `json:"host_ips,omitempty"`
	Settings   map[string]string `json:"settings"`
	Apps       []AppStatus       `json:"apps"`
	// DockerError is set when container state could not be read.
	DockerError string `json:"docker_error,omitempty"`
}

// Status reads the Project and asks Docker for container state. It does
// not take the lock.
func (s *Service) Status(ctx context.Context) (Status, error) {
	ss, err := s.open(ctx)
	if err != nil {
		return Status{}, err
	}
	status := Status{Project: ss.p.Root, Exposure: ss.settings["EXPOSURE"], LANIP: ss.settings["LAN_IP"], Settings: ss.settings}
	if stale, current := s.lanStale(ss.settings); stale {
		status.LANIPStale, status.HostIPs = true, current
	}
	containers, psErr := ss.compose.Ps(ctx)
	if psErr != nil {
		status.DockerError = s.Log.Redact(psErr.Error())
	}
	byService := map[string]compose.Container{}
	for _, c := range containers {
		byService[c.Service] = c
	}
	ids, err := ss.p.AppIDs()
	if err != nil {
		return Status{}, err
	}
	for _, id := range ids {
		as := AppStatus{ID: id, Name: id, Setup: "unmanaged", State: "missing"}
		services, _ := fragmentServices(ss.p.FragmentPath(id))
		as.Services = services
		mainService := id
		if a, found := s.Catalog.App(id); found && ss.state.Apps[id] != nil {
			info := a.Info()
			st := ss.state.Apps[id]
			as.Name, as.Managed, as.Port, as.Image, as.Setup = info.Name, true, st.Port, info.Image, st.Setup
			if !info.NoWebUI && st.Port > 0 && info.ContainerPort > 0 {
				as.URL = AppURL(ss.settings, st.Port, info.Path)
			}
			mainService = info.Service
			for _, stepID := range st.StepOrder {
				r := st.Steps[stepID]
				as.Steps = append(as.Steps, StepStatus{ID: stepID, Status: r.Status, Msg: s.Log.Redact(r.Msg), Error: s.Log.Redact(r.Error), Hint: s.Log.Redact(r.Hint)})
			}
		}
		if psErr != nil {
			as.State = "unknown"
		} else {
			fillContainer(&as, byService, mainService, services, ss.settings)
		}
		status.Apps = append(status.Apps, as)
	}
	return status, nil
}

// fillContainer sets state and health from the main service, and the
// worst state among the App's other services.
func fillContainer(as *AppStatus, byService map[string]compose.Container, main string, services []string, settings map[string]string) {
	c, found := byService[main]
	if !found && len(services) > 0 {
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
			as.State = "degraded"
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

type Credentials struct {
	Admin struct {
		Username string `json:"username"`
		Password string `json:"password"`
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
