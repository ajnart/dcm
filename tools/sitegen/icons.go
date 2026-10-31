package main

import (
	"fmt"
	"maps"
	"slices"

	"github.com/ajnart/self-host/internal/catalog"
)

// icons maps every App to its icon path in Dashboard Icons; "" means none. An App has to be
// listed: a guessed path that does not exist leaves a broken image on the site and in DCM.
var icons = map[string]string{
	"actual-budget":        "svg/actual-budget.svg",
	"adguard-home":         "svg/adguard-home.svg",
	"archive-team-warrior": "png/archiveteam-warrior.png",
	"aria2":                "png/ariang.png",
	"audiobookshelf":       "svg/audiobookshelf.svg",
	"authelia":             "svg/authelia.svg",
	"authentik":            "svg/authentik.svg",
	"bazarr":               "svg/bazarr.svg",
	"beszel":               "svg/beszel.svg",
	"bookstack":            "svg/bookstack.svg",
	"borgmatic":            "svg/borg.svg",
	"caddy":                "svg/caddy.svg",
	"cleanuparr":           "png/cleanuparr.png",
	"cloudflare-tunnel":    "svg/cloudflare.svg",
	"dashdot":              "png/dashdot.png",
	"deluge":               "svg/deluge.svg",
	"dockge":               "svg/dockge.svg",
	"docmost":              "",
	"emby":                 "svg/emby.svg",
	"firefly-iii":          "svg/firefly-iii.svg",
	"forgejo":              "svg/forgejo.svg",
	"freshrss":             "svg/freshrss.svg",
	"frigate":              "svg/frigate.svg",
	"gatus":                "svg/gatus.svg",
	"glances":              "svg/glances.svg",
	"gluetun":              "svg/gluetun.svg",
	"gotify":               "svg/gotify.svg",
	"grafana":              "svg/grafana.svg",
	"haproxy":              "svg/haproxy.svg",
	"headscale":            "svg/headscale.svg",
	"homarr":               "svg/homarr.svg",
	"home-assistant":       "svg/home-assistant.svg",
	"homebridge":           "svg/homebridge.svg",
	"immich":               "svg/immich.svg",
	"jellyfin":             "svg/jellyfin.svg",
	"keycloak":             "svg/keycloak.svg",
	"kopia":                "svg/kopia.svg",
	"lidarr":               "svg/lidarr.svg",
	"linkwarden":           "",
	"lldap":                "svg/lldap.svg",
	"loki":                 "svg/loki.svg",
	"mayan-edms":           "svg/mayan-edms.svg",
	"minio":                "svg/minio.svg",
	"navidrome":            "svg/navidrome.svg",
	"netbird":              "svg/netbird.svg",
	"netdata":              "svg/netdata.svg",
	"nextcloud":            "svg/nextcloud.svg",
	"nginx-proxy-manager":  "svg/nginx-proxy-manager.svg",
	"node-red":             "svg/node-red.svg",
	"ntfy":                 "svg/ntfy.svg",
	"nzbget":               "svg/nzbget.svg",
	"ollama":               "svg/ollama.svg",
	"open-webui":           "svg/open-webui.svg",
	"oxynote":              "",
	"pangolin":             "svg/pangolin.svg",
	"paperless-ngx":        "svg/paperless-ngx.svg",
	"passbolt":             "",
	"patchmon":             "svg/patchmon.svg",
	"peanut":               "svg/peanut.svg",
	"photoprism":           "svg/photoprism.svg",
	"pihole":               "svg/pi-hole.svg",
	"plex":                 "svg/plex.svg",
	"portainer":            "svg/portainer.svg",
	"postgresql":           "svg/postgresql.svg",
	"prometheus":           "svg/prometheus.svg",
	"prowlarr":             "svg/prowlarr.svg",
	"qbittorrent":          "svg/qbittorrent.svg",
	"radarr":               "svg/radarr.svg",
	"renovate":             "svg/renovate.svg",
	"restic":               "",
	"sabnzbd":              "svg/sabnzbd.svg",
	"scrypted":             "",
	"seafile":              "svg/seafile.svg",
	"seerr":                "svg/seerr.svg",
	"slskd":                "svg/slskd.svg",
	"sonarr":               "svg/sonarr.svg",
	"speedtest-tracker":    "",
	"stalwart-mail":        "svg/stalwart.svg",
	"stirling-pdf":         "svg/stirling-pdf.svg",
	"syncthing":            "svg/syncthing.svg",
	"tailscale":            "svg/tailscale.svg",
	"tdarr":                "svg/tdarr.svg",
	"technitium-dns":       "svg/technitium.svg",
	"tracearr":             "svg/tracearr.svg",
	"traefik":              "svg/traefik.svg",
	"transmission":         "svg/transmission.svg",
	"umami":                "svg/umami.svg",
	"unbound":              "svg/unbound.svg",
	"uptime-kuma":          "svg/uptime-kuma.svg",
	"valkey":               "svg/valkey.svg",
	"vaultwarden":          "svg/vaultwarden.svg",
	"vector":               "svg/vector.svg",
	"victoria-metrics":     "svg/victoriametrics.svg",
	"wud":                  "svg/whats-up-docker.svg",
	"zerotier":             "svg/zerotier.svg",
}

var lightIcons = map[string]string{
	"frigate":          "svg/frigate-light.svg",
	"lldap":            "svg/lldap-dark.svg",
	"mayan-edms":       "svg/mayan-edms-light.svg",
	"minio":            "svg/minio-light.svg",
	"ollama":           "svg/ollama-dark.svg",
	"open-webui":       "svg/open-webui-light.svg",
	"plex":             "svg/plex-light.svg",
	"portainer":        "svg/portainer-dark.svg",
	"tailscale":        "svg/tailscale-light.svg",
	"umami":            "svg/umami-light.svg",
	"vaultwarden":      "svg/vaultwarden-light.svg",
	"victoria-metrics": "svg/victoriametrics-light.svg",
}

func icon(id string) (string, error) {
	path, ok := icons[id]
	if !ok {
		return "", fmt.Errorf("%s: no icon declared; add it to icons with its path, or \"\" for none (tools/sitegen/icons.go)", id)
	}
	return path, nil
}

func checkIcons(cat *catalog.Catalog) error {
	for _, id := range slices.Sorted(maps.Keys(lightIcons)) {
		if icons[id] == "" {
			return fmt.Errorf("lightIcons names %q, which has no base icon", id)
		}
	}
	for _, id := range slices.Sorted(maps.Keys(icons)) {
		if _, found := cat.App(id); !found {
			return fmt.Errorf("icons names %q, which is not in the Catalog", id)
		}
	}
	return nil
}
