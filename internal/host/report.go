package host

import (
	"context"
	"strings"

	"github.com/ajnart/self-host/internal/system"
)

type DockerReport struct {
	Runtime         string `json:"runtime"`
	Installed       bool   `json:"installed"`
	DaemonReachable bool   `json:"daemon_reachable"`
	EndpointKind    string `json:"endpoint_kind,omitempty"`
	Version         string `json:"version,omitempty"`
	SocketDenied    bool   `json:"socket_denied,omitempty"`
	Hint            string `json:"hint,omitempty"`
}

type IPv6Report struct {
	Result     string `json:"result"`
	ErrorClass string `json:"error_class,omitempty"`
}

type PortReport struct {
	Port   int         `json:"port"`
	Probes []PortProbe `json:"probes"`
}

// HostReport is a bounded, read-only account of capabilities used by self-host.
type HostReport struct {
	OS           string       `json:"os"`
	Architecture string       `json:"architecture"`
	Docker       DockerReport `json:"docker"`
	IPv6         IPv6Report   `json:"ipv6"`
	Ports        []PortReport `json:"ports"`
	Extra        []Check      `json:"extra,omitempty"`
}

// Report probes this machine without loading a Project or any secret files.
func Report(ctx context.Context, deps *system.Deps) HostReport {
	report := HostReport{
		OS:           deps.GOOS,
		Architecture: deps.GOARCH,
		Docker:       dockerReport(ctx, deps),
	}
	ipv6Result, ipv6Class := classifyBind(deps.BindTCP("tcp6", "[::]:0"))
	report.IPv6 = IPv6Report{Result: string(ipv6Result), ErrorClass: ipv6Class}
	for _, port := range []int{80, 443} {
		report.Ports = append(report.Ports, PortReport{Port: port, Probes: ProbePort(deps, port)})
	}
	return report
}

func dockerReport(ctx context.Context, deps *system.Deps) DockerReport {
	report := DockerReport{Runtime: "docker"}
	if _, err := deps.LookPath("docker"); err != nil {
		return report
	}
	report.Installed = true
	probe := ProbeDocker(ctx, deps)
	if probe.SocketDenied() {
		report.SocketDenied = true
		report.Hint = SocketDeniedHint
		return report
	}
	if !probe.Reachable() {
		return report
	}
	report.DaemonReachable = true
	report.Version = strings.TrimSpace(string(probe.Result.Stdout))
	report.EndpointKind = "unknown"
	if endpoint, err := ActiveDockerEndpoint(ctx, deps); err == nil {
		report.EndpointKind = endpoint.Kind
	}
	return report
}
