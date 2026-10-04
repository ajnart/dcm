/** Pinned WUD 9.1.0 accepts host/port and CA, certificate and key file paths.
 * This prepares non-secret settings only; it neither deploys nor authorizes a watcher.
 * Dockerode receives these files and chooses TLS. No socket/proxy is provisioned.
 */
export type RemoteWatcherChoice = {
  serverName: string;
  port: number;
  caFileId: string;
  certificateFileId: string;
  keyFileId: string;
};

export function prepareRemoteWatcher(choice: RemoteWatcherChoice): {
  stage: "docker-inventory-authority-required";
  environment: Array<{ name: string; value: string }>;
  privateFileIds: string[];
  connectionVerified: false;
  authorizationVerified: false;
  deployable: false;
} {
  if (!choice || Object.keys(choice).sort().join(",") !== "caFileId,certificateFileId,keyFileId,port,serverName"
    || typeof choice.serverName !== "string" || choice.serverName.length > 253
    || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(choice.serverName)
    || !Number.isSafeInteger(choice.port) || choice.port < 1 || choice.port > 65535) {
    throw new Error("WUD needs one exact TLS DNS name and port; credentials, URLs and socket paths are not choices");
  }
  const refs = [choice.caFileId, choice.certificateFileId, choice.keyFileId];
  if (refs.some((ref) => typeof ref !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(ref) || ref.length > 64)
    || new Set(refs).size !== 3) throw new Error("WUD needs three distinct opaque private TLS file references");
  return { stage: "docker-inventory-authority-required", privateFileIds: refs,
    environment: [
      { name: "WUD_WATCHER_DOCKER_APPROVED_HOST", value: choice.serverName },
      { name: "WUD_WATCHER_DOCKER_APPROVED_PORT", value: String(choice.port) },
      { name: "WUD_WATCHER_DOCKER_APPROVED_CAFILE", value: `/run/secrets/${choice.caFileId}` },
      { name: "WUD_WATCHER_DOCKER_APPROVED_CERTFILE", value: `/run/secrets/${choice.certificateFileId}` },
      { name: "WUD_WATCHER_DOCKER_APPROVED_KEYFILE", value: `/run/secrets/${choice.keyFileId}` },
      { name: "WUD_WATCHER_DOCKER_APPROVED_WATCHBYDEFAULT", value: "false" },
      { name: "WUD_WATCHER_DOCKER_APPROVED_WATCHEVENTS", value: "false" }
    ], connectionVerified: false, authorizationVerified: false, deployable: false };
}
