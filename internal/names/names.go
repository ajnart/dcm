// Package names builds the Easy names at home: the Caddy that answers them and
// the check that tells whether they work on this network.
package names

import (
	"context"
	"net"
	"slices"
	"strings"

	"github.com/ajnart/self-host/internal/system"
)

// Domain is the public name service that answers every name with the address
// written inside it.
const Domain = "sslip.io"

// Host is the name of an App at home: jellyfin.192-168-1-20.sslip.io. It is
// false when lan is not an IPv4 address.
func Host(appID, lan string) (string, bool) {
	ip := net.ParseIP(lan)
	if ip == nil || ip.To4() == nil {
		return "", false
	}
	return appID + "." + strings.ReplaceAll(ip.To4().String(), ".", "-") + "." + Domain, true
}

// Service is the Compose service of the Caddy that owns port 80.
const Service = "access-caddy"

// Route sends the requests for one name to an App's service and port.
type Route struct {
	Host, Upstream string
}

// Caddyfile is the Caddy configuration for routes. Every site address is
// explicitly http:// so Caddy never tries to get a certificate, and anything
// else, such as the bare IP address, gets a plain 404.
func Caddyfile(routes []Route) string {
	var b strings.Builder
	b.WriteString("{\n\tadmin off\n\tauto_https off\n}\n")
	for _, r := range routes {
		b.WriteString("\nhttp://" + r.Host + " {\n\treverse_proxy " + r.Upstream + "\n}\n")
	}
	b.WriteString("\nhttp://:80 {\n\trespond \"self-host: unknown name\" 404\n}\n")
	return b.String()
}

// Fragment is the Compose fragment of the Caddy, next to a config folder
// holding its Caddyfile. The folder, not the file, is mounted so a rewritten
// Caddyfile reaches the container.
func Fragment() string {
	return `services:
  ` + Service + `:
    image: caddy:2.11.4
    restart: unless-stopped
    ports:
      - ${BIND_IP}:80:80
    volumes:
      - ./config:/etc/caddy:ro
`
}

// Verdict says why Easy names do or do not work on this network.
type Verdict string

const (
	// Working: this computer's resolver turns names into the LAN address.
	Working Verdict = "working"
	// Blocked: the router or its DNS drops answers that point inside the home.
	Blocked Verdict = "blocked"
	// Offline: this computer cannot look up any name on the internet.
	Offline Verdict = "offline"
	// Rewritten: the answer for a name is another address than the one inside it.
	Rewritten Verdict = "rewritten"
	// Unreachable: only this computer's own lookups fail, and asking a public
	// DNS server directly fails too, so the name service cannot be reached.
	Unreachable Verdict = "unreachable"
)

const (
	probeName   = "selfhost-probe"
	controlHost = "selfhost-control.1-1-1-1." + Domain
	directDNS   = "1.1.1.1:53"
)

// Diagnose resolves a probe name with this computer's resolver. When that
// does not give the LAN address it resolves a control name that points at a
// public address, so router protection never touches it, and then asks a
// public DNS server directly, to tell a blocked answer from a lost connection
// and from a rewritten answer. It checks this computer only, not a phone or TV.
func Diagnose(ctx context.Context, r system.Resolver, lan string) Verdict {
	probe, ok := Host(probeName, lan)
	if !ok || r == nil {
		return Offline
	}
	addresses, err := r.LookupHost(ctx, probe)
	if err == nil && slices.Contains(addresses, lan) {
		return Working
	}
	if err == nil && len(addresses) > 0 {
		return Rewritten
	}
	if _, err := r.LookupHost(ctx, controlHost); err != nil {
		return Offline
	}
	if direct, err := r.LookupHostVia(ctx, directDNS, probe); err == nil && slices.Contains(direct, lan) {
		return Blocked
	}
	return Unreachable
}

// Resolves reports whether this computer's resolver turns host into lan.
func Resolves(ctx context.Context, r system.Resolver, host, lan string) bool {
	if r == nil {
		return false
	}
	addresses, err := r.LookupHost(ctx, host)
	return err == nil && slices.Contains(addresses, lan)
}

const keepNumbers = " The addresses with numbers always work."

// Sentence is the one plain sentence that says why the names do not work, and
// that the addresses with numbers keep working. It is empty for Working.
func (v Verdict) Sentence() string {
	switch v {
	case Blocked:
		return "Your router hides the easy names, so they don't work here yet." + keepNumbers
	case Offline:
		return "This computer can't look up names on the internet right now, so the easy names don't work." + keepNumbers
	case Rewritten:
		return "Something on your network changes where names lead, so the easy names don't work." + keepNumbers
	case Unreachable:
		return "The service that makes the easy names isn't answering right now." + keepNumbers
	}
	return ""
}

// Technical is what to change or look at, for the Technical details section.
func (v Verdict) Technical() string {
	switch v {
	case Blocked:
		return "The router drops DNS answers that point at private addresses (DNS-rebind protection). " +
			"In its DNS settings, allow sslip.io or turn that protection off."
	case Offline:
		return "Looking up " + controlHost + " failed, so this computer has no working DNS to the internet."
	case Rewritten:
		return "The lookup of a " + Domain + " name returned an address other than the one inside it; check for a captive portal or a DNS filter."
	case Unreachable:
		return "This computer's DNS answered other names, but a direct query to " + directDNS + " for a " + Domain + " name failed too."
	}
	return ""
}
