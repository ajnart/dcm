package service

import (
	"context"
	"fmt"

	"github.com/ajnart/self-host/internal/host"
)

const lowDiskBytes = 5 << 30

// OnboardingChecks checks only the Home folder and selected Apps. Doctor is
// deliberately unchanged because these findings depend on an unapproved plan.
func (s *Service) OnboardingChecks(_ context.Context, appIDs []string) []host.Check {
	p, err := s.Project()
	if err != nil {
		return []host.Check{{ID: "disk", Title: "Disk space", Level: host.Fail,
			Detail: err.Error(), Hint: "Fix the Home folder, then recheck."}}
	}
	free, err := s.Deps.DiskFree(p.Root)
	disk := host.Check{ID: "disk", Title: "Disk space", Level: host.OK,
		Detail: fmt.Sprintf("%d GiB free in the Home folder", free>>30)}
	if err != nil {
		disk.Level, disk.Detail, disk.Hint = host.Fail, "free space could not be read: "+err.Error(), "Fix access to the Home folder, then recheck."
	} else if free < lowDiskBytes {
		disk.Level, disk.Hint = host.Warn, "Free some space before installing large Apps or storing media."
	}
	checks := []host.Check{disk}
	for _, id := range appIDs {
		a, found := s.Catalog.App(id)
		if !found || a.Info().Port == 0 {
			continue
		}
		info := a.Info()
		check := host.Check{ID: "port", App: id, Title: info.Name + " port", Level: host.OK,
			Detail: fmt.Sprintf("port %d is free", info.Port)}
		if !s.Deps.PortFree(info.Port) {
			check.Level = host.Fail
			check.Detail = fmt.Sprintf("port %d is already in use", info.Port)
			check.Hint = fmt.Sprintf("Stop the program using port %d, then recheck.", info.Port)
		}
		checks = append(checks, check)
	}
	return checks
}
