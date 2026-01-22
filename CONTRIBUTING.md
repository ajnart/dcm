# Contributing to Docker Compose Maker

Thank you for your interest in contributing to DCM (Docker Compose Maker)! This document provides guidelines for contributing to the project, particularly for adding new container definitions.

## Adding New Containers

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
  id: "my-media-tool",
  name: "My Media Tool",
  description: "A description of what this container does.",
  category: "Media",
  tags: ["Streaming", "Media Server"],
  githubUrl: "https://github.com/user/my-media-tool",
  icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/my-media-tool.svg",
  composeContent: `services:
  my-media-tool:
    image: user/my-media-tool:latest
    container_name: \${CONTAINER_PREFIX}my-media-tool
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
    volumes:
      - \${CONFIG_PATH}/my-media-tool:/config
      - \${DATA_PATH}/media:/data
    ports:
      - 8123:8123
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