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
]
