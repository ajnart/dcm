import { checkedDockerCliTlsRequest } from "../../types/docker-cli-tls.ts";

export const DOCKGE_COMPOSE_SOURCE = "https://github.com/louislam/dockge/blob/1.5.0/compose.yaml";
export const DOCKGE_IMAGE_SOURCE = "https://github.com/louislam/dockge/blob/1.5.0/docker/Dockerfile";
export const DOCKGE_SERVER_SOURCE = "https://github.com/louislam/dockge/blob/1.5.0/backend/dockge-server.ts";
export const DOCKER_CLI_TLS_SOURCE = "https://raw.githubusercontent.com/docker/cli/v27.3.1/cli/flags/options.go";
export const DOCKGE_SOCKET_SOURCE = "https://github.com/louislam/dockge/blob/1.5.0/backend/socket-handlers/main-socket-handler.ts";

export function checkedDockgeInputs(value: Readonly<Record<string, string>>) {
  if (Object.keys(value).sort().join(",") !== "docker-port,docker-private-ipv4,docker-server-name"
    || typeof value["docker-server-name"] !== "string"
    || value["docker-server-name"].length > 253
    || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value["docker-server-name"])
    || !/^[1-9][0-9]{0,4}$/.test(value["docker-port"] ?? "")
    || Number(value["docker-port"]) > 65535) {
    throw new Error("Dockge requires the exact separately approved remote Docker TLS DNS identity and port");
  }
  return { serverName: value["docker-server-name"], privateIpv4: value["docker-private-ipv4"], port: Number(value["docker-port"]) };
}

/** No socket and no caller-selected host filesystem. Common owners compile
 * the fixed TLS filenames and exact same-path private stack-directory claims. */
export function compileDockgeRecipe(inputs: Readonly<Record<string, string>>) {
  const endpoint = checkedDockgeInputs(inputs);
  const dockerCliTls = checkedDockerCliTlsRequest({ officialUrl: DOCKER_CLI_TLS_SOURCE, caFileId: "docker-ca",
    certificateFileId: "docker-certificate", keyFileId: "docker-key", endpoint });
  return {
    recipe: {
      schemaVersion: 2, kind: "multi-service-compose", appId: "dockge", source: DOCKGE_COMPOSE_SOURCE,
      services: [{ id: "dockge", purpose: "Private Compose manager with separately approved host-wide Docker mTLS authority and exact same-host private stack storage.",
        imageTag: "docker.io/louislam/dockge:1.5.0", imageSource: DOCKGE_IMAGE_SOURCE,
        user: "host-selected", imageUserEvidence: { officialUrl: DOCKGE_SERVER_SOURCE, reason: "official-image-runtime-contract" },
        restart: "unless-stopped", readOnly: false,
        environment: [{ name: "DOCKER_HOST", value: `tcp://${endpoint.serverName}:${endpoint.port}` },
          { name: "DOCKGE_DATA_DIR", value: "/app/data" }, { name: "DOCKGE_ENABLE_CONSOLE", value: "false" }],
        hostEnvironment: [], fileEnvironment: [],
        mounts: [{ name: "appdata", target: "/app/data" }], dependsOn: [], publishTargetPort: 5001,
        ownerDirectory: { kind: "docker-stack-directory", officialUrl: DOCKGE_COMPOSE_SOURCE },
        dockerCliTls,
      }],
      privateFiles: [{ id: "admin-password", bytes: 32, format: "alphanumeric" },
        ...["docker-ca", "docker-certificate", "docker-key"].map((id) => ({ id, source: "owner", maxBytes: 16384 }))],
      onboarding: { kind: "manual-first-admin", officialUrl: DOCKGE_SOCKET_SOURCE, username: "admin", fileId: "admin-password" },
      defaults: { hostIp: "127.0.0.1", publishedPort: 5001, dataDirectoryName: "dockge" },
      storage: { filesystem: "local-posix-locks", minimumFreeBytes: 1073741824 },
      acceptance: [
        { id: "first-owner", method: "api", description: "Require fresh empty-user-table setup event, create generated administrator once, then freshly verify password login and authenticated settings. JWT is a private session, not an API key." },
        { id: "management-authority", method: "persisted", description: "Before every startup verify exact approved host-wide mTLS Docker authority, local Unix and remote Engine ID equality, current host identity and same absolute private stack directory. No host socket is mounted." },
        { id: "stack-management", method: "api", description: "Separately approve an authorized disposable stack action and verify its resulting function. Administrator/settings readback and daemon identity are not stack-management acceptance." },
        { id: "restart-persistence", method: "persisted", description: "After a separately approved exact-owner restart, repeat saved-password login and authorized stack function readback." },
      ],
    },
    configuration: { ...endpoint, authorityMode: "docker-management-mtls", sameDaemonRequired: true,
      stackDirectoryScope: "current-project-private", managementVerified: false, restartPersistenceVerified: false },
    peerAppIds: [],
  };
}
