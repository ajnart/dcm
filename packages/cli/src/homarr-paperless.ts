import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { HomarrAttachClient, parseHomarrApiKey } from "./homarr-attach.ts";

type Input = { schemaVersion: 1; homarr: { origin: string; boardName: string };
  paperless: { appName: string; integrationName: string; url: string } };
type Board = { id: string; name: string; isPublic: false; sections: Record<string, unknown>[];
  items: Record<string, unknown>[] };
type State = { board: Board; app: Record<string, unknown>;
  integration: Record<string, unknown> | null; widget: Record<string, unknown> | null };
const size = { width: 2, height: 2 };

function fail(message: string): never { throw new Error(message); }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return canonical(Object.keys(value).sort()) === canonical(expected.sort());
}
function bounded(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value || value.length > max || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)) fail(`${label} is invalid`);
  return value;
}
function validateUrl(value: unknown, originOnly: boolean): string {
  const raw = bounded(value, "URL", 2048);
  let parsed: URL;
  try { parsed = new URL(raw); } catch { fail("URL must be absolute"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password
    || parsed.search || parsed.hash || parsed.pathname !== "/"
    || parsed.origin !== raw.replace(/\/$/, "")) fail("URL must be a credential-free HTTP(S) origin");
  if (parsed.protocol === "http:") {
    const host = parsed.hostname;
    const parts = host.split(".").map(Number);
    const privateIp = parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
      && (parts[0] === 10 || parts[0] === 127 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
        || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127));
    if (host !== "localhost" && host !== "[::1]" && !/^[a-z0-9][a-z0-9-]{0,62}$/i.test(host)
      && !privateIp) fail("HTTP URL must be private or loopback");
  }
  return originOnly ? parsed.origin : parsed.href;
}
function validateInput(value: unknown): Input {
  if (!record(value) || !keys(value, ["schemaVersion", "homarr", "paperless"]) || value.schemaVersion !== 1
    || !record(value.homarr) || !keys(value.homarr, ["origin", "boardName"])
    || !record(value.paperless) || !keys(value.paperless, ["appName", "integrationName", "url"])) {
    fail("Homarr Paperless input schema is invalid");
  }
  const boardName = bounded(value.homarr.boardName, "board name", 255);
  if (!/^[A-Za-z0-9-_]{1,255}$/.test(boardName)) fail("board name is invalid");
  return { schemaVersion: 1, homarr: { origin: validateUrl(value.homarr.origin, true), boardName },
    paperless: { appName: bounded(value.paperless.appName, "app name", 64),
      integrationName: bounded(value.paperless.integrationName, "integration name", 127),
      url: validateUrl(value.paperless.url, false) } };
}
async function privateFile(path: string, max: number): Promise<string> {
  if (!isAbsolute(path) || resolve(path) !== path) fail("File path must be exact and absolute");
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600
    || stat.uid !== process.getuid?.() || stat.size < 1 || stat.size > max || await realpath(path) !== path) {
    fail("Input and key files must be owner-only regular mode-0600 files without links");
  }
  return await readFile(path, "utf8");
}
function exactBoard(boards: unknown, detail: unknown, name: string): Board {
  if (!Array.isArray(boards)) fail("Homarr board inventory is invalid");
  const matches = boards.filter((entry) => record(entry) && entry.name === name);
  if (matches.length !== 1 || !record(matches[0]) || typeof matches[0].id !== "string"
    || matches[0].isPublic !== false || !record(detail) || detail.id !== matches[0].id
    || detail.name !== name || detail.isPublic !== false || !Array.isArray(detail.items)
    || !Array.isArray(detail.sections)) fail("Exactly one private Homarr board must match");
  return detail as Board;
}
function integrationFrom(value: unknown, input: Input): Record<string, unknown> | null {
  if (!Array.isArray(value)) fail("Homarr integration inventory is invalid");
  const matches = value.filter((entry) => record(entry) && entry.name === input.paperless.integrationName);
  if (matches.length === 0) return null;
  if (matches.length !== 1 || !record(matches[0]) || typeof matches[0].id !== "string"
    || matches[0].kind !== "paperlessNgx" || matches[0].url !== input.paperless.url
    || !record(matches[0].permissions) || matches[0].permissions.hasFullAccess !== true
    || matches[0].permissions.hasUseAccess !== true) fail("Existing Paperless integration conflicts with requested identity or access");
  return matches[0];
}
function widgetFrom(board: Board, integrationId: string | null): Record<string, unknown> | null {
  const matches = board.items.filter((item) => item.kind === "paperlessNgx");
  if (matches.length === 0) return null;
  if (matches.length !== 1 || !record(matches[0]) || integrationId === null
    || canonical(matches[0].integrationIds) !== canonical([integrationId])
    || canonical(matches[0].options) !== canonical({})) fail("Existing Paperless widget conflicts with selected integration");
  return matches[0];
}
async function read(client: HomarrAttachClient, input: Input): Promise<State> {
  const kinds = await client.query("integration.getKinds");
  if (!Array.isArray(kinds) || !kinds.some((entry) => record(entry) && entry.kind === "paperlessNgx"
    && Array.isArray(entry.requiredSecrets) && entry.requiredSecrets.some((option) => canonical(option) === canonical(["apiKey"])))) {
    fail("Live Homarr does not expose the Paperless apiKey contract");
  }
  const board = exactBoard(await client.query("board.getAllBoards"),
    await client.query("board.getBoardByName", { name: input.homarr.boardName }), input.homarr.boardName);
  const settings = await client.query("board.getBoardSettings", { id: board.id });
  if (!record(settings) || settings.id !== board.id || settings.name !== board.name) fail("Homarr key cannot prove board modification access");
  const apps = await client.query("app.all");
  if (!Array.isArray(apps)) fail("Homarr app inventory is invalid");
  const matches = apps.filter((app) => record(app) && app.name === input.paperless.appName);
  if (matches.length !== 1 || !record(matches[0]) || typeof matches[0].id !== "string") fail("Exactly one Paperless app must exist");
  const app = matches[0];
  if (board.items.filter((item) => item.kind === "app" && record(item.options) && item.options.appId === app.id).length !== 1) {
    fail("Exactly one Paperless app tile must exist on the private board");
  }
  const integration = integrationFrom(await client.query("integration.all"), input);
  if (integration !== null) {
    const detail = await client.query("integration.byId", { id: integration.id });
    if (!record(detail) || !record(detail.app) || detail.app.id !== app.id || detail.kind !== "paperlessNgx"
      || detail.url !== input.paperless.url || !Array.isArray(detail.secrets)
      || canonical(detail.secrets.map((secret: unknown) => record(secret) ? secret.kind : null)) !== canonical(["apiKey"])) {
      fail("Existing Paperless integration is not linked to this app and one apiKey secret");
    }
  }
  return { board, app, integration, widget: widgetFrom(board, integration ? String(integration.id) : null) };
}
function approval(input: Input, state: State, homarrKey: string, paperlessKey: string): string {
  const fingerprint = (prefix: string, secret: string) => createHash("sha256").update(prefix).update(secret).digest("hex");
  const snapshot = { input, board: state.board, app: state.app, integration: state.integration,
    widget: state.widget, size, homarrKey: fingerprint("homarr\0", homarrKey),
    paperlessKey: fingerprint("paperless\0", paperlessKey) };
  return `ATTACH-PAPERLESS:${state.board.id}:${createHash("sha256").update(canonical(snapshot)).digest("hex")}`;
}
function preserve(before: Board, after: Board): void {
  if (before.id !== after.id || before.name !== after.name || after.isPublic !== false
    || canonical(before.sections) !== canonical(after.sections)) fail("Homarr board changed; re-plan");
  for (const item of before.items) {
    const matches = after.items.filter((candidate) => candidate.id === item.id);
    if (matches.length !== 1 || canonical(matches[0]) !== canonical(item)) fail("Homarr board items changed; re-plan");
  }
}
function stats(value: unknown): Record<string, number> {
  if (!record(value)) fail("Paperless live stats response is invalid");
  const fields = ["documentsTotal", "documentsInbox", "correspondentsCount", "tagsCount", "documentTypesCount"];
  const result: Record<string, number> = {};
  for (const field of fields) {
    const count = value[field];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) fail("Paperless live stats response is invalid");
    result[field] = count;
  }
  return result;
}
function failure(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  if (error.message.includes("endpoint did not respond")) return "homarr-network";
  if (error.message.includes("HTTP ")) return "homarr-or-paperless-endpoint";
  return "stats-response";
}
function output(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

export async function homarrPaperlessCommand(args: string[]): Promise<void> {
  const action = args[0];
  if (!action || !["plan", "apply", "status"].includes(action)) fail("Use homarr attach paperless plan, apply, or status");
  const flags: Record<string, string> = {};
  const allowed = new Set(["--input", "--api-key-file", "--paperless-api-key-file", "--approve"]);
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || flags[name] || !value || value.startsWith("--")) fail("Invalid or repeated Paperless attachment option");
    flags[name] = value;
  }
  if (!flags["--input"] || !flags["--api-key-file"] || !flags["--paperless-api-key-file"])
    fail("Paperless attachment needs input, Homarr key file, and Paperless token file");
  if ((action === "apply") !== Boolean(flags["--approve"])) fail("Only apply accepts the exact plan approval");
  let parsed: unknown;
  try { parsed = JSON.parse(await privateFile(flags["--input"], 32 * 1024)); }
  catch { fail("Paperless attachment input is not valid JSON or a safe owner-only file"); }
  const input = validateInput(parsed);
  const homarrKey = parseHomarrApiKey(await privateFile(flags["--api-key-file"], 32 * 1024));
  const paperlessKey = await privateFile(flags["--paperless-api-key-file"], 4096);
  if (!/^[0-9a-f]{40}$/.test(paperlessKey)) fail("Paperless token file does not contain one raw API token");
  const client = new HomarrAttachClient(input.homarr.origin, homarrKey);
  let state: State;
  try { state = await read(client, input); }
  catch (error) {
    if (action !== "status" || failure(error) === "stats-response") throw error;
    output({ status: "attachment-unverified", mutation: false, liveStats: "not-checked", failure: failure(error) });
    return;
  }
  const current = state.integration !== null && state.widget !== null;
  if (action === "plan") {
    if (state.integration !== null) {
      try { stats(await client.query("widget.paperlessNgx.getStats", { integrationId: state.integration.id })); }
      catch { fail("Existing Paperless integration cannot read live stats; inspect its saved API key before adding a widget"); }
    }
    output({ status: "pass", mutation: false, board: { id: state.board.id, name: state.board.name, private: true },
      integration: { kind: "paperlessNgx", name: input.paperless.integrationName, url: input.paperless.url,
        id: state.integration?.id ?? null, secretKinds: ["apiKey"] },
      widget: { kind: "paperlessNgx", id: state.widget?.id ?? null, newItemSize: size },
      alreadyCurrent: current, approval: approval(input, state, homarrKey, paperlessKey),
      mutations: ["Create one tested native Paperless integration linked to the existing app if absent.",
        "Add one Paperless widget to the existing private board if absent."] });
    return;
  }
  if (action === "status") {
    if (!current) { output({ status: "needs-attachment", mutation: false, integrationId: state.integration?.id ?? null,
      widgetId: state.widget?.id ?? null, liveStats: "not-checked" }); return; }
    try {
      const live = stats(await client.query("widget.paperlessNgx.getStats", { integrationId: state.integration!.id }));
      output({ status: "attached", mutation: false, integrationId: state.integration!.id, widgetId: state.widget!.id,
        liveStats: "verified", stats: live });
    } catch (error) {
      output({ status: "attached-live-unverified", mutation: false, integrationId: state.integration!.id,
        widgetId: state.widget!.id, liveStats: "unverified", failure: failure(error) });
    }
    return;
  }
  if (flags["--approve"] !== approval(input, state, homarrKey, paperlessKey)) fail("Paperless approval is stale; re-plan");
  if (current) {
    const live = stats(await client.query("widget.paperlessNgx.getStats", { integrationId: state.integration!.id }));
    output({ status: "already-attached", mutation: false, integrationId: state.integration!.id,
      widgetId: state.widget!.id, liveStats: "verified", stats: live });
    return;
  }
  let integration = state.integration;
  if (integration === null) {
    let result: unknown;
    try {
      result = await client.mutate("integration.create", { name: input.paperless.integrationName,
        url: input.paperless.url, kind: "paperlessNgx", secrets: [{ kind: "apiKey", value: paperlessKey }],
        attemptSearchEngineCreation: false, app: { id: state.app.id } });
    } catch { /* The response may be lost after commit; reconcile exact state below. */ }
    if (record(result) && Object.hasOwn(result, "error")) fail("Paperless integration connection test failed; no widget was added");
    if (result !== undefined && (!record(result) || !record(result.integration)
      || result.integration.kind !== "paperlessNgx" || result.integration.name !== input.paperless.integrationName
      || result.integration.url !== input.paperless.url || result.appId !== state.app.id)) {
      fail("Homarr returned an unexpected Paperless integration result; no widget was added");
    }
    integration = integrationFrom(await client.query("integration.all"), input);
    if (integration === null) fail("Paperless integration was not persisted; inspect before retrying");
    const detail = await client.query("integration.byId", { id: integration.id });
    if (!record(detail) || !record(detail.app) || detail.app.id !== state.app.id) fail("Created Paperless integration has the wrong app link");
  }
  try { stats(await client.query("widget.paperlessNgx.getStats", { integrationId: integration.id })); }
  catch { fail("Paperless integration cannot read live stats; no widget was added"); }
  let board = exactBoard(await client.query("board.getAllBoards"),
    await client.query("board.getBoardByName", { name: input.homarr.boardName }), input.homarr.boardName);
  preserve(state.board, board);
  let widget = widgetFrom(board, String(integration.id));
  if (widget === null) {
    try { await client.mutate("board.addItem", { boardId: board.id, kind: "paperlessNgx",
      options: {}, integrationIds: [integration.id], size }); }
    catch { /* Reconcile a possibly committed placement. */ }
    board = exactBoard(await client.query("board.getAllBoards"),
      await client.query("board.getBoardByName", { name: input.homarr.boardName }), input.homarr.boardName);
    preserve(state.board, board);
    widget = widgetFrom(board, String(integration.id));
    if (widget === null) fail("Paperless widget was not persisted; inspect before retrying");
  }
  if (board.items.length !== state.board.items.length + (state.widget === null ? 1 : 0))
    fail("Homarr board gained unexpected items; inspect before retrying");
  const live = stats(await client.query("widget.paperlessNgx.getStats", { integrationId: integration.id }));
  output({ status: "attached", mutation: true,
    boardUrl: `${input.homarr.origin}/boards/${encodeURIComponent(input.homarr.boardName)}`,
    integrationId: integration.id, widgetId: widget.id, boardPreserved: true, liveStats: "verified", stats: live });
}
