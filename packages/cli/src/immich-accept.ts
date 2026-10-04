import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { deflateSync } from "node:zlib";
import { buildImmichManifest } from "../../../.agents/skills/self-host/workflows/selfhost-setup/scripts/immich-plan.ts";
import { loadHouseholdCredential } from "../../../.agents/skills/self-host/workflows/selfhost-setup/scripts/household-credentials.ts";

type Options = {
  projectRoot: string; input: string; accountFile: string; runId: string;
  imageFile?: string; integrationUrl: string; acceptanceFile: string;
};
type Response = Pick<globalThis.Response, "status" | "headers" | "json" | "arrayBuffer" | "body">;
export type ImmichAcceptRuntime = {
  fetch?: typeof fetch; now?: () => Date;
  closedSetup?: (manifest: Record<string, any>) => boolean;
};

export const immichHomarrPermissions = [
  "album.statistics", "album.read", "album.create", "user.read", "user.update", "asset.read", "asset.view",
  "asset.download", "asset.statistics", "server.statistics", "server.about",
];

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const runIdPattern = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const maxImageBytes = 256 * 1024;

function pngChunk(kind: string, payload: Buffer): Buffer {
  const name = Buffer.from(kind, "ascii");
  const contents = Buffer.concat([name, payload]);
  let crc = 0xffffffff;
  for (const byte of contents) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      if (crc & 1) crc = (crc >>> 1) ^ 0xedb88320;
      else crc >>>= 1;
    }
  }
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, contents, checksum]);
}
function syntheticPng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  const pixel = Buffer.concat([Buffer.from([0]), randomBytes(3)]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header), pngChunk("tEXt", Buffer.concat([Buffer.from("Comment\0", "ascii"), randomBytes(16)])),
    pngChunk("IDAT", deflateSync(pixel)), pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function fail(message: string): never { throw new Error(message); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function inside(root: string, path: string): boolean {
  const part = relative(root, path);
  return part === "" || (part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part));
}
function parse(args: string[]): Options {
  const allowed = new Set(["--project-root", "--input", "--account-file", "--run-id", "--image-file", "--integration-url", "--acceptance-file"]);
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || flags[name] || !value || value.startsWith("--")) fail(`Invalid or repeated Immich acceptance option: ${name ?? "(missing)"}`);
    flags[name] = value;
  }
  for (const name of allowed) if (name !== "--image-file" && !flags[name]) fail(`Immich acceptance needs ${name}`);
  if (!runIdPattern.test(flags["--run-id"])) fail("Invalid Immich run ID");
  return {
    projectRoot: flags["--project-root"], input: flags["--input"], accountFile: flags["--account-file"],
    runId: flags["--run-id"], imageFile: flags["--image-file"], integrationUrl: flags["--integration-url"],
    acceptanceFile: flags["--acceptance-file"],
  };
}
async function safeRoot(path: string): Promise<void> {
  if (!isAbsolute(path) || resolve(path) !== path || path === "/" || path === await realpath(homedir())) fail("Select one exact project root");
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path || (stat.mode & 0o002) !== 0
    || (typeof process.getuid === "function" && stat.uid !== process.getuid())) fail("Project root is unsafe");
}
async function ownerFile(path: string, root: string, maximum: number): Promise<Buffer> {
  if (!isAbsolute(path) || resolve(path) !== path || !inside(root, path)) fail("Input must be an exact path inside the selected project");
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || await realpath(path) !== path
    || (stat.mode & 0o777) !== 0o600 || stat.size < 1 || stat.size > maximum
    || (typeof process.getuid === "function" && stat.uid !== process.getuid())) fail("Input must be a bounded owner-only file (0600)");
  return await readFile(path);
}
async function privateOutput(path: string, root: string, value: unknown): Promise<void> {
  await inspectOutput(path, root);
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
}
async function inspectOutput(path: string, root: string): Promise<void> {
  if (!isAbsolute(path) || resolve(path) !== path || !inside(root, path)) fail("Acceptance output must stay inside the selected project");
  const parent = dirname(path);
  const stat = await lstat(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(parent) !== parent || (stat.mode & 0o077) !== 0
    || (typeof process.getuid === "function" && stat.uid !== process.getuid())) fail("Acceptance output directory must be owner-only");
  if (existsSync(path)) fail("Acceptance output already exists; use a new exact path for a new run");
}
async function boundedJson(response: Response, label: string): Promise<Record<string, unknown>> {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1 || bytes.length > 64 * 1024) fail(`${label} returned an invalid body size`);
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(`${label} returned invalid JSON`); }
  if (!record(value)) fail(`${label} returned an invalid object`);
  return value;
}
function request(client: typeof fetch, origin: string, path: string, token: string | null, method = "GET", body?: BodyInit, contentType?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (contentType) headers["content-type"] = contentType;
  return client(`${origin}/api${path}`, { method, body, headers, redirect: "error", signal: AbortSignal.timeout(20_000) });
}
async function expectJson(client: typeof fetch, origin: string, path: string, token: string | null, status: number, label: string,
  method = "GET", body?: BodyInit, contentType?: string): Promise<Record<string, unknown>> {
  const response = await request(client, origin, path, token, method, body, contentType);
  if (response.status !== status) { await response.body?.cancel(); fail(`${label} returned unexpected HTTP status ${response.status}`); }
  return await boundedJson(response, label);
}
async function original(client: typeof fetch, origin: string, token: string, id: string, expected: Buffer): Promise<void> {
  const response = await request(client, origin, `/assets/${id}/original`, token);
  if (response.status !== 200) { await response.body?.cancel(); fail("Test image original retrieval failed"); }
  const actual = await boundedOriginal(response);
  if (!actual.equals(expected)) fail("Retrieved original does not exactly match the authorized test image");
}
async function boundedOriginal(response: Response): Promise<Buffer> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maxImageBytes) {
    await response.body?.cancel();
    fail("Test image original exceeds the maximum size");
  }
  if (!response.body) fail("Test image original has no response body");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxImageBytes) {
        await reader.cancel();
        fail("Test image original exceeds the maximum size");
      }
      chunks.push(Buffer.from(part.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}
async function originalDigest(client: typeof fetch, origin: string, token: string, id: string,
  expectedDigest: string): Promise<void> {
  const response = await request(client, origin, `/assets/${id}/original`, token);
  if (response.status !== 200) { await response.body?.cancel(); fail("Saved test image original retrieval failed"); }
  const actual = await boundedOriginal(response);
  if (actual.length < 32 || actual.length > maxImageBytes
    || createHash("sha256").update(actual).digest("hex") !== expectedDigest) {
    fail("Saved test image original does not match the exact uploaded bytes");
  }
}
function originFromManifest(manifest: Record<string, any>): string {
  const server = manifest.services.find((entry: Record<string, any>) => entry.id === "immich-server");
  const port = server?.ports?.[0];
  if (!port || port.protocol !== "tcp" || port.target !== 2283 || !["127.0.0.1", "::1"].includes(port.hostIp)) {
    fail("Immich acceptance requires the exact loopback-published server");
  }
  let host = port.hostIp;
  if (host === "::1") host = "[::1]";
  return `http://${host}:${port.published}`;
}
function closedSetupInExactContainer(manifest: Record<string, any>): boolean {
  const context = manifest.project.dockerContext;
  const project = manifest.project.id;
  const server = manifest.services.find((entry: Record<string, any>) => entry.id === "immich-server");
  const listed = spawnSync("docker", ["--context", context, "ps", "-q",
    "--filter", `label=com.docker.compose.project=${project}`,
    "--filter", "label=com.docker.compose.service=immich-server"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 8000, maxBuffer: 4096 });
  if (listed.status !== 0) fail("Could not inspect the exact running Immich server; child output was suppressed");
  const ids = listed.stdout.trim().split("\n").filter(Boolean);
  if (ids.length !== 1 || !/^[0-9a-f]{12,64}$/.test(ids[0])) fail("Exactly one running Immich server is required for acceptance");
  const format = '{{.Config.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.State.Running}}|{{range .Config.Env}}{{if eq . "IMMICH_ALLOW_SETUP=false"}}F{{end}}{{if eq . "IMMICH_ALLOW_SETUP=true"}}T{{end}}{{end}}';
  const inspected = spawnSync("docker", ["--context", context, "inspect", "--format", format, ids[0]],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 8000, maxBuffer: 4096 });
  if (inspected.status !== 0) fail("Could not verify live Immich setup closure; child output was suppressed");
  return inspected.stdout.trim() === `${server.image}|${project}|immich-server|true|F`;
}
function integrationUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { fail("Integration URL is invalid"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || url.pathname !== "/" || (value !== url.origin && value !== `${url.origin}/`)) fail("Integration URL must be an exact credential-free origin");
  return `${url.origin}/`;
}

