package main

import (
	"fmt"
	"regexp"
	"strings"

	"go.yaml.in/yaml/v3"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
)

const (
	maxListedLinks     = 3
	minNoteKeyLength   = 6
	firstVisitAdmin    = "After the first start, create the administrator on the first visit."
	firstVisitOwner    = "After the first start, create the first owner on the first visit."
	arrAuthentication  = "After the first start, turn on authentication in Settings > General (Forms, with a username and password)"
	inertComposeSuffix = "self-host only prepares its credentials and folders."
)

var (
	noteKey  = regexp.MustCompile(`\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*\b`)
	notePath = regexp.MustCompile(`(?:^|[\s("'])((?:\$\{[A-Z_]+\})?(?:/[A-Za-z0-9._-]+){2,})`)
)

// extraNotes is what plain Compose leaves to the user because self-host does it after the
// App starts (its Setup) or before it (its Files). Each one comes from the App's package.
var extraNotes = map[string]string{
	"actual-budget":  "After the first start, open the web page and set the server password.",
	"adguard-home":   "After the first start, finish the install wizard in the browser: create the administrator and keep the admin port at 3000.",
	"audiobookshelf": "After the first start, create the root account on the first visit.",
	"bazarr":         "After the first start, turn on authentication in Settings > General > Authentication (Basic, with a username and password).",
	"beszel": "After the first start, create the administrator on the hub's first visit. self-host starts the agent only after its Setup has read the hub's key and token. " +
		"With plain Compose, start the hub, add a system in its web page, set BESZEL_AGENT_KEY and BESZEL_AGENT_TOKEN, then run docker compose up -d again.",
	"bookstack":   "BookStack starts with a seeded administrator account (admin@admin.com, password \"password\"); sign in and replace it.",
	"cleanuparr":  "After the first start, create the account on the first visit.",
	"deluge":      "The Web UI starts with the password \"deluge\"; change it on the first sign-in.",
	"dockge":      "After the first start, create the first administrator account on the first visit.",
	"docmost":     "After the first start, create the first workspace owner on the first visit.",
	"emby":        "After the first start, finish the first-run wizard and create the administrator.",
	"firefly-iii": "After the first start, register the first owner at /register.",
	"forgejo": "Installation and registration are locked, and self-host creates the first administrator after the first start. With plain Compose run: " +
		"docker exec -u git <container name> forgejo admin user create --admin --username admin --email admin@example.com --password <password>.",
	"freshrss":            "After the first start, finish the install page and create the administrator.",
	"frigate":             "Frigate generates the first administrator (admin) and prints its password once in the container logs; sign in with it and change it.",
	"home-assistant":      "After the first start, finish the onboarding page and create the owner.",
	"homarr":              "After the first start, finish the onboarding wizard and create the administrator.",
	"homebridge":          "After the first start, complete the setup wizard and create the administrator.",
	"immich":              firstVisitAdmin,
	"jellyfin":            "After the first start, finish the startup wizard: create the administrator and add your media library.",
	"lidarr":              arrAuthentication + ".",
	"linkwarden":          "After the first start, sign up the first account on the first visit.",
	"navidrome":           "After the first start, create the first administrator on the sign-in page.",
	"netbird":             firstVisitAdmin,
	"nginx-proxy-manager": firstVisitAdmin,
	"ntfy": "Access is deny-all and login is on, so create the administrator inside the container: " +
		"docker exec -it <container name> ntfy user add --role=admin <username>.",
	"pangolin":      "After the first start, create the first administrator on the setup page with the PANGOLIN_SETUP_TOKEN value.",
	"patchmon":      firstVisitAdmin,
	"plex":          "Create a claim token at https://www.plex.tv/claim (valid 4 minutes) and set PLEX_CLAIM_TOKEN before the first start, or the server stays unclaimed.",
	"prowlarr":      arrAuthentication + ".",
	"qbittorrent":   "The WebUI starts with a temporary administrator password printed in the container logs; sign in with it, set your own and set the default save path to the downloads folder.",
	"radarr":        arrAuthentication + " and add the root folder /media/movies.",
	"renovate":      "The container only runs renovate --version; replace the command with your own run. " + inertComposeSuffix,
	"restic":        "The container only runs restic version; run your backups against the repository yourself. " + inertComposeSuffix,
	"sabnzbd":       "After the first start, set the WebUI username and password in Config > General.",
	"scrypted":      "After the first start, create the first administrator on the login page.",
	"sonarr":        arrAuthentication + " and add the root folder /media/tv.",
	"stalwart-mail": "After the first start, finish the first-run setup in the admin UI to create the administrator.",
	"syncthing":     "After the first start, set the GUI administrator login in Actions > Settings > GUI.",
	"tdarr":         "After the first start, register the first administrator on the first-run page.",
	"tracearr":      firstVisitOwner,
	"umami":         "Umami starts with the seeded administrator admin and password \"umami\"; sign in and change the password right away.",
	"uptime-kuma":   firstVisitAdmin,
	"vaultwarden":   "Signups are closed. Open /admin with the VAULTWARDEN_ADMIN_TOKEN value and invite yourself to get an account.",
	"wud":           "WUD watches a remote Docker endpoint over TLS: set WUD_DOCKER_HOST and put its CA certificate at ${CONFIG_PATH}/wud/tls/ca.pem.",
}

