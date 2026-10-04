import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, realpath, unlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClientKeyIdentity, ClientKeyCustody } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/private-openpgp.ts";
import { installedCliRoot } from "./installed-cli-root.ts";

type Entry = Record<string, any>;
export type OpenPgpCustodyEnvelope = {
  projectRoot: string; projectId: string; appId: string; canonicalOrigin: string;
  sourceUrl: string; recipeHash: string; identity: ClientKeyIdentity;
};
const maximumBytes = 1024 * 1024;
function fail(): never { throw new Error("Private OpenPGP operation failed; private input and child output were suppressed"); }
function invoke(request: Entry): unknown {
  let worker = new URL("./private-openpgp-bun.ts", import.meta.url);
  if (!new URL(import.meta.url).pathname.endsWith(".ts")) worker = new URL("private-openpgp-bun.js", installedCliRoot(import.meta.url));
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > maximumBytes) fail();
  const result = spawnSync("bun", [fileURLToPath(worker)], { input, encoding: "utf8", timeout: 45_000,
    maxBuffer: maximumBytes, env: { PATH: process.env.PATH, NODE_ENV: "production" }, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  if (result.error || result.status !== 0 || result.stderr !== "") fail();
  try {
    const response = JSON.parse(result.stdout);
    if (!response || typeof response !== "object" || Object.keys(response).join(",") !== "value") fail();
    return response.value;
  } catch { fail(); }
}
function serialized(value: unknown): string { return JSON.stringify(value); }
function intact(metadata: any): boolean {
  return metadata.isFile() && metadata.uid === process.getuid?.() && metadata.nlink === 1
    && (metadata.mode & 0o7777) === 0o600 && metadata.size > 0 && metadata.size <= maximumBytes;
}
async function read(path: string): Promise<Entry | null> {
  let before;
  try { before = await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; fail(); }
  if (!intact(before) || await realpath(path) !== path) fail();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    if (!intact(opened) || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) fail();
    const bytes = Buffer.alloc(before.size + 1);
    const result = await handle.read(bytes, 0, bytes.length, 0);
    const after = await handle.stat(), named = await lstat(path);
    if (result.bytesRead !== before.size || !intact(after) || !intact(named)
      || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || named.dev !== after.dev || named.ino !== after.ino || named.size !== after.size
      || named.mtimeMs !== after.mtimeMs || named.ctimeMs !== after.ctimeMs || await realpath(path) !== path) fail();
    try { return JSON.parse(bytes.subarray(0, before.size).toString("utf8")); } catch { fail(); }
  } finally { await handle.close(); }
}
async function writeExclusive(path: string, value: unknown): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(serialized(value)); await handle.sync(); } finally { await handle.close(); }
}
async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
function checkedEnvelope(value: OpenPgpCustodyEnvelope): void {
  const url = new URL(value.canonicalOrigin), source = new URL(value.sourceUrl);
  if (Object.keys(value).sort().join(",") !== "appId,canonicalOrigin,identity,projectId,projectRoot,recipeHash,sourceUrl"
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.appId) || !value.projectRoot.startsWith("/")
    || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.projectId) || !/^[a-f0-9]{64}$/.test(value.recipeHash)
    || url.protocol !== "https:" || url.origin !== value.canonicalOrigin || source.protocol !== "https:"
    || source.username || source.password || source.hash
    || !value.identity || Object.keys(value.identity).sort().join(",") !== "email,name"
    || typeof value.identity.name !== "string" || !value.identity.name.trim() || value.identity.name.length > 200
    || /[\r\n\0<>]/.test(value.identity.name) || typeof value.identity.email !== "string"
    || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value.identity.email) || value.identity.email.length > 254) fail();
}

