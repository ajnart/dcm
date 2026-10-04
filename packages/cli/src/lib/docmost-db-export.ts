import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { link, lstat, open, realpath, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export type DocmostDbExportOptions = {
  projectRoot: string; input: string; runId: string; accountFile: string;
  destination: string; output: string; approval: string;
};
export type DocmostDbExportOwner = {
  root: string; project: string; context: string; directory: string; composeFile: string;
  manifestHash: string; checkpointHash: string; composeHash: string; sourceImage: string;
  mounts: Array<{ source: string; target: string; readOnly: boolean }>;
};
export type DocmostDbExportRuntime = {
  inspect?: (args: string[]) => Promise<string>;
  dump?: (args: string[], consume: (bytes: Uint8Array) => Promise<void>) => Promise<void>;
};
type Json = Record<string, any>;
const LIMIT = 512 * 1024 * 1024;
const DUMP_TIMEOUT = 120_000;
const DUMP_KILL_AFTER = 5_000;
const HOST_TIMEOUT = 130_000;
const KIND = "selfhost-docmost-database-export/v1";
const HEX = /^[a-f0-9]{64}$/;
const fail = (message: string): never => { throw new Error(message); };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const contains = (root: string, path: string) => { const r = relative(root, path); return r === "" || (!r.startsWith("..") && !isAbsolute(r)); };

function parse(args: string[]): { action: string; options: DocmostDbExportOptions } {
  const action = args[0];
  if (!["plan", "apply", "status"].includes(action)) fail("Docmost db-export requires plan, apply, or status");
  const values: Record<string, string> = {};
  const allowed = ["project-root", "input", "run-id", "account-file", "destination", "output", "approve"];
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, "");
    if (!args[i]?.startsWith("--") || !allowed.includes(key) || values[key] !== undefined
      || !args[i + 1] || args[i + 1].startsWith("--")) fail("Invalid Docmost db-export option");
    values[key] = args[i + 1];
  }
  for (const key of allowed.slice(0, 6)) if (!values[key]) fail(`Docmost db-export requires --${key}`);
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(values["run-id"])) fail("Invalid Docmost db-export run ID");
  if (action !== "apply" && values.approve) fail("--approve is only valid for db-export apply");
  return { action, options: { projectRoot: values["project-root"], input: values.input, runId: values["run-id"],
    accountFile: values["account-file"], destination: values.destination, output: values.output, approval: values.approve ?? "" } };
}

async function metadata(path: string, directory: boolean): Promise<void> {
  if (!isAbsolute(path) || resolve(path) !== path || await realpath(path) !== path) fail("Export path must be canonical and owned");
  const stat = await lstat(path);
  let expectedMode = 0o600;
  if (directory) expectedMode = 0o700;
  if (stat.uid !== process.getuid?.() || stat.isSymbolicLink() || (directory && !stat.isDirectory())
    || (!directory && (!stat.isFile() || stat.nlink !== 1))
    || (stat.mode & 0o777) !== expectedMode) fail("Export path must have exclusive owner permissions");
}
async function absent(path: string): Promise<boolean> {
  try { await lstat(path); return false; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; }
}
async function destination(options: DocmostDbExportOptions, root: string): Promise<void> {
  await metadata(options.destination, true);
  if (options.destination === "/" || options.destination === homedir() || contains(root, options.destination)
    || contains(options.destination, root) || !isAbsolute(options.output) || resolve(options.output) !== options.output
    || dirname(options.output) !== options.destination || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}\.dump$/.test(basename(options.output))) {
    fail("Export requires a new .dump file in a private destination outside the protected project");
  }
}
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function directoryIdentity(path: string): Promise<{ device: number; inode: number }> {
  await metadata(path, true);
  const stat = await lstat(path);
  return { device: stat.dev, inode: stat.ino };
}
async function fileHash(path: string): Promise<{ bytes: number; sha256: string }> {
  await metadata(path, false);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1 || stat.size > LIMIT) fail("Invalid private export");
    const contentHash = createHash("sha256"); let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) { bytes += chunk.length; if (bytes > LIMIT) fail("Export exceeds bound"); contentHash.update(chunk); }
    const current = await lstat(path);
    if (current.dev !== stat.dev || current.ino !== stat.ino || current.size !== bytes) fail("Export changed during readback");
    return { bytes, sha256: contentHash.digest("hex") };
  } finally { await handle.close(); }
}
async function writeRecord(path: string, value: unknown): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(dirname(path));
}
async function record(path: string): Promise<Json | null> {
  if (await absent(path)) return null;
  await metadata(path, false);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1
      || stat.size > 64 * 1024) fail("Export record must be one bounded private file");
    let value: Json;
    try { value = JSON.parse(await handle.readFile("utf8")); } catch { fail("Invalid export record"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid export record");
    const current = await lstat(path);
    if (current.dev !== stat.dev || current.ino !== stat.ino || current.size !== stat.size) fail("Export record changed during readback");
    return value;
  } finally { await handle.close(); }
}

