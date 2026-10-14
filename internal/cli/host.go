package cli

import (
	"fmt"
	"io"
	"strings"

	"github.com/spf13/cobra"

	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/service"
)

func (a *program) hostCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "host", Short: "Inspect what this machine can do for self-host"}
	var extra bool
	reportCmd := &cobra.Command{
		Use:   "report",
		Short: "Print a read-only report of Docker, IPv6 and ports 80 and 443",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a.document = true
			report := a.service().HostReport(cmd.Context(), extra)
			if a.json {
				return writeJSON(a.deps.Out, report)
			}
			printHostReport(a.deps.Out, report)
			return nil
		},
	}
	reportCmd.Flags().BoolVar(&extra, "extra", false, "run optional resource, connectivity and Docker write checks")
	cmd.AddCommand(reportCmd)
	return cmd
}

func printHostReport(w io.Writer, report service.HostReport) {
	fmt.Fprintln(w, "Host report")
	fmt.Fprintf(w, "System  %s/%s\n", report.OS, report.Architecture)
	docker := "not installed"
	if report.Docker.Installed {
		docker = "installed; daemon unavailable"
	}
	if report.Docker.DaemonReachable {
		docker = "engine " + report.Docker.Version + "; daemon reachable"
	}
	if report.Docker.EndpointKind == "unix" {
		docker = "engine " + report.Docker.Version + "; socket reachable"
	} else if report.Docker.DaemonReachable && report.Docker.EndpointKind != "" {
		docker += " (" + report.Docker.EndpointKind + ")"
	}
	fmt.Fprintf(w, "Docker  %s\n", docker)
	ipv6 := formatProbeResult(host.PortResult(report.IPv6.Result), report.IPv6.ErrorClass)
	fmt.Fprintf(w, "IPv6    %s\n", ipv6)
	for _, port := range report.Ports {
		fmt.Fprintf(w, "\nPort %d\n", port.Port)
		for _, probe := range port.Probes {
			address := probe.Address
			if strings.Contains(address, ":") {
				address = "[" + address + "]"
			}
			fmt.Fprintf(w, "  %-21s %s\n", fmt.Sprintf("%s:%d", address, port.Port), formatProbeResult(probe.Result, probe.ErrorClass))
		}
	}
	if len(report.Extra) > 0 {
		fmt.Fprintln(w, "\nExtra checks")
		for _, check := range report.Extra {
			fmt.Fprintf(w, "  %-9s %-24s %s\n", check.Level, check.Title, check.Detail)
		}
	}
}

func formatProbeResult(result host.PortResult, class string) string {
	text := strings.ReplaceAll(string(result), "_", " ")
	if class != "" {
		text += " (" + class + ")"
	}
	return text
}
