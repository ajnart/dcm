import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { chmod, cp, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { validatePrivateProxyOrigin } from "../../../scripts/lib/session-access.ts";
import { requireInstallPlan } from "./catalog-gate.ts";
import { parseMediaNetworkSubnets, type MediaNetworkSubnets } from "./media-network-subnets.ts";
import {
  assertNoRuntimeSyncTransaction,
  mediaRuntimeSync,
  runtimeTransitionAllows,
  withMediaRuntimeLock,
  type MediaRuntimePaths,
} from "./media-runtime-sync.ts";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const asset = join(packageRoot, "media-runtime");
const runIdPattern = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const usernamePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/;
const digestPattern = /^[0-9a-f]{64}$/;
const boardNamePattern = /^[A-Za-z0-9_-]{1,64}$/;
const boardApprovalPattern = /^sha256:[0-9a-f]{64}$/;
const stageOrder = ["up", "qbittorrent", "sonarr", "radarr", "prowlarr", "jellyfin", "seerr", "homarr", "homarr-finalize", "homarr-widgets", "homarr-notebook", "mcp-config", "mcp-verify", "verify", "connections", "handoff"] as const;
const stages = new Set<string>(stageOrder);
const mediaServices = ["prowlarr", "radarr", "sonarr", "qbittorrent", "jellyfin", "seerr", "homarr"] as const;
const containerStates = new Set(["created", "restarting", "running", "removing", "paused", "exited", "dead"]);
const healthStates = new Set(["unavailable", "starting", "healthy", "unhealthy"]);
const containerIdPattern = /^[0-9a-f]{12,64}$/;
const mediaPortKeys = ["PROWLARR_PORT", "RADARR_PORT", "SONARR_PORT", "QBITTORRENT_PORT", "JELLYFIN_PORT", "SEERR_PORT", "HOMARR_PORT"];
const networkOverrideName = "network-ipam.compose.yml";

function portStart(value: string): number {
  if (!/^[0-9]{5}$/.test(value)) fail("--port-start must be the first of seven ports from 20000 through 44999");
  const start = Number(value);
  if (start < 20000 || start > 44993) fail("--port-start must be from 20000 through 44993");
  return start;
}

function fail(message: string): never { throw new Error(message); }
function assertOptions(args: string[], allowed: string[], switches: string[] = []) {
  const valid = new Set(allowed);
  const booleanOptions = new Set(switches);
  const seenSwitches = new Set<string>();
  for (let index = 1; index < args.length;) {
    if (booleanOptions.has(args[index])) {
      if (!valid.has(args[index]) || seenSwitches.has(args[index])) {
        fail(`Unexpected or repeated media option: ${args[index]}`);
      }
      seenSwitches.add(args[index]);
      index += 1;
      continue;
    }
    if (!valid.has(args[index]) || !args[index + 1] || args[index + 1].startsWith("--")) {
      fail(`Unexpected or incomplete media option: ${args[index] ?? "(missing)"}`);
    }
    index += 2;
  }
}
function getOption(args: string[], name: string, required = true): string | null {
  const index = args.indexOf(name);
  if (index < 0) {
    if (required) fail(`Missing ${name}`);
    return null;
  }
  if (args.indexOf(name, index + 1) >= 0) fail(`Duplicate ${name}`);
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} needs a value`);
  return value;
}
function child(command: string[], cwd: string, environment?: Record<string, string>,
  limits: { maxBuffer?: number; timeout?: number } = {}) {
  const childEnvironment = { ...process.env };
  if (environment) Object.assign(childEnvironment, environment);
  const result = spawnSync(command[0], command.slice(1), {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: limits.maxBuffer ?? 1024 * 1024,
    timeout: limits.timeout,
    env: childEnvironment,
  });
  return { ok: result.status === 0, code: result.status, output: result.stdout ?? "", error: result.stderr ?? "" };
}
async function boundedMediaChild(command: string[], cwd: string) {
  return new Promise<{ ok: boolean; code: number | null; output: string }>((resolve) => {
    const execution = spawn(command[0], command.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let failed = false;
    let captured = 0;
    const output: Buffer[] = [];
    const stop = () => { failed = true; execution.kill("SIGKILL"); };
    const timeout = setTimeout(stop, 120_000);
    const capture = (chunk: Buffer, keep: boolean) => {
      captured += chunk.length;
      if (captured > 64 * 1024) { stop(); return; }
      if (keep) output.push(chunk);
    };
    execution.stdout.on("data", (chunk: Buffer) => capture(chunk, true));
    execution.stderr.on("data", (chunk: Buffer) => capture(chunk, false));
    execution.on("error", () => { failed = true; });
    execution.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ ok: !failed && code === 0, code, output: Buffer.concat(output).toString("utf8") });
    });
  });
}
async function streamSetup(command: string[], cwd: string) {
  return new Promise<{ ok: boolean; pending: boolean; failedStage: string | null }>((resolve) => {
    let failedStage: string | null = null;
    let launchFailed = false;
    const process = spawn(command[0], command.slice(1), {
      cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    const safeLine = /^(Automated setup is running\. |Starting |PASS |FAIL |PENDING |Benchmark: |Setup summary: |View dashboard: |Private credentials and service URLs: |Partial private credentials and available service URLs: |Private credential export was not requested; |Private credential export is pending; |Jellyfin plays your library; |Still to choose separately: |From another device, |Browser takeover: )/;
    const report = (line: string) => {
      if (!safeLine.test(line)) return;
      const failed = /^FAIL ([a-z-]+) \(/.exec(line);
      if (failed) failedStage = failed[1];
      console.log(line);
    };
    const follow = (stream: NodeJS.ReadableStream) => {
      let pending = "";
      let oversized = false;
      stream.on("data", (chunk: Buffer) => {
        for (const character of chunk.toString("utf8")) {
          if (character === "\n") {
            if (!oversized) report(pending.replace(/\r$/, ""));
            pending = "";
            oversized = false;
          } else if (!oversized) {
            pending += character;
            if (pending.length > 4096) {
              pending = "";
              oversized = true;
            }
          }
        }
      });
      return () => { if (pending && !oversized) report(pending.replace(/\r$/, "")); };
    };
    const flushOutput = follow(process.stdout);
    const flushError = follow(process.stderr);
    process.on("error", () => { launchFailed = true; });
    process.on("close", (code) => {
      flushOutput();
      flushError();
      resolve({ ok: !launchFailed && code === 0, pending: !launchFailed && code === 2, failedStage });
    });
  });
}
function mediaStatusFailure(harness: string, step: string): never {
  const daemon = child(["docker", "info", "--format", "{{.ServerVersion}}"], harness);
  if (!daemon.ok) {
    fail(`Media ${step} could not query Docker. Check that the daemon is running and this user can access its context; run self-host doctor. Docker output was suppressed.`);
  }
  fail(`Media ${step} failed after Docker responded. Inspect this exact run's Docker containers and retry status; child output was suppressed.`);
}
function sha(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }
function safeOwner(owner: number, installed: boolean) {
  if (typeof process.getuid !== "function") return true;
  if (owner === process.getuid()) return true;
  return !installed && owner === 0;
}
function shellQuote(value: string) { return `'${value.replaceAll("'", "'\"'\"'")}'`; }

function preflight(root: string) {
  if (process.platform !== "linux") fail("Media install currently requires a Linux host");
  const bun = child(["bun", "--version"], root);
  const version = /^(\d+)\.(\d+)\.(\d+)/.exec(bun.output.trim());
  if (!bun.ok || !version) fail("Media install requires Bun");
  const major = Number(version[1]);
  const minor = Number(version[2]);
  if (major < 1 || (major === 1 && minor < 4)) fail("Media install requires Bun 1.4 or newer; run self-host doctor");
  const bash = child(["bash", "--version"], root);
  if (!bash.ok || !/^GNU bash, version [4-9]\./.test(bash.output)) fail("Media install requires GNU Bash 4 or newer");
  const compose = child(["docker", "compose", "version", "--short"], root);
  if (!compose.ok) fail("Media install requires Docker Compose");
  const docker = child(["docker", "info", "--format", "{{.ServerVersion}}"], root);
  if (!docker.ok || !/^\d+\.\d+\.\d+/.test(docker.output.trim())) {
    fail("Docker daemon is unreachable from this invocation; check its state, selected context, socket permissions, or sandbox access");
  }
}

async function assertPrivateDirectory(path: string) {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail("Project directory must be a real directory");
  if (await realpath(path) !== path) fail("Project directory must use its canonical path");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail("Project directory has a different owner");
  if ((metadata.mode & 0o002) !== 0) fail("Project directory must not be world-writable");
}

async function projectPaths(rootInput: string) {
  if (!isAbsolute(rootInput)) fail("--project-root must be absolute");
  const root = resolve(rootInput);
  if (root === "/" || root !== rootInput) fail("--project-root must be an exact canonical directory");
  if (root === await realpath(homedir())) fail("--project-root must not be the user home directory");
  await assertPrivateDirectory(root);
  const local = join(root, ".selfhost");
  return { root, local, harness: join(local, "media-harness") };
}

async function walkRuntime(path: string, expectedFiles: Set<string>, installed: boolean, prefix = "") {
  for (const entry of await readdir(join(path, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const metadata = await lstat(join(path, relative));
    if (metadata.isSymbolicLink() || !safeOwner(metadata.uid, installed)) {
      fail(`Unsafe media runtime entry: ${relative}`);
    }
    if (installed && relative === ".sessions") {
      if (!metadata.isDirectory() || (metadata.mode & 0o777) !== 0o700) fail("Unsafe private media sessions directory");
      continue;
    }
    if (metadata.isDirectory()) {
      if (![...expectedFiles].some((file) => file.startsWith(`${relative}/`))) {
        fail(`Unexpected media runtime directory: ${relative}`);
      }
      if (installed && (metadata.mode & 0o777) !== 0o700) fail(`Unsafe media runtime directory: ${relative}`);
      if (!installed && (metadata.mode & 0o002) !== 0) fail(`World-writable packaged media directory: ${relative}`);
      await walkRuntime(path, expectedFiles, installed, relative);
      continue;
    }
    if (!metadata.isFile() || metadata.nlink !== 1 || !expectedFiles.has(relative)) {
      fail(`Unexpected media runtime entry: ${relative}`);
    }
  }
}

async function makeRuntimePrivate(path: string, prefix = "") {
  await chmod(join(path, prefix), 0o700);
  for (const entry of await readdir(join(path, prefix), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      await makeRuntimePrivate(path, relative);
    }
  }
}

async function verifyRuntime(path: string, installed = false) {
  const rootStat = await lstat(path);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !safeOwner(rootStat.uid, installed)) fail("Unsafe media runtime directory");
  if (installed && (rootStat.mode & 0o777) !== 0o700) fail("Installed media runtime must use mode 0700");
  const manifestPath = join(path, "runtime-manifest.json");
  const manifestStat = await lstat(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.nlink !== 1
    || !safeOwner(manifestStat.uid, installed)
    || (installed && (manifestStat.mode & 0o777) !== 0o600)) fail("Unsafe media runtime manifest");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) fail("Invalid media runtime manifest");
  const expectedFiles = new Set<string>(["runtime-manifest.json"]);
  for (const record of manifest.files) {
    if (typeof record.path !== "string" || !/^([a-z0-9-]+\/)*[a-z0-9.-]+$/.test(record.path)
      || typeof record.sha256 !== "string" || !digestPattern.test(record.sha256)
      || ![0o644, 0o755].includes(record.mode) || expectedFiles.has(record.path)) fail("Invalid media runtime file record");
    expectedFiles.add(record.path);
    const file = join(path, record.path);
    const metadata = await lstat(file);
    const mode = metadata.mode & 0o777;
    let unsafeMode = mode !== record.mode;
    if (!installed) {
      // Package managers may add group-write bits. The hash is checked before
      // and after copying; the owner-only installed copy gets the pinned mode.
      unsafeMode = (metadata.mode & 0o7000) !== 0 || (mode & 0o002) !== 0
        || (mode & 0o400) === 0
        || ((record.mode & 0o100) !== 0 && (mode & 0o100) === 0);
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
      || !safeOwner(metadata.uid, installed)
      || unsafeMode) fail(`Unsafe media runtime file: ${record.path}`);
    if (sha(await readFile(file)) !== record.sha256) fail(`Media runtime changed: ${record.path}`);
  }
  await walkRuntime(path, expectedFiles, installed);
  return manifest;
}

