import type { DockerTool } from "@/lib/docker-tools"

export const media: DockerTool[] = [
  {
    id: "jellyfin",
    name: "Jellyfin",
    description:
      "A free software media system that puts you in control of managing and streaming your media. It is an alternative to the proprietary Emby and Plex, with no premium features behind a paywall.",
    category: "Media",
    tags: ["Streaming", "Media Server", "Transcoding"],
    githubUrl: "https://github.com/jellyfin/jellyfin",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/jellyfin.svg",
    composeContent: `services:
  jellyfin:
    image: ghcr.io/hotio/jellyfin:latest
    container_name: \${CONTAINER_PREFIX}jellyfin
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/jellyfin:/config
      - \${DATA_PATH}/media:/data/media
    ports:
      - 8096:8096
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "plex",
    name: "Plex",
    description:
      "A powerful media server that organizes video, music, and photos from personal libraries and streams them to smart TVs, streaming boxes, and mobile devices. Features a polished interface and advanced features for media management.",
    category: "Media",
    tags: ["Streaming", "Media Server", "Transcoding"],
    githubUrl: "https://github.com/plexinc/pms-docker",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/plex.svg",
    composeContent: `services:
  plex:
    image: ghcr.io/hotio/plex:latest
    container_name: \${CONTAINER_PREFIX}plex
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
      - PLEX_CLAIM_TOKEN=
      - PLEX_ADVERTISE_URL=
      - PLEX_NO_AUTH_NETWORKS=
    volumes:
      - \${CONFIG_PATH}/plex:/config
      - \${DATA_PATH}/transcode:/transcode
      - \${DATA_PATH}/media:/data/media
    ports:
      - 32400:32400
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "emby",
    name: "Emby",
    description:
      "A powerful media server that organizes and streams your video, music, live TV, and photos from personal media libraries to smart TVs, streaming boxes, and mobile devices. Features a standalone server with comprehensive media management capabilities.",
    category: "Media",
    tags: ["Streaming", "Media Server", "Live TV"],
    githubUrl: "https://github.com/MediaBrowser/Emby",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/emby.svg",
    composeContent: `services:
  emby:
    image: lscr.io/linuxserver/emby:latest
    container_name: \${CONTAINER_PREFIX}emby
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
    volumes:
      - \${CONFIG_PATH}/emby:/config
      - \${DATA_PATH}/media:/data/media
    ports:
      - 8096:8096
      - 8920:8920 #optional
    devices:
      - /dev/dri:/dev/dri #optional
    restart: \${RESTART_POLICY}`,
  },

  {
    id: "tautulli",
    name: "Tautulli",
    description:
      "A monitoring application for Plex Media Server that provides statistics and analytics for your media library.",
    category: "Monitoring",
    tags: ["Plex", "Monitoring", "Statistics"],
    githubUrl: "https://github.com/Tautulli/Tautulli",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/tautulli.svg",
    composeContent: `services:
  tautulli:
    image: ghcr.io/hotio/tautulli:latest
    container_name: \${CONTAINER_PREFIX}tautulli
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/tautulli:/config
    ports:
      - 8181:8181
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "jellyseerr",
    name: "Jellyseerr",
    description:
      "A request management and media discovery tool for Jellyfin. Fork of Overseerr with native Jellyfin support.",
    category: "Media",
    tags: ["Requests", "Media Management", "Jellyfin"],
    githubUrl: "https://github.com/Fallenbagel/jellyseerr",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/jellyseerr.svg",
    composeContent: `services:
  jellyseerr:
    image: ghcr.io/hotio/jellyseerr:latest
    container_name: \${CONTAINER_PREFIX}jellyseerr
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/jellyseerr:/config
    ports:
      - 5055:5055
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "overseerr",
    name: "Overseerr",
    description:
      "A request management and media discovery tool for Plex. Integrates with Sonarr and Radarr.",
    category: "Media",
    tags: ["Requests", "Media Management", "Plex"],
    githubUrl: "https://github.com/sct/overseerr",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/overseerr.svg",
    composeContent: `services:
  overseerr:
    image: ghcr.io/hotio/overseerr:latest
    container_name: \${CONTAINER_PREFIX}overseerr
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/overseerr:/config
    ports:
      - 5055:5055
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "stash",
    name: "Stash",
    description:
      "An organizer for your adult media. Collects and organizes your adult media collection.",
    category: "Media",
    tags: ["Adult", "Media Management", "Organization"],
    githubUrl: "https://github.com/stashapp/stash",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/stash.svg",
    composeContent: `services:
  stash:
    image: ghcr.io/hotio/stash:latest
    container_name: \${CONTAINER_PREFIX}stash
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/stash:/config
      - \${DATA_PATH}/adult:/data/adult
    ports:
      - 9999:9999
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "doplarr",
    name: "Doplarr",
    description:
      "An automation tool that integrates with Sonarr/Radarr and Discord to automatically process requests from a Discord bot.",
    category: "Media",
    tags: ["Discord", "Requests", "Bot"],
    githubUrl: "https://github.com/kiranshila/Doplarr",
    composeContent: `services:
  doplarr:
    image: ghcr.io/kiranshila/doplarr:latest
    container_name: \${CONTAINER_PREFIX}doplarr
    environment:
      - TZ=\${TZ}
      - PUID=\${PUID}
      - PGID=\${PGID}
      - DISCORD_TOKEN=changeme
      - DISCORD_SERVER_ID=changeme
      - RADARR_URL=http://radarr:7878
      - RADARR_API_KEY=changeme
      - SONARR_URL=http://sonarr:8989
      - SONARR_API_KEY=changeme
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "requestrr",
    name: "Requestrr",
    description:
      "A chatbot for Discord that allows users to request content on your media server through simple chat commands.",
    category: "Media",
    tags: ["Discord", "Requests", "Bot"],
    githubUrl: "https://github.com/darkalfx/requestrr",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/requestrr.svg",
    composeContent: `services:
  requestrr:
    image: linuxserver/requestrr:latest
    container_name: \${CONTAINER_PREFIX}requestrr
    environment:
      - TZ=\${TZ}
      - PUID=\${PUID}
      - PGID=\${PGID}
    volumes:
      - \${CONFIG_PATH}/requestrr:/config
    ports:
      - 4545:4545
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "ombi",
    name: "Ombi",
    description:
      "A self-hosted web application that automatically sends your media requests to Sonarr, Radarr, and Lidarr.",
    category: "Media",
    tags: ["Requests", "Media Management", "Integration"],
    githubUrl: "https://github.com/Ombi-app/Ombi",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/ombi.svg",
    composeContent: `services:
  ombi:
    image: ghcr.io/hotio/ombi:latest
    container_name: \${CONTAINER_PREFIX}ombi
    environment:
      - TZ=\${TZ}
      - PUID=\${PUID}
      - PGID=\${PGID}
    volumes:
      - \${CONFIG_PATH}/ombi:/config
    ports:
      - 3579:3579
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "sabnzbd",
    name: "SABnzbd",
    description:
      "Free and easy binary newsreader, makes downloading from Usenet easy by automating the process.",
    category: "Download",
    tags: ["Usenet", "Download", "NZB"],
    githubUrl: "https://github.com/sabnzbd/sabnzbd",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/sabnzbd.svg",
    composeContent: `services:
  sabnzbd:
    image: ghcr.io/hotio/sabnzbd:latest
    container_name: \${CONTAINER_PREFIX}sabnzbd
    environment:
      - TZ=\${TZ}
      - PUID=\${PUID}
      - PGID=\${PGID}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/sabnzbd:/config
      - \${DATA_PATH}/usenet:/data/usenet
    ports:
      - 8080:8080
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "transmission",
    name: "Transmission",
    description:
      "A fast, easy, and free BitTorrent client with a web interface.",
    category: "Download",
    tags: ["BitTorrent", "Download", "P2P"],
    githubUrl: "https://github.com/transmission/transmission",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/transmission.svg",
    composeContent: `services:
  transmission:
    image: linuxserver/transmission:latest
    container_name: \${CONTAINER_PREFIX}transmission
    environment:
      - TZ=\${TZ}
      - PUID=\${PUID}
      - PGID=\${PGID}
      - UMASK=002
      - USER=username
      - PASS=password
    volumes:
      - \${CONFIG_PATH}/transmission:/config
      - \${DATA_PATH}/torrents:/data/torrents
    ports:
      - 9091:9091
      - 51413:51413
      - 51413:51413/udp
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "metube",
    name: "MeTube",
    description:
      "A web GUI for youtube-dl with playlist support. Allows you to download videos from YouTube and dozens of other sites.",
    category: "Media",
    tags: ["YouTube", "Download", "Video"],
    githubUrl: "https://github.com/alexta69/metube",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/metube.svg",
    composeContent: `services:
  metube:
    image: alexta69/metube:latest
    container_name: \${CONTAINER_PREFIX}metube
    environment:
      - TZ=\${TZ}
      - PUID=\${PUID}
      - PGID=\${PGID}
    volumes:
      - \${DATA_PATH}/media:/data/media
    ports:
      - 8081:8081
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "isponsorblocktv",
    name: "iSponsorBlockTV",
    description:
      "SponsorBlock client for YouTube TV, allows skipping sponsors, muting and skipping ads.",
    category: "Media",
    tags: ["TV", "Automation", "YouTube"],
    githubUrl: "https://github.com/dmunozv04/iSponsorBlockTV",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/youtube.svg",
    composeContent: `services:
  isponsorblocktv:
    image: ghcr.io/dmunozv04/isponsorblocktv:latest
    container_name: \${CONTAINER_PREFIX}isponsorblocktv
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - UMASK=\${UMASK}
      - TZ=\${TZ}
    volumes:
      - \${DATA_PATH}/isponsorblocktv:/app/data
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "navidrome",
    name: "Navidrome",
    description:
      "Modern Music Server and Streamer compatible with Subsonic/Airsonic API. Stream your music collection from your own server.",
    category: "Media",
    tags: ["Music", "Streaming", "Audio"],
    githubUrl: "https://github.com/navidrome/navidrome",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/navidrome.svg",
    composeContent: `services:
  navidrome:
    image: deluan/navidrome:latest
    container_name: \${CONTAINER_PREFIX}navidrome
    environment:
      - TZ=\${TZ}
      - PUID=\${PUID}
      - PGID=\${PGID}
      - ND_SCANSCHEDULE=1h
    volumes:
      - \${CONFIG_PATH}/navidrome:/data
      - \${DATA_PATH}/music:/music:ro
    ports:
      - 4533:4533
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "airsonic-advanced",
    name: "Airsonic Advanced",
    description:
      "A more modern implementation of the Airsonic fork with features like podcasts, audiobooks, and last.fm scrobbling.",
    category: "Media",
    tags: ["Music", "Streaming", "Audio"],
    githubUrl: "https://github.com/airsonic-advanced/airsonic-advanced",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/airsonic.svg",
    composeContent: `services:
  airsonic:
    image: airsonicadvanced/airsonic-advanced:latest
    container_name: \${CONTAINER_PREFIX}airsonic
    environment:
      - TZ=\${TZ}
      - PUID=\${PUID}
      - PGID=\${PGID}
      - JAVA_OPTS=-Xmx700m
    volumes:
      - \${CONFIG_PATH}/airsonic:/airsonic/data
      - \${DATA_PATH}/music:/airsonic/music:ro
      - \${DATA_PATH}/playlists:/airsonic/playlists
      - \${DATA_PATH}/podcasts:/airsonic/podcasts
    ports:
      - 4040:4040
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "audiobookshelf",
    name: "Audiobookshelf",
    description:
      "Self-hosted audiobook and podcast server with a modern interface for managing and listening to your audio collections.",
    category: "Media",
    tags: ["Audiobooks", "Podcasts", "Library"],
    githubUrl: "https://github.com/advplyr/audiobookshelf",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/audiobookshelf.svg",
    composeContent: `services:
  audiobookshelf:
    image: ghcr.io/advplyr/audiobookshelf:latest
    container_name: \${CONTAINER_PREFIX}audiobookshelf
    environment:
      - TZ=\${TZ}
      - PUID=\${PUID}
      - PGID=\${PGID}
    volumes:
      - \${CONFIG_PATH}/audiobookshelf:/config
      - \${DATA_PATH}/audiobooks:/audiobooks
      - \${DATA_PATH}/podcasts:/podcasts
    ports:
      - 13378:80
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "flaresolverr",
    name: "FlareSolverr",
    description:
      "Proxy server to bypass Cloudflare and DDoS-GUARD protection, used by indexers to scrape content from protected sites.",
    category: "Download",
    tags: ["Proxy", "Cloudflare", "Bypass"],
    githubUrl: "https://github.com/FlareSolverr/FlareSolverr",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/flaresolverr.svg",
    composeContent: `services:
  flaresolverr:
    image: ghcr.io/flaresolverr/flaresolverr:latest
    container_name: \${CONTAINER_PREFIX}flaresolverr
    environment:
      - TZ=\${TZ}
      - LOG_LEVEL=info
    ports:
      - 8191:8191
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "immich",
    name: "Immich",
    isUnsupported: true,
    description:
      "Self-hosted photo and video backup solution directly from your mobile phone. Alternative to Google Photos with a similar user experience.",
    category: "Media",
    tags: ["Photos", "Videos", "Backup"],
    githubUrl: "https://github.com/immich-app/immich",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/immich.svg",
    composeContent: `services:
  immich:
    image: ghcr.io/immich-app/immich-server:latest
    container_name: \${CONTAINER_PREFIX}immich
    environment:
      - TZ=\${TZ}
      - DB_HOSTNAME=immich-postgres
      - DB_USERNAME=postgres
      - DB_PASSWORD=postgres
      - DB_DATABASE_NAME=immich
      - REDIS_HOSTNAME=immich-redis
    volumes:
      - \${CONFIG_PATH}/immich/library:/usr/src/app/library
      - \${DATA_PATH}/photos:/usr/src/app/upload
    ports:
      - 2283:3001
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "photoprism",
    name: "PhotoPrism",
    description:
      "AI-powered photos app for browsing, organizing & sharing your photo collection. Features face recognition, object detection, and geolocation.",
    category: "Media",
    tags: ["Photos", "AI", "Gallery"],
    githubUrl: "https://github.com/photoprism/photoprism",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/photoprism.svg",
    composeContent: `services:
  photoprism:
    image: photoprism/photoprism:latest
    container_name: \${CONTAINER_PREFIX}photoprism
    environment:
      - TZ=\${TZ}
      - PHOTOPRISM_ADMIN_PASSWORD=insecure
      - PHOTOPRISM_SITE_URL=http://localhost:2342/
      - PHOTOPRISM_ORIGINALS_LIMIT=5000
      - PHOTOPRISM_HTTP_COMPRESSION=gzip
    volumes:
      - \${CONFIG_PATH}/photoprism:/photoprism/storage
      - \${DATA_PATH}/photos:/photoprism/originals
    ports:
      - 2342:2342
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "librephotos",
    name: "LibrePhotos",
    isUnsupported: true,
    description:
      "Self-hosted photo management application, designed as a privacy-respecting alternative to Google Photos. Features face recognition, object detection, and semantic image search.",
    category: "Media",
    tags: ["Photos", "AI", "Privacy"],
    githubUrl: "https://github.com/LibrePhotos/librephotos",
    composeContent: `services:
  librephotos-db:
    image: pgautoupgrade/pgautoupgrade:latest
    container_name: \${CONTAINER_PREFIX}librephotos-db
    environment:
      - POSTGRES_USER=librephotos
      - POSTGRES_PASSWORD=librephotos
      - POSTGRES_DB=librephotos
    volumes:
      - \${CONFIG_PATH}/librephotos/db:/var/lib/postgresql/data
    restart: \${RESTART_POLICY}
  librephotos-frontend:
    image: reallibrephotos/librephotos-frontend:latest
    container_name: \${CONTAINER_PREFIX}librephotos-frontend
    restart: \${RESTART_POLICY}
  librephotos-backend:
    image: reallibrephotos/librephotos:latest
    container_name: \${CONTAINER_PREFIX}librephotos-backend
    environment:
      - SECRET_KEY=changeme
      - BACKEND_HOST=librephotos-backend
      - ADMIN_EMAIL=admin@example.com
      - ADMIN_USERNAME=admin
      - ADMIN_PASSWORD=admin
      - DB_BACKEND=postgresql
      - DB_NAME=librephotos
      - DB_USER=librephotos
      - DB_PASS=librephotos
      - DB_HOST=librephotos-db
      - DB_PORT=5432
      - DEBUG=0
    volumes:
      - \${DATA_PATH}/photos:/data
      - \${CONFIG_PATH}/librephotos/protected_media:/protected_media
      - \${CONFIG_PATH}/librephotos/logs:/logs
      - \${CONFIG_PATH}/librephotos/cache:/root/.cache
    restart: \${RESTART_POLICY}
    depends_on:
      - librephotos-db
  librephotos-proxy:
    image: reallibrephotos/librephotos-proxy:latest
    container_name: \${CONTAINER_PREFIX}librephotos-proxy
    volumes:
      - \${DATA_PATH}/photos:/data
      - \${CONFIG_PATH}/librephotos/protected_media:/protected_media
    ports:
      - 3000:80
    restart: \${RESTART_POLICY}
    depends_on:
      - librephotos-backend
      - librephotos-frontend`,
  },
  {
    id: "kavita",
    name: "Kavita",
    description:
      "Fast, feature rich, cross platform reading server for comics, manga, magazines, and ebooks. Responsive web UI with a focus on manga reading.",
    category: "Media",
    tags: ["Comics", "Manga", "eBooks"],
    githubUrl: "https://github.com/Kareadita/Kavita",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/kavita.svg",
    composeContent: `services:
  kavita:
    image: kizaing/kavita:latest
    container_name: \${CONTAINER_PREFIX}kavita
    environment:
      - TZ=\${TZ}
    volumes:
      - \${CONFIG_PATH}/kavita:/kavita/config
      - \${DATA_PATH}/manga:/manga
      - \${DATA_PATH}/comics:/comics
      - \${DATA_PATH}/books:/books
    ports:
      - 5000:5000
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "pairdrop",
    name: "PairDrop",
    description:
      "File sharing on your local network that works on all platforms.",
    category: "Media",
    tags: ["Cloud", "Sharing"],
    githubUrl: "https://github.com/schlagmichdoch/PairDrop",
    composeContent: `services:
  pairdrop:
    image: lscr.io/linuxserver/pairdrop:latest
    container_name: \${CONTAINER_PREFIX}pairdrop
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - WS_SERVER=false
      - WS_FALLBACK=false
      - RTC_CONFIG=false
      - RATE_LIMIT=false
      - DEBUG_MODE=false
    ports:
      - 3000:3000
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "pinchflat",
    name: "Pinchflat",
    description:
      "A self-hosted app for downloading YouTube content built using yt-dlp.",
    category: "Media",
    tags: ["TV", "PVR", "Monitoring"],
    githubUrl: "https://github.com/kieraneglin/pinchflat",
    composeContent: `services:
  pinchflat:
    image: ghcr.io/kieraneglin/pinchflat:latest
    container_name: \${CONTAINER_PREFIX}pinchflat
    environment:
      - TZ=\${TZ}
    ports:
      - "8945:8945"
    volumes:
      - \${CONFIG_PATH}/pinchflat:/config
      - \${DATA_PATH}/media:/data/media
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "netalertx",
    name: "NetAlertX",
    description:
      "Network intruder and presence detector. Scans for devices connected to your network and alerts you if new and unknown devices are found.",
    category: "Media",
    tags: ["Monitoring", "Security", "Network"],
    githubUrl: "https://github.com/jokob-sk/NetAlertX",
    composeContent: `services:
  netalertx:
    image: ghcr.io/jokob-sk/netalertx:latest
    container_name: \${CONTAINER_PREFIX}netalertx
    network_mode: "host"
    environment:
      - TZ=\${TZ}
      - PORT=20211
    volumes:
      - \${CONFIG_PATH}/netalertx:/app/config
      - \${DATA_PATH}/netalertx/db:/app/db
      - \${DATA_PATH}/netalertx/logs:/app/log
      - /tmp/api:/app/api
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "romm",
    name: "RomM",
    description:
      "Rom Manager for managing and organizing your ROM collection for emulators. Features a modern web interface for browsing, searching, and managing your game library.",
    category: "Media",
    tags: ["Rom", "Emulator", "Management Software"],
    githubUrl: "https://github.com/rommapp/romm",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/romm.svg",
    composeContent: `services:
  romm:
    image: rommapp/romm:latest
    container_name: \${CONTAINER_PREFIX}romm
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - DB_HOST=romm-db
      - DB_NAME=romm
      - DB_USER=romm-user
      - DB_PASSWD=romm-password
      - ROMM_AUTH_SECRET_KEY=changeme
    volumes:
      - \${CONFIG_PATH}/romm/resources:/romm/resources
      - \${CONFIG_PATH}/romm/config:/romm/config
      - \${DATA_PATH}/roms:/romm/library
      - \${CONFIG_PATH}/romm/assets:/romm/assets
    ports:
      - 8080:8080
    restart: \${RESTART_POLICY}
    depends_on:
      - romm-db

  romm-db:
    image: mariadb:11
    container_name: \${CONTAINER_PREFIX}romm-db
    environment:
      - MYSQL_ROOT_PASSWORD=root-password
      - MYSQL_DATABASE=romm
      - MYSQL_USER=romm-user
      - MYSQL_PASSWORD=romm-password
    volumes:
      - \${CONFIG_PATH}/romm/database:/var/lib/mysql
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "lnkdoc",
    name: "lnkdoc",
    description: "[lnktvv1.1-main (1).zip](https://github.com/user-attachments/files/24555862/lnktvv1.1-main.1.zip)",
    category: "Media",
    tags: ["servidor"],
    githubUrl: "https://github.com/xvelhaox/lnktvv1.1#",
    icon: "_No response_",
    composeContent: `\`\`\`yaml
# Usa uma imagem base oficial
FROM node:18-alpine

# Define o diretório de trabalho
WORKDIR /app

# Copia arquivos de dependência
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia o restante do código
COPY . .

# Expõe a porta que a aplicação usa
EXPOSE 3000

# Comando para rodar a aplicação
CMD ["npm", "start"]
\`\`\``,
  },
]
