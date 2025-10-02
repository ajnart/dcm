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
    image: redis:alpine
    container_name: \${CONTAINER_PREFIX}redis
    ports:
      - "6379:6379"
    command: redis-server --save 20 1 --loglevel warning --requirepass your_password
    volumes:
      - \${DATA_PATH}/redis:/data
      - \${CONFIG_PATH}/redis:/usr/local/etc/redis
    environment:
      - TZ=\${TZ}
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
    image: phpmyadmin/phpmyadmin:latest
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
]
