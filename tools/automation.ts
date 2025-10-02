import type { DockerTool } from "@/lib/docker-tools"

export const automation: DockerTool[] = [
  {
    id: "sonarr",
    name: "Sonarr",
    description:
      "Smart PVR for usenet and bittorrent users. Monitors multiple RSS feeds for new TV show episodes, automatically grabbing, sorting, and renaming them.",
    category: "Media",
    tags: ["TV", "PVR", "Automation"],
    githubUrl: "https://github.com/Sonarr/Sonarr",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/sonarr.svg",
    composeContent: `services:
  sonarr:
    image: ghcr.io/hotio/sonarr:latest
    container_name: \${CONTAINER_PREFIX}sonarr
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/sonarr:/config
      - \${DATA_PATH}:/data
    ports:
      - 8989:8989
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "radarr",
    name: "Radarr",
    description:
      "A fork of Sonarr to work with movies. Automatically monitors and downloads movies, handles quality upgrades, and manages your movie collection with an elegant web interface.",
    category: "Media",
    tags: ["Movies", "PVR", "Automation"],
    githubUrl: "https://github.com/Radarr/Radarr",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/radarr.svg",
    composeContent: `services:
  radarr:
    image: ghcr.io/hotio/radarr:latest
    container_name: \${CONTAINER_PREFIX}radarr
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/radarr:/config
      - \${DATA_PATH}:/data
    ports:
      - 7878:7878
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "lidarr",
    name: "Lidarr",
    description:
      "A music collection manager for Usenet and BitTorrent users. It can monitor multiple RSS feeds for new albums from your favorite artists and will interface with clients and indexers to grab, sort, and rename them.",
    category: "Media",
    tags: ["Music", "PVR", "Automation"],
    githubUrl: "https://github.com/Lidarr/Lidarr",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/lidarr.svg",
    composeContent: `services:
  lidarr:
    image: ghcr.io/hotio/lidarr:latest
    container_name: \${CONTAINER_PREFIX}lidarr
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/lidarr:/config
      - \${DATA_PATH}:/data
    ports:
      - 8686:8686
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "readarr",
    name: "Readarr",
    description:
      "Book collection manager for Usenet and BitTorrent users. It integrates with clients such as SABnzbd, NZBGet, QBittorrent, and Deluge.",
    category: "Media",
    tags: ["Books", "PVR", "Automation"],
    githubUrl: "https://github.com/Readarr/Readarr",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/readarr.svg",
    composeContent: `services:
  readarr:
    image: ghcr.io/hotio/readarr:latest
    container_name: \${CONTAINER_PREFIX}readarr
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/readarr:/config
      - \${DATA_PATH}:/data
    ports:
      - 8787:8787
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "prowlarr",
    name: "Prowlarr",
    description:
      "A powerful indexer manager/proxy built on the arr stack. Seamlessly integrates with Sonarr, Radarr, Lidarr, and Readarr, supporting both Torrent Trackers and Usenet Indexers with centralized management.",
    category: "Media",
    tags: ["Indexer", "Proxy", "Integration"],
    githubUrl: "https://github.com/Prowlarr/Prowlarr",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/prowlarr.svg",
    composeContent: `services:
  prowlarr:
    image: ghcr.io/hotio/prowlarr:latest
    container_name: \${CONTAINER_PREFIX}prowlarr
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/prowlarr:/config
    ports:
      - 9696:9696
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "whisparr",
    name: "Whisparr",
    description:
      "An adult movie collection manager for Usenet and BitTorrent users.",
    category: "Media",
    tags: ["Adult", "Movies", "Automation"],
    githubUrl: "https://github.com/whisparr/whisparr",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/whisparr.svg",
    composeContent: `services:
  whisparr:
    image: ghcr.io/hotio/whisparr:latest
    container_name: \${CONTAINER_PREFIX}whisparr
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/whisparr:/config
      - \${DATA_PATH}:/data
    ports:
      - 6969:6969
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "nzbget",
    name: "NZBGet",
    description:
      "Efficient usenet downloader, optimized for reliability, completeness, and speed.",
    category: "Download",
    tags: ["Usenet", "Download", "NZB"],
    githubUrl: "https://github.com/nzbget/nzbget",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/nzbget.svg",
    composeContent: `services:
  nzbget:
    image: ghcr.io/hotio/nzbget:latest
    container_name: \${CONTAINER_PREFIX}nzbget
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/nzbget:/config
      - \${DATA_PATH}/usenet:/data/usenet
    ports:
      - 6789:6789
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "bazarr",
    name: "Bazarr",
    description:
      "A companion application to Sonarr and Radarr that manages and downloads subtitles.",
    category: "Media",
    tags: ["Subtitles", "Media", "Automation"],
    githubUrl: "https://github.com/morpheus65535/bazarr",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/bazarr.svg",
    composeContent: `services:
  bazarr:
    image: ghcr.io/hotio/bazarr:latest
    container_name: \${CONTAINER_PREFIX}bazarr
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/bazarr:/config
      - \${DATA_PATH}/media:/data/media
    ports:
      - 6767:6767
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "jackett",
    name: "Jackett",
    description:
      "API Support for your favorite torrent trackers, translating searches into tracker-site-specific queries.",
    category: "Download",
    tags: ["Indexer", "Proxy", "Torrent"],
    githubUrl: "https://github.com/Jackett/Jackett",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/jackett.svg",
    composeContent: `services:
  jackett:
    image: ghcr.io/hotio/jackett:latest
    container_name: \${CONTAINER_PREFIX}jackett
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/jackett:/config
    ports:
      - 9117:9117
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "qbittorrent",
    name: "qBittorrent",
    description:
      "A cross-platform BitTorrent client with an integrated web interface.",
    category: "Download",
    tags: ["BitTorrent", "Download", "P2P"],
    githubUrl: "https://github.com/qbittorrent/qBittorrent",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/qbittorrent.svg",
    composeContent: `services:
  qbittorrent:
    image: ghcr.io/hotio/qbittorrent:latest
    container_name: \${CONTAINER_PREFIX}qbittorrent
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
      - WEBUI_PORT=8080
    volumes:
      - \${CONFIG_PATH}/qbittorrent:/config
      - \${DATA_PATH}/torrents:/data/torrents
    ports:
      - 8080:8080
      - 6881:6881
      - 6881:6881/udp
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "nzbhydra2",
    name: "NZBHydra 2",
    description:
      "NZBHydra 2 is a meta search for newznab indexers and torznab trackers.",
    category: "Download",
    tags: ["Usenet", "Indexer", "Aggregator"],
    githubUrl: "https://github.com/theotherp/nzbhydra2",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/nzbhydra.png",
    composeContent: `services:
  nzbhydra2:
    image: ghcr.io/hotio/nzbhydra2:latest
    container_name: \${CONTAINER_PREFIX}nzbhydra2
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/nzbhydra2:/config
    ports:
      - 5076:5076
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "qbitmanage",
    name: "qBitManage",
    description: "A tool to manage qBittorrent and automate cross-seeding.",
    category: "Download",
    tags: ["BitTorrent", "Management", "Automation"],
    githubUrl: "https://github.com/StuffAnThings/qbit_manage",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/qbittorrent.svg",
    composeContent: `services:
  qbitmanage:
    image: ghcr.io/hotio/qbitmanage:latest
    container_name: \${CONTAINER_PREFIX}qbitmanage
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/qbitmanage:/config
      - \${DATA_PATH}/torrents:/data/torrents
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "rflood",
    name: "rFlood",
    description:
      "A custom version of Flood with additional ruTorrent-like functionality.",
    category: "Download",
    tags: ["BitTorrent", "Web Interface", "Download"],
    githubUrl: "https://github.com/jesec/flood",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/flood.svg",
    composeContent: `services:
  rflood:
    image: ghcr.io/hotio/rflood:latest
    container_name: \${CONTAINER_PREFIX}rflood
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/rflood:/config
      - \${DATA_PATH}/torrents:/data/torrents
    ports:
      - 3000:3000
      - 50000:50000
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "unpackerr",
    name: "Unpackerr",
    description:
      "Extracts archives for various media server software like Sonarr, Radarr, Lidarr, etc.",
    category: "Media",
    tags: ["Extraction", "Automation", "Archive"],
    githubUrl: "https://github.com/davidnewhall/unpackerr",
    icon: "https://unpackerr.zip/img/logo.png",
    composeContent: `services:
  unpackerr:
    image: ghcr.io/hotio/unpackerr:latest
    container_name: \${CONTAINER_PREFIX}unpackerr
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/unpackerr:/config
      - \${DATA_PATH}:/data
    restart: \${RESTART_POLICY}`,
  },
]
