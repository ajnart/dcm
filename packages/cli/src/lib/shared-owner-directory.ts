import { spawnSync } from "node:child_process";
import { constants, lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { checkedOwnerDirectoryClaim, ownerDirectoryClaim, ownerDirectoryFields,
  assertOwnerDirectoryService } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/owner-directory.ts";
import { installedCliRoot } from "./installed-cli-root.ts";
import type { SharedPrestartContext } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/pre-start.ts";

type Entry = Record<string, any>;
function fail(): never { throw new Error("Owned stack directory requires exact owner identity and approved same local rootful Docker daemon; inspect before startup"); }
function catalogDirectory(): URL {
  const own = new URL(import.meta.url);
  if (own.pathname.endsWith(".ts")) return new URL("../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/", own);
  return new URL("workflows/selfhost/references/catalog/", installedCliRoot(import.meta.url));
}
export function compileSharedOwnerDirectory(recipe: Entry, service: Entry, image: string,
  projectDirectory: string, dataDirectory: string) {
  if (service.user !== "host-selected" || dataDirectory !== join(projectDirectory, "data", recipe.appId)) fail();
  const claim = ownerDirectoryClaim(new URL(`apps/${recipe.appId}/`, catalogDirectory()),
    recipe.appId, service.id, image, service.ownerDirectory);
  return { claim, fields: ownerDirectoryFields(projectDirectory, recipe.appId) };
}
/** Metadata only; never read stack contents or repair an existing directory. */
export function verifyOwnedDirectoryIdentity(projectDirectory: string, appId: string,
  user: string, expectedUid: number, expectedGid: number): void {
  if (!Number.isSafeInteger(expectedUid) || expectedUid <= 0 || !Number.isSafeInteger(expectedGid) || expectedGid <= 0
    || user !== `${expectedUid}:${expectedGid}` || expectedUid !== process.getuid?.() || expectedGid !== process.getgid?.()) fail();
  const path = ownerDirectoryFields(projectDirectory, appId).path;
  for (const source of [projectDirectory, join(projectDirectory, "data"), join(projectDirectory, "data", appId), path]) {
    const metadata = lstatSync(source);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(source) !== source
      || metadata.uid !== expectedUid || metadata.gid !== expectedGid || (metadata.mode & 0o7777) !== 0o700) fail();
  }
}
type LocalDaemonObservation = { engineId: string; endpoint: string; securityOptions: string[] };
type LocalDaemonFacilities = {
  revalidate(): Promise<void>;
  /** Code-owned fixture seam only; never supplied by CLI, adapter or owner JSON. */
  query?(context: string, argv: string[]): string;
  socketMetadata?(path: string): { uid: number; mode: number; dev: number; ino: number; realPath: string };
};
function socketMetadata(path: string) {
  const metadata = lstatSync(path);
  return { uid: metadata.uid, mode: metadata.mode, dev: metadata.dev, ino: metadata.ino, realPath: realpathSync(path) };
}
function queryDocker(context: string, argv: string[]): string {
  const result = spawnSync("docker", ["--context", context, ...argv], {
    encoding: "utf8", timeout: 10000, maxBuffer: 65536, stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) fail();
  return result.stdout.trim();
}
/** Exact context and allowlisted fields only. No daemon management operation. */
export async function observeLocalRootfulDaemon(context: string,
  facilities: LocalDaemonFacilities): Promise<LocalDaemonObservation> {
  if (typeof context !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(context)
    || ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"].some((name) => Object.hasOwn(process.env, name))) fail();
  const query = facilities.query ?? queryDocker;
  await facilities.revalidate();
  const readEndpoint = () => {
    let endpoint: unknown;
    try { endpoint = JSON.parse(query(context, ["context", "inspect", context, "--format", "{{json .Endpoints.docker.Host}}"])); }
    catch { fail(); }
    if (endpoint !== "unix:///var/run/docker.sock" && endpoint !== "unix:///run/docker.sock") fail();
    return endpoint;
  };
  const endpoint = readEndpoint();
  const socketPath = endpoint.slice("unix://".length);
  const readSocket = facilities.socketMetadata ?? socketMetadata;
  const socket = readSocket(socketPath);
  if ((socket.mode & constants.S_IFMT) !== constants.S_IFSOCK || socket.uid !== 0
    || !["/var/run/docker.sock", "/run/docker.sock"].includes(socket.realPath)) fail();
  await facilities.revalidate();
  let info: unknown;
  try { info = JSON.parse(query(context, ["info", "--format", '{"engineId":{{json .ID}},"securityOptions":{{json .SecurityOptions}},"operatingSystem":{{json .OperatingSystem}}}'])); }
  catch { fail(); }
  const row = info as Record<string, unknown>;
  if (!row || Object.keys(row).sort().join(",") !== "engineId,operatingSystem,securityOptions"
    || typeof row.engineId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,127}$/.test(row.engineId)
    || typeof row.operatingSystem !== "string" || row.operatingSystem.length < 1 || row.operatingSystem.length > 256
    || /docker desktop|boot2docker/i.test(row.operatingSystem)
    || !Array.isArray(row.securityOptions) || row.securityOptions.some((value) => typeof value !== "string" || /rootless|userns/i.test(value))) fail();
  await facilities.revalidate();
  if (readEndpoint() !== endpoint) fail();
  if (JSON.stringify(readSocket(socketPath)) !== JSON.stringify(socket)) fail();
  await facilities.revalidate();
  return { engineId: row.engineId, endpoint, securityOptions: row.securityOptions as string[] };
}
/** Source/replay and authority own every observation. There is no caller pass
 * flag, serialized same-host proof, or arbitrary selected source path. */
export async function requireSharedOwnerDirectory(context: SharedPrestartContext): Promise<void> {
  await context.revalidate();
  if (!context.derived || context.derived.selection.appId !== context.appId) fail();
  const selected = context.manifest.services.filter((service: Entry) => context.serviceIds.includes(service.id) && service.ownerDirectory);
  if (selected.length !== 1 || selected[0].id !== context.appId) fail();
  const service = selected[0];
  const claim = checkedOwnerDirectoryClaim(catalogDirectory(), service.id, service.image, service.ownerDirectory);
  assertOwnerDirectoryService(context.state.project.directory, service, claim);
  verifyOwnedDirectoryIdentity(context.state.project.directory, context.appId, service.user,
    context.state.settings.uid, context.state.settings.gid);
  const { requireSharedDockerAuthorityForStart, sharedUnitDockerAuthorityBinding,
    loadSharedDockerAuthorityInput } = await import("./shared-docker-authority.ts");
  const authorityBinding = await sharedUnitDockerAuthorityBinding(context.state, context.appId);
  const authority = await loadSharedDockerAuthorityInput(authorityBinding);
  const endpoint = service.dockerCliTls?.endpoint;
  if (!endpoint || authority.mode !== "docker-management-mtls"
    || endpoint.serverName !== authority.endpoint.serverName
    || endpoint.privateIpv4 !== authority.endpoint.privateIpv4 || endpoint.port !== authority.endpoint.port) fail();
  await context.revalidate();
  // The authority owner loads approved, source-bound management intent and
  // verifies a fresh fixed GET /info with the exact mTLS/certificate identities.
  const remote = await requireSharedDockerAuthorityForStart(context.state, context.appId, context.revalidate);
  const local = await observeLocalRootfulDaemon(context.state.project.dockerContext, { revalidate: context.revalidate });
  if (!remote.usableForApplicationSetup || remote.engineId !== local.engineId) fail();
  await context.revalidate();
  verifyOwnedDirectoryIdentity(context.state.project.directory, context.appId, service.user,
    context.state.settings.uid, context.state.settings.gid);
}
