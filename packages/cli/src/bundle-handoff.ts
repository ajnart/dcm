import { randomBytes } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { lstat, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, join, relative, resolve, sep } from "node:path";
import { loadHouseholdCredential } from "../../../.agents/skills/self-host/workflows/selfhost-setup/scripts/household-credentials.ts";
import { loadDocmostHandoffForExport } from "./docmost.ts";

type ServiceInput = { runId: string; accountFile?: string; input?: string; httpsPlan?: string };
export type BundleHandoffInput = {
  id: string;
  projectRoot: string;
  services: { media: ServiceInput; immich: ServiceInput; docmost: ServiceInput; vaultwarden: ServiceInput };
};

const mediaNames = ["homarr", "jellyfin", "prowlarr", "qbittorrent", "radarr", "seerr", "sonarr"];
const mediaKeysUsedByThisStack = new Set(["homarr", "prowlarr", "radarr", "seerr", "sonarr"]);
const control = /[\u0000-\u001f\u007f]/;

function fail(message: string): never { throw new Error(message); }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is invalid`);
  return value as Record<string, unknown>;
}
function safeText(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || control.test(value) || (!allowEmpty && value.length === 0) || value.length > 4096) {
    fail(`${label} is invalid`);
  }
  return value;
}
function exactOrigin(value: unknown, label: string): string {
  const text = safeText(value, label);
  let url: URL;
  try { url = new URL(text); } catch { fail(`${label} is not a URL`); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || url.pathname !== "/" || url.origin !== text) fail(`${label} must be a credential-free origin`);
  return text;
}
function inside(root: string, path: string): boolean {
  const part = relative(root, path);
  return part === "" || (part !== ".." && !part.startsWith(`..${sep}`));
}
async function privateJson(root: string, path: string, label: string, maxBytes = 256 * 1024): Promise<Record<string, unknown>> {
  if (resolve(path) !== path || !inside(root, path)) fail(`${label} must stay inside the selected project`);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid?.()
    || (stat.mode & 0o777) !== 0o600 || stat.size < 2 || stat.size > maxBytes || await realpath(path) !== path) {
    fail(`${label} must be an owner-only regular file (0600)`);
  }
  let value: unknown;
  try { value = JSON.parse(await readFile(path, "utf8")); }
  catch { fail(`${label} is not valid JSON`); }
  return record(value, label);
}
function envLine(key: string, value: string | null): string {
  const safe = value ?? "";
  safeText(safe, key, true);
  return `${key}='${safe.replaceAll("'", "'\\''")}'`;
}
async function ownerDirectory(path: string): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()
    || (stat.mode & 0o777) !== 0o700 || await realpath(path) !== path) {
    fail("Bundle handoff directory must be owner-only (0700)");
  }
}
async function atomicHandoff(root: string, path: string, content: string): Promise<void> {
  if (resolve(path) !== path || !inside(root, path)) fail("Bundle handoff output is outside the project");
  const parent = dirname(path);
  await ownerDirectory(parent);
  try {
    const existing = await lstat(path);
    if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1
      || existing.uid !== process.getuid?.() || (existing.mode & 0o777) !== 0o600 || await realpath(path) !== path) {
      fail("Existing bundle handoff is not one owner-only file");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = join(parent, `.private-handoff.${randomBytes(12).toString("hex")}.tmp`);
  let created = false;
  try {
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    created = true;
    try { await handle.writeFile(content); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, path);
    created = false;
    const directory = await open(parent, constants.O_RDONLY);
    try { await directory.sync(); }
    finally { await directory.close(); }
  } finally {
    if (created) await unlink(temporary).catch(() => undefined);
  }
}

export async function exportBundleHandoff(bundle: BundleHandoffInput, immichApiKeyFile?: string): Promise<{ path: string; pending: string[] }> {
  const root = bundle.projectRoot;
  const mediaRun = bundle.services.media.runId;
  const mediaPath = join(root, ".selfhost", "media-harness", ".sessions", mediaRun, "artifacts", "private-handoff.json");
  const media = await privateJson(root, mediaPath, "Media handoff");
  const mediaServices = record(media.services, "Media handoff services");
  if (media.runId !== mediaRun || JSON.stringify(Object.keys(mediaServices).sort()) !== JSON.stringify([...mediaNames].sort())) {
    fail("Media handoff does not match the selected seven-service run");
  }
  const lines = [
    "# PRIVATE: generated credentials and local access links. Keep this file owner-only (0600).",
    "# Empty API-key values mean no key was recorded; they do not authorize creating one.",
    "# Jellyfin and qBittorrent use account or session authentication in this stack; an empty API key is expected.",
    envLine("BUNDLE_ID", bundle.id),
  ];
  const pending: string[] = [];
  for (const name of mediaNames) {
    const service = record(mediaServices[name], `Media ${name}`);
    const prefix = name.toUpperCase();
    const url = exactOrigin(service.url, `${name} URL`);
    const username = safeText(service.username, `${name} username`);
    const password = safeText(service.password, `${name} password`);
    const localUrl = exactOrigin(service.localUrl, `${name} local URL`);
    let userUrl: string | null = null;
    if (service.userUrl !== null) userUrl = exactOrigin(service.userUrl, `${name} user URL`);
    let key: string | null = null;
    if (service.apiKey !== null) key = safeText(service.apiKey, `${name} API key`);
    lines.push("", `# ${name}`, envLine(`${prefix}_URL`, url), envLine(`${prefix}_LOCAL_URL`, localUrl),
      envLine(`${prefix}_USER_URL`, userUrl), envLine(`${prefix}_USERNAME`, username),
      envLine(`${prefix}_PASSWORD`, password), envLine(`${prefix}_API_KEY`, key));
    if (name === "homarr") lines.push(envLine("HOMARR_DASHBOARD_URL", `${localUrl}/boards/personal`));
    if (key === null && mediaKeysUsedByThisStack.has(name)) pending.push(`${name}-api-key-not-recorded`);
  }

  const immichRun = bundle.services.immich.runId;
  const immichAccount = await privateJson(root, bundle.services.immich.accountFile!, "Immich account");
  const immichInput = await privateJson(root, bundle.services.immich.input!, "Immich input");
  const immich = loadHouseholdCredential(root, immichRun, "immich");
  if (immich.username !== immichAccount.username || immich.email !== immichAccount.email) {
    fail("Immich handoff account differs from the selected bundle account");
  }
  const immichHost = safeText(immichInput.hostIp, "Immich host IP");
  const immichPort = immichInput.publishedPort;
  if (isIP(immichHost) === 0 || !Number.isInteger(immichPort) || Number(immichPort) < 1024 || Number(immichPort) > 65535) {
    fail("Immich access port is invalid");
  }
  let immichUrlHost = immichHost;
  if (isIP(immichHost) === 6) immichUrlHost = `[${immichHost}]`;
  let immichKey: string | null = immich.apiKey;
  const conventionalImmichKey = join(root, ".selfhost", "bundles", bundle.id, "immich-homarr-api-key");
  let selectedImmichKeyFile = immichApiKeyFile;
  if (!selectedImmichKeyFile && existsSync(conventionalImmichKey)) selectedImmichKeyFile = conventionalImmichKey;
  if (selectedImmichKeyFile) {
    const stat = await lstat(selectedImmichKeyFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid?.()
      || (stat.mode & 0o777) !== 0o600 || stat.size < 9 || stat.size > 4097 || await realpath(selectedImmichKeyFile) !== selectedImmichKeyFile
      || !inside(root, selectedImmichKeyFile)) fail("Immich API key file must be one owner-only file inside the project");
    immichKey = safeText((await readFile(selectedImmichKeyFile, "utf8")).trim(), "Immich API key");
  }
  if (immichKey === null) pending.push("immich-api-key-not-recorded");
  lines.push("", "# Immich — private photos", envLine("IMMICH_URL", `http://${immichUrlHost}:${immichPort}`),
    envLine("IMMICH_USERNAME", immich.username), envLine("IMMICH_EMAIL", immich.email),
    envLine("IMMICH_PASSWORD", immich.password), envLine("IMMICH_API_KEY", immichKey),
    envLine("IMMICH_DATABASE_PASSWORD", immich.databasePassword));

  const docmostRun = bundle.services.docmost.runId;
  const docmost = await loadDocmostHandoffForExport({ projectRoot: root, input: bundle.services.docmost.input!,
    runId: docmostRun, accountFile: bundle.services.docmost.accountFile! });
  const docmostHandoffAccount = docmost.account;
  lines.push("", "# Docmost — private pages and documents", envLine("DOCMOST_URL", exactOrigin(docmost.url, "Docmost URL")),
    envLine("DOCMOST_USERNAME", safeText(docmostHandoffAccount.username, "Docmost username")),
    envLine("DOCMOST_EMAIL", safeText(docmostHandoffAccount.email, "Docmost email")),
    envLine("DOCMOST_PASSWORD", safeText(docmost.password, "Docmost password")),
    envLine("DOCMOST_APP_SECRET", safeText(docmost.appSecret, "Docmost app secret")),
    envLine("DOCMOST_DATABASE_PASSWORD", safeText(docmost.databasePassword, "Docmost database password")));

  const vaultRun = bundle.services.vaultwarden.runId;
  const vaultAccount = await privateJson(root, bundle.services.vaultwarden.accountFile!, "Vaultwarden account");
  const vaultPlan = await privateJson(root, bundle.services.vaultwarden.httpsPlan!, "Vaultwarden HTTPS plan");
  const vault = loadHouseholdCredential(root, vaultRun, "vaultwarden");
  if (vault.username !== vaultAccount.username || vault.email !== vaultAccount.email) {
    fail("Vaultwarden handoff account differs from the selected bundle account");
  }
  const vaultOrigin = exactOrigin(vaultPlan.origin, "Vaultwarden URL");
  if (!vaultOrigin.startsWith("https://")) fail("Vaultwarden handoff requires HTTPS");
  lines.push("", "# Vaultwarden — private password vault", envLine("VAULTWARDEN_URL", vaultOrigin),
    envLine("VAULTWARDEN_USERNAME", vault.username), envLine("VAULTWARDEN_EMAIL", vault.email),
    envLine("VAULTWARDEN_PASSWORD", vault.password));

  const path = join(root, ".selfhost", "bundles", bundle.id, "private-handoff.env");
  await atomicHandoff(root, path, `${lines.join("\n")}\n`);
  return { path, pending };
}

export async function checkBundleVaultwardenHandoff(bundle: BundleHandoffInput): Promise<{ path: string; matches: boolean }> {
  const path = join(bundle.projectRoot, ".selfhost", "bundles", bundle.id, "private-handoff.env");
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid?.()
    || (stat.mode & 0o777) !== 0o600 || stat.size < 2 || stat.size > 128 * 1024
    || await realpath(path) !== path) fail("Existing bundle handoff is not one owner-only file");
  const content = await readFile(path, "utf8");
  const fieldName = ["VAULTWARDEN", "PASSWORD"].join("_");
  const fieldPattern = new RegExp(`^${fieldName}='([A-Za-z0-9_-]{32,})'$`, "gm");
  const matches = [...content.matchAll(fieldPattern)];
  if (matches.length !== 1) fail("Bundle handoff has no single generated Vaultwarden password field");
  const selected = loadHouseholdCredential(bundle.projectRoot, bundle.services.vaultwarden.runId, "vaultwarden");
  return { path, matches: matches[0][1] === selected.password };
}