async function installRuntime(paths: Awaited<ReturnType<typeof projectPaths>>) {
  const packaged = await verifyRuntime(asset);
  if (!existsSync(paths.local)) await mkdir(paths.local, { mode: 0o700 });
  await assertPrivateDirectory(paths.local);
  const localStat = await stat(paths.local);
  if ((localStat.mode & 0o777) !== 0o700) fail(".selfhost must use mode 0700");
  if (existsSync(paths.harness)) {
    await assertPrivateDirectory(paths.harness);
    const installed = await verifyRuntime(paths.harness, true);
    const currentPackaged = await verifyRuntime(asset);
    if (JSON.stringify(installed) !== JSON.stringify(currentPackaged)) {
      fail("This project has a different media runtime; use the CLI version that created it or choose a new project root");
    }
    return;
  }
  const staging = await mkdtemp(join(paths.local, ".media-install-"));
  try {
    await cp(asset, staging, { recursive: true, force: false });
    await verifyRuntime(staging);
    await makeRuntimePrivate(staging);
    for (const record of packaged.files) {
      await chmod(join(staging, record.path), record.mode);
    }
    await chmod(join(staging, "runtime-manifest.json"), 0o600);
    await verifyRuntime(staging, true);
    await rename(staging, paths.harness);
  } finally {
    if (existsSync(staging)) await rm(staging, { recursive: true });
  }
}

function parseManifest(text: string) {
  const values: Record<string, string> = {};
  for (const line of text.trim().split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=(.+)$/.exec(line);
    if (!match || Object.hasOwn(values, match[1])) fail("Session manifest is invalid");
    values[match[1]] = match[2];
  }
  return values;
}

async function runIdentity(paths: Awaited<ReturnType<typeof projectPaths>>, runId: string) {
  if (!existsSync(paths.harness)) {
    fail("This project has no installed CLI media runtime; use its owning harness status command instead");
  }
  await verifyRuntime(paths.harness, true);
  const intents = join(paths.local, "cli-intents");
  const intentPath = join(intents, `${runId}.json`);
  if (!existsSync(intentPath)) {
    fail("This media run is not managed by this CLI; use the installed media harness status command for this exact run ID");
  }
  await assertPrivateDirectory(intents);
  if (((await stat(intents)).mode & 0o777) !== 0o700) fail("Private CLI intents must use mode 0700");
  const intent = await readPrivateJson(intentPath);
  const intentKeys = ["credentialHandoff", "runId", "runtimeSha256", "schemaVersion", "username"];
  if (Object.hasOwn(intent, "bindMode")) intentKeys.push("bindMode");
  if (Object.hasOwn(intent, "portStart")) intentKeys.push("portStart");
  if (Object.hasOwn(intent, "networkSubnets")) intentKeys.push("networkSubnets");
  let networkSubnets: MediaNetworkSubnets | undefined;
  if (Object.hasOwn(intent, "networkSubnets")) {
    networkSubnets = parseMediaNetworkSubnets(intent.networkSubnets);
    if (JSON.stringify(intent.networkSubnets) !== JSON.stringify(networkSubnets)) {
      fail("Invalid CLI media network selection");
    }
  }
  if (!intent || typeof intent !== "object" || Array.isArray(intent)
    || JSON.stringify(Object.keys(intent).sort()) !== JSON.stringify(intentKeys.sort())
    || intent.schemaVersion !== 1 || intent.runId !== runId
    || typeof intent.username !== "string" || !usernamePattern.test(intent.username)
    || typeof intent.credentialHandoff !== "boolean"
    || (intent.bindMode !== undefined && intent.bindMode !== "host-only")
    || (intent.portStart !== undefined && (!Number.isInteger(intent.portStart) || intent.portStart < 20000 || intent.portStart > 44993))
    || typeof intent.runtimeSha256 !== "string" || !digestPattern.test(intent.runtimeSha256)) {
    fail("Invalid CLI media ownership record");
  }
  const installedRuntimeSha256 = sha(await readFile(join(paths.harness, "runtime-manifest.json")));
  if (!await runtimeTransitionAllows(paths.local, intent.runtimeSha256, installedRuntimeSha256)) {
    fail("Invalid CLI media ownership record");
  }
  const manifestPath = join(paths.harness, ".sessions", runId, "manifest.env");
  await assertPrivateDirectory(dirname(manifestPath));
  if (((await stat(dirname(manifestPath))).mode & 0o777) !== 0o700) fail("Private media run must use mode 0700");
  const manifestStat = await lstat(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.nlink !== 1
    || !safeOwner(manifestStat.uid, true)
    || (manifestStat.mode & 0o777) !== 0o600) fail("Unsafe private session manifest");
  const manifest = parseManifest(await readFile(manifestPath, "utf8"));
  if (manifest.RUN_ID !== runId || manifest.COMPOSE_PROJECT_NAME !== `autostack-${runId}`
    || manifest.SESSION_ROOT !== dirname(manifestPath)) fail("Session manifest does not match this run");
  if (intent.bindMode === "host-only"
    && (manifest.HOMARR_BIND_ADDRESS !== "127.0.0.1" || manifest.MEDIA_PORT_BIND_PREFIX !== "127.0.0.1:")) {
    fail("Host-only media intent and session manifest differ");
  }
  if (intent.bindMode === undefined && manifest.MEDIA_PORT_BIND_PREFIX !== undefined) {
    fail("Media port bind prefix was not selected by this CLI run");
  }
  if (intent.portStart !== undefined) {
    for (const [index, key] of mediaPortKeys.entries()) {
      if (manifest[key] !== String(intent.portStart + index)) fail("Media port selection differs from the CLI prepare intent");
    }
  }
  const networkOverride = join(dirname(manifestPath), networkOverrideName);
  if (networkSubnets) {
    if (manifest.MEDIA_DEFAULT_SUBNET !== networkSubnets.default || manifest.MEDIA_WEB_SUBNET !== networkSubnets.web) {
      fail("Media network selection differs from the CLI prepare intent");
    }
    const metadata = await lstat(networkOverride);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
      || !safeOwner(metadata.uid, true) || (metadata.mode & 0o777) !== 0o600) {
      fail("Unsafe private media network override");
    }
    const expected = `networks:\n  default:\n    ipam:\n      config:\n        - subnet: ${networkSubnets.default}\n  web:\n    ipam:\n      config:\n        - subnet: ${networkSubnets.web}\n`;
    if (await readFile(networkOverride, "utf8") !== expected) fail("Media network override differs from this CLI run");
  } else if (manifest.MEDIA_DEFAULT_SUBNET !== undefined || manifest.MEDIA_WEB_SUBNET !== undefined
    || existsSync(networkOverride)) {
    fail("Media network subnets were not selected by this CLI run");
  }
  return { manifest, bindMode: intent.bindMode, credentialHandoff: intent.credentialHandoff, networkSubnets, runtimeSha256: intent.runtimeSha256,
    composeProject: manifest.COMPOSE_PROJECT_NAME, provenance: "cli-managed" as const };
}

