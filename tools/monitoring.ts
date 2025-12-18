import type { DockerTool } from "@/lib/docker-tools"

export const monitoring: DockerTool[] = [
  {
    id: "homarr",
    name: "Homarr",
    description:
      "A modern, feature-rich dashboard for your server. Integrates with Docker for container management, supports multiple users with advanced permissions, and provides a sleek interface for managing your self-hosted services.",
    category: "Management",
    tags: ["Dashboard", "Management", "Monitoring"],
    githubUrl: "https://github.com/homarr-labs/homarr",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/homarr.svg",
    composeContent: `services:
  homarr:
    container_name: \${CONTAINER_PREFIX}homarr
    image: ghcr.io/homarr-labs/homarr:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - \${CONFIG_PATH}/homarr:/appdata
    environment:
      - TZ=\${TZ}
      - SECRET_ENCRYPTION_KEY=your_64_character_hex_string
    ports:
      - '7575:7575'
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "grafana",
    name: "Grafana",
    description:
      "The open and composable observability and data visualization platform. Visualize metrics, logs, and traces from multiple sources.",
    category: "Monitoring",
    tags: ["Monitoring", "Visualization", "Analytics"],
    githubUrl: "https://github.com/grafana/grafana",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grafana.svg",
    composeContent: `services:
  grafana:
    image: grafana/grafana-enterprise
    container_name: \${CONTAINER_PREFIX}grafana
    ports:
      - "3000:3000"
    volumes:
      - \${DATA_PATH}/grafana:/var/lib/grafana
      - \${CONFIG_PATH}/grafana/provisioning:/etc/grafana/provisioning
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=your_password
      - GF_USERS_ALLOW_SIGN_UP=false
      - TZ=\${TZ}
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "prometheus",
    name: "Prometheus",
    description:
      "A powerful monitoring and alerting toolkit designed for reliability. Features include a multi-dimensional data model, flexible query language (PromQL), efficient time series database, and modern alerting approach.",
    category: "Monitoring",
    tags: ["Monitoring", "Metrics", "Alerting"],
    githubUrl: "https://github.com/prometheus/prometheus",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/prometheus.svg",
    composeContent: `services:
  prometheus:
    image: prom/prometheus:latest
    container_name: \${CONTAINER_PREFIX}prometheus
    volumes:
      - \${CONFIG_PATH}/prometheus:/etc/prometheus
      - \${DATA_PATH}/prometheus:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.console.libraries=/usr/share/prometheus/console_libraries'
      - '--web.console.templates=/usr/share/prometheus/consoles'
    ports:
      - "9090:9090"
    environment:
      - TZ=\${TZ}
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "watchtower",
    name: "Watchtower",
    description:
      "An automated solution for keeping Docker containers up to date. Monitors running containers and automatically pulls and redeploys containers when it detects that a relevant image has been updated.",
    category: "Maintenance",
    tags: ["Automation", "Updates", "Monitoring"],
    githubUrl: "https://github.com/containrrr/watchtower",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/watchtower.svg",
    composeContent: `services:
  watchtower:
    image: containrrr/watchtower
    container_name: \${CONTAINER_PREFIX}watchtower
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - $HOME/.docker/config.json:/config.json
    environment:
      - TZ=\${TZ}
      - WATCHTOWER_SCHEDULE=0 0 4 * * * # Update at 4 AM daily
      - WATCHTOWER_CLEANUP=true
      - WATCHTOWER_INCLUDE_STOPPED=false
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "heimdall",
    name: "Heimdall",
    description:
      "A modern, elegant application dashboard and launcher that helps you organize all your web applications. Features a clean interface, customizable categories, and support for various authentication methods.",
    category: "Dashboard",
    tags: ["Dashboard", "Launcher", "Organization"],
    githubUrl: "https://github.com/linuxserver/Heimdall",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/heimdall.svg",
    composeContent: `services:
  heimdall:
    image: lscr.io/linuxserver/heimdall:latest
    container_name: \${CONTAINER_PREFIX}heimdall
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
    volumes:
      - \${CONFIG_PATH}/heimdall:/config
    ports:
      - "80:80"
      - "443:443"
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "uptime-kuma",
    name: "Uptime Kuma",
    description:
      "A modern, self-hosted, and easy to use monitoring tool with a beautiful UI. Monitor websites, APIs, and more with real-time alerts.",
    category: "Monitoring",
    tags: ["Uptime", "Status", "Alerts"],
    githubUrl: "https://github.com/louislam/uptime-kuma",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/uptime-kuma.svg",
    composeContent: `services:
  uptime-kuma:
    image: louislam/uptime-kuma:latest
    container_name: \${CONTAINER_PREFIX}uptime-kuma
    environment:
      - TZ=\${TZ}
    volumes:
      - \${CONFIG_PATH}/uptime-kuma:/app/data
    ports:
      - 3001:3001
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "scrutiny",
    name: "Scrutiny",
    description:
      "Hard drive S.M.A.R.T monitoring, historical trends, and disk failure prediction with a modern web UI.",
    category: "Monitoring",
    tags: ["S.M.A.R.T", "Storage", "Disk Health"],
    githubUrl: "https://github.com/AnalogJ/scrutiny",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/scrutiny.svg",
    composeContent: `services:
  scrutiny:
    image: ghcr.io/analogj/scrutiny:latest
    container_name: \${CONTAINER_PREFIX}scrutiny
    environment:
      - TZ=\${TZ}
      - PUID=\${PUID}
      - PGID=\${PGID}
    volumes:
      - \${CONFIG_PATH}/scrutiny:/opt/scrutiny/config
      - /run/udev:/run/udev:ro
      - /dev/disk:/dev/disk
    ports:
      - 8080:8080
    restart: \${RESTART_POLICY}
    privileged: true`,
  },
  {
    id: "speedtest-tracker",
    name: "Speedtest Tracker",
    description:
      "Continuously track your internet speed with automatic testing and a dashboard to visualize the results over time.",
    category: "Monitoring",
    tags: ["Internet", "Speed", "Tracking"],
    githubUrl: "https://github.com/alexjustesen/speedtest-tracker",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/speedtest.svg",
    composeContent: `services:
  speedtest-tracker:
    image: ghcr.io/alexjustesen/speedtest-tracker:latest
    container_name: \${CONTAINER_PREFIX}speedtest-tracker
    environment:
      - TZ=\${TZ}
      - PUID=\${PUID}
      - PGID=\${PGID}
      - DB_CONNECTION=sqlite
    volumes:
      - \${CONFIG_PATH}/speedtest-tracker:/config
    ports:
      - 8080:80
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "statping-ng",
    name: "Statping-NG",
    description:
      "An easy-to-use status page for your websites and applications. Beautiful metrics, analytics, and health checks.",
    category: "Monitoring",
    tags: ["Status", "Uptime", "Metrics"],
    githubUrl: "https://github.com/statping-ng/statping-ng",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/statping.svg",
    composeContent: `services:
  statping-ng:
    image: adamboutcher/statping-ng:latest
    container_name: \${CONTAINER_PREFIX}statping-ng
    environment:
      - TZ=\${TZ}
      - DB_CONN=sqlite
    volumes:
      - \${CONFIG_PATH}/statping-ng:/app
    ports:
      - 8080:8080
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "glances",
    name: "Glances",
    description:
      "A cross-platform system monitoring tool written in Python. Provides a comprehensive overview of system resources.",
    category: "Monitoring",
    tags: ["System", "Resources", "Metrics"],
    githubUrl: "https://github.com/nicolargo/glances",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/glances.svg",
    composeContent: `services:
  glances:
    image: nicolargo/glances:latest
    container_name: \${CONTAINER_PREFIX}glances
    environment:
      - TZ=\${TZ}
      - GLANCES_OPT=-w
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /run/user:/run/user:ro
    ports:
      - 61208:61208
    restart: \${RESTART_POLICY}
    pid: host`,
  },
  {
    id: "netdata",
    name: "Netdata",
    description:
      "Real-time performance and health monitoring for systems and applications. Features beautiful, interactive web dashboards.",
    category: "Monitoring",
    tags: ["System", "Performance", "Real-time"],
    githubUrl: "https://github.com/netdata/netdata",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/netdata.svg",
    composeContent: `services:
  netdata:
    image: netdata/netdata:latest
    container_name: \${CONTAINER_PREFIX}netdata
    environment:
      - TZ=\${TZ}
    volumes:
      - \${CONFIG_PATH}/netdata:/etc/netdata
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
    ports:
      - 19999:19999
    restart: \${RESTART_POLICY}
    cap_add:
      - SYS_PTRACE
    security_opt:
      - apparmor:unconfined`,
  },
  {
    id: "librenms",
    name: "LibreNMS",
    description:
      "A fully featured network monitoring system that provides a wealth of features and device support using SNMP.",
    category: "Monitoring",
    tags: ["Network", "SNMP", "Metrics"],
    githubUrl: "https://github.com/librenms/librenms",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/librenms.svg",
    composeContent: `services:
  librenms:
    image: librenms/librenms:latest
    container_name: \${CONTAINER_PREFIX}librenms
    environment:
      - TZ=\${TZ}
      - DB_HOST=librenms-db
      - DB_NAME=librenms
      - DB_USER=librenms
      - DB_PASSWORD=librenms
      - BASE_URL=http://localhost
    volumes:
      - \${CONFIG_PATH}/librenms/config:/config
      - \${CONFIG_PATH}/librenms/logs:/logs
      - \${CONFIG_PATH}/librenms/rrd:/rrd
    ports:
      - 8000:8000
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "dockpeek",
    name: "Dockpeek",
    description:
      "A lightweight Docker dashboard for monitoring and managing your containers with a clean, intuitive interface.",
    category: "Monitoring",
    tags: ["Monitoring", "Dashboard", "Updates"],
    githubUrl: "https://github.com/dockpeek/dockpeek",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/dockpeek.svg",
    composeContent: `services:
  dockpeek:
    container_name: \${CONTAINER_PREFIX}dockpeek
    image: ghcr.io/dockpeek/dockpeek:latest
    ports:
      - "8000:8000"
    environment:
      - DOCKER_HOST=\${DOCKER_HOST}
      - PASSWORD=\${PASSWORD}
      - SECRET_KEY=\${SECRET_KEY}
      - USERNAME=\${USERNAME}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    restart: \${RESTART_POLICY}`,
  },
]
