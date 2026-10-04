import { createHash } from "node:crypto";
import { request } from "node:https";
import { join } from "node:path";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { loadSharedDerivedRecipeBindingSync } from "../lib/shared-derived-recipe-state.ts";
import { serializePrivateConfigEnvironment } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/private-config-environment.ts";
import { checkDockerApiAuthorityDirectory } from "../lib/docker-api-authority-state.ts";
import { readSharedHttpsPrivateFile } from "../lib/shared-private-https-state.ts";
import { loadSharedProjectState, type SharedProjectState } from "../lib/shared-project-state.ts";

/** A read approval is not public-exposure consent. No endpoint/header/file path
 * is selected by an app adapter. Import the credential through owner privateFiles. */
export type CloudflareProviderScope = {
  schemaVersion: 1;
  ownerManifestHash: string;
  accountId: string;
  tunnelId: string;
  zoneId: string;
  hostname: string;
  accessApplicationId: string;
  accountOwner: string;
  dnsOwner: string;
  tlsOwner: string;
  authenticationOwner: string;
  credentialSha256: string;
  readApproval: string;
};
export type CloudflareProviderObservation = {
  scope: Omit<CloudflareProviderScope, "readApproval">;
  account: Record<string, any>;
  tunnel: Record<string, any>;
  ipRoutes: readonly Record<string, any>[];
  hostnameRoutes: readonly Record<string, any>[];
  accessApplication: Record<string, any>;
  accessPolicies: readonly Record<string, any>[];
  zone: Record<string, any>;
  dnsRecords: readonly Record<string, any>[];
  ssl: Record<string, any>;
  certificates: readonly Record<string, any>[];
  observedAt: number;
  fingerprint: string;
};
// App adapters and the owner may be independently bundled. Share only object
// identity attestations across those bundles; never persist/reconstruct proof.
const observationKey = Symbol.for("selfhost.cloudflare-provider.observations.v1");
const runtime = globalThis as typeof globalThis & { [observationKey]?: WeakMap<object, string> };
runtime[observationKey] ??= new WeakMap<object, string>();
const minted = runtime[observationKey];
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sha = /^[0-9a-f]{64}$/;
const id = /^[0-9a-f]{32}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function fail(): never { throw new Error("Cloudflare exact-owner provider read failed; private payload withheld"); }
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, any>;
}
export function cloudflareProviderReadApproval(scope: Omit<CloudflareProviderScope, "readApproval">): string {
  return `CLOUDFLARE-READ:${hash(scope)}`;
}
function checkedScope(value: unknown, state: SharedProjectState): CloudflareProviderScope {
  const scope = object(value);
  if (Object.keys(scope).sort().join(",") !== "accessApplicationId,accountId,accountOwner,authenticationOwner,credentialSha256,dnsOwner,hostname,ownerManifestHash,readApproval,schemaVersion,tlsOwner,tunnelId,zoneId"
    || scope.schemaVersion !== 1 || scope.ownerManifestHash !== state.manifestHash
    || !id.test(scope.accountId) || !id.test(scope.zoneId) || !uuid.test(scope.tunnelId)
    || !uuid.test(scope.accessApplicationId) || !sha.test(scope.credentialSha256)
    || typeof scope.hostname !== "string" || scope.hostname.length > 253
    || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(scope.hostname)
    || [scope.accountOwner, scope.dnsOwner, scope.tlsOwner, scope.authenticationOwner]
      .some((owner) => typeof owner !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(owner))) fail();
  const { readApproval, ...input } = scope;
  if (readApproval !== cloudflareProviderReadApproval(input as Omit<CloudflareProviderScope, "readApproval">)) fail();
  return scope as CloudflareProviderScope;
}

/** Fixed HTTPS GET; system TLS trust, no proxy, redirect, cookies, retries or
 * custom CA. Node keeps the bearer out of argv and temporary request files. */
