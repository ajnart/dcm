package service

import (
	"context"

	"github.com/ajnart/self-host/internal/host"
)

type HostReport = host.HostReport

// HostReport inspects capabilities without loading or changing the Project.
func (s *Service) HostReport(ctx context.Context, extra ...bool) HostReport {
	report := host.Report(ctx, s.Deps)
	if len(extra) == 0 || !extra[0] {
		return report
	}
	options := host.ExtraOptions{}
	if p, err := s.Project(); err == nil {
		options.ProjectPath = p.Root
		if p.Exists() {
			if state, loadErr := p.LoadState(); loadErr == nil {
				options.AppCount = len(state.Apps)
			}
		} else if owner, ownerErr := s.Owner(); ownerErr == nil {
			options.ProjectPath = owner.Home
		}
	}
	report.Extra = host.Extra(ctx, s.Deps, options)
	return report
}
