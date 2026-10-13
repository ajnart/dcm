package service

import (
	"context"

	"github.com/ajnart/self-host/internal/host"
)

type HostReport = host.HostReport

// HostReport inspects capabilities without loading or changing the Project.
func (s *Service) HostReport(ctx context.Context) HostReport {
	return host.Report(ctx, s.Deps)
}
