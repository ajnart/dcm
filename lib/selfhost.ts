const SELFHOST_URL = "https://selfhost.ajnart.dev"

const SELFHOST_APP_IDS = new Set([
  "actual-budget",
  "adguard-home",
  "archive-team-warrior",
  "aria2",
  "audiobookshelf",
  "authelia",
  "authentik",
  "bazarr",
  "beszel",
  "bookstack",
  "borgmatic",
  "caddy",
  "cloudflare-tunnel",
  "dashdot",
  "deluge",
  "dockge",
  "docmost",
  "emby",
  "firefly-iii",
  "forgejo",
  "freshrss",
  "frigate",
  "gatus",
  "glances",
  "gluetun",
  "gotify",
  "grafana",
  "haproxy",
  "headscale",
  "homarr",
  "home-assistant",
  "homebridge",
  "immich",
  "jellyfin",
  "keycloak",
  "kopia",
  "lidarr",
  "linkwarden",
  "lldap",
  "loki",
  "mayan-edms",
  "minio",
  "navidrome",
  "netbird",
  "netdata",
  "nextcloud",
  "nginx-proxy-manager",
  "node-red",
  "ntfy",
  "nzbget",
  "ollama",
  "open-webui",
  "pangolin",
  "paperless-ngx",
  "passbolt",
  "patchmon",
  "peanut",
  "photoprism",
  "pihole",
  "plex",
  "portainer",
  "postgresql",
  "prometheus",
  "prowlarr",
  "qbittorrent",
  "radarr",
  "renovate",
  "restic",
  "sabnzbd",
  "scrypted",
  "seafile",
  "seerr",
  "slskd",
  "sonarr",
  "speedtest-tracker",
  "stalwart-mail",
  "stirling-pdf",
  "syncthing",
  "tailscale",
  "tdarr",
  "technitium-dns",
  "tracearr",
  "traefik",
  "transmission",
  "umami",
  "unbound",
  "uptime-kuma",
  "valkey",
  "vaultwarden",
  "vector",
  "victoria-metrics",
  "wud",
  "zerotier",
])

const OVERRIDES: Record<string, string> = {
  adguardhome: "adguard-home",
  homeassistant: "home-assistant",
  jellyseerr: "seerr",
  overseerr: "seerr",
}

export function getSelfHostId(toolId: string): string | undefined {
  const override = OVERRIDES[toolId]
  if (override) return override
  if (SELFHOST_APP_IDS.has(toolId)) return toolId
  return undefined
}

export function getSelfHostIds(toolIds: string[]): string[] {
  const ids = new Set<string>()
  for (const toolId of toolIds) {
    const id = getSelfHostId(toolId)
    if (id) ids.add(id)
  }
  return [...ids]
}

export function buildSelfHostLink(ids: string[] = []): string {
  if (ids.length === 0) return `${SELFHOST_URL}/?ref=dcm`
  return `${SELFHOST_URL}/?apps=${ids.join(",")}&ref=dcm`
}

export function buildSelfHostCommand(ids: string[]): string {
  return `self-host install ${ids.join(" ")}`
}