function boardPolishOutput(text: string, action: "plan" | "apply", boardName: string,
  approvedDigest: string | null, reflowAll = false) {
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { fail("Installed Homarr board-polish command returned invalid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("Installed Homarr board-polish command returned an invalid result");
  }
  const result = parsed as Record<string, unknown>;
  const board = result.board;
  if (result.schema !== "selfhost-homarr-starter-board-polish-plan/v2"
    || !board || typeof board !== "object" || Array.isArray(board)
    || (board as Record<string, unknown>).name !== boardName
    || (board as Record<string, unknown>).private !== true) {
    fail("Installed Homarr board-polish command returned an invalid result");
  }
  if (reflowAll && (result.layoutMode !== "all-top-left" || !Array.isArray(result.removeItems) || result.removeItems.length !== 0)) {
    fail("Homarr all-item reflow returned a non-layout-only result");
  }
  if (!reflowAll && result.layoutMode !== undefined && result.layoutMode !== "managed-y") {
    fail("Homarr board-polish result does not match the selected layout mode");
  }
  if (action === "plan") {
    if (result.live !== false) fail("Homarr board-polish plan reported a live mutation");
    let actions = ["remove-exact-starter-items", "already-clean", "no-exact-starter-set"];
    if (reflowAll) actions = ["reflow-all-items", "already-reflowed"];
    if (!actions.includes(String(result.action))) {
      fail("Homarr board-polish plan returned an invalid action");
    }
    if (result.action === "remove-exact-starter-items" || result.action === "reflow-all-items") {
      if (typeof result.approvalDigest !== "string" || !boardApprovalPattern.test(result.approvalDigest)) {
        fail("Homarr board-polish plan returned an invalid approval digest");
      }
    } else if (result.approvalDigest !== null) {
      fail("Homarr board-polish no-op returned an approval digest");
    }
    return result;
  }
  if (result.live !== true || result.action !== "applied" || result.approvalDigest !== approvedDigest) {
    fail("Homarr board-polish apply returned an invalid result");
  }
  return result;
}

async function mediaBoardPolishCommand(args: string[], lockedPaths?: MediaRuntimePaths) {
  const action = args[0];
  if (!action || action === "help" || action === "--help") {
    console.log("self-host install media board-polish plan --project-root ABSOLUTE --run-id ID --board NAME [--reflow-all]\nself-host install media board-polish apply --project-root ABSOLUTE --run-id ID --board NAME --approve sha256:... [--reflow-all]");
    return;
  }
  if (action !== "plan" && action !== "apply") fail("board-polish accepts plan or apply");
  const allowed = ["--project-root", "--run-id", "--board", "--reflow-all"];
  if (action === "apply") allowed.push("--approve");
  assertOptions(args, allowed, ["--reflow-all"]);
  const reflowAll = args.includes("--reflow-all");
  const root = getOption(args, "--project-root");
  const runId = getOption(args, "--run-id");
  const boardName = getOption(args, "--board");
  if (!runIdPattern.test(runId!)) fail("Invalid run ID");
  if (!boardNamePattern.test(boardName!)) fail("Invalid Homarr board name");
  let approvedDigest: string | null = null;
  if (action === "apply") {
    approvedDigest = getOption(args, "--approve");
    if (approvedDigest === null || !boardApprovalPattern.test(approvedDigest)) {
      fail("--approve must be the sha256-prefixed digest from a fresh board-polish plan");
    }
  }
  const paths = lockedPaths ?? await projectPaths(root!);
  await runIdentity(paths, runId!);
  const command = ["bash", "scripts/session.sh", "homarr-board-polish", action, runId!, boardName!];
  if (approvedDigest !== null) command.push("--approve", approvedDigest);
  if (reflowAll) command.push("--reflow-all");
  const result = child(command, paths.harness);
  if (!result.ok) {
    fail(`Homarr board-polish ${action} failed for this exact CLI-managed run; child output was suppressed`);
  }
  const output = boardPolishOutput(result.output, action, boardName!, approvedDigest, reflowAll);
  console.log(JSON.stringify(output, null, 2));
}

type MediaAccessRoutes = Record<string, { origin: string; privateDnsConfirmed: boolean }>;
const accessMetadataRead = `import { pathToFileURL } from "node:url";
const helper = await import(pathToFileURL(process.argv.at(-2)).href);
const config = helper.loadSessionAccessConfig({sessionDir:process.argv.at(-1)});
process.stdout.write(JSON.stringify({schemaVersion:1,routes:config.routes}));`;

async function mediaAccessRoutes(paths: MediaRuntimePaths, runId: string): Promise<MediaAccessRoutes> {
  // Invoke only the canonical metadata reader, never loadSession or any credential reader.
  const result = child(["bun", "--eval", accessMetadataRead, "selfhost-media-access-metadata-read",
    join(paths.harness, "scripts", "lib", "session-context.ts"), join(paths.harness, ".sessions", runId)],
  paths.harness, undefined, { maxBuffer: 32 * 1024, timeout: 5_000 });
  if (!result.ok) fail("Media access metadata could not be safely read; child output was suppressed");
  let parsed: unknown;
  try { parsed = JSON.parse(result.output); } catch { fail("Media access metadata returned invalid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("Media access metadata is invalid");
  const value = parsed as Record<string, unknown>;
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["routes", "schemaVersion"])
    || value.schemaVersion !== 1 || !value.routes || typeof value.routes !== "object" || Array.isArray(value.routes)) {
    fail("Media access metadata has an invalid schema");
  }
  const routes: MediaAccessRoutes = {};
  for (const service of Object.keys(value.routes).sort()) {
    if (!mediaServices.includes(service as typeof mediaServices[number])) fail("Media access metadata contains an unknown service");
    const raw = (value.routes as Record<string, unknown>)[service];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Media access metadata contains an invalid route");
    const route = raw as Record<string, unknown>;
    if (JSON.stringify(Object.keys(route).sort()) !== JSON.stringify(["origin", "privateDnsConfirmed"])
      || typeof route.origin !== "string" || typeof route.privateDnsConfirmed !== "boolean") {
      fail("Media access metadata contains an invalid route schema");
    }
    const origin = validatePrivateProxyOrigin(route.origin, service, route.privateDnsConfirmed);
    if (origin !== route.origin) fail("Media access metadata contains a noncanonical origin");
    routes[service] = { origin, privateDnsConfirmed: route.privateDnsConfirmed };
  }
  return routes;
}

async function mediaAccessProxyCommand(args: string[], lockedPaths?: MediaRuntimePaths) {
  const action = args[0];
  if (!action || action === "help" || action === "--help") {
    console.log("self-host install media access-proxy plan|apply --project-root ABSOLUTE --run-id ID --service NAME --origin HTTPS_ORIGIN [--private-dns-confirmed] [--approve sha256:DIGEST (apply)]");
    return;
  }
  if (action !== "plan" && action !== "apply") fail("access-proxy accepts plan or apply");
  const allowed = ["--project-root", "--run-id", "--service", "--origin", "--private-dns-confirmed"];
  if (action === "apply") allowed.push("--approve");
  assertOptions(args, allowed, ["--private-dns-confirmed"]);
  const runId = getOption(args, "--run-id")!;
  const service = getOption(args, "--service")!;
  const rawOrigin = getOption(args, "--origin")!;
  const privateDnsConfirmed = args.includes("--private-dns-confirmed");
  if (!runIdPattern.test(runId)) fail("Invalid run ID");
  if (!mediaServices.includes(service as typeof mediaServices[number])) fail("Invalid media access service");
  const origin = validatePrivateProxyOrigin(rawOrigin, service, privateDnsConfirmed);
  if (new URL(origin).protocol !== "https:") fail("Media access-proxy requires a private HTTPS origin");
  const paths = lockedPaths ?? await projectPaths(getOption(args, "--project-root")!);
  const identity = await runIdentity(paths, runId);
  if (identity.manifest.SESSION_PASSWORD_SCHEME !== "hmac-v1") {
    fail("Media access-proxy requires the current managed password-scheme run; legacy runs remain inspection-only");
  }
  const routes = await mediaAccessRoutes(paths, runId);
  const facts = { schemaVersion: 1, kind: "selfhost-media-access-proxy-plan", projectRoot: paths.root, runId,
    composeProject: identity.composeProject, identityDigest: sha(JSON.stringify(identity)),
    runtimeSha256: sha(await readFile(join(paths.harness, "runtime-manifest.json"))), currentRoutes: routes,
    selected: { service, origin, privateDnsConfirmed } };
  const approvalDigest = `sha256:${sha(JSON.stringify(facts))}`;
  if (action === "plan") {
    console.log(JSON.stringify({ ...facts, approvalDigest, mutation: false,
      limits: ["Only existing run access metadata is planned. No proxy, DNS, TLS or listener is created or verified.",
        "Private DNS confirmation is an operator assertion, not network evidence.",
        "Homarr links, reusable connections and private handoff are not refreshed by this operation."] }, null, 2));
    return;
  }
  const approval = getOption(args, "--approve")!;
  if (!boardApprovalPattern.test(approval)) fail("--approve must be the sha256-prefixed digest from a fresh access-proxy plan");
  if (approval !== approvalDigest) fail("Media access-proxy apply requires the exact digest from the unchanged plan");
  // The enclosing media project lock covers both this facts check and the canonical metadata mutation.
  const command = ["bash", "scripts/session.sh", "access-proxy", "set", runId, service, origin];
  if (privateDnsConfirmed) command.push("--private-dns-confirmed");
  const applied = child(command, paths.harness, undefined, { maxBuffer: 32 * 1024, timeout: 10_000 });
  if (!applied.ok) fail("Media access-proxy metadata update failed; inspect this exact run before retrying. Child output was suppressed");
  const updated = await mediaAccessRoutes(paths, runId);
  const expected = { ...routes, [service]: { origin, privateDnsConfirmed } };
  const sortedExpected = Object.fromEntries(Object.entries(expected).sort(([left], [right]) => left.localeCompare(right)));
  if (JSON.stringify(updated) !== JSON.stringify(sortedExpected)) fail("Media access-proxy readback differs from the exact selected metadata update");
  console.log(JSON.stringify({ schemaVersion: 1, kind: "selfhost-media-access-proxy-apply", status: "metadata-updated",
    projectRoot: paths.root, runId, composeProject: identity.composeProject, approvalDigest,
    selected: facts.selected, metadata: join(paths.harness, ".sessions", runId, "artifacts", "access.json"),
    completed: ["Exact selected private-origin metadata saved and read back; other service metadata preserved."],
    pending: ["Private route creation and actual DNS/TLS/connectivity proof.", "Homarr links and connections refresh; private handoff export only when requested."],
    homarrRefresh: { infoCommand: `self-host install media info --project-root ${shellQuote(paths.root)} --run-id ${runId}`,
      linksPlanCommand: `self-host install media reconcile-links plan --project-root ${shellQuote(paths.root)} --run-id ${runId} --board <EXACT_PRIVATE_BOARD>`,
      notebookPlanCommand: `self-host install media reconcile-notebook plan --project-root ${shellQuote(paths.root)} --run-id ${runId} --board <EXACT_PRIVATE_BOARD>`,
      requiresSeparateApproval: true,
      warning: "Review/apply links first, then take a fresh Notebook plan and approval. These scopes do not run deployment, widgets, MCP, connections or handoff and are not whole-run acceptance proof." },
    mutation: { accessMetadata: true, proxy: false, dns: false, tls: false, homarr: false, handoff: false } }, null, 2));
}

async function recordedMediaDeployment(paths: MediaRuntimePaths, runId: string,
  identity: Awaited<ReturnType<typeof runIdentity>>) {
  const artifacts = join(paths.harness, ".sessions", runId, "artifacts");
  await assertPrivateDirectory(artifacts);
  if (((await lstat(artifacts)).mode & 0o777) !== 0o700) fail("Private media artifacts must use mode 0700");
  const read = async (name: string) => {
    const path = join(artifacts, name);
    if (!existsSync(path)) fail("Media reconciliation requires the recorded original deployment approval");
    const metadata = await lstat(path);
    if (metadata.size < 1 || metadata.size > 32 * 1024) fail("Recorded media deployment approval is oversized or empty");
    return readPrivateJson(path);
  };
  const plan = await read("cli-approval-plan.json");
  const approved = await read("cli-approved.json");
  const { approvalDigest, ...bound } = plan;
  const manifest = identity.manifest;
  if (!plan || typeof plan !== "object" || Array.isArray(plan) || typeof approvalDigest !== "string"
    || !digestPattern.test(approvalDigest) || sha(JSON.stringify(bound)) !== approvalDigest
    || plan.schemaVersion !== 1 || plan.projectRoot !== paths.root || plan.harness !== paths.harness
    || plan.runId !== runId || plan.composeProject !== identity.composeProject || plan.adminUsername !== manifest.ADMIN_USERNAME
    || plan.bind !== manifest.HOMARR_BIND_ADDRESS || plan.runtimeSha256 !== identity.runtimeSha256
    || plan.credentialHandoff !== identity.credentialHandoff
    || plan.composeSha256 !== sha(await readFile(join(paths.harness, "docker-compose.yml")))
    || !plan.ports || typeof plan.ports !== "object" || Array.isArray(plan.ports)
    || JSON.stringify(Object.keys(plan.ports).sort()) !== JSON.stringify([...mediaPortKeys].sort())
    || mediaPortKeys.some((key) => plan.ports[key] !== manifest[key])
    || JSON.stringify(plan.networkSubnets) !== JSON.stringify(identity.networkSubnets)) {
    fail("Recorded media deployment plan does not match this exact CLI-managed run");
  }
  if (!approved || typeof approved !== "object" || Array.isArray(approved) || approved.schemaVersion !== 1
    || approved.approvalDigest !== approvalDigest
    || Object.keys(approved).some((key) => !["schemaVersion", "approvalDigest", "firewallScope"].includes(key))
    || (plan.bind === "0.0.0.0" && !["router-private", "docker-aware-private"].includes(approved.firewallScope))
    || (plan.bind === "127.0.0.1" && approved.firewallScope !== undefined)) {
    fail("Recorded media deployment approval does not match this exact run");
  }
  return { approvalDigest, recordDigest: sha(JSON.stringify({ plan, approved })) };
}

type MediaReconcileScope = "links" | "notebook";
function mediaReconcileOutput(text: string, scope: MediaReconcileScope, runId: string, boardName: string, live: boolean) {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { fail("Canonical Homarr reconciliation returned invalid JSON; child output was suppressed"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("Canonical Homarr reconciliation result is invalid");
  const value = parsed as Record<string, any>;
  const common = ["schemaVersion", "kind", "runId", "live", "mutation", "board", "snapshotDigest", "approvalDigest", "limits"];
  let fields = [...common, "action", "managedApps", "updates"];
  let kind = "selfhost-homarr-media-links-plan/v1";
  if (scope === "notebook") {
    fields = [...common, "notebookId", "actions", "layoutDeltas", "contentSha256", "status"];
    kind = "selfhost-homarr-media-notebook-plan/v1";
  }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(fields.sort()) || value.schemaVersion !== 1 || value.kind !== kind
    || value.runId !== runId || value.live !== live || typeof value.mutation !== "boolean" || (!live && value.mutation !== false)
    || !value.board || typeof value.board !== "object" || Array.isArray(value.board)
    || JSON.stringify(Object.keys(value.board).sort()) !== JSON.stringify(["id", "name", "private"])
    || typeof value.board.id !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value.board.id)
    || value.board.name !== boardName || value.board.private !== true
    || typeof value.snapshotDigest !== "string" || typeof value.approvalDigest !== "string"
    || !boardApprovalPattern.test(value.snapshotDigest) || !boardApprovalPattern.test(value.approvalDigest)
    || !Array.isArray(value.limits) || value.limits.length > 16 || value.limits.some((item: unknown) => typeof item !== "string" || item.length > 1024)) {
    fail("Canonical Homarr reconciliation result does not match this exact private board");
  }
  if (scope === "links") {
    const expectedServices = mediaServices.filter((service) => service !== "homarr");
    if (!Array.isArray(value.managedApps) || value.managedApps.length !== 6 || !Array.isArray(value.updates) || value.updates.length > 6
      || expectedServices.some((service) => value.managedApps.filter((entry: any) => entry?.service === service).length !== 1)
      || value.managedApps.some((entry: any) => !entry || typeof entry !== "object" || Array.isArray(entry)
        || JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["appId", "change", "desired", "preserveIcon", "preserveName", "service"])
        || typeof entry.appId !== "string" || !/^onboarding_app_[A-Za-z0-9_-]{1,256}$/.test(entry.appId)
        || typeof entry.change !== "boolean" || entry.preserveName !== true || entry.preserveIcon !== true
        || !entry.desired || typeof entry.desired !== "object" || Array.isArray(entry.desired)
        || JSON.stringify(Object.keys(entry.desired).sort()) !== JSON.stringify(["description", "href", "pingUrl"])
        || Object.values(entry.desired).some((field) => typeof field !== "string" || field.length > 2048 || /[\u0000-\u001f\u007f]/.test(field)))
      || JSON.stringify(value.updates) !== JSON.stringify(value.managedApps.filter((entry: any) => entry.change))
      || (!live && !["update-managed-app-links", "already-current"].includes(value.action))
      || (live && (value.action !== "applied" || value.mutation !== (value.updates.length > 0)))) {
      fail("Canonical Homarr link reconciliation plan is invalid");
    }
    for (const entry of value.managedApps) {
      for (const field of ["href", "pingUrl"]) {
        let url: URL;
        try { url = new URL(entry.desired[field]); } catch { fail("Canonical Homarr desired app origin is invalid"); }
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
          || url.pathname !== "/") fail("Canonical Homarr desired app origin is unsafe");
      }
    }
  } else {
    const actions = value.actions;
    if ((value.notebookId !== null && (typeof value.notebookId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value.notebookId)))
      || !actions || typeof actions !== "object" || Array.isArray(actions)
      || JSON.stringify(Object.keys(actions).sort()) !== JSON.stringify(["create", "resize", "updateContent"])
      || Object.values(actions).some((item) => typeof item !== "boolean")
      || !boardApprovalPattern.test(value.contentSha256) || !Array.isArray(value.layoutDeltas) || value.layoutDeltas.length > 32
      || (!live && value.status !== "planned") || (live && (value.status !== "applied"
        || value.mutation !== (actions.create || actions.updateContent || actions.resize)))) {
      fail("Canonical Homarr Notebook reconciliation plan is invalid");
    }
    for (const delta of value.layoutDeltas) {
      if (!delta || typeof delta !== "object" || Array.isArray(delta)
        || JSON.stringify(Object.keys(delta).sort()) !== JSON.stringify(["from", "layoutId", "to"])
        || typeof delta.layoutId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(delta.layoutId)) {
        fail("Canonical Homarr Notebook layout delta is invalid");
      }
      for (const size of [delta.from, delta.to]) {
        if (!size || typeof size !== "object" || Array.isArray(size)
          || JSON.stringify(Object.keys(size).sort()) !== JSON.stringify(["height", "width"])
          || Object.values(size).some((dimension) => !Number.isInteger(dimension) || Number(dimension) < 1 || Number(dimension) > 1000)) {
          fail("Canonical Homarr Notebook layout dimensions are invalid");
        }
      }
    }
  }
  return value;
}

