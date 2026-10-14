package host

import (
	"context"
	"strings"

	"github.com/ajnart/self-host/internal/system"
)

const HostReportSchemaVersion = 1

type DockerReport struct {
	Runtime         string `json:"runtime"`
	Installed       bool   `json:"installed"`
	DaemonReachable bool   `json:"daemon_reachable"`
	SocketReachable bool   `json:"socket_reachable"`
	EndpointKind    string `json:"endpoint_kind,omitempty"`
	Version         string `json:"version,omitempty"`
}

type IPv6Report struct {
	Available  bool   `json:"available"`
	Result     string `json:"result"`
	ErrorClass string `json:"error_class,omitempty"`
}

type PortReport struct {
	Port   int         `json:"port"`
	Probes []PortProbe `json:"probes"`
}

// HostReport is a bounded, read-only account of capabilities used by
// self-host. SchemaVersion changes only for incompatible revisions; fields may
// be added without changing it.
type HostReport struct {
	SchemaVersion int          `json:"schema_version"`
	OS            string       `json:"os"`
	Architecture  string       `json:"architecture"`
	Docker        DockerReport `json:"docker"`
	IPv6          IPv6Report   `json:"ipv6"`
	Ports         []PortReport `json:"ports"`
}

// Report probes this machine without loading a Project or any secret files.
func Report(ctx context.Context, deps *system.Deps) HostReport {
	report := HostReport{
		SchemaVersion: HostReportSchemaVersion,
		OS:            deps.GOOS,
		Architecture:  deps.GOARCH,
		Docker:        dockerReport(ctx, deps),
	}
	ipv6Result, ipv6Class := classifyBind(deps.BindTCP("tcp6", "[::]:0"))
	report.IPv6 = IPv6Report{Available: ipv6Result == PortOK, Result: string(ipv6Result), ErrorClass: ipv6Class}
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
	result, err := deps.Runner.Run(ctx, system.Cmd{Name: "docker", Args: []string{"version", "--format", "{{.Server.Version}}"}})
	if err != nil || result.ExitCode != 0 {
		return report
	}
	report.DaemonReachable = true
	report.Version = strings.TrimSpace(string(result.Stdout))
	report.EndpointKind = "unknown"
	if endpoint, err := ActiveDockerEndpoint(ctx, deps); err == nil {
		report.EndpointKind = endpoint.Kind
		report.SocketReachable = endpoint.Kind == "unix"
	}
	return report
}
