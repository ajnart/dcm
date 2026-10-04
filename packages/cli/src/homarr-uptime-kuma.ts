import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { HomarrAttachClient, parseHomarrApiKey } from "./homarr-attach.ts";

type Input = {
  schemaVersion: 1;
  homarr: { origin: string; boardName: string };
  uptimeKuma: { appName: string; integrationName: string; url: string };
};
type Board = { id: string; name: string; isPublic: false; sections: Record<string, unknown>[]; items: Record<string, unknown>[] };
type State = { board: Board; app: Record<string, unknown>; integration: Record<string, unknown> | null; widget: Record<string, unknown> | null };
type Client = HomarrAttachClient;

const boardNamePattern = /^[A-Za-z0-9-_]{1,255}$/;
const widgetSize = { width: 2, height: 3 };

function fail(message: string): never { throw new Error(message); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(`${label} is invalid`);
  }
  return value;
}
function privateHost(hostname: string): boolean {
  if (["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return true;
  if (/^[a-z0-9][a-z0-9-]{0,62}$/i.test(hostname)) return true;
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 10 || parts[0] === 127) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}
function url(value: unknown, label: string, originOnly = false): string {
  const raw = text(value, label, 2048);
  let parsed: URL;
  try { parsed = new URL(raw); } catch { fail(`${label} must be an absolute URL`); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail(`${label} must be a credential-free HTTP(S) URL without query or fragment`);
  }
  if (originOnly && (parsed.pathname !== "/" || parsed.origin !== raw.replace(/\/$/, ""))) fail(`${label} must be an exact origin`);
  if (parsed.protocol === "http:" && !privateHost(parsed.hostname)) fail(`${label} needs HTTPS unless private or loopback`);
  if (originOnly) return parsed.origin;
  return parsed.href;
}
function validateInput(value: unknown): Input {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "homarr", "uptimeKuma"]) || value.schemaVersion !== 1
    || !record(value.homarr) || !exactKeys(value.homarr, ["origin", "boardName"])
    || !record(value.uptimeKuma) || !exactKeys(value.uptimeKuma, ["appName", "integrationName", "url"])) {
    fail("Homarr Uptime Kuma input schema is invalid");
  }
  const boardName = text(value.homarr.boardName, "homarr.boardName", 255);
  if (!boardNamePattern.test(boardName)) fail("homarr.boardName contains unsupported characters");
  return { schemaVersion: 1, homarr: { origin: url(value.homarr.origin, "homarr.origin", true), boardName }, uptimeKuma: {
    appName: text(value.uptimeKuma.appName, "uptimeKuma.appName", 64),
    integrationName: text(value.uptimeKuma.integrationName, "uptimeKuma.integrationName", 127),
    url: url(value.uptimeKuma.url, "uptimeKuma.url"),
  } };
}
async function ownerFile(path: string): Promise<string> {
  if (!isAbsolute(path) || resolve(path) !== path) fail("Input file paths must be exact and absolute");
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o777) !== 0o600
    || await realpath(path) !== path || metadata.size < 1 || metadata.size > 32 * 1024) {
    fail("Input files must be owner-only regular files (0600) without links");
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail("Input file has a different owner");
  return await readFile(path, "utf8");
}
async function inputFile(path: string): Promise<Input> {
  let value: unknown;
  try { value = JSON.parse(await ownerFile(path)); } catch { fail("Homarr Uptime Kuma input is not valid JSON or a safe owner-only file"); }
  return validateInput(value);
}
function rawSecret(contents: string, label: string): string {
  let value = contents;
  if (value.endsWith("\r\n")) value = value.slice(0, -2);
  else if (value.endsWith("\n")) value = value.slice(0, -1);
  if (value.length < 1 || value.length > 4096 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)
    || /^[A-Z][A-Z0-9_]*=/.test(value)) fail(`${label} file must contain one bounded raw value, not an environment assignment`);
  return value;
}
function exactBoard(boards: unknown, detail: unknown, name: string): Board {
  if (!Array.isArray(boards)) fail("Homarr board list is invalid");
  const matches = boards.filter((board) => record(board) && board.name === name);
  if (matches.length !== 1 || !record(matches[0]) || typeof matches[0].id !== "string" || matches[0].isPublic !== false) {
    fail("Exactly one private Homarr board must match the selected name");
  }
  if (!record(detail) || detail.id !== matches[0].id || detail.name !== name || detail.isPublic !== false
    || !Array.isArray(detail.items) || !Array.isArray(detail.sections)) fail("Homarr private board detail is invalid");
  return detail as Board;
}
function exactApp(apps: unknown, board: Board, appName: string): Record<string, unknown> {
  if (!Array.isArray(apps)) fail("Homarr app inventory is invalid");
  const matches = apps.filter((app) => record(app) && app.name === appName);
  if (matches.length !== 1 || !record(matches[0]) || typeof matches[0].id !== "string") fail("Exactly one existing Homarr app must match Uptime Kuma");
  const tiles = board.items.filter((item) => item.kind === "app" && record(item.options) && item.options.appId === matches[0].id);
  if (tiles.length !== 1) fail("Uptime Kuma must already have exactly one app tile on the selected board");
  return matches[0];
}
function supportedKinds(value: unknown, secretKinds: string[]): void {
  if (!Array.isArray(value)) fail("Homarr integration kinds are invalid");
  const matches = value.filter((entry) => record(entry) && entry.kind === "uptimeKuma");
  if (matches.length !== 1 || !record(matches[0]) || !Array.isArray(matches[0].requiredSecrets)
    || !matches[0].requiredSecrets.some((option) => canonical(option) === canonical(secretKinds))) {
    fail("Live Homarr does not expose the selected Uptime Kuma secret contract");
  }
}
function findIntegration(value: unknown, input: Input): Record<string, unknown> | null {
  if (!Array.isArray(value)) fail("Homarr integration inventory is invalid");
  const matches = value.filter((entry) => record(entry) && entry.name === input.uptimeKuma.integrationName);
  if (matches.length === 0) return null;
  if (matches.length !== 1 || !record(matches[0]) || typeof matches[0].id !== "string" || matches[0].kind !== "uptimeKuma"
    || matches[0].url !== input.uptimeKuma.url || !record(matches[0].permissions)
    || matches[0].permissions.hasFullAccess !== true || matches[0].permissions.hasUseAccess !== true) {
    fail("An existing Uptime Kuma integration conflicts with the requested exact integration or permissions");
  }
  return matches[0];
}
function exactWidget(board: Board, integrationId: string | null): Record<string, unknown> | null {
  const matches = board.items.filter((item) => item.kind === "uptimeKuma");
  if (matches.length === 0) return null;
  if (matches.length !== 1 || integrationId === null || !record(matches[0])
    || canonical(matches[0].integrationIds) !== canonical([integrationId]) || canonical(matches[0].options) !== canonical({})) {
    fail("An existing Uptime Kuma widget conflicts with the selected integration or options");
  }
  return matches[0];
}
async function read(client: Client, input: Input, secretKinds: string[], selectedSlug: string | null): Promise<State> {
  supportedKinds(await client.query("integration.getKinds"), secretKinds);
  const board = exactBoard(await client.query("board.getAllBoards"),
    await client.query("board.getBoardByName", { name: input.homarr.boardName }), input.homarr.boardName);
  const settings = await client.query("board.getBoardSettings", { id: board.id });
  if (!record(settings) || settings.id !== board.id || settings.name !== board.name) {
    fail("Homarr API key cannot prove modify access to the selected private board");
  }
  const app = exactApp(await client.query("app.all"), board, input.uptimeKuma.appName);
  const integration = findIntegration(await client.query("integration.all"), input);
  if (integration !== null) {
    const detail = await client.query("integration.byId", { id: integration.id });
    if (!record(detail) || !record(detail.app) || detail.app.id !== app.id || detail.kind !== "uptimeKuma"
      || detail.url !== input.uptimeKuma.url || !Array.isArray(detail.secrets)
      || detail.secrets.some((secret) => !record(secret) || typeof secret.kind !== "string")
      || canonical(detail.secrets.map((secret) => secret.kind).sort()) !== canonical([...secretKinds].sort())) {
      fail("Existing Uptime Kuma integration is not linked to the exact app or selected secret kinds");
    }
    if (selectedSlug !== null) {
      const slug = detail.secrets.find((secret) => record(secret) && secret.kind === "slug");
      if (!record(slug) || slug.value !== selectedSlug) fail("Existing Uptime Kuma integration uses a different status-page slug");
    }
  }
  let integrationId: string | null = null;
  if (integration !== null) integrationId = String(integration.id);
  const widget = exactWidget(board, integrationId);
  return { board, app, integration, widget };
}
function approval(input: Input, state: State, fingerprints: Record<string, string>, secretKinds: string[]): string {
  const snapshot = { input, fingerprints, secretKinds, widgetSize, board: state.board, app: state.app, integration: state.integration };
  return `ATTACH-UPTIME-KUMA:${state.board.id}:${createHash("sha256").update(canonical(snapshot)).digest("hex")}`;
}
function assertBoardPreserved(original: Board, current: Board): void {
  if (original.id !== current.id || original.name !== current.name || current.isPublic !== false
    || canonical(original.sections) !== canonical(current.sections)) fail("Homarr board changed during Uptime Kuma attachment; re-plan");
  for (const item of original.items) {
    const matches = current.items.filter((candidate) => candidate.id === item.id);
    if (matches.length !== 1 || canonical(matches[0]) !== canonical(item)) fail("Homarr board data changed during Uptime Kuma attachment; re-plan");
  }
}
function liveDashboard(value: unknown, integrationId: string): { monitorCount: number; liveDashboard: "verified" | "empty" } {
  if (!Array.isArray(value) || value.length !== 1 || !record(value[0]) || value[0].integrationId !== integrationId
    || (value[0].error !== undefined && value[0].error !== null)
    || !record(value[0].dashboard)) fail("Uptime Kuma live widget response is missing or failed");
  const dashboard = value[0].dashboard;
  const countKeys = ["totalMonitors", "upCount", "downCount", "pausedCount"];
  if (countKeys.some((key) => !Number.isInteger(dashboard[key]) || Number(dashboard[key]) < 0)
    || typeof dashboard.averageUptimePercent !== "number" || !Number.isFinite(dashboard.averageUptimePercent)
    || dashboard.averageUptimePercent < 0 || dashboard.averageUptimePercent > 100
    || !Array.isArray(dashboard.monitors) || dashboard.monitors.length !== dashboard.totalMonitors
    || Number(dashboard.upCount) + Number(dashboard.downCount) + Number(dashboard.pausedCount) !== dashboard.totalMonitors) {
    fail("Uptime Kuma live widget dashboard is invalid");
  }
  for (const monitor of dashboard.monitors) {
    if (!record(monitor) || !Number.isInteger(monitor.id) || typeof monitor.name !== "string"
      || !["up", "down", "paused"].includes(String(monitor.status))
      || (monitor.uptimePercent24h !== null && (typeof monitor.uptimePercent24h !== "number"
        || !Number.isFinite(monitor.uptimePercent24h) || monitor.uptimePercent24h < 0 || monitor.uptimePercent24h > 100))) {
      fail("Uptime Kuma live widget monitor is invalid");
    }
  }
  let liveDashboard: "verified" | "empty" = "verified";
  if (dashboard.totalMonitors === 0) liveDashboard = "empty";
  return { monitorCount: Number(dashboard.totalMonitors), liveDashboard };
}
function liveFailure(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  if (error.message.includes("endpoint did not respond")) return "homarr-network";
  if (error.message.includes("HTTP ") || error.message.includes("tRPC response shape")) return "homarr-endpoint-or-widget-source";
  return "widget-response";
}
function connectionFailure(error: unknown): string {
  if (!record(error) || typeof error.type !== "string") return "unknown";
  if (error.type === "request") return "service-network";
  if (error.type === "statusCode") return "service-endpoint-http";
  if (error.type === "parse") return "service-endpoint-response";
  if (error.type === "authorization") return "service-authorization";
  if (error.type === "certificate") return "service-certificate";
  return "unknown";
}
function write(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

export async function homarrUptimeKumaCommand(args: string[]): Promise<void> {
  const action = args[0];
  if (!action || !["plan", "apply", "status"].includes(action)) fail("Use homarr attach uptime-kuma plan, apply, or status");
  const flags: Record<string, string> = {};
  const valid = new Set(["--input", "--api-key-file", "--slug-file", "--uptime-api-key-file", "--approve"]);
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!valid.has(name) || flags[name] || !value || value.startsWith("--")) fail(`Invalid or repeated Homarr Uptime Kuma option: ${name ?? "(missing)"}`);
    flags[name] = value;
  }
  if (!flags["--input"] || !flags["--api-key-file"]) fail("Homarr Uptime Kuma attachment needs --input and --api-key-file");
  if (action === "apply" && !flags["--approve"]) fail("Homarr Uptime Kuma apply needs the exact approval from its matching plan");
  if (action !== "apply" && flags["--approve"]) fail("Only Homarr Uptime Kuma apply accepts --approve");
  const input = await inputFile(flags["--input"]);
  const homarrKey = parseHomarrApiKey(await ownerFile(flags["--api-key-file"]));
  const secrets: { kind: "slug" | "apiKey"; value: string }[] = [];
  if (flags["--slug-file"]) {
    const slug = rawSecret(await ownerFile(flags["--slug-file"]), "Uptime Kuma slug");
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(slug)) fail("Uptime Kuma slug contains unsupported characters");
    secrets.push({ kind: "slug", value: slug.toLowerCase() });
  }
  if (flags["--uptime-api-key-file"]) {
    secrets.push({ kind: "apiKey", value: rawSecret(await ownerFile(flags["--uptime-api-key-file"]), "Uptime Kuma API key") });
  }
  const secretKinds = secrets.map((secret) => secret.kind);
  const fingerprints: Record<string, string> = { homarr: createHash("sha256").update("selfhost-homarr-key\0").update(homarrKey).digest("hex") };
  for (const secret of secrets) fingerprints[secret.kind] = createHash("sha256").update(`selfhost-uptime-kuma-${secret.kind}\0`).update(secret.value).digest("hex");
  const client = new HomarrAttachClient(input.homarr.origin, homarrKey);
  let state: State;
  try { state = await read(client, input, secretKinds, secrets.find((secret) => secret.kind === "slug")?.value ?? null); }
  catch (error) {
    const failure = liveFailure(error);
    if (action !== "status" || (failure !== "homarr-network" && failure !== "homarr-endpoint-or-widget-source")) throw error;
    write({ status: "attachment-unverified", mutation: false, liveDashboard: "not-checked", failure });
    return;
  }
  const current = state.integration !== null && state.widget !== null;
  if (action === "plan") {
    if (state.integration !== null) {
      const live = liveDashboard(await client.query("widget.uptimeKuma.getDashboard",
        { integrationIds: [state.integration.id] }), String(state.integration.id));
      if (live.liveDashboard !== "verified" || live.monitorCount < 1) {
        fail("Existing Uptime Kuma integration has no live monitors; inspect its status page before adding a widget");
      }
    }
    write({ status: "pass", mutation: false, board: { id: state.board.id, name: state.board.name, private: true },
      integration: { kind: "uptimeKuma", name: input.uptimeKuma.integrationName, url: input.uptimeKuma.url, id: state.integration?.id ?? null,
        secretKinds }, widget: { kind: "uptimeKuma", alreadyCurrent: state.widget !== null, newItemSize: widgetSize },
      alreadyCurrent: current, approval: approval(input, state, fingerprints, secretKinds),
      mutations: ["Create one tested native Uptime Kuma integration linked to the existing app if absent.",
        "Add one Uptime Kuma widget to the existing private board if absent."],
    });
    return;
  }
  if (action === "status") {
    if (!current) {
      write({ status: "needs-attachment", mutation: false, integrationId: state.integration?.id ?? null,
        widgetId: state.widget?.id ?? null, liveDashboard: "not-checked" });
      return;
    }
    try {
      const live = liveDashboard(await client.query("widget.uptimeKuma.getDashboard", { integrationIds: [state.integration!.id] }), String(state.integration!.id));
      write({ status: "attached", mutation: false, integrationId: state.integration!.id, widgetId: state.widget!.id, ...live });
    } catch (error) {
      write({ status: "attached-live-unverified", mutation: false, integrationId: state.integration!.id,
        widgetId: state.widget!.id, liveDashboard: "unverified", failure: liveFailure(error) });
    }
    return;
  }
  if (flags["--approve"] !== approval(input, state, fingerprints, secretKinds)) fail("Homarr Uptime Kuma approval no longer matches this exact board, integration, and credential state; re-plan");
  if (current) {
    const live = liveDashboard(await client.query("widget.uptimeKuma.getDashboard", { integrationIds: [state.integration!.id] }), String(state.integration!.id));
    write({ status: "already-attached", mutation: false, integrationId: state.integration!.id, widgetId: state.widget!.id, ...live });
    return;
  }
  let integration = state.integration;
  if (integration === null) {
    let result: unknown;
    try {
      result = await client.mutate("integration.create", { name: input.uptimeKuma.integrationName, url: input.uptimeKuma.url,
        kind: "uptimeKuma", secrets, attemptSearchEngineCreation: false, app: { id: state.app.id } });
    } catch {
      // A committed creation can lose its response; reconcile the exact integration below.
    }
    if (record(result) && Object.hasOwn(result, "error")) {
      fail(`Homarr Uptime Kuma connection test failed (${connectionFailure(result.error)}); no widget was added`);
    }
    if (result !== undefined && (!record(result) || !record(result.integration)
      || result.integration.kind !== "uptimeKuma" || result.integration.name !== input.uptimeKuma.integrationName
      || result.integration.url !== input.uptimeKuma.url || result.appId !== state.app.id)) {
      fail("Homarr integration.create returned an unexpected result; no widget was added");
    }
    integration = findIntegration(await client.query("integration.all"), input);
    if (integration === null) fail("Homarr integration.create did not persist the exact tested Uptime Kuma integration; no widget was added");
    const detail = await client.query("integration.byId", { id: integration.id });
    if (!record(detail) || !record(detail.app) || detail.app.id !== state.app.id) fail("Created Uptime Kuma integration did not link to the exact existing app; no widget was added");
  }
  const connected = liveDashboard(await client.query("widget.uptimeKuma.getDashboard",
    { integrationIds: [integration.id] }), String(integration.id));
  if (connected.liveDashboard !== "verified" || connected.monitorCount < 1) {
    fail("Uptime Kuma integration has no live monitors; no widget was added");
  }
  let board = exactBoard(await client.query("board.getAllBoards"),
    await client.query("board.getBoardByName", { name: input.homarr.boardName }), input.homarr.boardName);
  assertBoardPreserved(state.board, board);
  let widget = exactWidget(board, String(integration.id));
  if (widget === null) {
    try { await client.mutate("board.addItem", { boardId: board.id, kind: "uptimeKuma", options: {},
      integrationIds: [integration.id], size: widgetSize }); }
    catch { /* Reconcile a possibly committed placement using its exact item read-back. */ }
    board = exactBoard(await client.query("board.getAllBoards"),
      await client.query("board.getBoardByName", { name: input.homarr.boardName }), input.homarr.boardName);
    assertBoardPreserved(state.board, board);
    widget = exactWidget(board, String(integration.id));
    if (widget === null) fail("Homarr board.addItem did not persist the Uptime Kuma widget; inspect before retrying");
  }
  let expectedItems = state.board.items.length;
  if (state.widget === null) expectedItems += 1;
  if (board.items.length !== expectedItems) {
    fail("Homarr board gained unexpected items during Uptime Kuma attachment; inspect before retrying");
  }
  const live = liveDashboard(await client.query("widget.uptimeKuma.getDashboard", { integrationIds: [integration.id] }), String(integration.id));
  write({ status: "attached", boardUrl: `${input.homarr.origin}/boards/${encodeURIComponent(input.homarr.boardName)}`,
    integrationId: integration.id, widgetId: widget.id, boardPreserved: true, ...live });
}
