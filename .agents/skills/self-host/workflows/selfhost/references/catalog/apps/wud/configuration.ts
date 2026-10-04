import { createHash } from "node:crypto";
import { prepareRemoteWatcher } from "./remote-watcher.ts";

export const WUD_DOCKER_SOURCE = "https://raw.githubusercontent.com/getwud/wud/9.1.0/app/watchers/providers/docker/Docker.ts";
export const WUD_FILE_SOURCE = "https://raw.githubusercontent.com/getwud/wud/9.1.0/app/configuration/index.ts";
export const WUD_AUTH_SOURCE = "https://raw.githubusercontent.com/getwud/wud/9.1.0/app/store/auth_bootstrap.ts";
export const WUD_IMAGE_SOURCE = "https://raw.githubusercontent.com/getwud/wud/9.1.0/Dockerfile";

/** Pure selection only. The remote Docker endpoint is powerful authority, even
 * with WATCHBYDEFAULT=false. Never register/apply without a separate exact
 * endpoint/TLS/scope authority approval; labels are not an API ACL boundary. */
export function compileWudRecipe(serverName: string, portValue: string, watchedContainerId: string,
  mode = "docker-inventory-mtls") {
  if (!["docker-inventory-mtls", "docker-management-mtls"].includes(mode)) {
    throw new Error("WUD Docker authority mode differs");
  }
  if (!/^[1-9][0-9]{0,4}$/.test(portValue) || !/^[0-9a-f]{64}$/.test(watchedContainerId)) {
    throw new Error("WUD needs an exact decimal TLS port and full authorized container ID");
  }
  const choice = { serverName, port: Number(portValue), caFileId: "docker-ca",
    certificateFileId: "docker-certificate", keyFileId: "docker-key" };
  const prepared = prepareRemoteWatcher(choice);
  const authority = { kind: "remote-docker-api" as const, serverName, port: choice.port,
    privateFileIds: prepared.privateFileIds, watchedContainerId,
    watchScope: "only-containers-with-wud.watch=true", mutatingOperations: "must-be-denied-by-endpoint-owner" };
  if (mode === "docker-management-mtls") authority.mutatingOperations = "explicitly-approved-host-wide-docker-control";
  const authorityFingerprint = createHash("sha256").update(JSON.stringify(authority)).digest("hex");
  const environment = prepared.environment.filter((entry) => !entry.name.endsWith("FILE"));
  environment.push({ name: "WUD_AUTH_ADMIN_USER", value: "admin" },
    { name: "WUD_SERVER_FEATURE_DELETE", value: "false" });
  const recipe = {
    schemaVersion: 2, kind: "multi-service-compose", appId: "wud", source: WUD_DOCKER_SOURCE,
    services: [{ id: "wud", purpose: "Private image-update inventory from one separately approved owner-issued remote Docker TLS endpoint; no updates executed.",
      imageTag: "getwud/wud:9.1.0", imageSource: WUD_IMAGE_SOURCE,
      user: "image-default", imageUserEvidence: { officialUrl: WUD_IMAGE_SOURCE, reason: "official-image-runtime-contract" },
      restart: "unless-stopped", readOnly: true, environment, hostEnvironment: [],
      fileEnvironment: [
        { name: "WUD_AUTH_ADMIN_PASSWORD__FILE", fileId: "admin-password" },
        { name: "WUD_WATCHER_DOCKER_APPROVED_CAFILE", fileId: "docker-ca", format: "file-path", officialUrl: WUD_DOCKER_SOURCE },
        { name: "WUD_WATCHER_DOCKER_APPROVED_CERTFILE", fileId: "docker-certificate", format: "file-path", officialUrl: WUD_DOCKER_SOURCE },
        { name: "WUD_WATCHER_DOCKER_APPROVED_KEYFILE", fileId: "docker-key", format: "file-path", officialUrl: WUD_DOCKER_SOURCE },
      ],
      mounts: [{ name: "state", target: "/store", kind: "volume" }],
      dependsOn: [], publishTargetPort: 3000 }],
    privateFiles: [{ id: "admin-password", bytes: 48, format: "alphanumeric" },
      ...prepared.privateFileIds.map((id) => ({ id, source: "owner", maxBytes: 16384 }))],
    onboarding: { kind: "initial-admin-from-file", officialUrl: WUD_AUTH_SOURCE,
      username: "admin", usernameEnvironment: "WUD_AUTH_ADMIN_USER",
      fileEnvironment: "WUD_AUTH_ADMIN_PASSWORD__FILE", fileId: "admin-password" },
    defaults: { hostIp: "127.0.0.1", publishedPort: 18083, dataDirectoryName: "wud" },
    storage: { filesystem: "local-posix-locks", minimumFreeBytes: 1073741824 },
    acceptance: [
      { id: "administrator-and-inventory", method: "api", description: "Verify exact local administrator, anonymous denial and selected container image inventory; does not verify Docker endpoint ACLs or current scans." },
      { id: "docker-authority", method: "persisted", description: "Separately approve exact remote endpoint, owner-issued TLS credentials and opted-in scope; directly observe mutating operations denied before claiming least-privilege authority." },
      { id: "restart-persistence", method: "persisted", description: "After separately approved exact-owner restart, reverify saved administrator and refreshed image-update inventory." },
    ],
  };
  if (mode === "docker-management-mtls") {
    recipe.services[0]!.purpose = "Private image-update monitoring with separately approved host-wide remote Docker control credentials; labels do not restrict credential authority; no updates executed.";
    recipe.acceptance[1]!.description = "Separately disclose and approve host-wide Docker Engine control; verify exact endpoint, owner-issued TLS credentials and common pre-start binding on every start. This is not read-only inventory authority.";
  }
  return { recipe, configuration: { ...authority, authorityFingerprint, authorityApprovalRequired: true,
    dockerAuthorizationVerified: false, restartPersistenceVerified: false } };
}
