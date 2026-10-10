package service

import (
	"context"
	"fmt"
	"strconv"
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
	Network string      `json:"network"`
	Apps    []ExportApp `json:"apps"`
}

// AccessExport lists every managed App with a web page. It reads the Project
// and changes nothing, not even by asking Docker.
func (s *Service) AccessExport(ctx context.Context) (AccessExport, error) {
	ss, err := s.open(ctx)
	if err != nil {
		return AccessExport{}, err
	}
	ids, err := ss.p.AppIDs()
	if err != nil {
		return AccessExport{}, err
	}
	export := AccessExport{Network: ss.p.ComposeName + "_default", Apps: []ExportApp{}}
	host := ss.settings["LAN_IP"]
	if ss.settings["EXPOSURE"] == ExposureLocal || host == "" {
		host = "127.0.0.1"
	}
	for _, id := range ids {
		a, found := s.Catalog.App(id)
		st := ss.state.Apps[id]
		if !found || st == nil {
			continue
		}
		info := a.Info()
		if info.NoWebUI || st.Port <= 0 || info.ContainerPort <= 0 {
			continue
		}
		item := ExportApp{
			ID: id, Name: info.Name, Hostname: id + ExportHostnameSuffix,
			Service: info.Service, ContainerPort: info.ContainerPort,
			Upstream: info.Service + ":" + strconv.Itoa(info.ContainerPort),
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
