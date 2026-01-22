# Contributing to Docker Compose Maker

Thank you for your interest in contributing to DCM (Docker Compose Maker)! This document provides guidelines for contributing to the project, particularly for adding new container definitions.

## Adding New Containers

The easiest way to contribute is by adding new container definitions! We now have an **automated system** that creates pull requests from GitHub issues.

### Option 1: Use the GitHub Issue Template (Recommended)

1. [Open a new Container Submission issue](https://github.com/ajnart/dcm/issues/new?template=container-submission.yml)
2. Fill out all required fields following the examples provided
3. Submit the issue
4. When a maintainer tags the issue as "accepted", a GitHub Action will automatically create a pull request with your container definition!

### Option 2: Contribute Directly

The project organizes container definitions in the `tools/` directory. Each file represents a category of tools, and all tools are exported from the `tools/index.ts` file.

### File Structure

The `tools/` directory contains the following files (as of 2025-03-20):

- `automation.ts` - Home automation and related containers
- `database.ts` - Database containers (MySQL, PostgreSQL, etc.)
- `management.ts` - Management tools (Portainer, etc.)
- `media.ts` - Media servers and related tools
- `monitoring.ts` - Monitoring solutions
- `other.ts` - Miscellaneous containers
- `index.ts` - Exports all container arrays

### Container Definition Format

Each container is defined as a `DockerTool` object with the following properties:

```typescript
interface DockerTool {
  id: string;                // Unique identifier (lowercase, no spaces)
  name: string;              // Display name
  description: string;       // Brief description of the container
  category: string;          // Category (Media, Database, etc.)
  tags: string[];            // Array of tags for filtering
  githubUrl?: string;        // Optional GitHub URL for star count
  icon?: string;             // Optional icon URL (preferably SVG)
  stars?: number;            // GitHub stars (fetched automatically, don't set manually)
  composeContent?: string;   // Docker Compose YAML definition
  isUnsupported?: boolean;   // Optional flag for unsupported containers
}
```

### How to Add a New Container

1. Identify the appropriate category file in the `tools/` directory.
2. Add your container definition to the appropriate array.
3. Ensure the `tools/index.ts` file includes your category file (if it's a new category).

#### Example: Adding a New Media Container

1. Open `tools/media.ts`
2. Add your definition to the `media` array:

```typescript
{
  id: "jellyfin",
  name: "Jellyfin",
  description: "A free software media system that puts you in control of managing and streaming your media. It is an alternative to the proprietary Emby and Plex, with no premium features behind a paywall.",
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
    restart: \${RESTART_POLICY}`
}
```

#### Example: Adding a Database Container

1. Open `tools/database.ts`
2. Add your definition to the `databases` array:

```typescript
{
  id: "postgres",
  name: "PostgreSQL",
  description: "PostgreSQL is a powerful, open source object-relational database system with over 35 years of active development that has earned it a strong reputation for reliability, feature robustness, and performance.",
  category: "Database",
  tags: ["Database", "SQL", "Relational"],
  githubUrl: "https://github.com/postgres/postgres",
  icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/postgres.svg",
  composeContent: `services:
  postgres:
    image: postgres:16-alpine
    container_name: \${CONTAINER_PREFIX}postgres
    environment:
      - POSTGRES_USER=\${POSTGRES_USER:-postgres}
      - POSTGRES_PASSWORD=\${POSTGRES_PASSWORD}
      - POSTGRES_DB=\${POSTGRES_DB:-postgres}
      - TZ=\${TZ}
    volumes:
      - \${DATA_PATH}/postgres:/var/lib/postgresql/data
    ports:
      - 5432:5432
    restart: \${RESTART_POLICY}`
}
```

#### Creating a New Category

If you need to create a new category:

1. Create a new file in the `tools/` directory (e.g., `newcategory.ts`)
2. Define your array:

```typescript
import type { DockerTool } from "@/lib/docker-tools";

export const newcategory: DockerTool[] = [
  // Your container definitions here
];
```

3. Add the new category to `tools/index.ts`:

```typescript
import { newcategory } from "./newcategory";

export const tools = [
  // ...existing imports
  ...newcategory,
];
```

### Docker Compose Template Guidelines

When writing the `composeContent` for a container:

1. Use environment variables for common settings:
   - `${PUID}` - User ID
   - `${PGID}` - Group ID
   - `${TZ}` - Timezone
   - `${UMASK}` - UMASK value
   - `${CONFIG_PATH}` - Base path for config volumes
   - `${DATA_PATH}` - Base path for data volumes
   - `${CONTAINER_PREFIX}` - Prefix for container names
   - `${RESTART_POLICY}` - Restart policy

2. Format the YAML with consistent indentation (2 spaces).

3. Include comments for optional or less common settings.

### Testing Your Changes

After adding your container definition:

1. Run the application locally to verify it appears correctly.
2. Test generating a docker-compose file with your container.
3. Verify the generated docker-compose file works correctly when deployed.
4. Run the automated tests to ensure your container passes validation:

```bash
# Test your container's Docker Compose validation
bun test:compose

# Test your container passes the schema validation
bun test:containers
```

All tests should pass before submitting a pull request. The tests validate:
- That your Docker Compose template is syntactically valid
- That proper environment variables are used
- That the container definition follows the required schema

## Submitting Your Changes

1. Create a fork of the repository.
2. Create a branch for your changes.
3. Commit your changes with a clear commit message.
4. Open a pull request, detailing the containers you've added.

Thank you for helping improve Docker Compose Maker! 