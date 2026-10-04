import { createHash, X509Certificate } from "node:crypto";
import { join } from "node:path";
import { lstat } from "node:fs/promises";
import { createSelfhostComposeOwner } from "./selfhost-compose.ts";
import { isSharedPrivateHttpsHostname } from "./shared-private-https.ts";
import { loadSharedProjectState, type SharedProjectState } from "./shared-project-state.ts";
import { loadSharedPrivateHttpsBinding, readSharedHttpsPrivateFile,
  restoreSharedPrivateHttpsSelection } from "./shared-private-https-state.ts";

export type SharedHttpsTarget = {
  schemaVersion: 1;
  kind: "shared-private-https-target";
  appId: string;
  projectId: string;
  ownerRevision: number;
  ownerRecordHash: string;
  manifestHash: string;
  bindingHash: string;
  hostname: string;
  port: number;
  origin: string;
  resolveAddress: "127.0.0.1";
  caPath: string;
  caSha256: string;
  proxyProfile?: { sourceSha256: string; status: "source-bound-route-unverified";
    protocolsVerified: false; proxySourceAddressVerified: false };
};

function fail(): never {
  throw new Error("Shared HTTPS setup target differs from its exact owner, route, or CA; no request was sent");
}

/** Public certificate only. No trust-store edits and no private-key access. */
export async function readSharedHttpsTargetCa(target: SharedHttpsTarget): Promise<Buffer> {
  if (target.kind !== "shared-private-https-target" || target.schemaVersion !== 1
    || target.resolveAddress !== "127.0.0.1"
    || !isSharedPrivateHttpsHostname(target.hostname)
    || !Number.isSafeInteger(target.port) || target.port < 1024 || target.port > 65535
    || target.origin !== `https://${target.hostname}:${target.port}`
    || !/^[a-f0-9]{64}$/.test(target.caSha256)) fail();
  const bytes = await readSharedHttpsPrivateFile(target.caPath, 65536);
  if (createHash("sha256").update(bytes).digest("hex") !== target.caSha256) fail();
  try {
    const pem = bytes.toString("ascii").trim();
    if (!/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----$/.test(pem)) fail();
    const cert = new X509Certificate(bytes);
    if (!cert.ca || !cert.checkIssued(cert) || !cert.verify(cert.publicKey)
      || Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) <= Date.now()) fail();
  } catch { fail(); }
  return bytes;
}

/** Resolve only an already-owned route, never caller-provided URL or CA references. */
export async function resolveSharedHttpsTarget(state: SharedProjectState,
  canonicalRecipe: Record<string, any>, appId: string): Promise<SharedHttpsTarget> {
  if (state.checkpoint.phase !== "completed") fail();
  const latest = await loadSharedProjectState(state.project.directory, state.project.id, state.manifestHash);
  if (latest?.recordHash !== state.recordHash) fail();
  const binding = await loadSharedPrivateHttpsBinding(state.project.directory, canonicalRecipe);
  const selection = restoreSharedPrivateHttpsSelection(state, canonicalRecipe, binding);
  const routes = binding.routes.filter((route) => route.appId === appId);
  if (routes.length !== 1) fail();
  const configPath = join(state.project.directory, "data", "caddy", "config-files", "caddyfile");
  const config = await readSharedHttpsPrivateFile(configPath, 256 * 1024);
  if (!config.equals(Buffer.from(selection.recipe.configFiles[0].content))) fail();
  const owner = createSelfhostComposeOwner(state.manifest);
  await owner.checkRendered(await owner.plan());
  const caPath = join(state.project.directory, "private-https-root.crt");
  const ca = await readSharedHttpsPrivateFile(caPath, 65536);
  const hostname = routes[0]!.hostname;
  const proxy = binding.proxyProfiles?.find((entry) => entry.profile.appId === appId);
  const target: SharedHttpsTarget = { schemaVersion: 1, kind: "shared-private-https-target",
    appId, projectId: state.project.id, ownerRevision: state.revision,
    ownerRecordHash: state.recordHash, manifestHash: state.manifestHash,
    bindingHash: binding.bindingHash, hostname, port: binding.port,
    origin: `https://${hostname}:${binding.port}`, resolveAddress: "127.0.0.1",
    caPath, caSha256: createHash("sha256").update(ca).digest("hex"),
    ...(proxy && { proxyProfile: { sourceSha256: proxy.sourceSha256,
      status: "source-bound-route-unverified" as const, protocolsVerified: false as const,
      proxySourceAddressVerified: false as const } }) };
  await readSharedHttpsTargetCa(target);
  return target;
}

/** Reconstruct before both reads and approved mutations; changed targets require new review. */
export async function validateSharedHttpsTarget(target: SharedHttpsTarget,
  state: SharedProjectState, canonicalRecipe: Record<string, any>): Promise<void> {
  const current = await resolveSharedHttpsTarget(state, canonicalRecipe, target.appId);
  if (JSON.stringify(target) !== JSON.stringify(current)) fail();
}

/** An unconfigured app keeps its owned backend route; a configured TLS route must not downgrade. */
export async function resolveOptionalSharedHttpsTarget(state: SharedProjectState,
  canonicalRecipe: Record<string, any>, appId: string): Promise<SharedHttpsTarget | null> {
  if (!Object.hasOwn(state.units, "caddy")) return null;
  try { await lstat(join(state.project.directory, "private-https-binding.json")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const binding = await loadSharedPrivateHttpsBinding(state.project.directory, canonicalRecipe);
  if (!binding.routes.some((route) => route.appId === appId)) return null;
  return resolveSharedHttpsTarget(state, canonicalRecipe, appId);
}
