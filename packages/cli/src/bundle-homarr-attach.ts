import { lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

type AdapterId = "immich" | "docmost" | "vaultwarden" | "immich-native";
type QueueEntry = {
  adapter: AdapterId;
  kind: "shortcut" | "native-integration";
  state: "ready-for-plan" | "blocked" | "attached" | "needs-attachment" | "status-unavailable";
  gate: string | null;
  commands: { plan: string[]; status: string[] } | null;
};
export type HomarrAttachmentAdapter = (args: string[]) => Promise<void>;

const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const MAX_FILE = 64 * 1024;

function fail(message: string): never { throw new Error(message); }
function object(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, any>;
}
function exact(value: Record<string, any>, keys: string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(`${label} has unknown or missing fields`);
  }
}

async function ownerFileExists(path: string, label: string): Promise<boolean> {
  if (!isAbsolute(path) || resolve(path) !== path) fail(`${label} must use one exact absolute path`);
  let metadata;
  try { metadata = await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || (metadata.mode & 0o777) !== 0o600 || await realpath(path) !== path
    || metadata.size < 1 || metadata.size > MAX_FILE) {
    fail(`${label} must be one bounded owner-only file (0600) without links`);
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail(`${label} has a different owner`);
  return true;
}

async function loadBundle(root: string, input: string) {
  if (!isAbsolute(root) || resolve(root) !== root || root === sep || root === resolve(homedir())) {
    fail("--project-root must be one exact absolute project path, not root or home");
  }
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() || await realpath(root) !== root
    || (rootMetadata.mode & 0o002) !== 0) fail("Project root must be one real non-world-writable directory");
  if (typeof process.getuid === "function" && rootMetadata.uid !== process.getuid()) fail("Project root has a different owner");
  const directory = dirname(input);
  const inferredId = basename(directory);
  if (!ID.test(inferredId) || directory !== join(root, ".selfhost", "bundles", inferredId)
    || input !== join(directory, "household-bundle.json")) {
    fail("bundle homarr-attach requires one canonical bundle-owned household-bundle.json path");
  }
  if (!await ownerFileExists(input, "Bundle input")) fail("Bundle input does not exist");
  let value: Record<string, any>;
  try { value = object(JSON.parse(await readFile(input, "utf8")), "Bundle input"); }
  catch { fail("Bundle input is not valid JSON"); }
  exact(value, ["schemaVersion", "id", "projectRoot", "services"], "Bundle input");
  if (value.schemaVersion !== 1 || value.id !== inferredId || value.projectRoot !== root) {
    fail("Bundle input identity does not match this project");
  }
  const services = object(value.services, "Bundle services");
  exact(services, ["media", "immich", "docmost", "vaultwarden"], "Bundle services");
  const media = object(services.media, "Bundle media service");
  if (typeof media.runId !== "string" || !ID.test(media.runId)) fail("Bundle media run ID is invalid");
  const directoryMetadata = await lstat(directory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()
    || (directoryMetadata.mode & 0o777) !== 0o700 || await realpath(directory) !== directory) {
    fail("Bundle directory must be one owner-only real directory (0700)");
  }
  if (typeof process.getuid === "function" && directoryMetadata.uid !== process.getuid()) {
    fail("Bundle directory has a different owner");
  }
  return { id: value.id as string, mediaRunId: media.runId as string, directory };
}

async function homarrKey(root: string, runId: string): Promise<string | null> {
  const session = join(root, ".selfhost", "media-harness", ".sessions", runId);
  const connections = join(session, "connections.env");
  if (await ownerFileExists(connections, "Managed media connections file")) return connections;
  const standalone = join(session, "homarr-api-key.env");
  if (await ownerFileExists(standalone, "Managed Homarr API key file")) return standalone;
  return null;
}

function commands(args: string[]): { plan: string[]; status: string[] } {
  return {
    plan: ["self-host", "homarr", "attach", ...args.slice(0, 1), "plan", ...args.slice(1)],
    status: ["self-host", "homarr", "attach", ...args.slice(0, 1), "status", ...args.slice(1)],
  };
}

function shortcutCommands(input: string, apiKeyFile: string): { plan: string[]; status: string[] } {
  const base = ["--input", input, "--api-key-file", apiKeyFile];
  return {
    plan: ["self-host", "homarr", "attach", "plan", ...base],
    status: ["self-host", "homarr", "attach", "status", ...base],
  };
}

