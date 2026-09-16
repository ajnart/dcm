<div align="center">
  <img src="./public/favicon.png" height="80" alt="DCM Logo" />
  <h3>DCM - Docker Compose Maker</h3>
</div>

<p align="center">
<img src="https://img.shields.io/github/stars/ajnart/dcm?label=%E2%AD%90%20Stars&style=flat-square?branch=main&kill_cache=1%22">
<a href="https://github.com/ajnart/dcm/actions">
  <img title="CI Status" src="https://github.com/ajnart/dcm/actions/workflows/build_image.yml/badge.svg" alt="CI Status">
</a>
<a href="https://github.com/ajnart/dcm/pkgs/container/dcm">
  <img alt="Docker Image" src="https://img.shields.io/badge/🐳_Docker_Image-ghcr.io/ajnart/dcm-blue">
</a>
</p>

<!-- Links -->
<p align="center">
  <a href="https://compose.ajnart.dev">
    <strong>Live Demo 🚀</strong>
  </a>
  •
  <a href="#-quick-start">
    <strong>Install 💻</strong>
  </a>
  •
  <a href="#-contributing">
    <strong>Contribute 🤝</strong>
  </a>
  •
  <a href="#-supported-tools">
    <strong>Supported Tools 📦</strong>
  </a>
  •
  <a href="#-screenshots">
    <strong>Screenshots 📸</strong>
  </a>
</p>

## 📋 About

> [!NOTE]
> 🌟 **Community-Driven Project**: DCM started as a simple tool but aims to become the go-to resource for Docker Compose configurations, powered by the community. We believe everyone has their favorite self-hosted tools, and we'd love for you to share yours! Whether you're using a popular application or a hidden gem, your contribution helps others discover and easily deploy great software.

DCM (Docker Compose Maker) is a simple yet powerful tool that helps you create `docker-compose.yaml` files for your self-hosted applications. Select from a curated list of popular containers and generate a ready-to-use configuration file with just a few clicks.

No more copy-pasting from documentation or trying to remember the correct configuration options - this tool makes it easy to set up your Docker environment.

> [!TIP]
> Most containers come pre-configured with best practices and sensible defaults, saving you hours of documentation reading and configuration tweaking.

> 💡 **Share Your Stack**: Using a great tool that's not listed here? We'd love to include it! Check out our [contribution guide](CONTRIBUTING.md) to help others discover and use your favorite containers.

## 🔧 How to Use DCM

Using Docker Compose Maker is simple and intuitive:

1. **Select containers** - Browse the curated list of self-hosted applications and click to select the ones you want to include
2. **Use templates** - Choose from predefined templates in the Template Gallery for common stacks like media servers
3. **Configure settings** - Adjust environment variables, paths, and other common settings
4. **Generate your configuration** - Click "Copy Compose" to view and customize your docker-compose.yaml
5. **Deploy your stack** - Use one of the following methods to deploy your containers:

> [!IMPORTANT]
> All containers are configured to use environment variables like `${PUID}`, `${PGID}`, and `${TZ}`. Make sure to set these in your deployment to avoid permission issues.

### Deployment Options

Once you have your docker-compose configuration, you have several ways to deploy it:

#### Copy & Paste
Simply copy the generated docker-compose.yaml and .env content, save them locally, and run `docker-compose up -d` to start your containers.

#### Download Files
Download the generated docker-compose.yaml and .env files directly from the interface, then use them with your preferred Docker management tool.

> [!NOTE]
> The downloaded .env file contains all the environment variables referenced in your docker-compose.yaml. Keep both files in the same directory when deploying.

#### Portainer Stacks
If you're already using [Portainer](https://github.com/portainer/portainer) to manage your Docker environment, you can easily deploy your configuration as a stack:

1. Navigate to your Portainer dashboard and select **Stacks** from the sidebar
2. Click **Add stack**
3. Give your stack a name
4. Select **Web editor** and paste the generated docker-compose content
5. (Optional) Add the environment variables from the .env file
6. Click **Deploy the stack**

> [!CAUTION]
> When using Portainer Stacks, you'll need to manually add the environment variables or upload the .env file, as Portainer doesn't automatically read the .env file in all configurations.

