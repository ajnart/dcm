import type { DockerTool } from "@/lib/docker-tools"

export const management: DockerTool[] = [
  {
    id: "portainer",
    name: "Portainer",
    description:
      "A powerful container management interface that provides a user-friendly web UI for managing Docker environments. Features include container deployment, stack management with Docker Compose support, volume management, network configuration, and real-time container monitoring.",
    category: "Management",
    tags: ["Management", "UI", "Monitoring"],
    githubUrl: "https://github.com/portainer/portainer",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/portainer.svg",
    composeContent: `services:
  portainer:
    image: portainer/portainer-ce:latest
    container_name: \${CONTAINER_PREFIX}portainer
    ports:
      - "9443:9443"
      - "8000:8000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - \${DATA_PATH}/portainer:/data
    environment:
      - TZ=\${TZ}
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "traefik",
    name: "Traefik",
    description:
      "A modern, cloud-native application proxy and load balancer that makes deploying microservices easy. Features automatic service discovery, Let's Encrypt support, and dynamic configuration.",
    category: "Networking",
    tags: ["Proxy", "Load Balancer", "SSL"],
    githubUrl: "https://github.com/traefik/traefik",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/traefik.svg",
    composeContent: `services:
  traefik:
    image: traefik:v3.3
    container_name: \${CONTAINER_PREFIX}traefik
    command:
      - "--api.insecure=true"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entryPoints.web.address=:80"
      - "--entryPoints.websecure.address=:443"
    ports:
      - "80:80"
      - "443:443"
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - \${CONFIG_PATH}/traefik:/etc/traefik
    environment:
      - TZ=\${TZ}
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "nginx",
    name: "Nginx",
    description:
      "A powerful, high-performance web server and reverse proxy server. Features include load balancing, HTTP caching, serving static files, SSL/TLS termination, and acting as a reverse proxy for other services.",
    category: "Networking",
    tags: ["Web Server", "Reverse Proxy", "Load Balancer"],
    githubUrl: "https://github.com/nginx/nginx",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/nginx.svg",
    composeContent: `services:
  nginx:
    image: nginx:1-alpine
    container_name: \${CONTAINER_PREFIX}nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - \${CONFIG_PATH}/nginx/html:/usr/share/nginx/html
      - \${CONFIG_PATH}/nginx/conf.d:/etc/nginx/conf.d
      - \${CONFIG_PATH}/nginx/ssl:/etc/nginx/ssl
    environment:
      - TZ=\${TZ}
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "pihole",
    name: "Pi-hole",
    description: "Network-wide Ad Blocking.",
    category: "Networking",
    tags: ["Ad Blocking", "DNS", "Privacy"],
    githubUrl: "https://github.com/pi-hole/pi-hole",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/pi-hole.svg",
    composeContent: `services:
  pihole:
    container_name: \${CONTAINER_PREFIX}pihole
    image: pihole/pihole:latest
    ports:
      - "53:53/tcp"
      - "53:53/udp"
      - "80:80/tcp"
      - "443:443/tcp"
    environment:
      - TZ=\${TZ}
      - FTLCONF_dns_listeningMode=all
    volumes:
      - \${CONFIG_PATH}/pihole:/etc/pihole
    cap_add:
      - NET_ADMIN
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "adguardhome",
    name: "AdGuard Home",
    description: "Network-wide ads & trackers blocking DNS server.",
    category: "Networking",
    tags: ["Ad Blocking", "DNS", "Privacy"],
    githubUrl: "https://github.com/AdguardTeam/AdGuardHome",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/adguard-home.svg",
    composeContent: `services:
  adguardhome:
    container_name: \${CONTAINER_PREFIX}adguardhome
    image: adguard/adguardhome:latest
    ports:
      - "53:53/udp"
      - "53:53/tcp"
      - "80:80/tcp"
      - "443:443/tcp"
      - "3000:3000/tcp"
    volumes:
      - \${CONFIG_PATH}/adguardhome/conf:/opt/adguardhome/conf
      - \${CONFIG_PATH}/adguardhome/work:/opt/adguardhome/work
    environment:
      - TZ=\${TZ}
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "caddy",
    name: "Caddy",
    description:
      "Powerful, enterprise-ready, open source web server with automatic HTTPS.",
    category: "Networking",
    tags: ["Web Server", "Reverse Proxy", "HTTPS"],
    githubUrl: "https://github.com/caddyserver/caddy",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/caddy.svg",
    composeContent: `services:
  caddy:
    image: ghcr.io/hotio/caddy:latest
    container_name: \${CONTAINER_PREFIX}caddy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - \${CONFIG_PATH}/caddy:/config
      - \${CONFIG_PATH}/caddy/Caddyfile:/config/Caddyfile
      - \${CONFIG_PATH}/caddy/www:/config/www
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "cloudflared-web",
    name: "Cloudflared WEB",
    description:
      "Manage remotely-managed Cloudflare tunnels with a simple web UI for configuring tokens and starting or stopping cloudflared. Uses host networking; access the Web UI at http://localhost:14333.",
    category: "Networking",
    tags: ["Network", "Cloudflare", "Tunnel", "UI"],
    githubUrl: "https://github.com/WisdomSky/Cloudflared-web",
    composeContent: `services:
  cloudflared-web:
    image: wisdomsky/cloudflared-web:latest
    container_name: \${CONTAINER_PREFIX}cloudflared-web
    network_mode: host
    environment:
      - WEBUI_PORT=14333
    volumes:
      - \${CONFIG_PATH}/cloudflared-web:/config
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "dockge",
    name: "Dockge",
    description:
      "A fancy, easy-to-use and reactive self-hosted docker compose.yaml stack-oriented manager",
    category: "Management",
    tags: ["Management", "UI", "Monitoring"],
    githubUrl: "https://github.com/louislam/dockge",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/dockge.svg",
    composeContent: `services:
  dockge:
    container_name: \${CONTAINER_PREFIX}dockge
    image: louislam/dockge:1
    restart: \${RESTART_POLICY}
    ports:
      - "5001:5001"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - \${DATA_PATH}/data:/app/data
      - \${DATA_PATH}/stacks:/opt/stacks
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - UMASK=\${UMASK}
      - TZ=\${TZ}
      - DOCKGE_STACKS_DIR=/opt/stacks
      - DOCKGE_ENABLE_CONSOLE=true`,
  },
  {
    id: "nebula-sync",
    name: "Nebula Sync",
    description:
      "Synchronize Pi-hole v6.x configuration across multiple replicas automatically. Keeps your primary Pi-hole in sync with secondary instances via scheduled CRON jobs.",
    category: "Networking",
    tags: ["Ad Blocking", "DNS", "Pi-hole", "Sync"],
    githubUrl: "https://github.com/lovelaze/nebula-sync",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/nebula-sync.svg",
    composeContent: `services:
  nebula-sync:
    image: ghcr.io/lovelaze/nebula-sync:latest
    container_name: \${CONTAINER_PREFIX}nebula-sync
    environment:
      - PRIMARY=\${NEBULA_PRIMARY:-http://ph1.example.com|password}
      - REPLICAS=\${NEBULA_REPLICAS:-http://ph2.example.com|password,http://ph3.example.com|password}
      - FULL_SYNC=true
      - RUN_GRAVITY=true
      - CRON=0 * * * *
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "panelio",
    name: "Panelio",
    description:
      "Self-hosted services dashboard with a built-in web admin UI. Forked from Homepage, it adds web-based management for services, bookmarks, widgets, and settings — no more hand-editing YAML.",
    category: "Management",
    tags: ["Dashboard", "Homepage", "Management", "Services"],
    githubUrl: "https://github.com/Vellis59/panelio",
    icon: "https://raw.githubusercontent.com/Vellis59/panelio/main/public/logo.svg",
    composeContent: `services:
  panelio:
    image: ghcr.io/vellis59/panelio:latest
    container_name: \${CONTAINER_PREFIX}panelio
    ports:
      - "3011:3000"
    environment:
      - HOMEPAGE_ALLOWED_HOSTS=localhost
      - PANELIO_ADMIN_PASSWORD=\${PANELIO_ADMIN_PASSWORD}
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
    volumes:
      - \${CONFIG_PATH}/panelio:/app/config
      - /var/run/docker.sock:/var/run/docker.sock:ro
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "autoxpose",
    name: "Autoxpose",
    description:
      "Automatic DNS and reverse proxy configuration for Docker containers. Add a label to your container and autoxpose creates the DNS record and configures your reverse proxy with SSL — no manual setup required.",
    category: "Networking",
    tags: ["DNS", "Reverse Proxy", "Automation", "SSL"],
    githubUrl: "https://github.com/mostafa-wahied/autoxpose",
    icon: "https://github.com/mostafa-wahied/autoxpose/raw/main/packages/frontend/public/autoxpose-logo.svg",
    composeContent: `services:
  autoxpose:
    image: mostafawahied/autoxpose:latest
    container_name: \${CONTAINER_PREFIX}autoxpose
    ports:
      - "4949:3000"
    environment:
      - SERVER_IP=\${SERVER_IP}
      - LAN_IP=\${LAN_IP}
    volumes:
      - \${DATA_PATH}/autoxpose:/app/packages/backend/data
      - /var/run/docker.sock:/var/run/docker.sock:ro
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "portracker",
    name: "Portracker",
    description:
      "Open-source, self-hosted dashboard for homelabs and Docker environments that automatically discovers services and their ports. Provides a real-time network map and prevents port conflicts. Note: Requires elevated privileges (host PID namespace, SYS_PTRACE capability).",
    category: "Networking",
    tags: ["Monitoring", "Dashboard", "Network", "Ports", "Docker"],
    githubUrl: "https://github.com/mostafa-wahied/portracker",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/portracker.svg",
    composeContent: `services:
  portracker:
    image: mostafawahied/portracker:latest
    container_name: \${CONTAINER_PREFIX}portracker
    pid: "host"
    cap_add:
      - SYS_PTRACE
      - SYS_ADMIN
    security_opt:
      - apparmor:unconfined
    ports:
      - "4999:4999"
    volumes:
      - \${DATA_PATH}/portracker:/data
      - /var/run/docker.sock:/var/run/docker.sock:ro
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "zoraxy",
    name: "Zoraxy",
    description:
      "All-in-one homelab network tool providing reverse proxy, HTTP redirections, geo-IP blocking, global area network, web SSH terminal, real-time statistics, and port scanning utilities. Note: Uses ports 80/443/8000 — ensure no other reverse proxy (nginx, caddy, traefik) or portainer is running on those ports.",
    category: "Networking",
    tags: ["Reverse Proxy", "DNS", "SSL", "Network", "Security"],
    githubUrl: "https://github.com/tobychui/zoraxy",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/zoraxy.svg",
    composeContent: `services:
  zoraxy:
    image: zoraxydocker/zoraxy:latest
    container_name: \${CONTAINER_PREFIX}zoraxy
    ports:
      - "8000:8000"
      - "80:80"
      - "443:443"
    environment:
      - FASTGEOIP=true
      - TZ=\${TZ}
    volumes:
      - \${CONFIG_PATH}/zoraxy:/opt/zoraxy/config
      - /var/run/docker.sock:/var/run/docker.sock:ro
    extra_hosts:
      - "host.docker.internal:host-gateway"
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "arcane",
    name: "Arcane",
    description:
      "Simple and elegant Docker Management UI written in TypeScript and SvelteKit. Provides an intuitive interface for managing Docker containers, images, volumes, networks, and stacks.",
    category: "Management",
    tags: ["UI", "Management", "Docker", "Dashboard"],
    githubUrl: "https://github.com/ofkm/arcane",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/arcane.svg",
    composeContent: `services:
  arcane:
    image: ghcr.io/ofkm/arcane:latest
    container_name: \${CONTAINER_PREFIX}arcane
    ports:
      - "3000:3000"
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - APP_ENV=production
      - PUBLIC_SESSION_SECRET=\${PUBLIC_SESSION_SECRET}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - \${DATA_PATH}/arcane:/app/data
    restart: \${RESTART_POLICY}`,
  },
]