/** The caller must resolve the actual saved owner, origin and source; adapters never choose a path. */
export function privateOpenPgpCustody(directory: string, envelope: OpenPgpCustodyEnvelope) {
  checkedEnvelope(envelope);
  const exact = structuredClone(envelope);
  const path = join(directory, "client-openpgp.json");
  async function load(): Promise<Entry | null> {
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o7777) !== 0o700
      || await realpath(directory) !== directory) fail();
    const bundle = await read(path);
    if (!bundle) return null;
    if (Object.keys(bundle).sort().join(",") !== "custody,envelope,schemaVersion"
      || bundle.schemaVersion !== 1 || serialized(bundle.envelope) !== serialized(exact)
      || serialized(bundle.custody?.identity) !== serialized(exact.identity)
      || invoke({ operation: "validate-custody", custody: bundle.custody }) !== true) fail();
    return bundle;
  }
  function summary(bundle: Entry): ClientKeyCustody {
    return { publicKey: bundle.custody.publicKey, fingerprint: bundle.custody.fingerprint, custodyPath: path };
  }
  return {
    async ensureClientKey(): Promise<ClientKeyCustody> {
      const existing = await load();
      if (existing) return summary(existing);
      // Durable intent excludes concurrent/replayed generation after any lost worker response.
      const intent = join(directory, "client-openpgp-generation.json");
      if (await read(intent)) fail();
      await writeExclusive(intent, { schemaVersion: 1, envelope: exact });
      await syncDirectory(directory);
      const custody = invoke({ operation: "generate", identity: exact.identity,
        passphrase: randomBytes(48).toString("base64url") });
      const bundle = { schemaVersion: 1, envelope: exact, custody };
      const pending = join(directory, "client-openpgp-pending.json");
      await writeExclusive(pending, bundle);
      await link(pending, path); // No overwrite or duplicate identity on a racing resume.
      await unlink(pending);
      await syncDirectory(directory);
      const verified = await load();
      if (!verified) fail();
      return summary(verified);
    },
    async existingClientKey(): Promise<ClientKeyCustody> {
      const bundle = await load();
      if (!bundle) fail();
      return summary(bundle);
    },
    async encryptSign(input: { text: string; recipientPublicKey: string; recipientFingerprint: string }): Promise<string> {
      const bundle = await load(); if (!bundle) fail();
      const value = invoke({ operation: "encrypt-sign", custody: bundle.custody,
        publicKey: input.recipientPublicKey, fingerprint: input.recipientFingerprint, text: input.text });
      if (typeof value !== "string" || !value.startsWith("-----BEGIN PGP MESSAGE-----")) fail();
      return value;
    },
    async decryptVerify(input: { armored: string; signerPublicKey: string; signerFingerprint: string }): Promise<string> {
      const bundle = await load(); if (!bundle) fail();
      const value = invoke({ operation: "decrypt-verify", custody: bundle.custody,
        publicKey: input.signerPublicKey, fingerprint: input.signerFingerprint, armored: input.armored });
      if (typeof value !== "string") fail();
      return value;
    },
  };
}

export async function inspectPrivateOpenPgpPublicKey(input: { publicKey: string; expectedFingerprint: string }): Promise<{ fingerprint: string; identities: string[] }> {
  const value = invoke({ operation: "inspect-public", publicKey: input.publicKey, fingerprint: input.expectedFingerprint }) as Entry;
  if (!value || Object.keys(value).sort().join(",") !== "fingerprint,identities"
    || !/^[0-9A-F]{40}$/.test(value.fingerprint) || !Array.isArray(value.identities)
    || value.identities.length > 64 || value.identities.some((item: unknown) => typeof item !== "string")) fail();
  return value as { fingerprint: string; identities: string[] };
}

/** Reuse identity only from a cryptographically valid custody bundle whose
 * complete non-identity envelope matches the freshly resolved real owner. */
export async function readSavedPrivateOpenPgpIdentity(directory: string,
  expected: Omit<OpenPgpCustodyEnvelope, "identity">): Promise<ClientKeyIdentity | null> {
  const bundle = await read(join(directory, "client-openpgp.json"));
  if (!bundle) return null;
  const identity = bundle.envelope?.identity;
  const envelope = { ...expected, identity };
  await privateOpenPgpCustody(directory, envelope).existingClientKey();
  return structuredClone(identity);
}