async function queue(root: string, directory: string, runId: string): Promise<QueueEntry[]> {
  const apiKeyFile = await homarrKey(root, runId);
  const entries: QueueEntry[] = [];
  for (const id of ["immich", "docmost", "vaultwarden"] as const) {
    const input = join(directory, `homarr-attach-${id}.json`);
    let gate: string | null = null;
    if (!await ownerFileExists(input, `${id} Homarr shortcut input`)) gate = "missing-generated-input; run bundle homarr-inputs apply";
    else if (apiKeyFile === null) gate = "missing-managed-homarr-key; finish the media Homarr/connections stage";
    let entryCommands: { plan: string[]; status: string[] } | null = null;
    if (gate === null && apiKeyFile !== null) entryCommands = shortcutCommands(input, apiKeyFile);
    let state: "ready-for-plan" | "blocked" = "blocked";
    if (gate === null) state = "ready-for-plan";
    entries.push({ adapter: id, kind: "shortcut", state, gate, commands: entryCommands });
  }
  const input = join(directory, "homarr-attach-immich-native.json");
  const immichKey = join(directory, "immich-homarr-api-key");
  const acceptance = join(directory, "immich-acceptance.json");
  let gate: string | null = null;
  if (!await ownerFileExists(input, "Native Immich Homarr input")) {
    gate = "missing-native-input; establish the Homarr-reachable Immich network and rerun bundle homarr-inputs apply";
  } else if (apiKeyFile === null) gate = "missing-managed-homarr-key; finish the media Homarr/connections stage";
  else if (!await ownerFileExists(immichKey, "Limited Immich Homarr API key")) {
    gate = "missing-limited-immich-key; complete immich homarr-key plan and create";
  } else if (!await ownerFileExists(acceptance, "Immich acceptance evidence")) {
    gate = "missing-immich-acceptance; complete direct Immich acceptance";
  }
  let entryCommands: { plan: string[]; status: string[] } | null = null;
  if (gate === null && apiKeyFile !== null) {
    entryCommands = commands(["immich", "--input", input, "--api-key-file", apiKeyFile,
      "--immich-api-key-file", immichKey, "--acceptance-file", acceptance]);
  }
  let state: "ready-for-plan" | "blocked" = "blocked";
  if (gate === null) state = "ready-for-plan";
  entries.push({ adapter: "immich-native", kind: "native-integration", state, gate, commands: entryCommands });
  return entries;
}

async function freshStatus(command: string[], adapter: HomarrAttachmentAdapter): Promise<Record<string, any>> {
  const priorLog = console.log;
  const priorError = console.error;
  const priorWrite = process.stdout.write;
  const priorErrorWrite = process.stderr.write;
  const priorExitCode = process.exitCode;
  let output = "";
  const append = (value: string | Uint8Array) => {
    const text = String(value);
    if (Buffer.byteLength(output) + Buffer.byteLength(text) > MAX_FILE) fail("Attachment status exceeded its bound");
    output += text;
  };
  console.log = (...values) => append(`${values.map(String).join(" ")}\n`);
  console.error = (...values) => append(`${values.map(String).join(" ")}\n`);
  process.stdout.write = ((value: string | Uint8Array) => { append(value); return true; }) as typeof process.stdout.write;
  process.stderr.write = process.stdout.write;
  process.exitCode = 0;
  try {
    await adapter(command.slice(3));
    if (process.exitCode) fail("Attachment status failed");
    return object(JSON.parse(output), "Attachment status");
  } finally {
    console.log = priorLog;
    console.error = priorError;
    process.stdout.write = priorWrite;
    process.stderr.write = priorErrorWrite;
    process.exitCode = 0;
    process.exitCode = priorExitCode;
  }
}

function resourceId(value: unknown): boolean {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value);
}

async function observedAttachment(entry: QueueEntry, adapter: HomarrAttachmentAdapter): Promise<boolean> {
  if (!entry.commands) fail("Attachment commands are missing");
  const command = entry.commands.status;
  const inputPath = command[command.indexOf("--input") + 1];
  if (!await ownerFileExists(inputPath, "Attachment input")) fail("Attachment input is missing");
  const input = object(JSON.parse(await readFile(inputPath, "utf8")), "Attachment input");
  const value = await freshStatus(command, adapter);
  if (value.mutation !== false) fail("Attachment status claimed a mutation");
  if (entry.kind === "shortcut") {
    exact(value, ["status", "mutation", "board", "appId", "tileId", "notebookId", "additionalNotebookId",
      "integrationVerified", "serviceRuntimeVerified"], "Shortcut status");
    const board = object(value.board, "Shortcut board");
    exact(board, ["id", "name", "private"], "Shortcut board");
    if (input.service?.id !== entry.adapter || board.name !== input.homarr?.boardName
      || !resourceId(board.id) || board.private !== true || value.integrationVerified !== false
      || value.serviceRuntimeVerified !== false || !["attached", "needs-attachment"].includes(value.status)
      || [value.appId, value.tileId, value.notebookId, value.additionalNotebookId]
        .some((id) => id !== null && !resourceId(id))) fail("Shortcut status is invalid");
    if (value.status !== "attached") return false;
    if ([value.appId, value.tileId, value.notebookId, value.additionalNotebookId].some((id) => !resourceId(id))) {
      fail("Attached shortcut has missing resources");
    }
    return true;
  }
  exact(value, ["status", "mutation", "integrationId", "widgetKinds", "liveWidgetKinds",
    "integrationVerified", "boardPreserved", "serviceAcceptanceRecorded"], "Native status");
  const kinds = ["immich-serverStats", "immich-albumCarousel"];
  const selected = input.immich?.widgets;
  if (!Array.isArray(selected) || selected.length === 0 || selected.some((widget) => !kinds.includes(widget?.kind))) {
    fail("Native selected widgets are invalid");
  }
  const validKinds = (values: unknown): values is string[] => Array.isArray(values)
    && values.every((kind) => typeof kind === "string" && kinds.includes(kind))
    && new Set(values).size === values.length;
  if (!["attached", "needs-attachment", "attached-live-unverified"].includes(value.status)
    || (value.integrationId !== null && !resourceId(value.integrationId))
    || !validKinds(value.widgetKinds) || !validKinds(value.liveWidgetKinds)
    || typeof value.integrationVerified !== "boolean" || value.boardPreserved !== true
    || value.serviceAcceptanceRecorded !== true) fail("Native status is invalid");
  if (value.status !== "attached") return false;
  const expected = selected.map((widget) => widget.kind).sort();
  if (!resourceId(value.integrationId) || value.integrationVerified !== true
    || JSON.stringify([...value.widgetKinds].sort()) !== JSON.stringify(expected)
    || JSON.stringify([...value.liveWidgetKinds].sort()) !== JSON.stringify(expected)) fail("Native attachment is unverified");
  return true;
}

