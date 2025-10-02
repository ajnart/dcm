import type { DockerTool } from "@/lib/docker-tools"

export const other: DockerTool[] = [
  {
    id: "nextcloud",
    name: "Nextcloud",
    description: "A safe home for all your data.",
    category: "Storage",
    tags: ["Cloud Storage", "File Sharing", "Collaboration"],
    githubUrl: "https://github.com/nextcloud/server",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/nextcloud.svg",
    composeContent: `services:
  nextcloud:
    image: nextcloud:latest
    container_name: \${CONTAINER_PREFIX}nextcloud
    ports:
      - "8080:80"
    volumes:
      - \${CONFIG_PATH}/nextcloud/html:/var/www/html
      - \${CONFIG_PATH}/nextcloud/apps:/var/www/html/custom_apps
      - \${CONFIG_PATH}/nextcloud/config:/var/www/html/config
      - \${DATA_PATH}/nextcloud:/var/www/html/data
    environment:
      - MYSQL_HOST=nextclouddb
      - MYSQL_DATABASE=nextcloud
      - MYSQL_USER=nextcloud
      - MYSQL_PASSWORD=nextcloud_db_password
      - NEXTCLOUD_ADMIN_USER=admin
      - NEXTCLOUD_ADMIN_PASSWORD=admin_password
      - NEXTCLOUD_TRUSTED_DOMAINS=localhost
      - TZ=\${TZ}
    restart: \${RESTART_POLICY}
  
  nextclouddb:
    image: mariadb:latest
    container_name: \${CONTAINER_PREFIX}nextcloud-db
    command: --transaction-isolation=READ-COMMITTED --binlog-format=ROW
    volumes:
      - \${DATA_PATH}/nextcloud-db:/var/lib/mysql
    environment:
      - MYSQL_ROOT_PASSWORD=root_password
      - MYSQL_PASSWORD=nextcloud_db_password
      - MYSQL_DATABASE=nextcloud
      - MYSQL_USER=nextcloud
      - TZ=\${TZ}
    restart: \${RESTART_POLICY}`,
  },

  {
    id: "vaultwarden",
    name: "Vaultwarden",
    description: "Unofficial Bitwarden compatible server written in Rust.",
    category: "Security",
    tags: ["Password Manager", "Security", "Bitwarden"],
    githubUrl: "https://github.com/dani-garcia/vaultwarden",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/vaultwarden.svg",
    composeContent: `services:
  vaultwarden:
    image: vaultwarden/server:latest
    container_name: \${CONTAINER_PREFIX}vaultwarden
    ports:
      - "8080:8080"
    volumes:
      - \${DATA_PATH}/vaultwarden:/data
    environment:
      - WEBSOCKET_ENABLED=true
      - WEBSOCKET_PORT=8080
      - TZ=\${TZ}
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "gitea",
    name: "Gitea",
    description: "A painless self-hosted Git service.",
    category: "Development",
    tags: ["Git", "Version Control", "CI/CD"],
    githubUrl: "https://github.com/go-gitea/gitea",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/gitea.svg",
    composeContent: `services:
  gitea:
    image: gitea/gitea:latest
    container_name: \${CONTAINER_PREFIX}gitea
    ports:
      - "3000:3000"
    volumes:
      - \${DATA_PATH}/gitea:/data
    environment:
      - MYSQL_HOST=giteadb
      - MYSQL_DATABASE=gitea
      - MYSQL_USER=gitea
      - MYSQL_PASSWORD=gitea_db_password
      - TZ=\${TZ}
    command: --custom-path /data/custom --app-url http://localhost:3000
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "code-server",
    name: "Code Server",
    description:
      "Run VS Code on any machine anywhere and access it in the browser.",
    category: "Development",
    tags: ["IDE", "Development", "VS Code"],
    githubUrl: "https://github.com/coder/code-server",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/code-server.png",
    composeContent: `services:
  code-server:
    image: codercom/code-server:latest
    container_name: \${CONTAINER_PREFIX}code-server
    ports:
      - "8080:8080"
    volumes:
      - \${CONFIG_PATH}/code-server:/config
    environment:
      - PASSWORD=your_password
      - TZ=\${TZ}
    command: code-server --bind-addr 0.0.0.0:8080 --auth password --disable-telemetry
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "maxun",
    name: "Maxun",
    description:
      "Open-Source No-Code Web Data Extraction Platform. Train a robot in 2 minutes and scrape the web on auto-pilot.",
    category: "Development",
    tags: ["AI", "Automation", "Bot"],
    githubUrl: "https://github.com/getmaxun/maxun",
    composeContent: `services:
  maxun-postgres:
    image: postgres:13
    container_name: \${CONTAINER_PREFIX}maxun-postgres
    environment:
      - POSTGRES_USER=maxun
      - POSTGRES_PASSWORD=maxun_password
      - POSTGRES_DB=maxun
      - TZ=\${TZ}
    ports:
      - "5432:5432"
    volumes:
      - \${DATA_PATH}/maxun/postgres:/var/lib/postgresql/data
    restart: \${RESTART_POLICY}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  maxun-minio:
    image: minio/minio
    container_name: \${CONTAINER_PREFIX}maxun-minio
    environment:
      - MINIO_ROOT_USER=minioadmin
      - MINIO_ROOT_PASSWORD=minioadmin
      - TZ=\${TZ}
    command: server /data --console-address :9001
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - \${DATA_PATH}/maxun/minio:/data
    restart: \${RESTART_POLICY}

  maxun-backend:
    image: getmaxun/maxun-backend:latest
    container_name: \${CONTAINER_PREFIX}maxun-backend
    ports:
      - "8080:8080"
    environment:
      - BACKEND_URL=http://localhost:8080
      - BACKEND_PORT=8080
      - DB_NAME=maxun
      - DB_USER=maxun
      - DB_PASSWORD=maxun_password
      - DB_HOST=maxun-postgres
      - DB_PORT=5432
      - JWT_SECRET=change_this_secret_key
      - ENCRYPTION_KEY=change_this_encryption_key
      - MINIO_ENDPOINT=maxun-minio
      - MINIO_PORT=9000
      - MINIO_ACCESS_KEY=minioadmin
      - MINIO_SECRET_KEY=minioadmin
      - PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
      - PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0
      - CI=true
      - CONTAINER=true
      - CHROMIUM_FLAGS=--disable-gpu --no-sandbox --headless=new
      - TZ=\${TZ}
    security_opt:
      - seccomp=unconfined
    shm_size: 2gb
    mem_limit: 2g
    depends_on:
      - maxun-postgres
      - maxun-minio
    volumes:
      - /var/run/dbus:/var/run/dbus
    restart: \${RESTART_POLICY}

  maxun-frontend:
    image: getmaxun/maxun-frontend:latest
    container_name: \${CONTAINER_PREFIX}maxun-frontend
    ports:
      - "5173:5173"
    environment:
      - PUBLIC_URL=http://localhost:5173
      - BACKEND_URL=http://localhost:8080
      - FRONTEND_PORT=5173
      - VITE_BACKEND_URL=http://localhost:8080
      - VITE_PUBLIC_URL=http://localhost:5173
      - TZ=\${TZ}
    depends_on:
      - maxun-backend
    restart: \${RESTART_POLICY}`,
  },

  {
    id: "elasticsearch",
    name: "Elasticsearch",
    description:
      "A distributed, RESTful search and analytics engine capable of addressing a growing number of use cases.",
    category: "Database",
    tags: ["Search", "Analytics", "Full-Text"],
    githubUrl: "https://github.com/elastic/elasticsearch",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/elasticsearch.svg",
    composeContent: `services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.12.2
    container_name: \${CONTAINER_PREFIX}elasticsearch
    environment:
      - node.name=es01
      - cluster.name=es-docker-cluster
      - discovery.type=single-node
      - bootstrap.memory_lock=true
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
      - xpack.security.enabled=false
      - TZ=\${TZ}
    ulimits:
      memlock:
        soft: -1
        hard: -1
    volumes:
      - \${DATA_PATH}/elasticsearch:/usr/share/elasticsearch/data
      - \${CONFIG_PATH}/elasticsearch:/usr/share/elasticsearch/config
    ports:
      - "9200:9200"
      - "9300:9300"
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "duplicacy",
    name: "Duplicacy",
    description: "A lock-free deduplication cloud backup tool.",
    category: "Backup",
    tags: ["Backup", "Deduplication", "Cloud"],
    githubUrl: "https://github.com/gilbertchen/duplicacy",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/duplicacy.png",
    composeContent: `services:
  duplicacy:
    image: ghcr.io/hotio/duplicacy:latest
    container_name: \${CONTAINER_PREFIX}duplicacy
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
    volumes:
      - \${CONFIG_PATH}/duplicacy:/config
      - \${DATA_PATH}/backups:/data/backups
    ports:
      - 3875:3875
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "mergerfs",
    name: "MergerFS",
    description: "A featureful FUSE-based union filesystem.",
    category: "Storage",
    tags: ["Filesystem", "Storage", "Union FS"],
    githubUrl: "https://github.com/trapexit/mergerfs",
    composeContent: `services:
  mergerfs:
    image: ghcr.io/hotio/mergerfs:latest
    container_name: \${CONTAINER_PREFIX}mergerfs
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - UMASK=\${UMASK}
      - DISK_PATH=/disk
      - DISK_MOUNTPOINTS=/disk1,/disk2,/disk3
      - MOUNT_OPTS=defaults,allow_other,direct_io,use_ino,category.create=mfs
    volumes:
      - \${DATA_PATH}/disk1:/disk1
      - \${DATA_PATH}/disk2:/disk2
      - \${DATA_PATH}/disk3:/disk3
    privileged: true
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "homeassistant",
    name: "Home Assistant",
    description:
      "Open source home automation platform that puts local control and privacy first. Supported by a worldwide community of bricoleurs, tinkerers and DIYers.",
    category: "Home Automation",
    tags: ["IoT", "Smart Home", "Automation"],
    githubUrl: "https://github.com/home-assistant/core",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/home-assistant.svg",
    composeContent: `services:
  homeassistant:
    image: ghcr.io/home-assistant/home-assistant:stable
    container_name: \${CONTAINER_PREFIX}homeassistant
    environment:
      - TZ=\${TZ}
    volumes:
      - \${CONFIG_PATH}/homeassistant:/config
      - /etc/localtime:/etc/localtime:ro
      - /run/dbus:/run/dbus:ro
    ports:
      - 8123:8123
    restart: \${RESTART_POLICY}
    privileged: true`,
  },
  {
    id: "node-red",
    name: "Node-RED",
    description:
      "Flow-based programming tool for connecting hardware devices, APIs and online services. Perfect companion for Home Assistant automations.",
    category: "Home Automation",
    tags: ["IoT", "Automation", "Flow Programming"],
    githubUrl: "https://github.com/node-red/node-red",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/node-red.svg",
    composeContent: `services:
  nodered:
    image: nodered/node-red:latest
    container_name: \${CONTAINER_PREFIX}nodered
    environment:
      - TZ=\${TZ}
    volumes:
      - \${CONFIG_PATH}/nodered:/data
    ports:
      - 1880:1880
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "mosquitto",
    name: "Mosquitto",
    description:
      "Lightweight MQTT broker for IoT messaging. Essential for Home Assistant and IoT device communications.",
    category: "Home Automation",
    tags: ["IoT", "MQTT", "Messaging"],
    githubUrl: "https://github.com/eclipse/mosquitto",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/mosquitto.svg",
    composeContent: `services:
  mosquitto:
    image: eclipse-mosquitto:latest
    container_name: \${CONTAINER_PREFIX}mosquitto
    environment:
      - TZ=\${TZ}
    volumes:
      - \${CONFIG_PATH}/mosquitto/config:/mosquitto/config
      - \${CONFIG_PATH}/mosquitto/data:/mosquitto/data
      - \${CONFIG_PATH}/mosquitto/log:/mosquitto/log
    ports:
      - 1883:1883
      - 9001:9001
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "zigbee2mqtt",
    name: "Zigbee2MQTT",
    description:
      "Enables you to use Zigbee devices without the vendor's bridge or gateway. Connects directly to a wide range of Zigbee adapters.",
    category: "Home Automation",
    tags: ["IoT", "Zigbee", "Smart Home"],
    githubUrl: "https://github.com/Koenkk/zigbee2mqtt",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/zigbee2mqtt.svg",
    composeContent: `services:
  zigbee2mqtt:
    image: koenkk/zigbee2mqtt:latest
    container_name: \${CONTAINER_PREFIX}zigbee2mqtt
    environment:
      - TZ=\${TZ}
    volumes:
      - \${CONFIG_PATH}/zigbee2mqtt:/app/data
      - /run/udev:/run/udev:ro
    ports:
      - 8080:8080
    restart: \${RESTART_POLICY}
    privileged: true`,
  },
  {
    id: "freshrss",
    name: "FreshRSS",
    description:
      "Self-hosted RSS feed aggregator like Google Reader with modern UI and customization options.",
    category: "Productivity",
    tags: ["RSS", "News", "Reading"],
    githubUrl: "https://github.com/FreshRSS/FreshRSS",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/freshrss.svg",
    composeContent: `services:
  freshrss:
    image: freshrss/freshrss:latest
    container_name: \${CONTAINER_PREFIX}freshrss
    environment:
      - TZ=\${TZ}
      - PUID=\${PUID}
      - PGID=\${PGID}
    volumes:
      - \${CONFIG_PATH}/freshrss:/var/www/FreshRSS/data
    ports:
      - 8080:80
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "tinyfeed",
    name: "TinyFeed",
    description:
      "Generate a static HTML page in the style of Hacker News from a collection of feeds",
    category: "Productivity",
    tags: ["RSS", "News", "Reading"],
    githubUrl: "https://github.com/TheBigRoomXXL/tinyfeed",
    icon: "https://github.com/TheBigRoomXXL/tinyfeed/blob/main/.images/icon.png?raw=true",
    composeContent: `services:
  tinyfeed:
    image: thebigroomxxl/tinyfeed:latest
    container_name: \${CONTAINER_PREFIX}tinyfeed
    command: --daemon -i /app/config/feeds.txt -o /app/data/index.html
    volumes:
      - \${CONFIG_PATH}/tinyfeed/:/app/config/ # Add your feeds.txt here
      - \${DATA_PATH}/tinyfeed/:/app/data/     # Point your webserver to this folder
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "wallabag",
    name: "Wallabag",
    description:
      "Self-hosted read-it-later application. Save web pages for offline reading and classify articles.",
    category: "Productivity",
    tags: ["Reading", "Bookmark", "Archive"],
    githubUrl: "https://github.com/wallabag/wallabag",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/wallabag.svg",
    composeContent: `services:
  wallabag:
    image: wallabag/wallabag:latest
    container_name: \${CONTAINER_PREFIX}wallabag
    environment:
      - TZ=\${TZ}
      - POPULATE_DATABASE=false
    volumes:
      - \${CONFIG_PATH}/wallabag/data:/var/www/wallabag/data
      - \${CONFIG_PATH}/wallabag/images:/var/www/wallabag/web/assets/images
    ports:
      - 8080:80
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "tandoorrecipes",
    name: "Tandoor Recipes",
    description:
      "The recipe manager that allows you to manage your ever-growing collection of digital recipes.",
    category: "Productivity",
    tags: ["Cooking", "Recipes", "Food"],
    githubUrl: "https://github.com/vabene1111/recipes",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/tandoor-recipes.svg",
    composeContent: `services:
  tandoor:
    image: vabene1111/recipes:latest
    container_name: \${CONTAINER_PREFIX}tandoor
    environment:
      - TZ=\${TZ}
      - SECRET_KEY=changeme
      - POSTGRES_PASSWORD=changeme
      - POSTGRES_USER=tandoor
      - POSTGRES_DB=tandoor
    volumes:
      - \${CONFIG_PATH}/tandoor/staticfiles:/opt/recipes/staticfiles
      - \${CONFIG_PATH}/tandoor/mediafiles:/opt/recipes/mediafiles
    ports:
      - 8080:8080
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "filebrowser",
    name: "File Browser",
    description:
      "Web-based file manager with a clean UI for browsing, managing, and sharing files from your server.",
    category: "Productivity",
    tags: ["Files", "Manager", "Sharing"],
    githubUrl: "https://github.com/filebrowser/filebrowser",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/filebrowser.svg",
    composeContent: `services:
  filebrowser:
    image: filebrowser/filebrowser:latest
    container_name: \${CONTAINER_PREFIX}filebrowser
    environment:
      - TZ=\${TZ}
      - PUID=\${PUID}
      - PGID=\${PGID}
    volumes:
      - \${CONFIG_PATH}/filebrowser/database.db:/database.db
      - \${CONFIG_PATH}/filebrowser/config.json:/.filebrowser.json
      - \${DATA_PATH}:/srv
    ports:
      - 8080:80
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "openvscode",
    name: "OpenVSCode Server",
    description:
      "Run VS Code in the browser with server-side computation. Perfect for remote development.",
    category: "Development",
    tags: ["IDE", "Editor", "Development"],
    githubUrl: "https://github.com/gitpod-io/openvscode-server",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/vscode.svg",
    composeContent: `services:
  openvscode:
    image: gitpod/openvscode-server:latest
    container_name: \${CONTAINER_PREFIX}openvscode
    environment:
      - TZ=\${TZ}
    volumes:
      - \${CONFIG_PATH}/openvscode:/home/workspace
    ports:
      - 3000:3000
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "actualbudget",
    name: "Actual Budget",
    description:
      "A super fast and privacy-focused app for managing your finances.",
    category: "Finance",
    tags: ["Money", "Budgeting", "Finance"],
    githubUrl: "https://github.com/actualbudget/actual",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/actual-budget.svg",
    composeContent: `services:
  actualbudget:
    image: docker.io/actualbudget/actual-server:latest
    container_name: \${CONTAINER_PREFIX}actualbudget
    environment:
      # Uncomment any of the lines below to set configuration options.
      # - ACTUAL_HTTPS_KEY=/data/selfhost.key
      # - ACTUAL_HTTPS_CERT=/data/selfhost.crt
      - ACTUAL_PORT=5006
      - ACTUAL_UPLOAD_FILE_SYNC_SIZE_LIMIT_MB=20
      - ACTUAL_UPLOAD_SYNC_ENCRYPTED_FILE_SYNC_SIZE_LIMIT_MB=50
      # - ACTUAL_UPLOAD_FILE_SIZE_LIMIT_MB=20
      # See all options and more details at https://actualbudget.github.io/docs/Installing/Configuration
      # !! If you are not using any of these options, you can comment them out.
    volumes:
      - \${CONFIG_PATH}/actualbudget:/data
    ports:
      - 5006:5006
    healthcheck:
      # Enable health check for the instance
      test: ['CMD-SHELL', 'node src/scripts/health-check.js']
      interval: 60s
      timeout: 10s
      retries: 3
      start_period: 20s
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "firefly",
    name: "Firefly III",
    description:
      "Personal finance manager to help track expenses, income, budgets and more.",
    category: "Finance",
    tags: ["Money", "Budgeting", "Finance"],
    githubUrl: "https://github.com/firefly-iii/firefly-iii",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/firefly-iii.svg",
    composeContent: `services:
  firefly:
    image: fireflyiii/core:latest
    container_name: \${CONTAINER_PREFIX}firefly
    environment:
      - TZ=\${TZ}
      - DB_CONNECTION=mysql
      - DB_HOST=firefly_db
      - DB_PORT=3306
      - DB_DATABASE=firefly
      - DB_USERNAME=firefly
      - DB_PASSWORD=changeme
      - APP_KEY=changeme
    volumes:
      - \${CONFIG_PATH}/firefly/upload:/var/www/html/storage/upload
    ports:
      - 8080:8080
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "homepage",
    name: "Homepage",
    description:
      "A modern, fully static, fast, secure dashboard for public/private services. Perfect homepage for your server.",
    category: "Productivity",
    tags: ["Dashboard", "Homepage", "UI"],
    githubUrl: "https://github.com/benphelps/homepage",
    icon: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/homepage.png",
    composeContent: `services:
  homepage:
    image: ghcr.io/benphelps/homepage:latest
    container_name: \${CONTAINER_PREFIX}homepage
    environment:
      - TZ=\${TZ}
    volumes:
      - \${CONFIG_PATH}/homepage:/app/config
      - /var/run/docker.sock:/var/run/docker.sock:ro
    ports:
      - 3000:3000
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "calibreweb",
    name: "Calibre-Web",
    description:
      "Web app for browsing, reading and downloading eBooks stored in a Calibre database.",
    category: "Media",
    tags: ["eBooks", "Reading", "Library"],
    githubUrl: "https://github.com/janeczku/calibre-web",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/calibre-web.svg",
    composeContent: `services:
  calibreweb:
    image: linuxserver/calibre-web:latest
    container_name: \${CONTAINER_PREFIX}calibreweb
    environment:
      - TZ=\${TZ}
      - PUID=\${PUID}
      - PGID=\${PGID}
    volumes:
      - \${CONFIG_PATH}/calibreweb:/config
      - \${DATA_PATH}/books:/books
    ports:
      - 8083:8083
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "unifi",
    name: "Unifi Controller",
    description:
      "Network management controller for Ubiquiti UniFi devices, enabling centralized management.",
    category: "Network",
    tags: ["Network", "Management", "Ubiquiti"],
    githubUrl: "https://github.com/jacobalberty/unifi-docker",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/unifi.svg",
    composeContent: `services:
  unifi:
    image: jacobalberty/unifi:latest
    container_name: \${CONTAINER_PREFIX}unifi
    environment:
      - TZ=\${TZ}
      - PUID=\${PUID}
      - PGID=\${PGID}
    volumes:
      - \${CONFIG_PATH}/unifi:/unifi
    ports:
      - 8080:8080
      - 8443:8443
      - 3478:3478/udp
      - 10001:10001/udp
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "mealie",
    name: "Mealie",
    description:
      "A self-hosted recipe manager and meal planner with a sleek interface and powerful features.",
    category: "Productivity",
    tags: ["Recipes", "Cooking", "Meal Planning"],
    githubUrl: "https://github.com/hay-kot/mealie",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/mealie.svg",
    composeContent: `services:
  mealie:
    image: hkotel/mealie:latest
    container_name: \${CONTAINER_PREFIX}mealie
    environment:
      - TZ=\${TZ}
      - PUID=\${PUID}
      - PGID=\${PGID}
      - SECRET_KEY=changeme
      - DB_ENGINE=sqlite
    volumes:
      - \${CONFIG_PATH}/mealie:/app/data
    ports:
      - 9925:9000
    restart: \${RESTART_POLICY}`,
  },
]
