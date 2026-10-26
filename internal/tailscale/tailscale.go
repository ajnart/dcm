// Package tailscale owns the shape of an App's private Tailscale name: the
// sidecar node and serve configuration generated for each App with a web page,
// and the reading of `tailscale status --json` that gives the real Address
// and the warnings about it. It runs nothing.
package tailscale

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
)

const (
	Image = "ghcr.io/tailscale/tailscale:latest"
	// ServicePrefix starts the Compose service of every node, so each is owned by the Tailscale App.
	ServicePrefix = "tailscale-"
	// Tag is the tag an OAuth client secret gives every node.
	Tag = "tag:self-host"

	KeysURL     = "https://login.tailscale.com/admin/settings/keys"
	DNSURL      = "https://login.tailscale.com/admin/dns"
	MachinesURL = "https://login.tailscale.com/admin/machines"

	// KeyDir holds the auth key file, mounted as a folder so a new key reaches the nodes.
	KeyDir = "keys"
	// KeyFile is the key's path under KeyDir and inside every container.
	KeyFile = "auth-key"
	// Socket is where tailscaled listens inside the containers.
	Socket = "/tmp/tailscaled.sock"

	expirySoon  = 30 * 24 * time.Hour
	oauthPrefix = "tskey-client-"
)

// ServiceName is the Compose service of an App's node.
func ServiceName(id string) string { return ServicePrefix + id }

// AppOf is the App a node's Compose service belongs to.
func AppOf(service string) (string, bool) {
	id, found := strings.CutPrefix(service, ServicePrefix)
	return id, found && id != ""
}

// NodeDir is an App's node folder inside the Tailscale App's folder; the
// state in it keeps the node's name the same across restarts.
func NodeDir(id string) string { return "nodes/" + id }

// ServePath is where an App's serve configuration lives in the Tailscale App's folder.
func ServePath(id string) string { return NodeDir(id) + "/config/serve.json" }

// IsOAuth reports whether the key is an OAuth client secret rather than an auth key.
func IsOAuth(key string) bool { return strings.HasPrefix(strings.TrimSpace(key), oauthPrefix) }

// KeyFileContent is what the key file holds: an auth key as given, an OAuth
// client secret with the options that make its nodes permanent and pre-approved.
func KeyFileContent(key string) string {
	key = strings.TrimSpace(key)
	if IsOAuth(key) && !strings.Contains(key, "?") {
		return key + "?ephemeral=false&preauthorized=true"
	}
	return key
}

// StatusCommand reads a node's own view of the tailnet.
func StatusCommand() []string {
	return []string{"tailscale", "--socket=" + Socket, "status", "--json"}
}

// Sidecar is the Compose service of one App's node, indented for a services: map.
func Sidecar(t app.WebTarget, oauth bool) string {
	var b strings.Builder
	fmt.Fprintf(&b, "  %s:\n", ServiceName(t.ID))
	fmt.Fprintf(&b, "    image: %s\n", Image)
	b.WriteString("    restart: unless-stopped\n")
	b.WriteString("    environment:\n")
	fmt.Fprintf(&b, "      TS_HOSTNAME: %s\n", t.ID)
	fmt.Fprintf(&b, "      TS_AUTHKEY: file:/run/secrets/%s\n", KeyFile)
	b.WriteString("      TS_STATE_DIR: /var/lib/tailscale\n")
	b.WriteString("      TS_USERSPACE: \"true\"\n")
	b.WriteString("      TS_SERVE_CONFIG: /config/serve.json\n")
	if oauth {
		fmt.Fprintf(&b, "      TS_EXTRA_ARGS: --advertise-tags=%s\n", Tag)
	}
	b.WriteString("    volumes:\n")
	fmt.Fprintf(&b, "      - ./%s/state:/var/lib/tailscale\n", NodeDir(t.ID))
	fmt.Fprintf(&b, "      - ./%s/config:/config:ro\n", NodeDir(t.ID))
	fmt.Fprintf(&b, "      - ./%s:/run/secrets:ro\n", KeyDir)
	return b.String()
}

// ServeConfig serves an App over HTTPS on its node's own name, inside the
// tailnet only: it has no AllowFunnel, so nothing is public.
func ServeConfig(t app.WebTarget) string {
	return fmt.Sprintf(`{
  "TCP": { "443": { "HTTPS": true } },
  "Web": {
    "${TS_CERT_DOMAIN}:443": {
      "Handlers": { "/": { "Proxy": "http://%s:%d" } }
    }
  }
}
`, t.Service, t.ContainerPort)
}

// Node is what one node says about itself in `tailscale status --json`.
type Node struct {
	// State is the BackendState: Running, NeedsLogin, NeedsMachineAuth, Stopped or Starting.
	State string
	// DNSName is the node's real name without the trailing dot, such as
	// jellyfin.tail1234.ts.net. A stale device of the same name makes it jellyfin-1.
	DNSName string
	// KeyExpiry is zero when the node's key does not expire.
	KeyExpiry time.Time
	// HTTPS is whether the tailnet has HTTPS certificates turned on.
	HTTPS bool
}