async function get(path: string, credential: string): Promise<Record<string, any>> {
  return await new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Cloudflare provider GET failed; payload withheld"));
    const client = request({ hostname: "api.cloudflare.com", port: 443, method: "GET",
      path: `/client/v4${path}`, agent: false, rejectUnauthorized: true,
      headers: { authorization: `Bearer ${credential}`, accept: "application/json" },
      maxHeaderSize: 16384 }, (response) => {
      if (response.statusCode !== 200 || response.headers.location
        || !String(response.headers["content-type"]).toLowerCase().startsWith("application/json")) {
        response.destroy(); abort(); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (bytes: Buffer) => {
        size += bytes.length;
        if (size > 1024 * 1024) { response.destroy(); abort(); return; }
        chunks.push(bytes);
      });
      response.on("error", abort);
      response.on("end", () => {
        try {
          const body = object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          if (body.success !== true || !Array.isArray(body.errors) || body.errors.length
            || !Array.isArray(body.messages) || body.messages.length) fail();
          resolve(body);
        } catch { abort(); }
      });
    });
    const deadline = setTimeout(() => { client.destroy(); abort(); }, 15000);
    client.on("close", () => clearTimeout(deadline));
    client.on("error", abort);
    client.end();
  });
}

/** Only this producer mints accepted observations; JSON copies are not proof. */
export function assertActualCloudflareProviderObservation(value: CloudflareProviderObservation): void {
  const { observedAt, fingerprint, ...inventory } = value;
  if (minted.get(value) !== fingerprint || hash(inventory) !== fingerprint
    || !Number.isSafeInteger(observedAt) || Date.now() < observedAt || Date.now() - observedAt > 30000) fail();
}

/** The future start gate calls this with its loaded shared owner, not status
 * JSON. The fixed scope record is separate from the imported API credential.
 * The local recipe keeps enrollment JSON in the private environment file. */
export async function readCloudflareProvider(state: SharedProjectState,
  revalidate: () => Promise<void>): Promise<CloudflareProviderObservation> {
  await checkDockerApiAuthorityDirectory(state.project.directory, state.project.id);
  await checkDockerApiAuthorityDirectory(join(state.project.directory, "secrets"), "secrets");
  await checkDockerApiAuthorityDirectory(join(state.project.directory, "secrets", "cloudflare-tunnel"), "cloudflare-tunnel");
  const scopePath = join(state.project.directory, "cloudflare-provider-scope.json");
  const scopeBytes = await readSharedHttpsPrivateFile(scopePath, 16384);
  let scope: CloudflareProviderScope;
  try { scope = checkedScope(JSON.parse(scopeBytes.toString("utf8")), state); } catch { fail(); }
  const credentialPath = join(state.project.directory, "secrets", "cloudflare-tunnel", "provider-api-token");
  const credentialBytes = await readSharedHttpsPrivateFile(credentialPath, 4096);
  if (createHash("sha256").update(credentialBytes).digest("hex") !== scope.credentialSha256) fail();
  const credential = credentialBytes.toString("utf8").trim();
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(credential)) fail();
  const observedAt = Date.now();
  async function current() {
    await revalidate();
    const owner = await loadSharedProjectState(state.project.directory, state.project.id);
    if (!owner || owner.recordHash !== state.recordHash || owner.manifestHash !== state.manifestHash
      || owner.checkpoint.phase === "inspect-required"
      || !(await readSharedHttpsPrivateFile(scopePath, 16384)).equals(scopeBytes)
      || !(await readSharedHttpsPrivateFile(credentialPath, 4096)).equals(credentialBytes)) fail();
  }
  async function one(path: string) { await current(); const body = await get(path, credential); await current(); return object(body.result); }
  async function list(path: string, perPage = 100) {
    const rows: Record<string, any>[] = [];
    let total: number | undefined;
    for (let page = 1; page <= 10; page++) {
      await current();
      let separator = "?";
      if (path.includes("?")) separator = "&";
      const body = await get(`${path}${separator}page=${page}&per_page=${perPage}`, credential);
      await current();
      const info = object(body.result_info);
      if (!Array.isArray(body.result) || info.page !== page || info.per_page !== perPage
        || info.count !== body.result.length || !Number.isSafeInteger(info.total_count)
        || info.total_count < 0 || info.total_count > 1000
        || (total !== undefined && total !== info.total_count)) fail();
      total = info.total_count;
      rows.push(...body.result.map(object));
      if (rows.length === total) return rows;
      if (rows.length > total || body.result.length !== perPage) fail();
    }
    fail();
  }
  const accountPath = `/accounts/${scope.accountId}`;
  const zonePath = `/zones/${scope.zoneId}`;
  const { readApproval: _approval, ...input } = scope;
  const inventory = { scope: input,
    account: await one(accountPath),
    tunnel: await one(`${accountPath}/cfd_tunnel/${scope.tunnelId}`),
    ipRoutes: await list(`${accountPath}/teamnet/routes?tunnel_id=${scope.tunnelId}&is_deleted=false`),
    hostnameRoutes: await list(`${accountPath}/zerotrust/routes/hostname?tunnel_id=${scope.tunnelId}&is_deleted=false`),
    accessApplication: await one(`${accountPath}/access/apps/${scope.accessApplicationId}`),
    accessPolicies: await list(`${accountPath}/access/apps/${scope.accessApplicationId}/policies`),
    zone: await one(zonePath),
    dnsRecords: await list(`${zonePath}/dns_records?name=${encodeURIComponent(scope.hostname)}`),
    ssl: await one(`${zonePath}/settings/ssl`),
    certificates: await list(`${zonePath}/ssl/certificate_packs?deploy=production`, 50),
  };
  const observation = { ...inventory, observedAt, fingerprint: hash(inventory) };
  minted.set(observation, observation.fingerprint);
  assertActualCloudflareProviderObservation(observation);
  return observation;
}