export async function immichPhotoRoundTrip(options: {
  origin: string; email: string; password: string; runId: string;
  image?: Buffer; fetch?: typeof fetch; now?: () => Date;
  onUploaded?: (assetId: string, imageSha256: string) => Promise<void>;
  resumeAsset?: { assetId: string; imageSha256: string };
  retainAsset?: boolean;
}): Promise<{ assetId: string; imageSha256: string }> {
  let image: Buffer | null = null;
  if (!options.resumeAsset) {
    image = options.image ?? syntheticPng();
    if (image.length < 32 || image.length > maxImageBytes
      || !(image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        || image.subarray(0, 3).equals(Buffer.from([255, 216, 255])))) {
      fail("Supply one small authorized PNG or JPEG test image");
    }
  }
  const client = options.fetch ?? fetch;
  const token = await immichAdminToken(client, options.origin, options.email, options.password);
  let id: string;
  let digest: string;
  if (options.resumeAsset) {
    id = options.resumeAsset.assetId;
    digest = options.resumeAsset.imageSha256;
    if (!uuid.test(id) || !/^[0-9a-f]{64}$/.test(digest)) fail("Saved test asset identity is invalid");
    await originalDigest(client, options.origin, token, id, digest);
  } else {
    if (!image) fail("Test image is missing");
    const form = new FormData();
    const timestamp = (options.now ?? (() => new Date()))().toISOString();
    form.set("assetData", new Blob([image], { type: image[0] === 137 ? "image/png" : "image/jpeg" }),
      `selfhost-accept-${options.runId}.${image[0] === 137 ? "png" : "jpg"}`);
    form.set("fileCreatedAt", timestamp);
    form.set("fileModifiedAt", timestamp);
    const upload = await expectJson(client, options.origin, "/assets", token, 201, "Test image upload", "POST", form);
    if (typeof upload.id !== "string" || !uuid.test(upload.id) || upload.status !== "created") {
      fail("Test image upload did not create one new asset");
    }
    id = upload.id;
    digest = createHash("sha256").update(image).digest("hex");
    if (options.onUploaded) {
      try { await options.onUploaded(id, digest); }
      catch { fail(`Test asset ${id} was uploaded but its recovery checkpoint could not be saved; inspect it manually`); }
    }
    try { await original(client, options.origin, token, id, image); }
    catch { fail(`Test image retrieval failed; asset ${id} remains in the library for manual recovery`); }
  }
  if (options.retainAsset) return { assetId: id, imageSha256: digest };
  await trashExactAsset(client, options.origin, token, id);
  return { assetId: id, imageSha256: digest };
}

