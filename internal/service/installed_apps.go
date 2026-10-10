package service

import (
	"context"
	"fmt"

	"github.com/ajnart/self-host/internal/compose"
	"github.com/ajnart/self-host/internal/helpers"
)

// installedApps exposes navigation metadata without credentials or Setup state.
func (ss *session) installedApps(ctx context.Context) ([]helpers.InstalledApp, error) {
	ids, err := ss.p.AppIDs()
	if err != nil {
		return nil, err
	}
	var out []helpers.InstalledApp
	var unmanaged []int
	for _, id := range ids {
		item := helpers.InstalledApp{ID: id, Name: id}
		if a, found := ss.s.Catalog.App(id); found && ss.state.Apps[id] != nil {
			info := a.Info()
			item.Name, item.Service, item.ContainerPort = info.Name, info.Service, info.ContainerPort
			if !info.NoWebUI && ss.state.Apps[id].Port > 0 && info.ContainerPort > 0 {
				item.URL = ss.friendlyAddress(ctx, id, AppURL(ss.settings, ss.state.Apps[id].Port, info.Path))
			}
		} else {
			unmanaged = append(unmanaged, len(out))
		}
		out = append(out, item)
	}
	if len(unmanaged) == 0 {
		return out, nil
	}
	containers, err := ss.compose.Ps(ctx)
	if err != nil {
		return nil, fmt.Errorf("read unmanaged App endpoints; check Docker then retry Setup: %w", err)
	}
	byService := map[string]compose.Container{}
	for _, c := range containers {
		byService[c.Service] = c
	}
	for _, index := range unmanaged {
		item := &out[index]
		services, err := fragmentServices(ss.p.FragmentPath(item.ID))
		if err != nil {
			return nil, err
		}
		for _, service := range services {
			for _, port := range byService[service].Publishers {
				if port.PublishedPort <= 0 || port.Protocol != "" && port.Protocol != "tcp" {
					continue
				}
				item.Service, item.ContainerPort = service, port.TargetPort
				item.URL = AppURL(ss.settings, port.PublishedPort, "")
				break
			}
			if item.URL != "" {
				break
			}
		}
	}
	return out, nil
}
