package cli

import (
	"fmt"
	"io"
	"strings"

	"github.com/spf13/cobra"

	"github.com/ajnart/self-host/internal/service"
)

var exportFormats = map[string]func(io.Writer, service.AccessExport) error{
	"caddy":   writeCaddy,
	"nginx":   writeNginx,
	"traefik": writeTraefik,
	"json":    func(w io.Writer, e service.AccessExport) error { return writeJSON(w, e) },
}

func (a *program) accessCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "access",
		Short: "Open the Apps through your own reverse proxy",
	}
	var format string
	export := &cobra.Command{
		Use:   "export",
		Short: "Print each App's upstream and a suggested hostname as a Caddy, nginx or Traefik snippet, or JSON; changes nothing",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a.document = true
			write, ok := exportFormats[format]
			if !ok {
				return a.fail(fmt.Errorf("--format %q: use caddy, nginx, traefik or json", format))
			}
			export, err := a.service().AccessExport(cmd.Context())
			if err != nil {
				return a.fail(err)
			}
			return write(a.deps.Out, export)
		},
	}
	export.Flags().StringVar(&format, "format", "json", "caddy, nginx, traefik or json")
	cmd.AddCommand(export)
	return cmd
}

func exportHeader(tool string, e service.AccessExport) string {
	return fmt.Sprintf("# self-host access export --format %s\n"+
		"# Replace each example.com hostname with your own.\n"+
		"# Upstreams are Compose services: the proxy must join the Docker network %s.\n"+
		"# A proxy outside Docker uses the host address in each comment instead.\n",
		tool, e.Network)
}

// exportNotes are the lines of comment about what the App needs from a proxy.
func exportNotes(app service.ExportApp, websockets, timeouts string) []string {
	var notes []string
	if app.WebSockets != nil && *app.WebSockets {
		notes = append(notes, "WebSockets: "+websockets)
	}
	if app.LongTimeouts != nil && *app.LongTimeouts {
		notes = append(notes, "Long timeouts: "+timeouts)
	}
	return notes
}

func writeCaddy(w io.Writer, e service.AccessExport) error {
	var b strings.Builder
	b.WriteString(exportHeader("caddy", e))
	for _, app := range e.Apps {
		fmt.Fprintf(&b, "\n# %s\n# host: %s\n", app.Name, app.HostUpstream)
		for _, note := range exportNotes(app, "Caddy passes them through.", "Caddy sets no response timeout.") {
			b.WriteString("# " + note + "\n")
		}
		fmt.Fprintf(&b, "%s {\n\treverse_proxy %s\n}\n", app.Hostname, app.Upstream)
	}
	_, err := io.WriteString(w, b.String())
	return err
}

func writeNginx(w io.Writer, e service.AccessExport) error {
	var b strings.Builder
	b.WriteString(exportHeader("nginx", e))
	b.WriteString("# Add your own listen 443 ssl block and certificates.\n")
	for _, app := range e.Apps {
		websockets := app.WebSockets != nil && *app.WebSockets
		timeouts := app.LongTimeouts != nil && *app.LongTimeouts
		fmt.Fprintf(&b, "\n# %s\n# host: %s\n", app.Name, app.HostUpstream)
		fmt.Fprintf(&b, "server {\n\tlisten 80;\n\tserver_name %s;\n\n\tlocation / {\n\t\tproxy_pass http://%s;\n", app.Hostname, app.Upstream)
		b.WriteString("\t\tproxy_set_header Host $host;\n" +
			"\t\tproxy_set_header X-Real-IP $remote_addr;\n" +
			"\t\tproxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n" +
			"\t\tproxy_set_header X-Forwarded-Proto $scheme;\n")
		if websockets {
			b.WriteString("\t\tproxy_http_version 1.1;\n" +
				"\t\tproxy_set_header Upgrade $http_upgrade;\n" +
				"\t\tproxy_set_header Connection \"upgrade\";\n")
		}
		if timeouts {
			b.WriteString("\t\tclient_max_body_size 0;\n" +
				"\t\tproxy_read_timeout 3600s;\n" +
				"\t\tproxy_send_timeout 3600s;\n")
		}
		b.WriteString("\t}\n}\n")
	}
	_, err := io.WriteString(w, b.String())
	return err
}

func writeTraefik(w io.Writer, e service.AccessExport) error {
	var b strings.Builder
	b.WriteString(exportHeader("traefik", e))
	b.WriteString("# Save as a file in the directory of Traefik's file provider.\n")
	if len(e.Apps) == 0 {
		b.WriteString("http: {}\n")
		_, err := io.WriteString(w, b.String())
		return err
	}
	b.WriteString("http:\n  routers:\n")
	for _, app := range e.Apps {
		fmt.Fprintf(&b, "    selfhost-%[1]s:\n      rule: Host(`%[2]s`)\n      service: selfhost-%[1]s\n", app.ID, app.Hostname)
	}
	b.WriteString("  services:\n")
	for _, app := range e.Apps {
		fmt.Fprintf(&b, "    # %s\n    # host: http://%s\n", app.Name, app.HostUpstream)
		for _, note := range exportNotes(app, "Traefik passes them through.", "raise respondingTimeouts on the entry point, in Traefik's static configuration.") {
			b.WriteString("    # " + note + "\n")
		}
		fmt.Fprintf(&b, "    selfhost-%s:\n      loadBalancer:\n        servers:\n          - url: http://%s\n", app.ID, app.Upstream)
	}
	_, err := io.WriteString(w, b.String())
	return err
}
