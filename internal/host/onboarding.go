package host

import (
	"fmt"
	"slices"
	"strings"

	"github.com/ajnart/self-host/internal/system"
)

// PortRequirement is one non-secret host port in an approved Onboarding plan.
type PortRequirement struct {
	App, Title string
	Port       int
	Protocols  []string
	Automatic  bool
}

// Onboarding checks the machine against an unapproved plan without changing it.
func Onboarding(deps *system.Deps, projectPath string, appCount int, ports []PortRequirement) []Check {
	checks := []Check{onboardingDisk(deps, projectPath, appCount)}
	reserved := map[string]bool{}
	for _, requirement := range ports {
		checks = append(checks, onboardingPort(deps, requirement, reserved))
	}
	return checks
}

func onboardingDisk(deps *system.Deps, path string, apps int) Check {
	check := Check{ID: "disk", Title: "Disk space", Level: OK}
	if deps.DiskUsage == nil {
		check.Level, check.Detail, check.Hint = Fail, "free space could not be read", "Fix access to the Home folder, then press r to recheck."
		return check
	}
	usage, err := deps.DiskUsage(path)
	if err != nil {
		check.Level, check.Detail, check.Hint = Fail, "free space could not be read: "+err.Error(), "Fix access to the Home folder, then press r to recheck."
		return check
	}
	required := Requirements.BaseDiskBytes + uint64(max(apps, 0))*Requirements.DiskBytesPerApp
	check.Detail = fmt.Sprintf("%d GiB free in the Home folder; %d GiB recommended", usage.AvailableBytes>>30, required>>30)
	if usage.AvailableBytes < required {
		check.Level = Warn
		check.Hint = "Free some space before installing large Apps or storing media."
	}
	return check
}

func onboardingPort(deps *system.Deps, requirement PortRequirement, reserved map[string]bool) Check {
	protocols := slices.Clone(requirement.Protocols)
	if len(protocols) == 0 {
		protocols = []string{"tcp"}
	}
	label := protocolLabel(protocols)
	check := Check{ID: "port", App: requirement.App, Title: requirement.Title, Level: OK,
		Detail: fmt.Sprintf("port %d %s is free", requirement.Port, label)}
	if portUsable(deps, requirement.Port, protocols, reserved) {
		reservePort(requirement.Port, protocols, reserved)
		return check
	}
	if !requirement.Automatic {
		check.Level = Fail
		check.Detail = fmt.Sprintf("selected port %d %s is already in use", requirement.Port, label)
		check.Hint = "Choose another port in What, then press r to recheck."
		return check
	}
	for port := requirement.Port + 1; port <= 65535; port++ {
		if portUsable(deps, port, protocols, reserved) {
			check.Level = Warn
			check.Detail = fmt.Sprintf("port %d %s is in use; install will use %d instead", requirement.Port, label, port)
			reservePort(port, protocols, reserved)
			return check
		}
	}
	check.Level = Fail
	check.Detail = fmt.Sprintf("no free %s port from %d", label, requirement.Port)
	check.Hint = "Free a port, then press r to recheck."
	return check
}

func portUsable(deps *system.Deps, port int, protocols []string, reserved map[string]bool) bool {
	for _, protocol := range protocols {
		if reserved[protocol+fmt.Sprint(port)] {
			return false
		}
		var probes []PortProbe
		switch protocol {
		case "tcp":
			if deps.BindTCP == nil {
				return false
			}
			probes = ProbePort(deps, port)
		case "udp":
			if deps.BindUDP == nil {
				return false
			}
			probes = ProbeUDPPort(deps, port)
		default:
			return false
		}
		if !PortAvailable(probes) {
			return false
		}
	}
	return true
}

func reservePort(port int, protocols []string, reserved map[string]bool) {
	for _, protocol := range protocols {
		reserved[protocol+fmt.Sprint(port)] = true
	}
}

func protocolLabel(protocols []string) string {
	labels := make([]string, 0, len(protocols))
	for _, protocol := range protocols {
		labels = append(labels, strings.ToUpper(protocol))
	}
	return strings.Join(labels, " and ")
}