async function inspectCommand(args: string[]): Promise<string> {
  return await new Promise((resolveValue, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stdout = ""; let failed = false;
    const timeout = setTimeout(() => { failed = true; child.kill("SIGKILL"); }, 10_000);
    child.stdout.on("data", (bytes: Buffer) => { stdout += bytes.toString("utf8"); if (Buffer.byteLength(stdout) > 64 * 1024) { failed = true; child.kill("SIGKILL"); } });
    child.stderr.on("data", () => { failed = true; child.kill("SIGKILL"); });
    child.on("error", () => { clearTimeout(timeout); reject(new Error("Managed database inspection failed")); });
    child.on("close", (code) => { clearTimeout(timeout); if (failed || code !== 0) reject(new Error("Managed database inspection failed")); else resolveValue(stdout); });
  });
}
async function identity(owner: DocmostDbExportOwner, runtime: DocmostDbExportRuntime): Promise<Json> {
  const inspect = runtime.inspect ?? inspectCommand;
  const prefix = ["--context", owner.context];
  const ids = (await inspect([...prefix, "container", "ls", "--all", "--no-trunc", "--filter", `label=com.docker.compose.project=${owner.project}`,
    "--filter", "label=com.docker.compose.service=database", "--format", "{{.ID}}"])).trim().split(/\s+/);
  if (ids.length !== 1 || !HEX.test(ids[0])) fail("Export requires exactly one managed database container");
  // Deliberately select no environment, password, logs, or database payload.
  const format = '{"id":{{json .Id}},"image":{{json .Image}},"sourceImage":{{json .Config.Image}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"configFile":{{json (index .Config.Labels "com.docker.compose.project.config_files")}},"directory":{{json (index .Config.Labels "com.docker.compose.project.working_dir")}},"oneoff":{{json (index .Config.Labels "com.docker.compose.oneoff")}},"running":{{json .State.Running}},"health":{{json .State.Health.Status}},"mounts":[{{range $i,$m := .Mounts}}{{if $i}},{{end}}{"Type":{{json $m.Type}},"Source":{{json $m.Source}},"Destination":{{json $m.Destination}},"RW":{{json $m.RW}}}{{end}}]}';
  let value: Json;
  try { value = JSON.parse(await inspect([...prefix, "container", "inspect", "--format", format, ids[0]])); }
  catch { fail("Managed database identity is unavailable"); }
  const aliases = [owner.sourceImage, owner.sourceImage.replace(/^docker\.io\/library\//, ""), owner.sourceImage.replace(/^docker\.io\//, "")];
  if (value.id !== ids[0] || typeof value.image !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.image)
    || !aliases.includes(value.sourceImage) || value.running !== true || value.health !== "healthy"
    || value.project !== owner.project || value.service !== "database" || value.configFile !== owner.composeFile
    || value.directory !== owner.directory || value.oneoff !== "False" || !Array.isArray(value.mounts)
    || value.mounts.length !== owner.mounts.length) fail("Managed database identity does not match the applied adapter");
  for (const expected of owner.mounts) {
    const found = value.mounts.filter((mount: Json) => mount.Type === "bind" && mount.Source === expected.source
      && mount.Destination === expected.target && mount.RW === !expected.readOnly);
    if (found.length !== 1) fail("Managed database mounts do not match the applied adapter");
  }
  const image = (await inspect([...prefix, "image", "inspect", "--format", "{{.Id}}", owner.sourceImage])).trim();
  if (image !== value.image) fail("Managed database does not use the exact pinned source image");
  return { containerId: value.id, imageId: image, service: "database", database: "docmost", user: "docmost" };
}

async function dumpCommand(args: string[], consume: (bytes: Uint8Array) => Promise<void>): Promise<void> {
  const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
  let failed = false;
  const completion = new Promise<number | null>((resolveCode) => { child.on("error", () => { failed = true; resolveCode(null); }); child.on("close", resolveCode); });
  const timeout = setTimeout(() => { failed = true; child.kill("SIGKILL"); }, HOST_TIMEOUT);
  child.stderr.on("data", () => { failed = true; child.kill("SIGKILL"); });
  try {
    for await (const bytes of child.stdout) await consume(bytes);
    if (await completion !== 0 || failed) fail("Native database export failed");
  } catch { child.kill("SIGKILL"); await completion; fail("Native database export failed"); }
  finally { clearTimeout(timeout); }
}

const claims = { singleDatabaseSnapshot: false, applicationConsistency: false, writerQuiescence: false,
  uploadsIncluded: false, redisIncluded: false, adapterSecretFilesIncluded: false, archiveContainsPrivateData: true,
  encrypted: false, offHostBackupVerified: false, restoreVerified: false };
export async function docmostDbExportCommand(args: string[], loadOwner: (options: DocmostDbExportOptions) => Promise<DocmostDbExportOwner>,
  runtime: DocmostDbExportRuntime = {}): Promise<void> {
  const { action, options } = parse(args);
  const owner = await loadOwner(options);
  await destination(options, owner.root);
  const intentPath = `${options.output}.intent.json`;
  const outcomePath = `${options.output}.outcome.json`;
  const partial = `${options.output}.partial`;
  if (action === "status") {
    const intent = await record(intentPath);
    if (!intent) { print({ kind: KIND, status: "not-started", output: options.output, destination: options.destination, replayAllowed: false, ...claims }); return; }
    const { plan, digest } = intent;
    if (Object.keys(intent).sort().join() !== "digest,kind,plan,schemaVersion" || intent.schemaVersion !== 1 || intent.kind !== KIND
      || !plan || hash(plan) !== digest || plan.owner.project !== owner.project || plan.owner.root !== owner.root
      || plan.runId !== options.runId || plan.output !== options.output || hash(plan.owner) !== hash(owner)
      || hash(plan.destinationIdentity) !== hash(await directoryIdentity(options.destination))) fail("Export intent is invalid or stale");
    let status = "unknown-no-replay"; let stage = "intent-recorded"; let bytes: number | null = null; let sha256: string | null = null;
    try {
      const outcome = await record(outcomePath);
      if (outcome?.kind === KIND && outcome.schemaVersion === 1 && outcome.digest === digest && outcome.status === "unknown-no-replay"
        && ["open-private-staging", "native-pg-dump", "publish-private-export", "record-export-outcome"].includes(outcome.stage)
        && Object.keys(outcome).sort().join() === "digest,kind,schemaVersion,stage,status") stage = outcome.stage;
      if (outcome?.kind === KIND && outcome.schemaVersion === 1 && outcome.digest === digest && outcome.status === "exported"
        && Number.isSafeInteger(outcome.bytes) && outcome.bytes >= 5 && outcome.bytes <= LIMIT && HEX.test(outcome.sha256)
        && Object.keys(outcome).sort().join() === "bytes,digest,kind,schemaVersion,sha256,status") {
        const current = await fileHash(options.output);
        if (current.bytes === outcome.bytes && current.sha256 === outcome.sha256) { status = "exported"; stage = "record-export-outcome"; bytes = current.bytes; sha256 = current.sha256; }
      }
    } catch { /* A damaged/missing outcome never upgrades an interrupted attempt. */ }
    print({ kind: KIND, status, stage, replayAllowed: false, output: options.output, destination: options.destination, bytes, sha256, approvalDigest: digest,
      ...claims, singleDatabaseSnapshot: status === "exported" });
    return;
  }
  for (const path of [options.output, partial, intentPath, outcomePath]) if (!await absent(path)) fail("Export target is already present or consumed; do not replay");
  const source = await identity(owner, runtime);
  const plan = { schemaVersion: 1, kind: KIND, runId: options.runId, owner, source, destination: options.destination,
    destinationIdentity: await directoryIdentity(options.destination),
    output: options.output, format: "custom", maxBytes: LIMIT, timeoutMs: DUMP_TIMEOUT,
    killAfterMs: DUMP_KILL_AFTER, hostWatchdogMs: HOST_TIMEOUT, claims };
  const digest = hash(plan);
  const approval = `EXPORT-DOCMOST:${owner.project}:${digest}`;
  if (action === "plan") {
    print({ kind: KIND, status: "planned", mutation: false, live: true, observation: "read-only-container-metadata", approval,
      project: owner.project, runId: options.runId, source, output: options.output, format: "custom", maxBytes: LIMIT,
      destination: options.destination, timeoutMs: DUMP_TIMEOUT, killAfterMs: DUMP_KILL_AFTER, hostWatchdogMs: HOST_TIMEOUT, ...claims });
    return;
  }
  if (options.approval !== approval) fail("Docmost database export requires the exact fresh approval token");
  await writeRecord(intentPath, { schemaVersion: 1, kind: KIND, plan, digest });
  const recheckDestination = async () => {
    if (hash(await directoryIdentity(options.destination)) !== hash(plan.destinationIdentity)) fail("Approved export destination changed");
  };
  let stage = "open-private-staging";
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    await recheckDestination();
    handle = await open(partial, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const staging = await handle.stat();
    const contentHash = createHash("sha256"); let bytes = 0; let magic = Buffer.alloc(0);
    stage = "native-pg-dump";
    const argv = ["--context", owner.context, "exec", "--user", "postgres", source.containerId,
      "timeout", "--signal=TERM", "--kill-after=5s", "120s", "pg_dump",
      "--format=custom", "--no-password", "--host=/var/run/postgresql", "--port=5432", "--username=docmost", "--dbname=docmost"];
    await (runtime.dump ?? dumpCommand)(argv, async (chunk) => {
      bytes += chunk.length;
      if (bytes > LIMIT) fail("Native database export exceeds its bound");
      if (magic.length < 5) magic = Buffer.concat([magic, Buffer.from(chunk)]).subarray(0, 5);
      contentHash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) { const result = await handle!.write(chunk, offset, chunk.length - offset); if (result.bytesWritten < 1) fail("Export write failed"); offset += result.bytesWritten; }
    });
    if (magic.toString("ascii") !== "PGDMP") fail("Native export is not a PostgreSQL custom archive");
    stage = "publish-private-export";
    await handle.sync(); await handle.close(); handle = null;
    await recheckDestination(); await metadata(partial, false);
    const stagedPath = await lstat(partial);
    if (stagedPath.dev !== staging.dev || stagedPath.ino !== staging.ino || stagedPath.size !== bytes) fail("Export staging changed before publish");
    await link(partial, options.output); await unlink(partial); await syncDirectory(options.destination);
    stage = "record-export-outcome";
    const sha256 = contentHash.digest("hex");
    const published = await fileHash(options.output);
    await recheckDestination();
    if (published.bytes !== bytes || published.sha256 !== sha256) fail("Published export does not match native output");
    await writeRecord(outcomePath, { schemaVersion: 1, kind: KIND, digest, status: "exported", bytes, sha256 });
    print({ kind: KIND, status: "exported", replayAllowed: false, output: options.output, destination: options.destination, bytes, sha256, approvalDigest: digest,
      ...claims, singleDatabaseSnapshot: true });
  } catch {
    if (handle) { try { await handle.sync(); await handle.close(); } catch { /* Consumed intent remains authoritative. */ } }
    try { await writeRecord(outcomePath, { schemaVersion: 1, kind: KIND, digest, status: "unknown-no-replay", stage }); } catch { /* Do not overwrite existing outcome. */ }
    process.exitCode = 1;
    print({ kind: KIND, status: "unknown-no-replay", stage, replayAllowed: false, output: options.output, destination: options.destination, partial, ...claims });
  }
}
