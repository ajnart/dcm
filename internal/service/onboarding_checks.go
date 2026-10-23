package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/host"
)

// OnboardingChecks prepares the approved non-secret App inputs for Host-owned
// disk and port inspection. Doctor is deliberately unchanged.
func (s *Service) OnboardingChecks(_ context.Context, opts InstallOptions) []host.Check {
	p, err := s.Project()
	if err != nil {
		return []host.Check{{ID: "disk", Title: "Disk space", Level: host.Fail,
			Detail: err.Error(), Hint: "Fix the Home folder, then press r to recheck."}}
	}
	apps, err := s.Resolve(opts.Targets)
	if err != nil {
		return []host.Check{{ID: "plan", Title: "Selected Apps", Level: host.Fail, Detail: err.Error()}}
	}
	inputs, err := resolveInputs(apps, opts.Sets, nil)
	if err != nil {
		return []host.Check{{ID: "plan", Title: "Selected ports", Level: host.Fail, Detail: err.Error()}}
	}
	var ports []host.PortRequirement
	for _, a := range apps {
		info, values := a.Info(), inputs[a.Info().ID]
		if info.Port > 0 {
			port, parseErr := plannedPort(values["port"], info.Port)
			if parseErr != nil {
				return []host.Check{{ID: "port", App: info.ID, Title: info.Name + " port", Level: host.Fail, Detail: parseErr.Error()}}
			}
			ports = append(ports, host.PortRequirement{App: info.ID, Title: info.Name + " port", Port: port,
				Input: "port", Protocols: []string{"tcp"}, Automatic: !inputWasSet(opts.Sets, info.ID, "port")})
		}
		for _, input := range a.Inputs() {
			if len(input.HostPortProtocols) == 0 {
				continue
			}
			port, parseErr := plannedPort(values[input.Key], 0)
			if parseErr != nil {
				return []host.Check{{ID: "port", App: info.ID, Title: info.Name + " " + input.Prompt, Level: host.Fail, Detail: parseErr.Error()}}
			}
			ports = append(ports, host.PortRequirement{App: info.ID, Title: info.Name + " " + input.Prompt, Port: port,
				Input: input.Key, Protocols: input.HostPortProtocols, Automatic: !inputWasSet(opts.Sets, info.ID, input.Key)})
		}
	}
	return host.Onboarding(s.Deps, p.Root, len(apps), ports)
}

func plannedPort(value string, fallback int) (int, error) {
	if strings.TrimSpace(value) == "" {
		return fallback, nil
	}
	port, err := strconv.Atoi(value)
	if err != nil || port < 1 || port > 65535 {
		return 0, fmt.Errorf("%q is not a port", value)
	}
	return port, nil
}