async function immichAdminToken(client: typeof fetch, origin: string, email: string,
  password: string): Promise<string> {
  const login = await expectJson(client, origin, "/auth/login", null, 201, "Admin login", "POST",
    JSON.stringify({ email, password }), "application/json");
  if (login.isAdmin !== true || login.userEmail !== email
    || typeof login.accessToken !== "string" || !login.accessToken) {
    fail("Immich login did not identify the intended admin");
  }
  const token = login.accessToken;
  const version = await expectJson(client, origin, "/server/version", token, 200, "Release version");
  if (version.major !== 3 || version.minor !== 2 || version.patch !== 2) {
    fail("Running Immich release differs from the approved v3.2.2 manifest");
  }
  const config = await expectJson(client, origin, "/server/config", token, 200, "Setup closure");
  if (config.isInitialized !== true) fail("Immich is not initialized");
  return token;
}

async function trashExactAsset(client: typeof fetch, origin: string, token: string, id: string): Promise<void> {
  let deletion: Response;
  try { deletion = await request(client, origin, "/assets", token, "DELETE", JSON.stringify({ ids: [id] }), "application/json"); }
  catch { fail(`Could not move exact test asset ${id} to recoverable trash; inspect it manually`); }
  if (deletion.status !== 204) {
    await deletion.body?.cancel();
    fail(`Could not confirm recoverable trash for exact test asset ${id}; inspect it manually`);
  }
  await deletion.body?.cancel();
}