func checkExtraNotes(cat *catalog.Catalog) error {
	for id := range extraNotes {
		if _, found := cat.App(id); !found {
			return fmt.Errorf("extraNotes names %q, which is not in the Catalog", id)
		}
	}
	return nil
}

func notesFor(ap app.App, c *converter, compose string, env []envJSON, links []linkJSON) (string, error) {
	id := ap.Info().ID
	var notes []string
	if len(c.missing) > 0 {
		notes = append(notes, fmt.Sprintf("Needs files that only self-host generates before the first start (%s), mounted from ${CONFIG_PATH}/%s/; without them it does not start. Use self-host install %s for the full setup.",
			strings.Join(c.missing, ", "), id, id))
	}
	for _, entry := range env {
		if entry.required && boundVar(compose, entry.Key) {
			notes = append(notes, fmt.Sprintf("Set %s before the first start (%s); the default %s is only a placeholder, and without a file there the container does not start.",
				entry.Key, entry.prompt, entry.Default))
		}
	}
	if len(c.converted) > 0 {
		keys := make([]string, len(c.converted))
		for i, key := range c.converted {
			keys[i] = strings.TrimSuffix(key, "_FILE")
		}
		notes = append(notes, fmt.Sprintf("self-host hands secrets to the container as files (%s); this Compose passes them as plain environment variables (%s) instead.",
			strings.Join(c.converted, ", "), strings.Join(keys, ", ")))
	}
	if len(c.dropped) > 0 {
		notes = append(notes, fmt.Sprintf("self-host preseeds the administrator through a password file (%s); this Compose leaves it out, so create the administrator in the web page on the first visit.",
			strings.Join(c.dropped, " ")))
	}
	if extra := extraNotes[id]; extra != "" {
		if err := checkNote(id, extra, compose); err != nil {
			return "", err
		}
		notes = append(notes, extra)
	}
	switch {
	case len(links) > maxListedLinks:
		notes = append(notes, fmt.Sprintf("After its first start, self-host also wires it to %d other Apps; plain Compose leaves that to you.", len(links)))
	case len(links) > 0:
		titles := make([]string, len(links))
		for i, link := range links {
			titles[i] = link.Title
		}
		notes = append(notes, "After its first start, self-host also wires it to other Apps ("+strings.Join(titles, "; ")+"); plain Compose leaves that to you.")
	}
	return strings.Join(notes, " "), nil
}

// checkNote keeps a hand-written note honest: it may only name variables the App's compose
// reads and folders the compose mounts, so a rename in the App cannot leave it stale.
func checkNote(id, note, compose string) error {
	keys, mounts, err := composeFacts(compose)
	if err != nil {
		return fmt.Errorf("%s: %w", id, err)
	}
	for _, token := range noteKey.FindAllString(note, -1) {
		if _, global := globals[token]; len(token) >= minNoteKeyLength && !keys[token] && !global {
			return fmt.Errorf("%s: note names %s, which its compose does not read", id, token)
		}
	}
	for _, match := range notePath.FindAllStringSubmatch(note, -1) {
		target := strings.TrimRight(match[1], ".")
		if !coveredBy(target, mounts) {
			return fmt.Errorf("%s: note names %s, which its compose does not mount", id, target)
		}
	}
	return nil
}

type mount struct{ source, target string }

func composeFacts(compose string) (map[string]bool, []mount, error) {
	var doc struct {
		Services map[string]struct {
			Environment any      `yaml:"environment"`
			Volumes     []string `yaml:"volumes"`
		} `yaml:"services"`
	}
	if err := yaml.Unmarshal([]byte(compose), &doc); err != nil {
		return nil, nil, fmt.Errorf("compose is not valid YAML: %w", err)
	}
	keys := map[string]bool{}
	for _, match := range varRef.FindAllStringSubmatch(compose, -1) {
		keys[match[1]+match[2]] = true
	}
	var mounts []mount
	for _, svc := range doc.Services {
		switch env := svc.Environment.(type) {
		case map[string]any:
			for key := range env {
				keys[key] = true
			}
		case []any:
			for _, item := range env {
				key, _, _ := strings.Cut(fmt.Sprint(item), "=")
				keys[key] = true
			}
		}
		for _, volume := range svc.Volumes {
			source, rest, _ := strings.Cut(volume, ":")
			target, _, _ := strings.Cut(rest, ":")
			mounts = append(mounts, mount{source: source, target: target})
		}
	}
	return keys, mounts, nil
}

func coveredBy(p string, mounts []mount) bool {
	for _, m := range mounts {
		if within(p, m.source) || within(p, m.target) {
			return true
		}
	}
	return false
}

func within(p, root string) bool {
	root = strings.TrimSuffix(root, "/")
	return root != "" && (p == root || strings.HasPrefix(p, root+"/"))
}