async function immutablePrivate(path: string, value: unknown): Promise<void> {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  try {
    const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") fail(); }
  if (!(await readSharedHttpsPrivateFile(path, 16384)).equals(bytes)) fail();
}

/** Scope choices contain no credential payload. Digest comes from the actual
 * imported owner file, never a supplied hash. The caller holds the owner lock. */
export async function planCloudflareReadScope(state: SharedProjectState, inputPath: string) {
  const choices = object(JSON.parse((await readSharedHttpsPrivateFile(inputPath, 16384)).toString("utf8")));
  if (Object.keys(choices).sort().join(",") !== "accessApplicationId,accountId,accountOwner,authenticationOwner,dnsOwner,hostname,tlsOwner,tunnelId,zoneId") fail();
  const binding = loadSharedDerivedRecipeBindingSync(state.project.directory, "cloudflare-tunnel", state);
  if (choices.tunnelId !== binding.derived.configuration.tunnelId || choices.hostname !== binding.derived.configuration.hostname) fail();
  const bytes = await readSharedHttpsPrivateFile(join(state.project.directory, "secrets", "cloudflare-tunnel", "provider-api-token"), 4096);
  const scope = { schemaVersion: 1 as const, ownerManifestHash: state.manifestHash, ...choices,
    credentialSha256: createHash("sha256").update(bytes).digest("hex") } as Omit<CloudflareProviderScope, "readApproval">;
  const readApproval = cloudflareProviderReadApproval(scope);
  return checkedScope({ ...scope, readApproval }, state);
}
export async function applyCloudflareReadScope(state: SharedProjectState, inputPath: string, approval: string,
  revalidate: () => Promise<void>) {
  await revalidate();
  const scope = await planCloudflareReadScope(state, inputPath);
  if (scope.readApproval !== approval) fail();
  await revalidate();
  await immutablePrivate(join(state.project.directory, "cloudflare-provider-scope.json"), scope);
  await revalidate();
  return { status: "read-scope-approved", publicExposureApproved: false };
}

async function publicExposure(state: SharedProjectState, revalidate: () => Promise<void>) {
  const { cloudflareLocalProviderReview } = await import("../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/cloudflare-tunnel/connector.ts");
  await revalidate();
  const binding = loadSharedDerivedRecipeBindingSync(state.project.directory, "cloudflare-tunnel", state);
  const selected = binding.derived.configuration;
  const bytes = await readSharedHttpsPrivateFile(join(state.project.directory, "secrets", "cloudflare-tunnel", "tunnel-credentials"), 4096);
  let credentials: Record<string, any>;
  try { credentials = object(JSON.parse(bytes.toString("utf8"))); } catch { fail(); }
  if (Object.keys(credentials).sort().join(",") !== "AccountTag,Endpoint,TunnelID,TunnelSecret"
    || !id.test(credentials.AccountTag) || credentials.TunnelID !== selected.tunnelId || credentials.Endpoint !== ""
    || typeof credentials.TunnelSecret !== "string"
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(credentials.TunnelSecret)
    || Buffer.from(credentials.TunnelSecret, "base64").length < 32
    || Buffer.from(credentials.TunnelSecret, "base64").toString("base64") !== credentials.TunnelSecret) fail();
  const env = Buffer.from(`${serializePrivateConfigEnvironment("TUNNEL_CRED_CONTENTS", JSON.stringify(credentials))}\n`);
  const actualEnv = await readSharedHttpsPrivateFile(join(state.project.directory, "secrets", "cloudflare-tunnel", "cloudflare-tunnel.env"), 8192);
  if (!actualEnv.equals(env)) fail();
  const config = binding.selection.recipe.configFiles[0];
  const configPath = join(state.project.directory, "data", "cloudflare-tunnel", "config-files", "tunnel-config");
  // Non-secret config uses the shared generated-file verifier (0644); its
  // exact bytes/ownership are also rechecked by checkRendered before startup.
  const { generatedConfigReadability } = await import("../lib/multi-service-recipe.ts");
  generatedConfigReadability(binding.selection.recipe);
  const { lstat, realpath } = await import("node:fs/promises");
  async function prepared() {
    await revalidate();
    if (!(await readSharedHttpsPrivateFile(join(state.project.directory, "secrets", "cloudflare-tunnel", "tunnel-credentials"), 4096)).equals(bytes)
      || !(await readSharedHttpsPrivateFile(join(state.project.directory, "secrets", "cloudflare-tunnel", "cloudflare-tunnel.env"), 8192)).equals(env)) fail();
    if (await realpath(configPath) !== configPath) fail();
    const handle = await open(configPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.()
        || (before.mode & 0o7777) !== 0o644 || before.size !== Buffer.byteLength(config.content)) fail();
      if (!(await handle.readFile()).equals(Buffer.from(config.content))) fail();
      for (const after of [await handle.stat(), await lstat(configPath)]) {
        if (before.dev !== after.dev || before.ino !== after.ino || before.mode !== after.mode
          || before.uid !== after.uid || before.nlink !== after.nlink || before.size !== after.size
          || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail();
      }
    } finally { await handle.close(); }
    await revalidate();
  }
  await prepared();
  const observed = await readCloudflareProvider(state, prepared);
  cloudflareLocalProviderReview(observed);
  if (credentials.AccountTag !== observed.scope.accountId || selected.hostname !== observed.scope.hostname
    || selected.tunnelId !== observed.scope.tunnelId) fail();
  await prepared();
  const record = { schemaVersion: 1, ownerManifestHash: state.manifestHash, bindingHash: binding.bindingHash,
    targetAppId: selected.targetAppId, origin: selected.origin, hostname: selected.hostname,
    tunnelId: selected.tunnelId, credentialSha256: createHash("sha256").update(bytes).digest("hex"),
    configSha256: selected.configSha256, environmentSha256: createHash("sha256").update(env).digest("hex"),
    providerFingerprint: hash({ scope: observed.scope, accountId: observed.account.id,
      tunnel: { id: observed.tunnel.id, account_tag: observed.tunnel.account_tag, config_src: observed.tunnel.config_src, deleted_at: observed.tunnel.deleted_at },
      ipRoutes: observed.ipRoutes, hostnameRoutes: observed.hostnameRoutes,
      accessApplication: observed.accessApplication, accessPolicies: observed.accessPolicies,
      zone: observed.zone, dnsRecords: observed.dnsRecords, ssl: observed.ssl, certificates: observed.certificates }), accountOwner: observed.scope.accountOwner,
    dnsOwner: observed.scope.dnsOwner, tlsOwner: observed.scope.tlsOwner, authenticationOwner: observed.scope.authenticationOwner };
  return { record, approval: `CLOUDFLARE-PUBLIC:${hash(record)}` };
}
export async function planCloudflarePublicExposure(state: SharedProjectState, revalidate: () => Promise<void>) {
  return publicExposure(state, revalidate);
}
export async function applyCloudflarePublicExposure(state: SharedProjectState, approval: string, revalidate: () => Promise<void>) {
  const plan = await publicExposure(state, revalidate);
  if (plan.approval !== approval) fail();
  await immutablePrivate(join(state.project.directory, "cloudflare-public-approval.json"), plan);
  await revalidate();
  return { status: "public-intent-approved", applicationAcceptanceVerified: false };
}
export async function requireCloudflarePublicExposure(state: SharedProjectState, revalidate: () => Promise<void>) {
  const plan = await publicExposure(state, revalidate);
  const saved = object(JSON.parse((await readSharedHttpsPrivateFile(join(state.project.directory, "cloudflare-public-approval.json"), 16384)).toString("utf8")));
  if (JSON.stringify(saved) !== JSON.stringify(plan)) fail();
  await revalidate();
}