async function mediaReconcileCommand(args: string[], scope: MediaReconcileScope, lockedPaths?: MediaRuntimePaths) {
  const action = args[0];
  if (!action || action === "help" || action === "--help") {
    console.log(`self-host install media reconcile-${scope} plan|apply --project-root ABSOLUTE --run-id ID --board NAME [--approve sha256:DIGEST (apply)]`);
    return;
  }
  if (action !== "plan" && action !== "apply") fail(`reconcile-${scope} accepts plan or apply`);
  const allowed = ["--project-root", "--run-id", "--board"];
  if (action === "apply") allowed.push("--approve");
  assertOptions(args, allowed);
  const runId = getOption(args, "--run-id")!;
  const boardName = getOption(args, "--board")!;
  if (!runIdPattern.test(runId)) fail("Invalid run ID");
  if (!boardNamePattern.test(boardName)) fail("Invalid Homarr board name");
  const paths = lockedPaths ?? await projectPaths(getOption(args, "--project-root")!);
  const identity = await runIdentity(paths, runId);
  const deployment = await recordedMediaDeployment(paths, runId, identity);
  const routes = await mediaAccessRoutes(paths, runId);
  let script = "scripts/homarr-finalize.ts";
  if (scope === "notebook") script = "scripts/homarr-notebook.ts";
  const read = await boundedMediaChild(["bun", script, "plan", runId, boardName], paths.harness);
  if (!read.ok) fail(`Homarr ${scope} reconciliation plan failed; child output was suppressed`);
  const canonical = mediaReconcileOutput(read.output, scope, runId, boardName, false);
  const facts = { schemaVersion: 1, kind: `selfhost-media-reconcile-${scope}-plan`, projectRoot: paths.root, runId, board: canonical.board,
    identityDigest: sha(JSON.stringify(identity)), runtimeSha256: sha(await readFile(join(paths.harness, "runtime-manifest.json"))),
    deployment, currentRoutes: routes, canonicalApprovalDigest: canonical.approvalDigest,
    snapshotDigest: canonical.snapshotDigest, scope, stages: [`homarr-${scope}-only`] };
  const approvalDigest = `sha256:${sha(JSON.stringify(facts))}`;
  const summarize = () => {
    if (scope === "notebook") return { notebookId: canonical.notebookId, actions: canonical.actions,
      contentSha256: canonical.contentSha256, layoutDeltas: canonical.layoutDeltas };
    // Do not echo arbitrary existing app fields or icons from authenticated responses.
    return { managedApps: canonical.managedApps,
      updateCount: canonical.updates.length };
  };
  const pending = ["Other link/Notebook reconciliation requires its own fresh plan and approval.",
    "Widget API/visual acceptance, external private-route reachability, MCP and isolated restore remain separate gates."];
  if (action === "plan") {
    console.log(JSON.stringify({ ...facts, approvalDigest, mutation: false, ...summarize(), pending,
      limits: ["Only the named canonical reconciliation scope is authorized; no legacy-item deletion.",
        "No deployment, Docker, indexer, MCP configuration, connections or private handoff export is performed."] }, null, 2));
    return;
  }
  const approval = getOption(args, "--approve")!;
  if (!boardApprovalPattern.test(approval) || approval !== approvalDigest) fail("Media reconciliation apply requires the exact digest from the unchanged plan");
  const applied = await boundedMediaChild(["bun", script, "apply", runId, boardName, "--approve", canonical.approvalDigest], paths.harness);
  const unknown = (failedStage: string) => {
    process.exitCode = 1;
    console.log(JSON.stringify({ schemaVersion: 1, kind: `selfhost-media-reconcile-${scope}-apply`, status: "unknown-no-auto-replay",
      runId, board: canonical.board, failedStage, completed: [], pending,
      diagnosisCommand: `self-host install media reconcile-${scope} plan --project-root ${shellQuote(paths.root)} --run-id ${runId} --board ${shellQuote(boardName)}`,
      next: "Inspect a fresh read-only plan to reconcile observed state; never repeat the old approval automatically. Child output was suppressed." }, null, 2));
  };
  if (!applied.ok) {
    let stage = `homarr-${scope}-only`;
    const failure = /^FAIL Homarr finalization at (parse-media-links-plan|load-private-session|read-approved-media-links-plan|apply-approved-media-links|read-back-approved-media-links)\n?$/.exec(applied.output);
    if (failure) stage = failure[1];
    unknown(stage);
    return;
  }
  let result: Record<string, any>;
  try {
    result = mediaReconcileOutput(applied.output, scope, runId, boardName, true);
    if (result.approvalDigest !== canonical.approvalDigest) fail("Canonical Homarr reconciliation apply returned a different approval");
  } catch {
    unknown(`homarr-${scope}-readback`);
    return;
  }
  console.log(JSON.stringify({ schemaVersion: 1, kind: `selfhost-media-reconcile-${scope}-apply`, status: "applied",
    runId, board: result.board, approvalDigest, completed: [`homarr-${scope}-only exact canonical readback`], pending,
    mutation: { managedLinks: scope === "links" && result.mutation, primaryNotebook: scope === "notebook" && result.mutation, legacyDeletion: false,
      docker: false, mcp: false, connections: false, handoff: false } }, null, 2));
}

