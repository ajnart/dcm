import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { socketIoIntentProfileSha256 } from "./setup-socketio-profile.ts";

const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const APP_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function fail(): never {
  throw new Error("The executable setup contract is missing, unsafe or changed while reading");
}

/** Matches the engine's executable choice; never fall back from a broken package. */
export async function setupAdapterSource(appId: string): Promise<{ url: URL; sha256: string } | null> {
  if (typeof appId !== "string" || appId.length > 64 || !APP_ID.test(appId)) fail();
  const own = new URL(import.meta.url);
  let url = new URL(`./workflows/selfhost/references/catalog/apps/${appId}/setup.js`, own);
  if (own.pathname.endsWith(".ts")) {
    url = new URL(`../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/${appId}/setup.ts`, own);
  }
  try { await lstat(fileURLToPath(url)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    fail();
  }
  return { url, sha256: await sourceHash(url) };
}

async function sourceHash(url: URL, maximumBytes = MAX_SOURCE_BYTES, dependencyHardLinks = false): Promise<string> {
  const path = fileURLToPath(url);
  if (await realpath(path).catch(() => null) !== path) fail();
  let handle;
  const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  try { handle = await open(path, flags); }
  catch { fail(); }
  try {
    const before = await handle.stat();
    if (!before.isFile() || (!dependencyHardLinks && before.nlink !== 1)
      || (dependencyHardLinks && (before.nlink < 1 || before.uid !== process.getuid?.())) || before.size < 1
      || before.size > maximumBytes || (before.mode & 0o002) !== 0) fail();
    const bytes = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    if (offset !== before.size || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs || after.nlink !== before.nlink || after.mode !== before.mode
      || after.uid !== before.uid || await realpath(path) !== path) fail();
    // Reopen through the pathname to reject replacement of the original inode.
    const current = await open(path, flags);
    try {
      const named = await current.stat();
      if (named.dev !== after.dev || named.ino !== after.ino || named.size !== after.size
        || named.mtimeMs !== after.mtimeMs || named.ctimeMs !== after.ctimeMs
        || named.nlink !== after.nlink || named.uid !== after.uid || named.mode !== after.mode) fail();
    } finally { await current.close(); }
    return createHash("sha256").update(bytes.subarray(0, offset)).digest("hex");
  } finally { await handle.close(); }
}

async function bootstrapProfileHash(adapterUrl: URL): Promise<string | null> {
  const url = new URL("bootstrap-password.json", adapterUrl);
  try { await lstat(fileURLToPath(url)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    fail();
  }
  return sourceHash(url, 4096);
}

async function implementationHashes(): Promise<Array<[string, string]>> {
  const own = new URL(import.meta.url);
  const sourceMode = own.pathname.endsWith(".ts");
  let parts: Array<[string, URL]>;
  if (sourceMode) {
    const catalog = new URL("../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/", own);
    parts = [
      ["contract", own],
      ["engine", new URL("../control-panel/setup-engine.ts", own)],
      ["transport", new URL("../control-panel/setup-transport.ts", own)],
      ["websocket", new URL("../control-panel/setup-websocket.ts", own)],
      ["sabnzbd-config", new URL("../control-panel/sabnzbd-ini.ts", own)],
      ["shared-owner", new URL("../shared-project.ts", own)],
      ["homarr-attach", new URL("../homarr-attach.ts", own)],
      ["shared-unit", new URL("./shared-unit-setup.ts", own)],
      ["shared-state", new URL("./shared-project-state.ts", own)],
      ["observation-journal", new URL("./setup-observation-journal.ts", own)],
      ["setup-interface", new URL("types/setup.ts", catalog)],
      ["no-account", new URL("shared/no-account-get.ts", catalog)],
    ];
    // Cover owner/runtime validation helpers and future local helper imports
    // without maintaining another app-specific dependency registry.
    for (const [role, directory] of [["lib", new URL("./", own)],
      ["control", new URL("../control-panel/", own)],
      ["catalog-types", new URL("types/", catalog)],
      ["catalog-shared", new URL("shared/", catalog)]] as const) {
      const entries = await readdir(directory, { withFileTypes: true });
      if (entries.length > 256) fail();
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.name.endsWith(".ts")) continue;
        if (!entry.isFile() || entry.isSymbolicLink()) fail();
        const url = new URL(entry.name, directory);
        if (!parts.some(([, included]) => included.href === url.href)) parts.push([`${role}/${entry.name}`, url]);
      }
    }
  } else {
    // Every entry bundles the same module into a different executable. Bind
    // the complete shipped executable set, not whichever entry is calling us.
    const directory = new URL("./", own);
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.length > 256) fail();
    parts = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.name.endsWith(".js")) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) fail();
      parts.push([`executable/${entry.name}`, new URL(entry.name, directory)]);
    }
    if (!parts.length || !parts.some(([, url]) => url.href === own.href)) fail();
  }
  // These owners are executed as external files even in the compiled package.
  let workflows = new URL("./workflows/", own);
  if (sourceMode) workflows = new URL("../../../../.agents/skills/self-host/workflows/", own);
  for (const path of ["selfhost-compose/scripts/compose-project.ts",
    "selfhost-compose/scripts/compose-lifecycle.sh", "selfhost-host/scripts/inspect-host.sh",
    "selfhost/references/catalog/types/manual-job.ts", "selfhost/references/catalog/types/non-secret-policy.ts",
    "selfhost/references/catalog/types/private-daemon.ts", "selfhost/references/catalog/types/runtime-resources.ts",
    "selfhost/references/catalog/types/recipe-image-reference.ts", "selfhost/references/catalog/types/owner-directory.ts",
    "selfhost/references/catalog/types/docker-cli-tls.ts"]) {
    const url = new URL(path, workflows);
    if (!parts.some(([, included]) => included.href === url.href)) parts.push([`owner/${path}`, url]);
  }
  const hashes: Array<[string, string]> = [];
  if (sourceMode) {
    // Bun legitimately hardlinks immutable dependency files into its cache.
    // Permit that only for this resolved, exact pinned package, never app code.
    const entryPath = await realpath(fileURLToPath(import.meta.resolve("openpgp"))).catch(() => null);
    if (!entryPath || !entryPath.endsWith("/node_modules/openpgp/dist/node/openpgp.mjs")) fail();
    const entry = pathToFileURL(entryPath);
    const manifest = new URL("../../package.json", entry);
    const manifestHash = await sourceHash(manifest, 65536, true);
    const handle = await open(fileURLToPath(manifest), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const bytes = Buffer.alloc(65537);
      const result = await handle.read(bytes, 0, bytes.length, 0);
      if (result.bytesRead < 1 || result.bytesRead > 65536) fail();
      const metadata = JSON.parse(bytes.subarray(0, result.bytesRead).toString("utf8"));
      if (metadata.name !== "openpgp" || metadata.version !== "6.3.2") fail();
    } finally { await handle.close(); }
    if (await sourceHash(manifest, 65536, true) !== manifestHash) fail();
    hashes.push(["dependency/openpgp-package", manifestHash], ["dependency/openpgp-runtime", await sourceHash(entry, MAX_SOURCE_BYTES, true)]);
  }
  for (const [role, url] of parts) hashes.push([role, await sourceHash(url)]);
  return hashes;
}

