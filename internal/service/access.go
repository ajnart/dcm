package service

import (
	"context"
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/helpers"
	"go.yaml.in/yaml/v3"

	"github.com/ajnart/self-host/internal/project"
)

// ExportHostnameSuffix ends the hostname placeholder suggested for each App.
const ExportHostnameSuffix = ".example.com"

// ExportApp is one App a reverse proxy can front.
type ExportApp struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Hostname string `json:"hostname"`
	// Service and ContainerPort are the upstream for a proxy on the Project's
	// Docker network; Upstream is them joined.
	Service       string `json:"service"`
	ContainerPort int    `json:"container_port"`
	Upstream      string `json:"upstream"`
	// Host, HostPort and HostUpstream are the upstream for a proxy outside Docker.
	Host         string `json:"host"`
	HostPort     int    `json:"host_port"`
	HostUpstream string `json:"host_upstream"`
	// WebSockets and LongTimeouts are set only when the App is known to need them.
	WebSockets   *bool `json:"websockets,omitempty"`
	LongTimeouts *bool `json:"long_timeouts,omitempty"`
}

// AccessExport is what a reverse proxy needs to front the Project's Apps.
type AccessExport struct {
	// Network is the Docker network a proxy joins to use each App's Upstream.
	Network  string          `json:"network"`
	Apps     []ExportApp     `json:"apps"`
	Warnings []ExportWarning `json:"warnings,omitempty"`
}

type ExportWarning struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

// AccessExport lists Apps with an identifiable HTTP upstream. It reads the Project
// and changes nothing, not even by asking Docker.
func (s *Service) AccessExport(ctx context.Context) (AccessExport, error) {
	p, err := s.Project()
	if err != nil {
		return AccessExport{}, err
	}
	if !p.Exists() {
		return AccessExport{}, ErrNoProject
	}
	settings, err := p.LoadSettings()
	if err != nil {
		return AccessExport{}, err
	}
	state, err := p.LoadState()
	if err != nil {
		return AccessExport{}, err
	}
	ids, err := p.AppIDs()
	if err != nil {
		return AccessExport{}, err
	}
	export := AccessExport{Network: p.ComposeName + "_default", Apps: []ExportApp{}}
	host := settings["LAN_IP"]
	if settings["EXPOSURE"] == ExposureLocal || host == "" {
		host = "127.0.0.1"
	}
	for _, id := range ids {
		a, found := s.Catalog.App(id)
		st := state.Apps[id]
		if !found || st == nil || p.IsExtra(id) {
			item, err := unmanagedExport(p, id, host)
			if err == nil {
				err = p.ValidateFragment(id, "services:\n  "+item.Service+": {}\n")
			}
			if err == nil {
				export.Apps = append(export.Apps, item)
			} else {
				warningID := id
				if !exportAppID.MatchString(warningID) {
					warningID = "unmanaged"
				}
				export.Warnings = append(export.Warnings, ExportWarning{ID: warningID, Reason: "No unambiguous supported HTTP upstream; configure the proxy manually."})
			}
			continue
		}
		info := a.Info()
		if info.NoWebUI || st.Port <= 0 || info.ContainerPort <= 0 {
			continue
		}
		item := ExportApp{
			ID: id, Name: info.Name, Hostname: id + ExportHostnameSuffix,
			Service: info.Service, ContainerPort: info.ContainerPortFor(st.Port),
			Upstream: helpers.InternalAddress(info.Service, info.ContainerPortFor(st.Port)),
			Host:     host, HostPort: st.Port, HostUpstream: fmt.Sprintf("%s:%d", host, st.Port),
		}
		if info.WebSockets {
			item.WebSockets = &info.WebSockets
		}
		if info.LongTimeouts {
			item.LongTimeouts = &info.LongTimeouts
		}
		export.Apps = append(export.Apps, item)
	}
	return export, nil
}

var exportAppID = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)
var exportServiceName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`)

func unmanagedExport(p *project.Project, id, host string) (ExportApp, error) {
	unsupported := fmt.Errorf("no unambiguous supported HTTP upstream")
	if !exportAppID.MatchString(id) {
		return ExportApp{}, unsupported
	}
	data, err := p.ReadFragment(id)
	if err != nil {
		return ExportApp{}, unsupported
	}
	var doc struct {
		Services map[string]struct {
			Ports       []yaml.Node `yaml:"ports"`
			Extends     yaml.Node   `yaml:"extends"`
			NetworkMode string      `yaml:"network_mode"`
			Networks    yaml.Node   `yaml:"networks"`
			Profiles    yaml.Node   `yaml:"profiles"`
		} `yaml:"services"`
		Include  yaml.Node `yaml:"include"`
		Networks yaml.Node `yaml:"networks"`
	}
	if yaml.Unmarshal(data, &doc) != nil || doc.Include.Kind != 0 || doc.Networks.Kind != 0 {
		return ExportApp{}, unsupported
	}
	var candidates []ExportApp
	for name, svc := range doc.Services {
		if svc.Extends.Kind != 0 || svc.NetworkMode != "" || svc.Networks.Kind != 0 || svc.Profiles.Kind != 0 || !exportServiceName.MatchString(name) {
			return ExportApp{}, unsupported
		}
		for _, port := range svc.Ports {
			published, target, bind := "", "", ""
			protocol, appProtocol := "tcp", ""
			switch port.Kind {
			case yaml.ScalarNode:
				value := strings.TrimSuffix(port.Value, "/tcp")
				parts := strings.Split(value, ":")
				if len(parts) == 2 {
					published, target = parts[0], parts[1]
				} else if len(parts) == 3 {
					bind, published, target = parts[0], parts[1], parts[2]
				} else {
					return ExportApp{}, unsupported
				}
			case yaml.MappingNode:
				var mapping struct {
					Published   string `yaml:"published"`
					Target      string `yaml:"target"`
					HostIP      string `yaml:"host_ip"`
					Protocol    string `yaml:"protocol"`
					AppProtocol string `yaml:"app_protocol"`
					Mode        string `yaml:"mode"`
				}
				if port.Decode(&mapping) != nil || (mapping.Mode != "" && mapping.Mode != "ingress") {
					return ExportApp{}, unsupported
				}
				published, target, bind = mapping.Published, mapping.Target, mapping.HostIP
				appProtocol = mapping.AppProtocol
				if mapping.Protocol != "" {
					protocol = mapping.Protocol
				}
			default:
				return ExportApp{}, unsupported
			}
			hostPort, err := strconv.Atoi(published)
			containerPort, targetErr := strconv.Atoi(target)
			if err != nil || targetErr != nil || hostPort <= 0 || hostPort > 65535 || containerPort <= 0 || containerPort > 65535 || protocol != "tcp" {
				return ExportApp{}, unsupported
			}
			if appProtocol != "http" && (containerPort != 80 || appProtocol != "") {
				continue
			}
			address := host
			if bind != "" {
				ip := net.ParseIP(bind)
				if ip == nil {
					return ExportApp{}, unsupported
				}
				if !ip.IsUnspecified() {
					address = ip.String()
				}
			}
			candidates = append(candidates, ExportApp{
				ID: id, Name: id, Hostname: id + ExportHostnameSuffix,
				Service: name, ContainerPort: containerPort, Upstream: helpers.InternalAddress(name, containerPort),
				Host: address, HostPort: hostPort, HostUpstream: net.JoinHostPort(address, strconv.Itoa(hostPort)),
			})
		}
	}
	if len(candidates) != 1 {
		return ExportApp{}, unsupported
	}
	return candidates[0], nil
}