export async function immichTrashAsset(options: {
  origin: string; email: string; password: string; assetId: string; fetch?: typeof fetch;
}): Promise<void> {
  if (!uuid.test(options.assetId)) fail("Saved test asset identity is invalid");
  const client = options.fetch ?? fetch;
  const token = await immichAdminToken(client, options.origin, options.email, options.password);
  await trashExactAsset(client, options.origin, token, options.assetId);
}

export async function immichAcceptCommand(args: string[], runtime: ImmichAcceptRuntime = {}): Promise<void> {
  const options = parse(args);
  await safeRoot(options.projectRoot);
  await inspectOutput(options.acceptanceFile, options.projectRoot);
  const input = JSON.parse((await ownerFile(options.input, options.projectRoot, 256 * 1024)).toString("utf8"));
  const account = JSON.parse((await ownerFile(options.accountFile, options.projectRoot, 8 * 1024)).toString("utf8"));
  if (!record(account) || account.schemaVersion !== 1 || typeof account.email !== "string" || typeof account.username !== "string") fail("Immich account input is invalid");
  const manifest = buildImmichManifest(input) as Record<string, any>;
  if (manifest.project.root !== options.projectRoot || input.allowSetup !== false) fail("Immich acceptance requires the exact closed-setup manifest");
  const server = manifest.services.find((entry: Record<string, any>) => entry.id === "immich-server");
  if (!server?.image?.includes("v3.2.2@sha256:")) fail("Immich acceptance expects the approved v3.2.2 release");
  const origin = originFromManifest(manifest);
  const liveClosed = runtime.closedSetup ? runtime.closedSetup(manifest) : closedSetupInExactContainer(manifest);
  if (!liveClosed) fail("The exact running Immich server does not prove IMMICH_ALLOW_SETUP=false");
  const selectedIntegrationUrl = integrationUrl(options.integrationUrl);
  let image = syntheticPng();
  if (options.imageFile) image = await ownerFile(options.imageFile, options.projectRoot, maxImageBytes);
  const credential = loadHouseholdCredential(options.projectRoot, options.runId, "immich");
  if (credential.email !== account.email || credential.username !== account.username) fail("Managed Immich admin does not match the approved account");
  const { assetId: id, imageSha256: digest } = await immichPhotoRoundTrip({
    origin, email: account.email, password: credential.password, runId: options.runId,
    image, fetch: runtime.fetch, now: runtime.now,
  });
  const evidence = {
    schemaVersion: 1, kind: "immich-service-acceptance", service: "immich", integrationUrl: selectedIntegrationUrl,
    status: "accepted", checks: [
      { id: "admin-login", status: "pass", evidenceRefs: [`immich:admin:${options.runId}`] },
      { id: "release-version", status: "pass", evidenceRefs: ["immich:version:v3.2.2"] },
      { id: "test-image-upload-retrieval", status: "pass", evidenceRefs: [`immich:asset:${id}`, `sha256:${digest}`] },
    ],
  };
  await privateOutput(options.acceptanceFile, options.projectRoot, evidence);
  process.stdout.write(`${JSON.stringify({ status: "accepted", acceptanceFile: options.acceptanceFile, assetId: id,
    release: "v3.2.2", imageSha256: digest, movedToRecoverableTrash: true })}\n`);
}

