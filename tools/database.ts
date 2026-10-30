import type { DockerTool } from "@/lib/docker-tools"

export const databases: DockerTool[] = [
  {
    id: "mariadb",
    name: "MariaDB",
    description: "One of the most popular database servers.",
    category: "Database",
    tags: ["SQL", "Database", "MySQL"],
    githubUrl: "https://github.com/MariaDB/server",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/mariadb.svg",
    composeContent: `services:
  mariadb:
    image: mariadb:latest
    container_name: \${CONTAINER_PREFIX}mariadb
    ports:
      - "3306:3306"
    volumes:
      - \${DATA_PATH}/mariadb:/var/lib/mysql
      - \${CONFIG_PATH}/mariadb:/etc/mysql/conf.d
    environment:
      - MYSQL_ROOT_PASSWORD=your_root_password
      - MYSQL_DATABASE=default_database
      - MYSQL_USER=default_user
      - MYSQL_PASSWORD=your_password
      - TZ=\${TZ}
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "mysql",
    name: "MySQL",
    description:
      "The world's most popular open source database. Features high performance, reliability, and ease of use.",
    category: "Database",
    tags: ["SQL", "Database", "Relational"],
    githubUrl: "https://github.com/mysql/mysql-server",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/mysql.svg",
    composeContent: `services:
  mysql:
    image: mysql:8.0
    container_name: \${CONTAINER_PREFIX}mysql
    cap_add:
      - SYS_NICE
    ports:
      - "3306:3306"
    volumes:
      - \${DATA_PATH}/mysql:/var/lib/mysql
      - \${CONFIG_PATH}/mysql/conf.d:/etc/mysql/conf.d
      - \${CONFIG_PATH}/mysql/init:/docker-entrypoint-initdb.d
    environment:
      - MYSQL_ROOT_PASSWORD=your_root_password
      - MYSQL_DATABASE=your_database
      - MYSQL_USER=your_user
      - MYSQL_PASSWORD=your_password
      - TZ=\${TZ}
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "The world's most advanced open source database.",
    category: "Database",
    tags: ["SQL", "Database", "Relational"],
    githubUrl: "https://github.com/postgres/postgres",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/postgres.svg",
    composeContent: `services:
  postgres:
    image: postgres:latest
    container_name: \${CONTAINER_PREFIX}postgres
    ports:
      - "5432:5432"
    volumes:
      - \${DATA_PATH}/postgres:/var/lib/postgresql/data
      - \${CONFIG_PATH}/postgres:/etc/postgresql/conf.d
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=your_password
      - POSTGRES_DB=postgres
      - TZ=\${TZ}
    shm_size: 128mb
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "mongodb",
    name: "MongoDB",
    description:
      "A document-oriented NoSQL database that provides high performance, high availability, and easy scalability.",
    category: "Database",
    tags: ["NoSQL", "Database", "Document"],
    githubUrl: "https://github.com/mongodb/mongo",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/mongodb.svg",
    composeContent: `services:
  mongodb:
    image: mongo:latest
    container_name: \${CONTAINER_PREFIX}mongodb
    ports:
      - "27017:27017"
    volumes:
      - \${DATA_PATH}/mongodb:/data/db
      - \${CONFIG_PATH}/mongodb:/etc/mongo
    environment:
      - MONGO_INITDB_ROOT_USERNAME=admin
      - MONGO_INITDB_ROOT_PASSWORD=your_password
      - MONGO_INITDB_DATABASE=admin
      - TZ=\${TZ}
    healthcheck:
      test: ["CMD", "mongosh", "--username", "$MONGO_INITDB_ROOT_USERNAME", "--password", "$MONGO_INITDB_ROOT_PASSWORD", "--authenticationDatabase", "admin", "--eval", "db.adminCommand('ping').ok"]
      start_period: 30s
      interval: 30s
      timeout: 10s
      retries: 3
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "redis",
    name: "Redis",
    description:
      "A source-available, in-memory data structure store used as a database, cache, message broker, and queue.",
    category: "Database",
    tags: ["Cache", "Database", "In-Memory"],
    githubUrl: "https://github.com/redis/redis",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/redis.svg",
    composeContent: `services:
  redis:
    image: redis:8.0.2
    container_name: \${CONTAINER_PREFIX}redis
    ports:
      - "6379:6379"
    command: redis-server /usr/local/etc/redis/redis-full.conf
    volumes:
      - \${DATA_PATH}/redis:/data
      - \${CONFIG_PATH}/redis/redis-full.conf:/usr/local/etc/redis/redis-full.conf
    environment:
      - TZ=\${TZ}
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "redisinsight",
    name: "RedisInsight",
    description:
      "A powerful GUI for Redis that provides visualization and management of your Redis data structures, memory usage, and performance metrics.",
    category: "Database",
    tags: ["Redis", "GUI", "Management", "Visualization"],
    githubUrl: "https://github.com/RedisInsight/RedisInsight",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/redis.svg",
    composeContent: `services:
  redisinsight:
    image: redis/redisinsight:latest
    container_name: \${CONTAINER_PREFIX}redisinsight
    ports:
      - "5540:5540"
    environment:
      - TZ=\${TZ}
      - RI_APP_PORT=5540
      - RI_APP_HOST=0.0.0.0
    volumes:
      - \${DATA_PATH}/redisinsight:/data
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "phpmyadmin",
    name: "phpMyAdmin",
    description:
      "A free and open source administration tool for MySQL and MariaDB. Provides a web interface for database management.",
    category: "Database",
    tags: ["Database", "MySQL", "MariaDB", "Database Viewer", "Admin"],
    githubUrl: "https://github.com/phpmyadmin/phpmyadmin",
    icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/phpmyadmin.svg",
    composeContent: `services:
  phpmyadmin:
    image: phpmyadmin:latest
    container_name: \${CONTAINER_PREFIX}phpmyadmin
    ports:
      - "8080:80"
    environment:
      - PMA_HOST=your_db_host
      - PMA_PORT=3306
      - PMA_USER=your_db_user
      - PMA_PASSWORD=your_db_password
      # - PMA_ARBITRARY=1
      - TZ=\${TZ}
    restart: \${RESTART_POLICY}`,
  },
  {
    id: "tigergraph",
    name: "TigerGraph",
    description:
      "A native parallel graph database designed for real-time analytics and deep link analytics on connected data. Free Trial version with 50GB limit, valid for 30 days. License key required from dl.tigergraph.com.",
    category: "Database",
    tags: ["AI", "Database", "Graph Database", "Analytics"],
    githubUrl: "https://github.com/tigergraph/ecosys",
    composeContent: `services:
  tigergraph:
    image: tigergraph/tigergraph:latest
    container_name: \${CONTAINER_PREFIX}tigergraph
    ports:
      - "14022:22"
      - "9000:9000"
      - "14240:14240"
    ulimits:
      nofile:
        soft: 1000000
        hard: 1000000
    volumes:
      - \${CONFIG_PATH}/tigergraph:/home/tigergraph
      - \${DATA_PATH}/tigergraph:/home/tigergraph/mydata
    restart: \${RESTART_POLICY}`,
  },
]