/** Fresh adapter calls only; no stored attachment assertion can satisfy this queue. */
export async function inspectBundleHomarrAttachments(root: string, input: string, adapter?: HomarrAttachmentAdapter): Promise<QueueEntry[]> {
  const bundle = await loadBundle(root, input);
  const entries = await queue(root, bundle.directory, bundle.mediaRunId);
  const invoke = adapter ?? (await import("./homarr-attach.ts")).homarrAttachCommand;
  for (const entry of entries) {
    if (entry.state === "blocked") break;
    try {
      entry.state = "needs-attachment";
      if (await observedAttachment(entry, invoke)) entry.state = "attached";
    }
    catch { entry.state = "status-unavailable"; entry.gate = "invalid-or-unavailable-fresh-adapter-status; inspect the exact adapter status"; }
    // Each later adapter sees a new snapshot after this unresolved attachment is applied.
    if (entry.state !== "attached") break;
  }
  return entries;
}

function parse(args: string[]): Record<string, string> {
  if (args[0] !== "status") fail("Use bundle homarr-attach status");
  const flags: Record<string, string> = {};
  const allowed = new Set(["--project-root", "--input"]);
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index];
    if (name === "--inspect" && !flags[name]) { flags[name] = "yes"; index -= 1; continue; }
    const value = args[index + 1];
    if (!allowed.has(name) || flags[name] || !value || value.startsWith("--")) {
      fail(`Invalid or repeated bundle homarr-attach option: ${name ?? "(missing)"}`);
    }
    flags[name] = value;
  }
  if (!flags["--project-root"] || !flags["--input"]) fail("bundle homarr-attach status needs --project-root and --input");
  return flags;
}

export async function bundleHomarrAttachCommand(args: string[], adapter?: HomarrAttachmentAdapter): Promise<void> {
  const flags = parse(args);
  const bundle = await loadBundle(flags["--project-root"], flags["--input"]);
  let entries = await queue(flags["--project-root"], bundle.directory, bundle.mediaRunId);
  const inspected = flags["--inspect"] === "yes";
  if (inspected) entries = await inspectBundleHomarrAttachments(flags["--project-root"], flags["--input"], adapter);
  let status = "ready-for-adapter-plans";
  if (entries.some((entry) => entry.state === "blocked")) status = "partially-ready";
  if (entries.every((entry) => entry.state === "blocked")) status = "blocked";
  if (inspected) {
    status = "attachment-action-required";
    if (entries.every((entry) => entry.state === "attached")) status = "attached-readback";
  }
  let observation = "file-metadata-only";
  if (inspected) observation = "fresh-sequential-adapter-status";
  console.log(JSON.stringify({ schemaVersion: 1, kind: "household-bundle-homarr-attach-queue",
    action: "status", status, mutation: false, bundle: bundle.id, queue: entries,
    secretsRead: inspected, secretsPrinted: false, fullAcceptance: false,
    observation,
    limitations: [
      "Without --inspect this queue checks file metadata only; --inspect performs fresh read-only adapter calls through their private credential boundary, stopping at the first unresolved entry.",
      "Adapter requests use existing bounded API timeouts; the queue does not claim an aggregate cancellation deadline.",
      "Run each ready adapter's exact plan, review its approval, then run its apply and status commands directly.",
      "One aggregate approval is unsafe because every shortcut changes the board snapshot bound by the next adapter approval, and native Immich cannot plan before its app exists.",
      "The returned commands retain the underlying adapters' exact board-snapshot and existing-content preservation checks.",
      "Existing media links and recap content are assumed to have been reconciled by their owning media/access workflow.",
    ] }, null, 2));
}
