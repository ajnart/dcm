package service

import (
	"context"
	"strings"

	"github.com/ajnart/self-host/internal/compose"
)

func (ss *session) observeNavigation(ctx context.Context, ids []string, containers map[string]compose.Container, rec cloudflareRecord) {
	ss.navigationContainers = containers
	working, failed := ss.workingNames(ctx, ids)
	ss.nameFailure = failed
	nodes := ss.tailscaleNodes(ctx, containers)
	private := ss.accessAddresses(nodes)
	ss.navigationWarnings = nil
	if ss.navigationError != nil && ss.tailscaleOn() {
		ss.navigationWarnings = append(ss.navigationWarnings, "Tailscale: private Access could not be inspected; its sign-in and HTTPS state are unknown. Inspect it with self-host logs tailscale.")
	}
	for _, check := range ss.tailscaleFindings(nodes) {
		if strings.HasPrefix(check.ID, "tailscale-inspection-") {
			ss.navigationWarnings = append(ss.navigationWarnings, check.Detail)
		}
	}
	if len(rec.Hosts) > 0 && !rec.Suspended && containers[cloudflareConnector].State != "running" {
		ss.navigationWarnings = append(ss.navigationWarnings, "Cloudflare's connector is not observed running. Use the other Addresses; inspect it with self-host status and self-host logs cloudflare-tunnel. Publication ownership is retained for review or cloudflare remove.")
	}
	ss.navigationAddresses = make(map[string][]string, len(ids))
	for _, id := range ids {
		if _, ok := ss.webApp(id); !ok {
			continue
		}
		ss.navigationAddresses[id] = append(private[id], ss.cloudflareAddresses(id, rec, containers)...)
		ss.navigationAddresses[id] = append(ss.navigationAddresses[id], addresses(working[id], "")...)
	}
}

func (ss *session) browserAddresses(id, local string) []string {
	out := append([]string(nil), ss.navigationAddresses[id]...)
	if local != "" {
		out = append(out, local)
	}
	return out
}