async function planForRun(paths: Awaited<ReturnType<typeof projectPaths>>, runId: string,
  credentialHandoff = false, allowLegacyLoopback = false) {
  const identity = await runIdentity(paths, runId);
  const manifest = identity.manifest;
  const hostOnly = identity.bindMode === "host-only" && manifest.HOMARR_BIND_ADDRESS === "127.0.0.1"
    && manifest.MEDIA_PORT_BIND_PREFIX === "127.0.0.1:";
  const legacyLoopback = manifest.HOMARR_BIND_ADDRESS === "127.0.0.1" && allowLegacyLoopback;
  if (manifest.HOMARR_BIND_ADDRESS !== "0.0.0.0" && !hostOnly && !legacyLoopback) {
    fail("Media bind selection differs from this CLI run; an older loopback run needs its original saved approval");
  }
  if (manifest.HOMARR_BIND_ADDRESS === "0.0.0.0" && manifest.MEDIA_PORT_BIND_PREFIX !== undefined) {
    fail("All-interface media run has an unexpected port bind prefix");
  }
  const docker = child(["docker", "info", "--format", "{{.ServerVersion}}"], paths.harness);
  if (!docker.ok || !/^\d+\.\d+\.\d+/.test(docker.output.trim())) fail("Docker daemon is unavailable");
  const dockerId = child(["docker", "info", "--format", "{{.ID}}"], paths.harness);
  if (!dockerId.ok || !/^[a-zA-Z0-9:-]{16,256}$/.test(dockerId.output.trim())) fail("Docker daemon identity is unavailable");
  const composeHash = sha(await readFile(join(paths.harness, "docker-compose.yml")));
  const runtimeHash = identity.runtimeSha256;
  const portKeys = ["PROWLARR_PORT", "RADARR_PORT", "SONARR_PORT", "QBITTORRENT_PORT", "JELLYFIN_PORT", "SEERR_PORT", "HOMARR_PORT"];
  const safePorts = Object.fromEntries(portKeys.map((key) => [key, manifest[key]]));
  if (Object.keys(safePorts).length !== 7) fail("Expected seven assigned service ports");
  if (Object.values(safePorts).some((port) => typeof port !== "string" || !/^[1-9][0-9]{1,4}$/.test(port)
    || Number(port) > 65535)) {
    fail("Invalid assigned service port");
  }
  const networkFacts: { networkSubnets?: MediaNetworkSubnets } = {};
  if (identity.networkSubnets) networkFacts.networkSubnets = identity.networkSubnets;
  const commonFacts = {
    schemaVersion: 1,
    runId,
    projectRoot: paths.root,
    harness: paths.harness,
    composeProject: identity.composeProject,
    adminUsername: manifest.ADMIN_USERNAME,
    bind: manifest.HOMARR_BIND_ADDRESS,
    ...networkFacts,
  };
  const remainingFacts = {
    ports: safePorts,
    dockerServer: docker.output.trim(),
    dockerServerId: dockerId.output.trim(),
    credentialHandoff,
    composeSha256: composeHash,
    runtimeSha256: runtimeHash,
    imagePolicy: "Compose image references, including floating tags; resolved image digests are not locked",
  };
  if (legacyLoopback) {
    const facts = { ...commonFacts, ...remainingFacts };
    return { ...facts, approvalDigest: sha(JSON.stringify(facts)) };
  }
  if (hostOnly) {
    const facts = {
      ...commonFacts,
      publishedPorts: "host-loopback-only; other devices need a separately approved private route",
      ...remainingFacts,
    };
    return { ...facts, approvalDigest: sha(JSON.stringify(facts)) };
  }
  const facts = {
    ...commonFacts,
    publishedPorts: "all-host-interfaces; require router or Docker-aware firewall policy before approval",
    ...remainingFacts,
  };
  return { ...facts, approvalDigest: sha(JSON.stringify(facts)) };
}

async function writeApprovalRecord(paths: Awaited<ReturnType<typeof projectPaths>>, runId: string, plan: Awaited<ReturnType<typeof planForRun>>) {
  const destination = join(paths.harness, ".sessions", runId, "artifacts", "cli-approval-plan.json");
  await writePrivateJson(destination, plan);
}

async function writePrivateJson(path: string, value: unknown) {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
}

async function readPrivateJson(path: string) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || !safeOwner(metadata.uid, true) || (metadata.mode & 0o777) !== 0o600) fail("Unsafe private CLI state");
  return JSON.parse(await readFile(path, "utf8"));
}

async function latestFailedStage(paths: Awaited<ReturnType<typeof projectPaths>>, runId: string) {
  const artifacts = join(paths.harness, ".sessions", runId, "artifacts");
  const records = (await readdir(artifacts))
    .filter((name) => /^setup-benchmark-[0-9]{13}-[0-9a-f-]{36}\.json$/.test(name))
    .sort().reverse();
  if (records.length === 0) fail("No recorded media setup failure can be resumed");
  const benchmarkPath = join(artifacts, records[0]);
  const latest = await readPrivateJson(benchmarkPath);
  if (latest.schema !== "selfhost-media-setup-benchmark/v1" || latest.runId !== runId
    || latest.status !== "failed" || !stages.has(latest.failedStage)) {
    fail("The latest media benchmark does not record a resumable failure");
  }
  if (Object.hasOwn(latest, "indexerVerificationDeferred")
    && typeof latest.indexerVerificationDeferred !== "boolean") {
    fail("Invalid recorded media indexer deferral");
  }
  const knownCategories = new Set(["docker-network-pool-exhausted", "selected-port-in-use",
    "docker-daemon-unavailable", "docker-compose-up-failed"]);
  const failureCategory = knownCategories.has(latest.failureCategory) ? latest.failureCategory as string : null;
  return { stage: latest.failedStage as string, benchmarkPath, failureCategory,
    indexerVerificationDeferred: latest.indexerVerificationDeferred === true };
}

function boundedObjectKeys(value: Record<string, unknown>, required: string[], allowed: string[], message: string) {
  if (required.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !allowed.includes(key))) fail(message);
}

function benchmarkTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string") fail(`Invalid media benchmark ${field}`);
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf()) || timestamp.toISOString() !== value) {
    fail(`Invalid media benchmark ${field}`);
  }
  return value;
}