Using Portainer provides a user-friendly web interface to manage, update, and monitor your containers without needing command-line tools.

#### Other Docker Management Tools
The generated compose file works with any tool that supports docker-compose syntax, such as Docker Desktop, Rancher, Yacht, or command-line tools.

## 🚀 Quick Start

If you want to try DCM for yourself, there are several ways to get started:

### 🌐 Use the Online Version

Visit [compose.ajnart.dev](https://compose.ajnart.dev) to use the tool immediately without installation.

> [!NOTE]
> The online version includes analytics for usage tracking, while the self-hosted version does not.

### 🐳 Run with Docker

Run with a single command:

```bash
docker run -p 7576:7576 --name dcm --rm ghcr.io/ajnart/dcm
```

Then visit `http://localhost:7576` in your browser.

The Docker image is available for multiple platforms:
- linux/amd64
- linux/arm64
- linux/arm/v7

### 📦 Using Docker Compose

Create a `docker-compose.yaml` file:

```yaml
services:
  dcm:
    image: ghcr.io/ajnart/dcm
    container_name: dcm
    ports:
      - "7576:7576"
    restart: unless-stopped
```

Then run:

```bash
docker-compose up -d
```

### 🚀 Using Easypanel

[Easypanel](https://easypanel.io) is a self-hosted Docker deployment platform. It has a one-click Easypanel template for DCM, which runs the image above.

[![Deploy on Easypanel](https://easypanel.io/img/deploy-on-easypanel-40.svg)](https://easypanel.io/templates/dcm)

### 🛠️ Build from Source

1. Clone the repository:
```bash
git clone https://github.com/ajnart/dcm.git
cd dcm
```

2. Install dependencies:

First install [Bun](https://bun.sh/) if you haven't already, then run:
```bash
bun install
```

> [!WARNING]
> Using npm instead of Bun may result in longer installation times and potential compatibility issues. We strongly recommend using Bun for development.

3. Build and start:
```bash
bun run build
bun start
```

## 🧰 Supported Tools

DCM includes configuration for many popular self-hosted applications, including:

📺 **Media Management**: 
  - **Media Servers**: [Jellyfin](https://github.com/jellyfin/jellyfin), [Plex](https://github.com/plexinc/pms-docker), [Emby](https://github.com/MediaBrowser/Emby)
  - **Media Automation**: [Sonarr](https://github.com/Sonarr/Sonarr), [Radarr](https://github.com/Radarr/Radarr), [Lidarr](https://github.com/lidarr/Lidarr), [Readarr](https://github.com/Readarr/Readarr), [Prowlarr](https://github.com/Prowlarr/Prowlarr), [Bazarr](https://github.com/morpheus65535/bazarr), [Whisparr](https://github.com/whisparr/whisparr)
  - **Media Requests**: [Jellyseerr](https://github.com/Fallenbagel/jellyseerr), [Overseerr](https://github.com/sct/overseerr), [Doplarr](https://github.com/kiranshila/Doplarr), [Requestrr](https://github.com/darkalfx/requestrr)

🔍 **Dashboards & Management**: 
  - **Dashboards**: [Homarr](https://github.com/homarr-labs/homarr), [Heimdall](https://github.com/linuxserver/Heimdall)
  - **Container Management**: [Portainer](https://github.com/portainer/portainer)
  - **Media Analytics**: [Tautulli](https://github.com/Tautulli/Tautulli)

📥 **Download Management**:
  - **Torrent**: [qBittorrent](https://github.com/qbittorrent/qBittorrent)
  - **Usenet**: [NZBGet](https://github.com/nzbget/nzbget), [NZBHydra 2](https://github.com/theotherp/nzbhydra2)
  - **Indexers**: [Jackett](https://github.com/Jackett/Jackett), [Prowlarr](https://github.com/Prowlarr/Prowlarr)

🗄️ **Databases**: 
  - **SQL**: [MariaDB](https://github.com/MariaDB/server), [MySQL](https://github.com/mysql/mysql-server), [PostgreSQL](https://github.com/postgres/postgres)
  - **NoSQL**: [MongoDB](https://github.com/mongodb/mongo), [Redis](https://github.com/redis/redis)

📊 **Monitoring & Automation**: 
  - **Monitoring**: [Grafana](https://github.com/grafana/grafana), [Prometheus](https://github.com/prometheus/prometheus)
  - **Updates**: [Watchtower](https://github.com/containrrr/watchtower)
  - **Home Automation**: [Home Assistant](https://github.com/home-assistant/core)

🔐 **Security**: [Vaultwarden](https://github.com/dani-garcia/vaultwarden)

💾 **Storage & Files**: [Nextcloud](https://github.com/nextcloud/server)

Each tool includes a detailed description, GitHub star count, and pre-configured docker-compose settings.

## 🧪 Testing

DCM uses [Bun](https://bun.sh/) for testing. To run the tests:

```bash
# Run all tests
bun test

# Run Docker Compose validation tests
bun test:compose

# Run container schema validation tests
bun test:containers
```

## 🤖 MCP v2 endpoints

The Cloudflare Pages deployment includes three independent, stateless MCP v2
Streamable HTTP endpoints:

- `https://compose.ajnart.dev/api/mcp/v2/tools` - discover tools and retrieve their Compose definitions
- `https://compose.ajnart.dev/api/mcp/v2/templates` - discover templates and their tools
- `https://compose.ajnart.dev/api/mcp/v2/compose` - generate `docker-compose.yaml` and `.env` content

Each endpoint is a separate MCP server. They do not keep sessions or rely on
in-memory state, so they can run on any Cloudflare Pages Function instance.
POST requests use JSON responses over the MCP Streamable HTTP transport. Because
these endpoints are stateless, `GET` and `DELETE` return `405`; clients should
use `POST` for initialization and tool calls.

The endpoints are public by default. Set the optional `MCP_ACCESS_TOKEN`
Pages secret to require `Authorization: Bearer <token>`:

```bash
wrangler pages secret put MCP_ACCESS_TOKEN
```

The frontend remains a static Next.js export. The deploy script compiles the
Pages Functions into `out/_worker.js` before uploading `out`:

```bash
bun run deploy
```

The Docker image in this repository still serves only the static `out`
directory, so it does not provide the MCP endpoints. GitHub Pages would have
the same limitation; the MCP runtime requires Cloudflare Pages Functions or a
separate Worker.

## 🔄 Template Gallery

DCM includes a Template Gallery that allows you to quickly add predefined stacks of containers based on common use cases:

- **Media Server Stacks**: Complete media server setups with Jellyfin/Plex and related tools
- **Development Environments**: Web development stacks with databases and web servers
- **Monitoring Solutions**: Grafana, Prometheus, and other monitoring tools
- **Database Clusters**: Various database engines with management tools
- **Security Tools**: Password managers and security-related containers
- **And more!**: Smart home hubs, personal cloud solutions, and other useful templates

To use the Template Gallery:
1. Click the "Template Gallery" button at the top of the main page
2. Browse or search for templates that match your needs
3. Click "Use Template" to add all containers from that template to your selection
4. Return to the main page to customize your selected containers

You can combine multiple templates to create your perfect self-hosted environment!

## 🖼️ Screenshots

### User Interface
![UI Screenshot](/public/ui-demo.png)

### Generated docker compose file
![Generated docker-compose file](/public/compose-output.png)

## 🤝 Contributing

We welcome contributions to DCM! Whether you want to add new container definitions, improve documentation, or fix bugs, your help is appreciated.

Please check our [CONTRIBUTING.md](CONTRIBUTING.md) guide for detailed instructions on:
- How to add new container definitions
- Code style guidelines
- Testing requirements
- Pull request process

The easiest way to contribute is by adding new container definitions to our growing collection!

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 💖 Support

If you find this tool useful, consider supporting the project by:

- ⭐ Starring the repository on GitHub
- 🐦 Sharing it on social media
- ☕ [Buying me a coffee](https://ko-fi.com/ajnart)

## 📞 Contact

- GitHub: [@ajnart](https://github.com/ajnart)

---

Made with ❤️ by [ajnart](https://github.com/ajnart) 
