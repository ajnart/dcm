package service

import (
	"context"

	"github.com/ajnart/self-host/internal/host"
)

type HostReport = host.HostReport

// HostReport inspects capabilities without loading or changing the Project.
func (s *Service) HostReport(ctx context.Context, extra bool) HostReport {
	report := host.Report(ctx, s.Deps)
	if !extra {
		return report
	}
	var path string
	var apps int
	if p, err := s.Project(); err == nil {
		path = p.Root
		if p.Exists() {
			if state, loadErr := p.LoadState(); loadErr == nil {
				apps = len(state.Apps)
			}
		} else if owner, ownerErr := s.Owner(); ownerErr == nil {
			path = owner.Home
		}
	}
	report.Extra = host.Extra(ctx, s.Deps, path, apps)
	return report
}