function validateBenchmarkRecord(value: unknown, runId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid media benchmark record");
  const record = value as Record<string, unknown>;
  const requiredKeys = ["boardName", "browserFallbacks", "finishedAt", "imagePullMs", "resumedFrom", "runId", "schema",
    "stages", "startedAt", "status", "technicalAcceptance", "wallMs"];
  const allowedKeys = ["benchmarkScope", "boardName", "browserFallbacks", "credentialHandoffRequested", "finishedAt",
    "imagePullMs", "indexerVerificationDeferred", "pendingAcceptanceRows", "resumedFrom", "runId", "schema",
    "stages", "startedAt", "status", "technicalAcceptance", "wallMs", "failedStage", "failureCategory"];
  boundedObjectKeys(record, requiredKeys, allowedKeys, "Invalid media benchmark record");
  if (record.schema !== "selfhost-media-setup-benchmark/v1" || record.runId !== runId
    || typeof record.boardName !== "string" || !boardNamePattern.test(record.boardName)
    || (Object.hasOwn(record, "credentialHandoffRequested") && typeof record.credentialHandoffRequested !== "boolean")
    || (Object.hasOwn(record, "indexerVerificationDeferred") && typeof record.indexerVerificationDeferred !== "boolean")
    || record.imagePullMs !== null || (record.browserFallbacks !== null && record.browserFallbacks !== 0)
    || (Object.hasOwn(record, "benchmarkScope")
      && record.benchmarkScope !== "Command stages only; manual browser repair outside this invocation is not timed or counted")
    || typeof record.technicalAcceptance !== "boolean"
    || !Number.isInteger(record.wallMs) || Number(record.wallMs) < 0) {
    fail("Invalid media benchmark record");
  }
  let credentialHandoffRequested = true;
  if (record.credentialHandoffRequested === false) credentialHandoffRequested = false;
  let indexerVerificationDeferred = false;
  if (record.indexerVerificationDeferred === true) indexerVerificationDeferred = true;
  const startedAt = benchmarkTimestamp(record.startedAt, "startedAt");
  const finishedAt = benchmarkTimestamp(record.finishedAt, "finishedAt");
  if (Date.parse(finishedAt) < Date.parse(startedAt)) fail("Invalid media benchmark timestamps");
  if (record.resumedFrom !== null && (typeof record.resumedFrom !== "string" || !stages.has(record.resumedFrom))) {
    fail("Invalid media benchmark resume stage");
  }
  let first = 0;
  if (typeof record.resumedFrom === "string") {
    first = stageOrder.indexOf(record.resumedFrom as typeof stageOrder[number]);
    if (first <= 0) fail("Invalid media benchmark resume stage");
  }
  let expectedStages: readonly string[] = stageOrder;
  if (!credentialHandoffRequested) expectedStages = stageOrder.slice(0, -1);
  expectedStages = expectedStages.slice(first);
  if (!Array.isArray(record.stages) || record.stages.length === 0 || record.stages.length > expectedStages.length) {
    fail("Invalid media benchmark stages");
  }
  const safeStages: Array<{ id: string; status: string; elapsedMs: number; exitCode: number }> = [];
  for (let index = 0; index < record.stages.length; index += 1) {
    const value = record.stages[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid media benchmark stage");
    const stage = value as Record<string, unknown>;
    boundedObjectKeys(stage, ["elapsedMs", "exitCode", "id", "status"],
      ["elapsedMs", "exitCode", "id", "status"], "Invalid media benchmark stage");
    if (stage.id !== expectedStages[index] || !["pass", "fail", "pending"].includes(stage.status as string)
      || !Number.isInteger(stage.elapsedMs) || Number(stage.elapsedMs) < 0 || !Number.isInteger(stage.exitCode)) {
      fail("Invalid media benchmark stage");
    }
    if ((stage.status === "pass" && stage.exitCode !== 0)
      || (stage.status === "pending" && (stage.id !== "verify" || stage.exitCode !== 2))
      || (stage.status === "fail" && stage.exitCode === 0)) {
      fail("Invalid media benchmark stage outcome");
    }
    safeStages.push({ id: stage.id as string, status: stage.status as string,
      elapsedMs: stage.elapsedMs as number, exitCode: stage.exitCode as number });
  }
  const measuredStageMs = safeStages.reduce((total, stage) => total + stage.elapsedMs, 0);
  if (measuredStageMs > Number(record.wallMs) + safeStages.length) fail("Invalid media benchmark wall time");
  const deferredRows = ["Prowlarr selected indexer", "Sonarr synced indexer edge", "Radarr synced indexer edge"];
  let expectedRows: string[] = [];
  if (indexerVerificationDeferred) expectedRows = deferredRows;
  let pendingAcceptanceRows: unknown = [];
  if (Object.hasOwn(record, "pendingAcceptanceRows")) pendingAcceptanceRows = record.pendingAcceptanceRows;
  if (!Array.isArray(pendingAcceptanceRows)
    || JSON.stringify(pendingAcceptanceRows) !== JSON.stringify(expectedRows)) {
    fail("Invalid media benchmark pending acceptance rows");
  }
  if (!indexerVerificationDeferred && safeStages.some((stage) => stage.status === "pending")) {
    fail("Invalid media benchmark pending stage");
  }
  const completeObservedScope = safeStages.length === expectedStages.length;
  if (record.status === "passed") {
    if (!completeObservedScope || safeStages.some((stage) => stage.status !== "pass")
      || indexerVerificationDeferred || Object.hasOwn(record, "failedStage")
      || Object.hasOwn(record, "failureCategory") || record.technicalAcceptance !== (record.resumedFrom === null)) {
      fail("Invalid passed media benchmark");
    }
  } else if (record.status === "pending-owner-choice") {
    const pending = safeStages.filter((stage) => stage.status === "pending");
    if (!completeObservedScope || !indexerVerificationDeferred || pending.length !== 1
      || pending[0].id !== "verify" || safeStages.some((stage) => stage.status === "fail")
      || record.technicalAcceptance !== false || Object.hasOwn(record, "failedStage")
      || Object.hasOwn(record, "failureCategory")) {
      fail("Invalid pending media benchmark");
    }
  } else if (record.status === "failed") {
    const last = safeStages.at(-1)!;
    if (last.status !== "fail" || safeStages.slice(0, -1).some((stage) => stage.status === "fail")
      || record.failedStage !== last.id || record.technicalAcceptance !== false) {
      fail("Invalid failed media benchmark");
    }
    if (Object.hasOwn(record, "failureCategory")) {
      const categories = new Set(["docker-network-pool-exhausted", "selected-port-in-use",
        "docker-daemon-unavailable", "docker-compose-up-failed"]);
      if (last.id !== "up" || typeof record.failureCategory !== "string"
        || !categories.has(record.failureCategory)) fail("Invalid media benchmark failure category");
    }
  } else {
    fail("Invalid media benchmark status");
  }
  return { startedAt, finishedAt, status: record.status as string, resumedFrom: record.resumedFrom as string | null,
    wallMs: record.wallMs as number, stages: safeStages, completeObservedScope, credentialHandoffRequested };
}

function recordedWorkflowCompletion(records: Array<{ value: ReturnType<typeof validateBenchmarkRecord> }>) {
  const latest = records[0].value;
  let status = latest.status;
  let completed = latest.completeObservedScope && ["passed", "pending-owner-choice"].includes(status);
  const observed = [...latest.stages];
  let resumedFrom = latest.resumedFrom;
  let successor = latest;
  let index = 1;
  while (completed && resumedFrom !== null) {
    const previous = records[index]?.value;
    if (!previous || previous.status !== "failed" || previous.stages.at(-1)?.id !== resumedFrom
      || previous.credentialHandoffRequested !== latest.credentialHandoffRequested
      || Date.parse(previous.finishedAt) > Date.parse(successor.startedAt)) {
      completed = false;
      break;
    }
    observed.unshift(...previous.stages.slice(0, -1));
    resumedFrom = previous.resumedFrom;
    successor = previous;
    index += 1;
  }
  let expectedStages: readonly string[] = stageOrder;
  if (!latest.credentialHandoffRequested) expectedStages = stageOrder.slice(0, -1);
  if (completed && (observed.length !== expectedStages.length
    || observed.some((stage, stageIndex) => stage.id !== expectedStages[stageIndex]))) completed = false;
  if (completed && observed.some((stage) => stage.status === "pending")) status = "pending-owner-choice";
  if (!completed && status !== "failed") status = "incomplete";
  let failedStage: string | null = null;
  if (latest.status === "failed") failedStage = latest.stages.at(-1)!.id;
  return { recorded: true, completed, status, failedStage };
}

async function mediaBenchmark(paths: Awaited<ReturnType<typeof projectPaths>>, runId: string) {
  await runIdentity(paths, runId);
  const artifacts = join(paths.harness, ".sessions", runId, "artifacts");
  await assertPrivateDirectory(artifacts);
  if (((await stat(artifacts)).mode & 0o777) !== 0o700) fail("Private media artifacts must use mode 0700");
  const names = (await readdir(artifacts))
    .filter((name) => /^setup-benchmark-[0-9]{13}-[0-9a-f-]{36}\.json$/.test(name))
    .sort().reverse();
  if (names.length === 0) fail("No media setup benchmark is recorded for this run");
  const records = [];
  for (const name of names) {
    records.push({ path: join(artifacts, name), value: validateBenchmarkRecord(await readPrivateJson(join(artifacts, name)), runId) });
  }
  const latest = records[0];
  const commandInvocationComplete = latest.value.status === "passed" && latest.value.completeObservedScope;
  const commandStagesUnderTenMinutes = commandInvocationComplete && latest.value.wallMs < 10 * 60 * 1000;
  console.log(JSON.stringify({ schemaVersion: 1, kind: "selfhost-media-benchmark", mutation: false, runId,
    recordCount: records.length,
    workflowCompletion: recordedWorkflowCompletion(records),
    latestInvocation: { recordPath: latest.path, startedAt: latest.value.startedAt, finishedAt: latest.value.finishedAt,
      status: latest.value.status, resumedFrom: latest.value.resumedFrom, wallMs: latest.value.wallMs,
      stages: latest.value.stages },
    scope: { description: "Command stages only", completeObservedScope: latest.value.completeObservedScope,
      externalBrowserRepairIncluded: false },
    claims: { commandInvocationComplete, commandStagesUnderTenMinutes, thresholdMs: 10 * 60 * 1000,
      fullSetupUnderTenMinutesClaimed: false, fullStackAcceptanceClaimed: false,
      note: "Command-stage timing excludes session preparation and manual browser repair. It does not prove the full setup finished under ten minutes or that the stack passed acceptance." },
    secretsPrinted: false }, null, 2));
}

async function safeMediaFallback(paths: Awaited<ReturnType<typeof projectPaths>>, runId: string, stage: string) {
  const path = join(paths.harness, ".sessions", runId, "artifacts", `setup-fallback-${stage}.json`);
  if (!existsSync(path)) return null;
  const handoff = await readPrivateJson(path);
  const fallback = handoff.fallback;
  if (!fallback || fallback.schemaVersion !== 1 || fallback.service !== stage) {
    fail("Invalid private service fallback record");
  }
  const safeCodes = new Set(["NO_RESPONSE", "UNEXPECTED_STATUS", "INVALID_JSON", "STAGE_FAILED", "SETUP_ERROR"]);
  const code = safeCodes.has(fallback.code) ? fallback.code as string : null;
  const httpStatus = Number.isInteger(fallback.httpStatus) && fallback.httpStatus >= 100
    && fallback.httpStatus <= 599 ? fallback.httpStatus as number : null;
  const jellyfinSteps = new Set(["Jellyfin administrator and libraries", "Jellyfin public readiness",
    "Jellyfin startup state retry", "Jellyfin first user initialization", "Jellyfin selected account login",
    "Jellyfin libraries", "Jellyfin library verification", "Jellyfin setup token logout",
    "Jellyfin configuration /Startup/Configuration", "Jellyfin configuration /Startup/User",
    "Jellyfin configuration /Startup/RemoteAccess", "Jellyfin configuration /Startup/Complete",
    "Jellyfin configuration /Library/VirtualFolders"]);
  let stepHint: string | null = null;
  if (stage === "jellyfin" && jellyfinSteps.has(fallback.step)) stepHint = fallback.step;
  return { privateFallbackPath: path, code, httpStatus, stepHint };
}

async function currentSavedPlan(paths: Awaited<ReturnType<typeof projectPaths>>, runId: string) {
  const savedPath = join(paths.harness, ".sessions", runId, "artifacts", "cli-approval-plan.json");
  const saved = await readPrivateJson(savedPath);
  const allowLegacyLoopback = saved.bind === "127.0.0.1" && !Object.hasOwn(saved, "publishedPorts");
  const current = await planForRun(paths, runId, saved.credentialHandoff === true, allowLegacyLoopback);
  if (current.approvalDigest !== saved.approvalDigest) fail("Saved media plan changed; prepare a new run before continuing");
  return current;
}

async function mediaLifecycle(paths: Awaited<ReturnType<typeof projectPaths>>, runId: string) {
  const plan = await currentSavedPlan(paths, runId);
  const approvedPath = join(paths.harness, ".sessions", runId, "artifacts", "cli-approved.json");
  if (!existsSync(approvedPath)) fail("Media lifecycle needs the applied CLI approval checkpoint");
  const approved = await readPrivateJson(approvedPath);
  if (approved.approvalDigest !== plan.approvalDigest) fail("Media lifecycle approval no longer matches the current plan");
  const identity = await runIdentity(paths, runId);
  const session = join(paths.harness, ".sessions", runId);
  const manifestPath = join(session, "manifest.env");
  const secretsPath = join(session, "secrets.env");
  const secrets = await lstat(secretsPath);
  if (!secrets.isFile() || secrets.isSymbolicLink() || secrets.nlink !== 1
    || !safeOwner(secrets.uid, true) || (secrets.mode & 0o777) !== 0o600) {
    fail("Unsafe private media secrets file");
  }
  const command = ["docker", "compose", "--project-name", identity.composeProject,
    "--env-file", manifestPath, "--env-file", secretsPath,
    "--file", join(paths.harness, "docker-compose.yml")];
  if (identity.networkSubnets) command.push("--file", join(session, networkOverrideName));
  let bindPrefix = "";
  if (plan.bind === "127.0.0.1") bindPrefix = "127.0.0.1:";
  const composeEnvironment = { MEDIA_PORT_BIND_PREFIX: bindPrefix };
  const configured = child([...command, "config", "--quiet"], paths.harness, composeEnvironment);
  if (!configured.ok) fail("Media lifecycle Compose validation failed for this exact run");
  return { command, composeEnvironment, composeProject: identity.composeProject };
}

async function approvedRun(paths: Awaited<ReturnType<typeof projectPaths>>, runId: string, digest: string,
  from: string | null, firewallScope: string | null, deferIndexer: boolean) {
  if (!digestPattern.test(digest)) fail("--approve must be the 64-character plan digest");
  const current = await currentSavedPlan(paths, runId);
  if (current.approvalDigest !== digest) fail("Plan changed; prepare a new run before apply");
  const scopes = new Set(["router-private", "docker-aware-private"]);
  if (firewallScope !== null && !scopes.has(firewallScope)) {
    fail("--firewall-scope must be router-private or docker-aware-private after checking the actual policy");
  }
  const approvedPath = join(paths.harness, ".sessions", runId, "artifacts", "cli-approved.json");
  if (existsSync(approvedPath)) {
    const approved = await readPrivateJson(approvedPath);
    if (approved.approvalDigest !== digest) fail("This run has a different recorded approval");
    if (firewallScope !== null && approved.firewallScope !== firewallScope) {
      fail("The recorded firewall scope differs; inspect this run before changing its exposure policy");
    }
  } else {
    if (current.bind === "0.0.0.0" && firewallScope === null) {
      fail("All-interface media ports need --firewall-scope router-private or docker-aware-private after checking the actual policy");
    }
    if (current.bind !== "0.0.0.0" && firewallScope !== null) {
      fail("This loopback media run does not need an all-interface firewall scope");
    }
    const approval: Record<string, unknown> = { schemaVersion: 1, approvalDigest: digest };
    if (firewallScope !== null) approval.firewallScope = firewallScope;
    await writePrivateJson(approvedPath, approval);
  }
  const command = ["bun", "scripts/setup-media-run.ts", "run", runId, "personal", "--approved"];
  if (current.credentialHandoff !== true) command.push("--no-handoff");
  if (deferIndexer) command.push("--defer-indexer");
  if (from !== null) {
    if (!stages.has(from)) fail("Unknown resume stage");
    const failure = await latestFailedStage(paths, runId);
    if (failure.stage !== from) fail(`Resume must start at the recorded failed stage: ${failure.stage}`);
    command.push("--from", from);
  }
  const result = await streamSetup(command, paths.harness);
  if (result.pending) {
    if (!deferIndexer) fail("Media setup returned an unexpected pending verification result");
    console.log("Indexer verification was explicitly deferred. Deployment approval is unchanged; technical acceptance remains false pending the owner's authorized indexer choice and synced edges.");
    process.exitCode = 2;
    return;
  }
  if (!result.ok) {
    const failedStage = result.failedStage;
    if (failedStage && stages.has(failedStage)) {
      let deferOption = "";
      if (deferIndexer) deferOption = " --defer-indexer";
      console.log(`Resume after repair: self-host install media resume --project-root ${shellQuote(paths.root)} --run-id ${runId} --approve ${digest} --from ${failedStage}${deferOption}`);
    }
    if (failedStage === "verify") fail("Verification stopped; review the private benchmark and connect an authorized Prowlarr source before retrying");
    if (failedStage && ["qbittorrent", "sonarr", "radarr", "prowlarr", "jellyfin", "seerr", "homarr"].includes(failedStage)) {
      fail("Media setup stopped; use the private service fallback artifact for targeted repair");
    }
    fail("Media setup stopped; inspect the private benchmark and repair the recorded stage before retrying");
  }
  if (from !== null) console.log("This was a resumed partial run; a fresh full run is required for whole-run timing and acceptance.");
}

function structuredStatus(harness: string, composeProject: string, runId: string, provenance: "cli-managed") {
  const listFormat = "{\"id\":{{json .ID}},\"project\":{{json (.Label \"com.docker.compose.project\")}},\"service\":{{json (.Label \"com.docker.compose.service\")}},\"state\":{{json .State}}}";
  const listed = child(["docker", "container", "ls", "--all", "--no-trunc",
    "--filter", `label=com.docker.compose.project=${composeProject}`,
    "--format", listFormat], harness);
  if (!listed.ok) mediaStatusFailure(harness, "container list");
  const expected = new Map<string, string>();
  for (const line of listed.output.split("\n")) {
    if (line.trim() === "") continue;
    let value: unknown;
    try { value = JSON.parse(line); }
    catch { fail("Docker returned an invalid media status record"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("Docker returned an invalid media status record");
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (JSON.stringify(keys) !== JSON.stringify(["id", "project", "service", "state"])) {
      fail("Docker returned an invalid media status record");
    }
    if (typeof record.id !== "string" || !containerIdPattern.test(record.id)
      || record.project !== composeProject || typeof record.service !== "string"
      || !mediaServices.includes(record.service as typeof mediaServices[number])
      || typeof record.state !== "string" || !containerStates.has(record.state)
      || expected.has(record.service)) {
      fail("Docker returned a status record outside this exact media run");
    }
    expected.set(record.service, record.id);
  }
  const observed = new Map<string, { state: string; health: string }>();
  if (expected.size > 0) {
    const inspectFormat = "{\"id\":{{json .Id}},\"project\":{{json (index .Config.Labels \"com.docker.compose.project\")}},\"service\":{{json (index .Config.Labels \"com.docker.compose.service\")}},\"state\":{{json .State.Status}},\"health\":{{with (index .State \"Health\")}}{{json (index . \"Status\")}}{{else}}\"unavailable\"{{end}}}";
    const inspected = child(["docker", "container", "inspect", "--format", inspectFormat, ...expected.values()], harness);
    if (!inspected.ok) mediaStatusFailure(harness, "container inspect");
    for (const line of inspected.output.split("\n")) {
      if (line.trim() === "") continue;
      let value: unknown;
      try { value = JSON.parse(line); }
      catch { fail("Docker returned an invalid media status record"); }
      if (!value || typeof value !== "object" || Array.isArray(value)) fail("Docker returned an invalid media status record");
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      if (JSON.stringify(keys) !== JSON.stringify(["health", "id", "project", "service", "state"])) {
        fail("Docker returned an invalid media status record");
      }
      if (typeof record.id !== "string" || !containerIdPattern.test(record.id)
        || record.project !== composeProject || typeof record.service !== "string"
        || !mediaServices.includes(record.service as typeof mediaServices[number])
        || expected.get(record.service) !== record.id
        || typeof record.state !== "string" || !containerStates.has(record.state)
        || typeof record.health !== "string" || !healthStates.has(record.health)
        || observed.has(record.service)) {
        fail("Docker returned a status record outside this exact media run");
      }
      observed.set(record.service, { state: record.state, health: record.health });
    }
    if (observed.size !== expected.size) fail("Docker returned an incomplete media status result");
  }
  const services = mediaServices.map((service) => {
    const record = observed.get(service);
    if (!record) return { service, present: false, state: "absent", running: false, health: "unavailable" };
    return { service, present: true, state: record.state, running: record.state === "running", health: record.health };
  });
  const summary = {
    expected: mediaServices.length,
    present: services.filter((service) => service.present).length,
    running: services.filter((service) => service.running).length,
    healthy: services.filter((service) => service.health === "healthy").length,
    unhealthy: services.filter((service) => service.health === "unhealthy").length,
    starting: services.filter((service) => service.health === "starting").length,
    healthUnavailable: services.filter((service) => service.health === "unavailable").length,
  };
  return { schemaVersion: 1, kind: "selfhost-media-status", provenance, runId, composeProject, services, summary };
}

async function mediaCommandUnlocked(args: string[], lockedPaths?: MediaRuntimePaths) {
  const action = args[0];
  if (!action || action === "help" || action === "--help") {
    console.log("self-host config init --project-root ABSOLUTE --profile media --run-id ID --username NAME\nself-host up --project-root ABSOLUTE [--approve DIGEST] [--defer-indexer]\nself-host install media benchmark --project-root ABSOLUTE --run-id ID\nself-host install media diagnose --project-root ABSOLUTE --run-id ID\nself-host install media runtime-sync plan|apply --project-root ABSOLUTE [--approve sha256:...]\nself-host install media board-polish plan|apply --project-root ABSOLUTE --run-id ID --board NAME [--approve sha256:...]\nself-host resume --project-root ABSOLUTE --approve DIGEST --from STAGE [--defer-indexer]\nself-host status|info|down --project-root ABSOLUTE");
    console.log("self-host install media access-proxy plan|apply --project-root ABSOLUTE --run-id ID --service NAME --origin HTTPS_ORIGIN [--private-dns-confirmed] [--approve sha256:DIGEST (apply)]");
    console.log("self-host install media reconcile-links|reconcile-notebook plan|apply --project-root ABSOLUTE --run-id ID --board NAME [--approve sha256:DIGEST (apply)]");
    return;
  }
  if (action === "board-polish") {
    await mediaBoardPolishCommand(args.slice(1), lockedPaths);
    return;
  }
  if (action === "access-proxy") {
    await mediaAccessProxyCommand(args.slice(1), lockedPaths);
    return;
  }
  if (action === "reconcile-links" || action === "reconcile-notebook") {
    let scope: MediaReconcileScope = "links";
    if (action === "reconcile-notebook") scope = "notebook";
    await mediaReconcileCommand(args.slice(1), scope, lockedPaths);
    return;
  }
  if (action === "runtime-sync") {
    const syncAction = args[1];
    if (!syncAction || syncAction === "help" || syncAction === "--help") {
      console.log("self-host install media runtime-sync plan --project-root ABSOLUTE\nself-host install media runtime-sync apply --project-root ABSOLUTE --approve sha256:...");
      return;
    }
    if (syncAction !== "plan" && syncAction !== "apply") fail("runtime-sync accepts plan or apply");
    const allowed = ["--project-root"];
    if (syncAction === "apply") allowed.push("--approve");
    assertOptions(args.slice(1), allowed);
    let approval: string | null = null;
    if (syncAction === "apply") approval = getOption(args, "--approve");
    const paths = lockedPaths ?? await projectPaths(getOption(args, "--project-root")!);
    const output = await mediaRuntimeSync(syncAction, paths, asset, approval);
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  const allowed = ["--project-root", "--run-id"];
  if (action === "prepare") allowed.push("--username", "--credential-handoff", "--bind-mode", "--port-start", "--network-subnets");
  if (action === "apply" || action === "resume") allowed.push("--approve", "--defer-indexer");
  if (action === "apply") allowed.push("--firewall-scope");
  if (action === "resume") allowed.push("--from");
  if (["status", "info", "diagnose"].includes(action)) allowed.push("--json");
  assertOptions(args, allowed, ["--defer-indexer"]);
  const root = getOption(args, "--project-root");
  const runId = getOption(args, "--run-id");
  if (!runIdPattern.test(runId!)) fail("Invalid run ID");
  if (["info", "diagnose"].includes(action)) {
    const json = getOption(args, "--json", false);
    if (json !== null && json !== "yes") fail("--json accepts yes");
  }
  const paths = lockedPaths ?? await projectPaths(root!);
  if (action === "prepare") {
    await requireInstallPlan("media");
    const username = getOption(args, "--username");
    if (!usernamePattern.test(username!)) fail("Invalid admin username");
    const bindMode = getOption(args, "--bind-mode", false) ?? "all-interfaces";
    if (bindMode !== "all-interfaces" && bindMode !== "host-only") fail("--bind-mode accepts all-interfaces or host-only");
    const selectedPortStart = getOption(args, "--port-start", false);
    if (selectedPortStart !== null) portStart(selectedPortStart);
    const networkSubnetChoice = getOption(args, "--network-subnets", false);
    let networkSubnets: MediaNetworkSubnets | undefined;
    if (networkSubnetChoice !== null) networkSubnets = parseMediaNetworkSubnets(networkSubnetChoice);
    const handoffChoice = getOption(args, "--credential-handoff", false) ?? "no";
    if (handoffChoice !== "yes" && handoffChoice !== "no") fail("--credential-handoff accepts yes or no");
    const credentialHandoff = handoffChoice === "yes";
    preflight(paths.root);
    await installRuntime(paths);
    const intents = join(paths.local, "cli-intents");
    if (!existsSync(intents)) await mkdir(intents, { mode: 0o700 });
    await assertPrivateDirectory(intents);
    if (((await stat(intents)).mode & 0o777) !== 0o700) fail("Private CLI intents must use mode 0700");
    const intentPath = join(intents, `${runId}.json`);
    const runPath = join(paths.harness, ".sessions", runId!);
    const approvalPath = join(runPath, "artifacts", "cli-approval-plan.json");
    if (existsSync(runPath) && !existsSync(intentPath) && !existsSync(approvalPath)) {
      fail("Existing media run was not prepared by this CLI; use another run ID");
    }
    const intent: Record<string, unknown> = { schemaVersion: 1, runId, username, credentialHandoff,
      runtimeSha256: sha(await readFile(join(paths.harness, "runtime-manifest.json"))) };
    if (bindMode === "host-only") intent.bindMode = bindMode;
    if (selectedPortStart !== null) intent.portStart = portStart(selectedPortStart);
    if (networkSubnets) intent.networkSubnets = networkSubnets;
    if (existsSync(intentPath)) {
      if (JSON.stringify(await readPrivateJson(intentPath)) !== JSON.stringify(intent)) fail("Existing media prepare intent differs");
    } else {
      await writePrivateJson(intentPath, intent);
    }
    if (!existsSync(runPath)) {
      const createArgs = ["bash", "scripts/session.sh", "create", runId!, username!];
      if (bindMode === "host-only") createArgs.push("--bind-mode", bindMode);
      if (selectedPortStart !== null) createArgs.push("--port-start", selectedPortStart);
      if (networkSubnets) createArgs.push("--network-subnets", `${networkSubnets.default},${networkSubnets.web}`);
      const created = child(createArgs, paths.harness);
      if (!created.ok) fail("Could not prepare the private media session; inspect this project only");
    }
    const plan = await planForRun(paths, runId!, credentialHandoff);
    if (plan.adminUsername !== username) fail("Existing media run belongs to a different administrator");
    if (existsSync(approvalPath)) {
      const saved = await readPrivateJson(approvalPath);
      if (saved.approvalDigest !== plan.approvalDigest) fail("Existing media plan changed; use a new run ID");
    } else {
      await writeApprovalRecord(paths, runId!, plan);
    }
    let scopeSuffix = "";
    if (plan.bind === "0.0.0.0") scopeSuffix = " --firewall-scope VERIFIED_SCOPE";
    let review = "Review this exact host-only project and its 127.0.0.1 bindings";
    if (plan.bind === "0.0.0.0") review = "Review this exact project and its private firewall policy";
    console.log(JSON.stringify({ ...plan,
      firewallScopeChoices: plan.bind === "0.0.0.0" ? ["router-private", "docker-aware-private"] : [],
      next: `${review}, then run self-host up --project-root ${shellQuote(paths.root)} --approve ${plan.approvalDigest}${scopeSuffix}` }, null, 2));
    return;
  }
  if (action === "apply" || action === "resume") {
    const digest = getOption(args, "--approve");
    const from = action === "resume" ? getOption(args, "--from") : null;
    const firewallScope = action === "apply" ? getOption(args, "--firewall-scope", false) : null;
    const deferIndexer = args.includes("--defer-indexer");
    await approvedRun(paths, runId!, digest!, from, firewallScope, deferIndexer);
    return;
  }
  if (action === "info") {
    const plan = await currentSavedPlan(paths, runId!);
    const approvedPath = join(paths.harness, ".sessions", runId!, "artifacts", "cli-approved.json");
    const approved = existsSync(approvedPath) ? await readPrivateJson(approvedPath) : null;
    const descriptions = [
      ["HOMARR_PORT", "Homarr", "Dashboard, connected widgets, and an optional agent front door"],
      ["JELLYFIN_PORT", "Jellyfin", "Play your own films and shows"],
      ["SEERR_PORT", "Seerr", "Request items for your owned media library"],
      ["SONARR_PORT", "Sonarr", "Organize shows"],
      ["RADARR_PORT", "Radarr", "Organize films"],
      ["PROWLARR_PORT", "Prowlarr", "Connect search sources you authorize"],
      ["QBITTORRENT_PORT", "qBittorrent", "Manage authorized downloads"],
    ];
    const services = descriptions.map(([portKey, name, purpose]) => ({
      name, purpose, url: `http://127.0.0.1:${plan.ports[portKey]}`,
    }));
    let otherDeviceAccess = "This host-only media run is bound to loopback. Use a separately approved private route or an SSH tunnel from another device.";
    if (plan.bind === "0.0.0.0") {
      otherDeviceAccess = "The ports also listen on host interfaces. Use an approved private IP or DNS name and confirm router or Docker-aware firewall rules before opening them from another device.";
    }
    console.log(JSON.stringify({ ...plan, approved: approved?.approvalDigest === plan.approvalDigest,
      services, access: { listedUrls: "this-host-only", otherDeviceAccess },
      secrets: "Stored only in the private run; not shown by info" }, null, 2));
    return;
  }
  if (action === "diagnose") {
    await runIdentity(paths, runId!);
    const failure = await latestFailedStage(paths, runId!);
    const fallback = await safeMediaFallback(paths, runId!, failure.stage);
    const approvedPath = join(paths.harness, ".sessions", runId!, "artifacts", "cli-approved.json");
    let resumeCommand: string[] | null = null;
    if (existsSync(approvedPath)) {
      const approved = await readPrivateJson(approvedPath);
      if (typeof approved.approvalDigest !== "string" || !digestPattern.test(approved.approvalDigest)) {
        fail("Invalid recorded media approval");
      }
      resumeCommand = ["self-host", "install", "media", "resume", "--project-root", paths.root,
        "--run-id", runId!, "--approve", approved.approvalDigest, "--from", failure.stage];
      if (failure.indexerVerificationDeferred) resumeCommand.push("--defer-indexer");
    }
    console.log(JSON.stringify({ schemaVersion: 1, kind: "selfhost-media-diagnosis", mutation: false,
      runId, failedStage: failure.stage, failureCategory: failure.failureCategory,
      privateBenchmarkPath: failure.benchmarkPath, safeFallback: fallback,
      resumeCommand, secretsPrinted: false,
      next: "Diagnose the named service with scoped status or browser evidence, repair its cause, then use the exact resume command. This does not prove acceptance." }, null, 2));
    return;
  }
  if (action === "benchmark") {
    await mediaBenchmark(paths, runId!);
    return;
  }
  if (action === "status") {
    const identity = await runIdentity(paths, runId!);
    const json = getOption(args, "--json", false);
    if (json !== null && json !== "yes") fail("--json accepts yes");
    if (json === "yes") {
      console.log(JSON.stringify(structuredStatus(paths.harness, identity.composeProject, runId!, identity.provenance), null, 2));
      return;
    }
    const result = child(["bash", "scripts/session.sh", "status", runId!], paths.harness);
    if (!result.ok) mediaStatusFailure(paths.harness, "run status");
    console.log(result.output.trim());
    return;
  }
  if (action === "lifecycle-check") {
    const lifecycle = await mediaLifecycle(paths, runId!);
    console.log(JSON.stringify({ schemaVersion: 1, kind: "selfhost-media-lifecycle-check", runId,
      composeProject: lifecycle.composeProject, status: "pass", mutation: false }, null, 2));
    return;
  }
  if (action === "stop") {
    const lifecycle = await mediaLifecycle(paths, runId!);
    const stopped = child([...lifecycle.command, "stop"], paths.harness, lifecycle.composeEnvironment);
    if (!stopped.ok) fail("Media stop failed for this exact run");
    console.log(JSON.stringify({ schemaVersion: 1, kind: "selfhost-media-bundle-lifecycle", action: "down",
      runId, composeProject: lifecycle.composeProject, volumesDeleted: false, accepted: false }, null, 2));
    return;
  }
  if (action === "up" || action === "down") {
    const plan = await currentSavedPlan(paths, runId!);
    if (action === "up") {
      const approvedPath = join(paths.harness, ".sessions", runId!, "artifacts", "cli-approved.json");
      if (!existsSync(approvedPath)) fail(`This run needs approval. Review self-host info, then run self-host up --project-root ${shellQuote(paths.root)} --approve ${plan.approvalDigest}`);
      const approved = await readPrivateJson(approvedPath);
      if (approved.approvalDigest !== plan.approvalDigest) fail("Run approval no longer matches the current plan");
    }
    let sessionAction = "down";
    if (action === "up") sessionAction = "up";
    const command = ["bash", "scripts/session.sh", sessionAction, runId!];
    const result = child(command, paths.harness);
    if (!result.ok) fail(`Media ${action} failed for this run`);
    if (action === "down") console.log(`Stopped only autostack-${runId}; bind-mounted data remains at ${join(paths.harness, ".sessions", runId!, "data")}`);
    if (action === "up") console.log(`Started only autostack-${runId}. Run self-host status --project-root ${shellQuote(paths.root)} to check the services.`);
    return;
  }
  fail("Unknown media action");
}

export async function mediaCommand(args: string[]) {
  const action = args[0];
  if (!action || action === "help" || action === "--help"
    || (action === "board-polish" && (!args[1] || ["help", "--help"].includes(args[1])))
    || (action === "access-proxy" && (!args[1] || ["help", "--help"].includes(args[1])))
    || (["reconcile-links", "reconcile-notebook"].includes(action) && (!args[1] || ["help", "--help"].includes(args[1])))
    || (action === "runtime-sync" && (!args[1] || ["help", "--help"].includes(args[1])))) {
    await mediaCommandUnlocked(args);
    return;
  }
  const root = getOption(args, "--project-root");
  const paths = await projectPaths(root!);
  if (action === "benchmark") {
    await assertNoRuntimeSyncTransaction(paths.local);
    await mediaCommandUnlocked(args, paths);
    return;
  }
  await withMediaRuntimeLock(paths.root, async () => {
    if (action !== "runtime-sync") await assertNoRuntimeSyncTransaction(paths.local);
    await mediaCommandUnlocked(args, paths);
  });
}