// Pin before any importing engine executes: a warm TUI must not bless new disk
// bytes while continuing to run its previously imported implementation.
const loadedImplementation = JSON.stringify(await implementationHashes());

/** Bind approvals/chronology to the shared implementation, external owners and
 * every executable adapter in the saved owner. Not acceptance or attestation. */
export async function setupContractSha256(appId: string, ownerAppIds: readonly string[] = [appId]): Promise<string> {
  if (typeof appId !== "string" || appId.length > 64 || !APP_ID.test(appId)) fail();
  if (!Array.isArray(ownerAppIds) || ownerAppIds.length > 256
    || ownerAppIds.some((id) => typeof id !== "string" || id.length > 64 || !APP_ID.test(id))) fail();
  const hashes: Array<[string, string | null]> = await implementationHashes();
  if (loadedImplementation !== JSON.stringify(hashes)) {
    throw new Error("Setup implementation changed while the CLI was running; restart it and review again");
  }
  for (const id of [...new Set([appId, ...ownerAppIds])].sort()) {
    const adapter = await setupAdapterSource(id);
    if (id === appId && !adapter) fail();
    hashes.push([`adapter/${id}`, adapter?.sha256 ?? null]);
    if (adapter) {
      const profileHash = await bootstrapProfileHash(adapter.url);
      if (profileHash) hashes.push([`bootstrap-profile/${id}`, profileHash]);
      hashes.push([`socketio-profile/${id}`, socketIoIntentProfileSha256(id)]);
    }
  }
  let execution = "compiled";
  if (new URL(import.meta.url).pathname.endsWith(".ts")) execution = "source";
  return createHash("sha256").update(JSON.stringify({ schemaVersion: 1, appId,
    execution, parts: hashes })).digest("hex");
}
