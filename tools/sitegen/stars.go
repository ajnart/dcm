package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/ajnart/self-host/internal/catalog"
)

var repos = map[string]string{
	"actual-budget":        "actualbudget/actual",
	"adguard-home":         "AdguardTeam/AdGuardHome",
	"archive-team-warrior": "ArchiveTeam/warrior-dockerfile",
	"aria2":                "aria2/aria2",
	"audiobookshelf":       "advplyr/audiobookshelf",
	"authelia":             "authelia/authelia",
	"authentik":            "goauthentik/authentik",
	"bazarr":               "morpheus65535/bazarr",
	"beszel":               "henrygd/beszel",
	"bookstack":            "BookStackApp/BookStack",
	"borgmatic":            "borgmatic-collective/borgmatic",
	"caddy":                "caddyserver/caddy",
	"cloudflare-tunnel":    "cloudflare/cloudflared",
	"dashdot":              "MauriceNino/dashdot",
	"deluge":               "deluge-torrent/deluge",
	"dockge":               "louislam/dockge",
	"docmost":              "docmost/docmost",
	"emby":                 "MediaBrowser/Emby",
	"firefly-iii":          "firefly-iii/firefly-iii",
	"freshrss":             "FreshRSS/FreshRSS",
	"frigate":              "blakeblackshear/frigate",
	"gatus":                "TwiN/gatus",
	"glances":              "nicolargo/glances",
	"gluetun":              "qdm12/gluetun",
	"gotify":               "gotify/server",
	"grafana":              "grafana/grafana",
	"haproxy":              "haproxy/haproxy",
	"headscale":            "juanfont/headscale",
	"homarr":               "homarr-labs/homarr",
	"home-assistant":       "home-assistant/core",
	"homebridge":           "homebridge/homebridge",
	"immich":               "immich-app/immich",
	"jellyfin":             "jellyfin/jellyfin",
	"keycloak":             "keycloak/keycloak",
	"kopia":                "kopia/kopia",
	"lidarr":               "Lidarr/Lidarr",
	"linkwarden":           "linkwarden/linkwarden",
	"lldap":                "lldap/lldap",
	"loki":                 "grafana/loki",
	"mayan-edms":           "mayan-edms/Mayan-EDMS",
	"minio":                "minio/minio",
	"navidrome":            "navidrome/navidrome",
	"netbird":              "netbirdio/netbird",
	"netdata":              "netdata/netdata",
	"nextcloud":            "nextcloud/server",
	"nginx-proxy-manager":  "NginxProxyManager/nginx-proxy-manager",
	"node-red":             "node-red/node-red",
	"ntfy":                 "binwiederhier/ntfy",
	"nzbget":               "nzbgetcom/nzbget",
	"ollama":               "ollama/ollama",
	"open-webui":           "open-webui/open-webui",
	"pangolin":             "fosrl/pangolin",
	"paperless-ngx":        "paperless-ngx/paperless-ngx",
	"passbolt":             "passbolt/passbolt_api",
	"patchmon":             "PatchMon/PatchMon",
	"peanut":               "Brandawg93/PeaNUT",
	"photoprism":           "photoprism/photoprism",
	"pihole":               "pi-hole/pi-hole",
	"portainer":            "portainer/portainer",
	"postgresql":           "postgres/postgres",
	"prometheus":           "prometheus/prometheus",
	"prowlarr":             "Prowlarr/Prowlarr",
	"qbittorrent":          "qbittorrent/qBittorrent",
	"radarr":               "Radarr/Radarr",
	"renovate":             "renovatebot/renovate",
	"restic":               "restic/restic",
	"sabnzbd":              "sabnzbd/sabnzbd",
	"scrypted":             "koush/scrypted",
	"seafile":              "haiwen/seafile",
	"seerr":                "seerr-team/seerr",
	"slskd":                "slskd/slskd",
	"sonarr":               "Sonarr/Sonarr",
	"speedtest-tracker":    "alexjustesen/speedtest-tracker",
	"stalwart-mail":        "stalwartlabs/stalwart",
	"stirling-pdf":         "Stirling-Tools/Stirling-PDF",
	"syncthing":            "syncthing/syncthing",
	"tailscale":            "tailscale/tailscale",
	"tdarr":                "HaveAGitGat/Tdarr",
	"technitium-dns":       "TechnitiumSoftware/DnsServer",
	"tracearr":             "connorgallopo/Tracearr",
	"traefik":              "traefik/traefik",
	"transmission":         "transmission/transmission",
	"umami":                "umami-software/umami",
	"unbound":              "NLnetLabs/unbound",
	"uptime-kuma":          "louislam/uptime-kuma",
	"valkey":               "valkey-io/valkey",
	"vaultwarden":          "dani-garcia/vaultwarden",
	"vector":               "vectordotdev/vector",
	"victoria-metrics":     "VictoriaMetrics/VictoriaMetrics",
	"wud":                  "getwud/wud",
	"zerotier":             "zerotier/ZeroTierOne",
}

func query(ids []string) string {
	var b strings.Builder
	b.WriteString("{")
	for i, id := range ids {
		owner, name, _ := strings.Cut(repos[id], "/")
		fmt.Fprintf(&b, "r%d: repository(owner: %q, name: %q) { stargazerCount } ", i, owner, name)
	}
	b.WriteString("}")
	return b.String()
}

func writeStars() error {
	token := os.Getenv("GITHUB_TOKEN")
	if token == "" {
		return fmt.Errorf("set GITHUB_TOKEN to read star counts")
	}
	ids := []string{}
	for _, ap := range catalog.Default().Apps() {
		if _, ok := repos[ap.Info().ID]; ok {
			ids = append(ids, ap.Info().ID)
		}
	}
	body, err := json.Marshal(map[string]string{"query": query(ids)})
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, "https://api.github.com/graphql", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	var out struct {
		Data   map[string]*struct{ StargazerCount int } `json:"data"`
		Errors []struct{ Message string }               `json:"errors"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return err
	}
	for _, e := range out.Errors {
		fmt.Fprintln(os.Stderr, e.Message)
	}
	type entry struct {
		Repo  string `json:"repo"`
		Stars int    `json:"stars"`
	}
	stars := map[string]entry{}
	for i, id := range ids {
		if r := out.Data[fmt.Sprintf("r%d", i)]; r != nil {
			stars[id] = entry{Repo: repos[id], Stars: r.StargazerCount}
		}
	}
	doc, err := json.MarshalIndent(stars, "", " ")
	if err != nil {
		return err
	}
	path := filepath.Join("site", "src", "data", "stars.json")
	if err := os.WriteFile(path, append(doc, '\n'), 0o644); err != nil {
		return err
	}
	fmt.Println(path)
	return nil
}