// ParseStatus reads the output of `tailscale status --json`.
func ParseStatus(data []byte) (Node, error) {
	var raw struct {
		BackendState string
		CertDomains  []string
		Self         *struct {
			DNSName   string
			KeyExpiry *time.Time
		}
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return Node{}, fmt.Errorf("tailscale status: %w", err)
	}
	node := Node{State: raw.BackendState, HTTPS: len(raw.CertDomains) > 0}
	if raw.Self != nil {
		node.DNSName = strings.TrimSuffix(raw.Self.DNSName, ".")
		if raw.Self.KeyExpiry != nil && !raw.Self.KeyExpiry.IsZero() && raw.Self.KeyExpiry.Year() > 1 {
			node.KeyExpiry = *raw.Self.KeyExpiry
		}
	}
	return node, nil
}

// Running reports whether the node is signed in and connected.
func (n Node) Running() bool { return n.State == "Running" }

// Address is the https Address of an App at the given path, empty until the
// node is running with a name and the tailnet has HTTPS on.
func (n Node) Address(path string) string {
	if !n.Running() || n.DNSName == "" || !n.HTTPS {
		return ""
	}
	return "https://" + n.DNSName + path
}

// Finding is something about the nodes a person should deal with, in plain words.
type Finding struct {
	// ID is needs-login, approval, https, key-expired or key-expires.
	ID string
	// Broken means private names do not work now; otherwise they will stop working.
	Broken bool
	Detail string
	Hint   string
}

// Assess lists what needs attention across the nodes, by App name: one
// finding for each kind of trouble, naming every App it touches.
func Assess(nodes map[string]Node, now time.Time) []Finding {
	var names = map[string][]string{}
	soonest := map[string]time.Duration{}
	for _, name := range sortedNames(nodes) {
		node := nodes[name]
		note := func(id string) { names[id] = append(names[id], name) }
		switch node.State {
		case "NeedsLogin":
			note("needs-login")
		case "NeedsMachineAuth":
			note("approval")
		case "Running":
			if !node.HTTPS {
				note("https")
			}
		}
		if node.KeyExpiry.IsZero() || node.State == "NeedsLogin" {
			continue
		}
		left := node.KeyExpiry.Sub(now)
		switch {
		case left <= 0:
			note("key-expired")
		case left <= expirySoon:
			note("key-expires")
			if known, found := soonest["key-expires"]; !found || left < known {
				soonest["key-expires"] = left
			}
		}
	}
	var findings []Finding
	add := func(id string, broken bool, detail func(who string, many bool) string, hint string) {
		if list := names[id]; len(list) > 0 {
			who := subject(list)
			findings = append(findings, Finding{ID: id, Broken: broken, Detail: detail(who, len(list) > 1), Hint: hint})
		}
	}
	add("needs-login", true, func(who string, many bool) string {
		return who + " " + verb(many, "is", "are") + " signed out of Tailscale, so " + verb(many, "its private name does", "their private names do") + " not work."
	}, "Make a new key at "+KeysURL+", run: self-host install tailscale --set-file tailscale.auth_key=PATH, then: self-host restart tailscale")
	add("approval", true, func(who string, many bool) string {
		return who + " " + verb(many, "is", "are") + " waiting for you to approve " + verb(many, "it", "them") + " in Tailscale."
	}, "Open "+MachinesURL+" and approve them. A key made with Pre-approved on skips this.")
	add("https", true, func(who string, many bool) string {
		return "HTTPS is not turned on for your Tailscale network, so " + who + " " + verb(many, "has", "have") + " no private name yet."
	}, "Turn on HTTPS on the DNS page, "+DNSURL+", then run: self-host restart tailscale")
	add("key-expired", true, func(who string, many bool) string {
		return "The Tailscale sign-in of " + who + " has run out."
	}, expiryHint)
	add("key-expires", false, func(who string, many bool) string {
		return fmt.Sprintf("The Tailscale sign-in of %s runs out in %s.", who, days(soonest["key-expires"]))
	}, expiryHint)
	return findings
}

const expiryHint = "Open " + MachinesURL + ", find the App's name and choose Disable key expiry."

func verb(many bool, one, several string) string {
	if many {
		return several
	}
	return one
}

func sortedNames(nodes map[string]Node) []string {
	names := make([]string, 0, len(nodes))
	for name := range nodes {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// subject names the Apps in a sentence: "Jellyfin", "Jellyfin and Immich", "Jellyfin, Immich and 2 more".
func subject(names []string) string {
	switch len(names) {
	case 1:
		return names[0]
	case 2:
		return names[0] + " and " + names[1]
	}
	return fmt.Sprintf("%s, %s and %d more", names[0], names[1], len(names)-2)
}

func days(d time.Duration) string {
	n := int((d + 24*time.Hour - 1) / (24 * time.Hour))
	if n <= 1 {
		return "1 day"
	}
	return fmt.Sprintf("%d days", n)
}