type KeyOptions = {
  action: "plan" | "create"; projectRoot: string; input: string; accountFile: string; runId: string;
  acceptanceFile: string; keyFile: string; approval?: string;
};
function parseKey(args: string[]): KeyOptions {
  const action = args[0];
  if (action !== "plan" && action !== "create") fail("Use immich homarr-key plan or create");
  const allowed = new Set(["--project-root", "--input", "--account-file", "--run-id", "--acceptance-file", "--key-file", "--approve"]);
  const flags: Record<string, string> = {};
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || flags[name] || !value || value.startsWith("--")) fail(`Invalid or repeated Immich key option: ${name ?? "(missing)"}`);
    flags[name] = value;
  }
  for (const name of allowed) if (name !== "--approve" && !flags[name]) fail(`Immich key command needs ${name}`);
  if (action === "plan" && flags["--approve"]) fail("Key planning does not accept approval");
  if (action === "create" && !flags["--approve"]) fail("Key creation needs exact approval");
  if (!runIdPattern.test(flags["--run-id"])) fail("Invalid Immich run ID");
  return {
    action, projectRoot: flags["--project-root"], input: flags["--input"], accountFile: flags["--account-file"],
    runId: flags["--run-id"], acceptanceFile: flags["--acceptance-file"], keyFile: flags["--key-file"], approval: flags["--approve"],
  };
}

