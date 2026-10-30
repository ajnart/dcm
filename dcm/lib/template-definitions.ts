import { TemplateCategory } from "./template-categories"
import type { Template } from "./templates"

// Predefined templates with personality-based themes
export const templateDefinitions: Template[] = [
  {
    id: "the-self-promo",
    name: "The Self Promo",
    description:
      "Promoting your other self-hosted services, really? It's almost embarrassing...",
    category: TemplateCategory.MEDIA,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/homarr.png",
    tools: ["homarr"],
  },
  {
    id: "the-privacy-schizo",
    name: "The Privacy Schizo",
    description:
      "Because they're not paranoid if they're really watching you. Tinfoil hat sold separately.",
    category: TemplateCategory.SECURITY,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/pi-hole.png",
    tools: [
      "pihole",
      "wireguard",
      "vaultwarden",
      "traefik",
      "authelia",
      "crowdsec",
    ],
  },
  {
    id: "the-dad",
    name: "The Dad",
    description:
      "The essential family server setup that keeps everyone happy and the Wi-Fi complaints to a minimum",
    category: TemplateCategory.MEDIA,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/jellyfin.png",
    tools: ["jellyfin", "nextcloud", "pihole", "homarr", "homeassistant"],
  },
  {
    id: "the-media-server-starter",
    name: "The Media Server Starter",
    description:
      "A straightforward media server setup for the 'Netflix is raising prices again?' crowd",
    category: TemplateCategory.MEDIA,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/jellyfin.png",
    tools: ["jellyfin", "sonarr", "radarr", "prowlarr", "qbittorrent"],
  },
  {
    id: "the-media-hoarder",
    name: "The Media Hoarder",
    description:
      "For the digital dragon who never deletes anything and needs 'just one more hard drive'",
    category: TemplateCategory.MEDIA,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/jellyfin.png",
    tools: [
      "jellyfin",
      "sonarr",
      "radarr",
      "lidarr",
      "prowlarr",
      "qbittorrent",
      "bazarr",
      "jellyseerr",
      "calibreweb",
      "readarr",
    ],
  },
  {
    id: "the-automator",
    name: "The Automator",
    description:
      "Spent 10 hours automating a 2-minute task because 'it's about the principle'",
    category: TemplateCategory.HOME_AUTOMATION,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/home-assistant.png",
    tools: [
      "homeassistant",
      "node-red",
      "mosquitto",
      "zigbee2mqtt",
      "grafana",
      "influxdb",
    ],
  },
  {
    id: "the-home-office",
    name: "The Home Office",
    description:
      "Everything you need to work from home without your files becoming hostages to cloud services",
    category: TemplateCategory.PRODUCTIVITY,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/nextcloud.png",
    tools: [
      "nextcloud",
      "mariadb",
      "code-server",
      "vaultwarden",
      "filebrowser",
    ],
  },
  {
    id: "the-coomer",
    name: "The Coomer",
    description:
      "Keep your 'homework folder' meticulously organized and automated. We won't judge.",
    category: TemplateCategory.MEDIA,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/stash.png",
    tools: ["whisparr", "prowlarr", "transmission", "flaresolverr"],
  },
  {
    id: "the-dashboard-enjoyer",
    name: "The Dashboard Enjoyer",
    description:
      "Spends more time customizing dashboards than using the actual services",
    category: TemplateCategory.MONITORING,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/homepage.png",
    tools: [
      "homepage",
      "grafana",
      "prometheus",
      "uptime-kuma",
      "portainer",
      "heimdall",
    ],
  },
  {
    id: "the-security-essentials",
    name: "The Security Essentials",
    description:
      "Basic security setup for those who want to keep their digital life locked up but still find their keys",
    category: TemplateCategory.SECURITY,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/vaultwarden.png",
    tools: ["vaultwarden", "wireguard", "pihole", "traefik", "authelia"],
  },
  {
    id: "the-backup-basics",
    name: "The Backup Basics",
    description:
      "Because even digital packrats need to make sure their collection survives a catastrophe",
    category: TemplateCategory.OTHER,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/duplicacy.png",
    tools: ["nextcloud", "syncthing", "mariadb"],
  },
  {
    id: "the-homarr-enjoyer",
    name: "The Homarr Enjoyer",
    description:
      "Has more dashboard widgets than actual services and rearranges them daily 'for optimal workflow'",
    category: TemplateCategory.MONITORING,
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/homarr.svg",
    tools: ["homarr", "uptime-kuma", "portainer", "watchtower", "statping-ng"],
  },
  {
    id: "the-docker-novice",
    name: "The Docker Novice",
    description:
      "Proudly announces they've 'ascended to containerization' after watching one YouTube tutorial",
    category: TemplateCategory.MONITORING,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/portainer.png",
    tools: ["portainer", "watchtower", "homarr", "nginx"],
  },
  {
    id: "the-just-the-basics",
    name: "Just The Basics",
    description:
      "A solid starter pack for self-hosting that won't have you reading documentation all weekend",
    category: TemplateCategory.OTHER,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/portainer.png",
    tools: ["portainer", "nextcloud", "jellyfin", "pihole"],
  },
  {
    id: "the-raspberry-pi-warrior",
    name: "The Raspberry Pi Warrior",
    description:
      "Running 17 critical services on a $35 computer with a microSD card that could fail any minute",
    category: TemplateCategory.OTHER,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/pi-hole.png",
    tools: ["pihole", "portainer", "nextcloud", "traefik"],
  },
  {
    id: "the-data-scientist",
    name: "The Data Scientist",
    description:
      "Analyzes kitchen appliance usage patterns to determine the optimal coffee brewing schedule",
    category: TemplateCategory.DATABASE,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/grafana.png",
    tools: [
      "grafana",
      "prometheus",
      "influxdb",
      "postgres",
      "elasticsearch",
      "kibana",
    ],
  },
  {
    id: "the-digital-librarian",
    name: "The Digital Librarian",
    description:
      "Has more books than they'll read in 10 lifetimes, but the collection must grow",
    category: TemplateCategory.MEDIA,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/calibre-web.png",
    tools: [
      "calibreweb",
      "readarr",
      "kavita",
      "komga",
      "audiobookshelf",
      "mariadb",
    ],
  },
  {
    id: "the-small-office",
    name: "The Small Office",
    description:
      "For the small business or home office that wants to keep their data on-premises and save a few bucks",
    category: TemplateCategory.PRODUCTIVITY,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/nextcloud.png",
    tools: [
      "nextcloud",
      "wikijs",
      "mariadb",
      "portainer",
      "vaultwarden",
      "traefik",
    ],
  },
  {
    id: "the-recipe-collector",
    name: "The Recipe Collector",
    description:
      "Saves every recipe they'll never cook, but the food pictures look amazing",
    category: TemplateCategory.PRODUCTIVITY,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/tandoor.png",
    tools: ["tandoorrecipes", "mealie", "postgres"],
  },
  {
    id: "the-budget-hawk",
    name: "The Budget Hawk",
    description:
      "Tracks every penny spent while hosting $500 worth of services to save $5 per month",
    category: TemplateCategory.FINANCE,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/firefly-iii.png",
    tools: ["firefly", "mariadb", "scrutiny"],
  },
  {
    id: "the-homelab-newbie",
    name: "The Homelab Newbie",
    description:
      "About to discover why everyone keeps mentioning 'backups' in an ominous tone",
    category: TemplateCategory.OTHER,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/nextcloud.png",
    tools: ["nextcloud", "jellyfin", "portainer", "pihole", "homarr"],
  },
  {
    id: "the-perpetual-student",
    name: "The Perpetual Student",
    description:
      "Turns their home server into a personal knowledge management system they never actually use",
    category: TemplateCategory.PRODUCTIVITY,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/nextcloud.png",
    tools: [
      "nextcloud",
      "bookstack",
      "wikijs",
      "wallabag",
      "freshrss",
      "mysql",
    ],
  },
  {
    id: "the-dev-environment",
    name: "The Dev Environment",
    description:
      "Convinces themselves they need enterprise-level CI/CD for their personal projects",
    category: TemplateCategory.DEVELOPMENT,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/vscode.png",
    tools: ["code-server", "gitea", "jenkins", "postgres", "redis", "nginx"],
  },
  {
    id: "the-family-tech-support",
    name: "The Family Tech Support",
    description:
      "Set up the perfect stack so family can ask 'is the internet down?' instead of Googling it",
    category: TemplateCategory.OTHER,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/adguard-home.png",
    tools: ["pihole", "uptime-kuma", "nextcloud", "jellyfin", "homeassistant"],
  },
  {
    id: "the-note-taking-addict",
    name: "The Note Taking Addict",
    description:
      "Has tried every note-taking app and still can't decide which one to stick with",
    category: TemplateCategory.PRODUCTIVITY,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/joplin.png",
    tools: ["joplin-server", "wikijs", "bookstack", "logseq", "mariadb"],
  },
  {
    id: "the-uptime-obsessor",
    name: "The Uptime Obsessor",
    description:
      "Checks status dashboards more than social media and panics over 0.1% downtime",
    category: TemplateCategory.MONITORING,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/uptime-kuma.png",
    tools: ["uptime-kuma", "statping-ng", "prometheus", "grafana", "netdata"],
  },
  {
    id: "the-compose-enthusiast",
    name: "The Compose Enthusiast",
    description:
      "Has a git repo of meticulously crafted YAML files that are 'definitely not copied from random GitHub repos'",
    category: TemplateCategory.DEVELOPMENT,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/portainer.png",
    tools: ["portainer", "nginx", "traefik", "watchtower", "homarr"],
  },
  {
    id: "the-paperless-dreamer",
    name: "The Paperless Dreamer",
    description:
      "Scans every receipt and document while drowning in a sea of actual paper on their desk",
    category: TemplateCategory.PRODUCTIVITY,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/paperless-ngx.png",
    tools: ["nextcloud", "mariadb", "redis"],
  },
  {
    id: "the-wiki-hoarder",
    name: "The Wiki Hoarder",
    description:
      "Documents every single system configuration down to the last SSH key and never refers to it again",
    category: TemplateCategory.PRODUCTIVITY,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/wikijs.png",
    tools: ["wikijs", "bookstack", "postgres", "nginx"],
  },
  {
    id: "the-vpn-tunneler",
    name: "The VPN Tunneler",
    description:
      "Routes traffic through so many layers of encryption they've forgotten what website they were trying to visit",
    category: TemplateCategory.SECURITY,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/wireguard.png",
    tools: ["wireguard", "traefik", "pihole", "adguardhome"],
  },
  {
    id: "the-reverse-proxy-master",
    name: "The Reverse Proxy Master",
    description:
      "Can explain the difference between Traefik, Nginx, and Caddy in excruciating detail to anyone who makes eye contact",
    category: TemplateCategory.NETWORK,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/traefik.png",
    tools: ["traefik", "nginx", "caddy", "portainer"],
  },
  {
    id: "the-minimalist",
    name: "The Minimalist",
    description:
      "Runs only the 'essential' 25 containers and calls it a 'lightweight setup'",
    category: TemplateCategory.OTHER,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/alpine.png",
    tools: ["nginx", "pihole", "portainer", "nextcloud"],
  },
  {
    id: "the-file-synchronizer",
    name: "The File Synchronizer",
    description:
      "Has the same files copied across 7 different services 'just to be safe'",
    category: TemplateCategory.OTHER,
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/syncthing.png",
    tools: ["syncthing", "nextcloud", "filebrowser", "mariadb"],
  },
]
