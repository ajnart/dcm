package main

import (
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/ajnart/self-host/internal/catalog"
)

// icons holds the Apps whose icon is not svg/<id>.svg in Dashboard Icons; "" means none.
var icons = map[string]string{
	"archive-team-warrior": "png/archiveteam-warrior.png",
	"aria2":                "png/ariang.png",
	"borgmatic":            "svg/borg.svg",
	"cleanuparr":           "png/cleanuparr.png",
	"cloudflare-tunnel":    "svg/cloudflare.svg",
	"dashdot":              "png/dashdot.png",
	"pihole":               "svg/pi-hole.svg",
	"stalwart-mail":        "svg/stalwart.svg",
	"technitium-dns":       "svg/technitium.svg",
	"victoria-metrics":     "svg/victoriametrics.svg",
	"wud":                  "svg/whats-up-docker.svg",
	"docmost":              "",
	"linkwarden":           "",
	"passbolt":             "",
	"restic":               "",
	"scrypted":             "",
	"speedtest-tracker":    "",
}

// svgIcons are the Apps whose icon is svg/<id>.svg. An App has to be listed here or in icons:
// a guessed path that does not exist leaves a broken image on the site and in DCM.
var svgIcons = strings.Fields(`
	actual-budget adguard-home audiobookshelf authelia authentik bazarr beszel bookstack caddy
	deluge dockge emby firefly-iii forgejo freshrss frigate gatus glances gluetun gotify grafana
	haproxy headscale homarr home-assistant homebridge immich jellyfin keycloak kopia lidarr
	lldap loki mayan-edms minio navidrome netbird netdata nextcloud nginx-proxy-manager node-red
	ntfy nzbget ollama open-webui pangolin paperless-ngx patchmon peanut photoprism plex
	portainer postgresql prometheus prowlarr qbittorrent radarr renovate sabnzbd seafile seerr
	slskd sonarr stirling-pdf syncthing tailscale tdarr tracearr traefik transmission umami
	unbound uptime-kuma valkey vaultwarden vector zerotier
`)

func icon(id string) (string, error) {
	if path, ok := icons[id]; ok {
		return path, nil
	}
	if slices.Contains(svgIcons, id) {
		return "svg/" + id + ".svg", nil
	}
	return "", fmt.Errorf("%s: no icon declared; add it to svgIcons, or to icons with its path or \"\" for none (tools/sitegen/icons.go)", id)
}

func checkIcons(cat *catalog.Catalog) error {
	for _, id := range slices.Sorted(maps.Keys(icons)) {
		if _, found := cat.App(id); !found {
			return fmt.Errorf("icons names %q, which is not in the Catalog", id)
		}
	}
	for _, id := range svgIcons {
		if _, found := cat.App(id); !found {
			return fmt.Errorf("svgIcons names %q, which is not in the Catalog", id)
		}
		if _, both := icons[id]; both {
			return fmt.Errorf("%s is in both icons and svgIcons", id)
		}
	}
	return nil
}
