import { createHash } from "node:crypto";
import type { SharedProjectState } from "./shared-project-state.ts";
import { sharedProjectCandidate, type SharedProjectInput } from "./shared-compose-project.ts";

export type SharedServiceTarget = {
  appId: string;
  serviceId: string;
  hostname: string;
  targetPort: number;
  publishedPort: number;
  hostIp: "127.0.0.1" | "::1";
  frontNetworkId: "front";
  frontNetworkName: string;
  projectId: string;
  image: string;
  selectionFingerprint: string;
  ownerFingerprint: string;
  targetFingerprint: string;
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fail(message: string): never {
  throw new Error(`Shared service target: ${message}`);
}

/** Pure target resolution, not live reachability, isolation or exposure approval.
 * Call only with the exact state returned by the shared owner loader. No caller
 * hostname, arbitrary backend URL, database or helper-service selection exists.
 */
export function resolveSharedServiceTarget(state: SharedProjectState, targetAppId: string): SharedServiceTarget {
  if (!state || state.schemaVersion !== 1 || state.checkpoint?.phase !== "completed"
    || !Number.isSafeInteger(state.revision) || state.revision < 1
    || !Number.isSafeInteger(state.manifestRevision) || state.manifestRevision < 1
    || !/^[0-9a-f]{64}$/.test(state.recordHash ?? "")
    || state.manifestHash !== hash(state.manifest)) fail("needs one completed hash-bound shared owner");
  const { recordHash, ...record } = state;
  if (recordHash !== hash(record)) fail("saved owner record differs");
  const ownerFingerprint = hash({ project: state.project, revision: state.revision,
    manifestRevision: state.manifestRevision, recordHash, manifestHash: state.manifestHash });
  return resolveTarget(state, targetAppId, ownerFingerprint);
}

/** New-project planning only. Pins and private topology come from the same
 * real candidate compiler; this makes no saved-owner or runtime claim. */
export function resolvePlannedSharedServiceTarget(input: SharedProjectInput,
  targetAppId: string): SharedServiceTarget {
  const candidate = sharedProjectCandidate(input);
  const { ownership: _ownership, ...project } = candidate.manifest.project;
  return resolveTarget({ ...candidate, project }, targetAppId,
    hash({ kind: "new-shared-project", project, settings: candidate.settings,
      manifest: candidate.manifest, selectionFingerprints: candidate.selectionFingerprints }));
}

function resolveTarget(state: Pick<SharedProjectState, "project" | "manifest" | "units" | "selectionFingerprints">,
  targetAppId: string, ownerFingerprint: string): SharedServiceTarget {
  const projectId = state.project?.id;
  if (typeof projectId !== "string" || !/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(projectId)
    || state.project.owner !== projectId || state.manifest.project?.id !== projectId
    || state.manifest.project?.owner !== projectId
    || state.manifest.project?.directory !== state.project.directory
    || state.manifest.project?.root !== state.project.root
    || state.manifest.project?.dockerContext !== state.project.dockerContext) fail("owner identity differs");
  if (typeof targetAppId !== "string" || targetAppId.length > 47
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(targetAppId)
    || !Object.hasOwn(state.units, targetAppId)
    || !Array.isArray(state.units[targetAppId])
    || !state.units[targetAppId]!.includes(targetAppId)
    || !/^[0-9a-f]{64}$/.test(state.selectionFingerprints[targetAppId] ?? "")) {
    fail("target must explicitly name a selected application frontend");
  }
  const services = state.manifest.services.filter((service) => service.id === targetAppId);
  if (services.length !== 1) fail("target frontend identity is ambiguous");
  const service = services[0]!;
  const networks = state.manifest.networks.filter((network) => network.id === "front");
  if (networks.length !== 1 || networks[0]!.name !== `${projectId}-front`
    || networks[0]!.owner !== projectId || networks[0]!.driver !== "bridge"
    || !["new", "verified-existing"].includes(networks[0]!.ownership)
    || !Array.isArray(service.networks) || !service.networks.includes("front")) {
    fail("target must join the exact same-owner front bridge");
  }
  if (typeof service.image !== "string" || !/^[^\s@]+@sha256:[0-9a-f]{64}$/.test(service.image)
    || service.operation === "manual-job" || service.restart === "no") fail("target needs a pinned long-running frontend");
  if (!Array.isArray(service.ports) || service.ports.length !== 1) fail("target frontend port is ambiguous");
  const port = service.ports[0]!;
  if (!["127.0.0.1", "::1"].includes(port.hostIp) || port.protocol !== "tcp"
    || !["admin", "private-admin", "application"].includes(port.purpose)
    || port.publicApproved !== false || !Number.isInteger(port.target)
    || port.target < 1 || port.target > 65535 || !Number.isInteger(port.published)
    || port.published < 1024 || port.published > 65535) {
    fail("target needs one private loopback TCP application/admin binding");
  }
  const target = { appId: targetAppId, serviceId: targetAppId, hostname: targetAppId,
    targetPort: port.target as number, publishedPort: port.published as number,
    hostIp: port.hostIp as "127.0.0.1" | "::1", frontNetworkId: "front" as const,
    frontNetworkName: networks[0]!.name as string, projectId, image: service.image,
    selectionFingerprint: state.selectionFingerprints[targetAppId]!, ownerFingerprint };
  return { ...target, targetFingerprint: hash({ ...target, service, network: networks[0] }) };
}