export async function immichHomarrKeyCommand(args: string[], runtime: ImmichAcceptRuntime = {}): Promise<void> {
  const options = parseKey(args);
  await safeRoot(options.projectRoot);
  await inspectOutput(options.keyFile, options.projectRoot);
  const input = JSON.parse((await ownerFile(options.input, options.projectRoot, 256 * 1024)).toString("utf8"));
  const account = JSON.parse((await ownerFile(options.accountFile, options.projectRoot, 8 * 1024)).toString("utf8"));
  const accepted = JSON.parse((await ownerFile(options.acceptanceFile, options.projectRoot, 32 * 1024)).toString("utf8"));
  if (!record(account) || account.schemaVersion !== 1 || typeof account.email !== "string" || typeof account.username !== "string") fail("Immich account input is invalid");
  const manifest = buildImmichManifest(input) as Record<string, any>;
  if (manifest.project.root !== options.projectRoot || input.allowSetup !== false) fail("Immich key creation requires the exact closed-setup manifest");
  const origin = originFromManifest(manifest);
  if (!record(accepted) || accepted.kind !== "immich-service-acceptance" || accepted.service !== "immich" || accepted.status !== "accepted"
    || !Array.isArray(accepted.checks) || accepted.checks.length !== 3
    || ["admin-login", "release-version", "test-image-upload-retrieval"].some((id) => !accepted.checks.some((check: unknown) => record(check) && check.id === id && check.status === "pass"))) {
    fail("Immich key creation requires complete accepted service evidence");
  }
  const approval = `CREATE_IMMICH_HOMARR_KEY:${createHash("sha256").update(JSON.stringify({
    project: manifest.project.id, input, account, accepted, keyFile: options.keyFile, permissions: immichHomarrPermissions,
  })).digest("hex")}`;
  if (options.action === "plan") {
    process.stdout.write(`${JSON.stringify({ status: "ready-for-approval", mutation: "one Immich API key named Homarr",
      permissions: immichHomarrPermissions, keyFile: options.keyFile, approval })}\n`);
    return;
  }
  if (options.approval !== approval) fail("Immich Homarr key approval does not match the exact plan");
  const credential = loadHouseholdCredential(options.projectRoot, options.runId, "immich");
  if (credential.email !== account.email || credential.username !== account.username) fail("Managed Immich admin does not match the approved account");
  const client = runtime.fetch ?? fetch;
  const login = await expectJson(client, origin, "/auth/login", null, 201, "Admin login", "POST",
    JSON.stringify({ email: account.email, password: credential.password }), "application/json");
  if (login.isAdmin !== true || login.userEmail !== account.email || typeof login.accessToken !== "string" || !login.accessToken) {
    fail("Immich login did not identify the intended admin");
  }
  const keysResponse = await request(client, origin, "/api-keys", login.accessToken);
  if (keysResponse.status !== 200) { await keysResponse.body?.cancel(); fail("Could not inspect existing Immich API keys"); }
  const keys = await keysResponse.json() as unknown;
  if (!Array.isArray(keys) || keys.some((key) => !record(key) || typeof key.name !== "string")) fail("Immich API key inventory is invalid");
  if (keys.some((key) => key.name === "Homarr")) fail("An Immich API key named Homarr already exists; do not create a duplicate");
  const created = await expectJson(client, origin, "/api-keys", login.accessToken, 201, "Immich Homarr API key creation", "POST",
    JSON.stringify({ name: "Homarr", permissions: immichHomarrPermissions }), "application/json");
  if (typeof created.secret !== "string" || created.secret.length < 8 || created.secret.length > 4096
    || created.secret.trim() !== created.secret || /[\u0000-\u001f\u007f]/.test(created.secret)) {
    fail("Immich created a key without a usable one-time secret; inspect and revoke the new key manually");
  }
  const secret = created.secret;
  let handle;
  try {
    handle = await open(options.keyFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(`${secret}\n`);
    await handle.sync();
    await handle.close();
  } catch {
    if (handle) await handle.close().catch(() => undefined);
    fail("Immich created a key but its one-time secret could not be saved; revoke the new key manually");
  }
  if (typeof created.id !== "string" || !uuid.test(created.id) || created.name !== "Homarr"
    || !Array.isArray(created.permissions) || JSON.stringify([...created.permissions].sort()) !== JSON.stringify([...immichHomarrPermissions].sort())) {
    fail(`Immich created an unexpected key; private secret is retained at ${options.keyFile} for manual inspection and revoke`);
  }
  const id = created.id;
  let current: Record<string, unknown>;
  try {
    const verified = await client(`${origin}/api/api-keys/me`, {
      headers: { "x-api-key": secret }, redirect: "error", signal: AbortSignal.timeout(20_000),
    });
    if (verified.status !== 200) { await verified.body?.cancel(); fail("New key could not authenticate"); }
    current = await boundedJson(verified, "New Immich Homarr API key");
  } catch {
    fail(`New Immich Homarr key ${id} could not be verified; private secret is retained at ${options.keyFile} for manual revoke`);
  }
  if (current.id !== id || current.name !== "Homarr" || !Array.isArray(current.permissions)
    || JSON.stringify([...current.permissions].sort()) !== JSON.stringify([...immichHomarrPermissions].sort())) {
    fail(`New Immich Homarr key ${id} did not verify with exact permissions; private secret is retained at ${options.keyFile} for manual revoke`);
  }
  process.stdout.write(`${JSON.stringify({ status: "created-and-verified", keyId: id, keyFile: options.keyFile,
    permissions: immichHomarrPermissions, secretPrinted: false })}\n`);
}
