import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { HomarrAttachClient, parseHomarrApiKey } from "./homarr-attach.ts";

type WidgetKind = "immich-serverStats" | "immich-albumCarousel";
type Widget = { kind: WidgetKind; options: Record<string, unknown> };
export type HomarrImmichInput = {
  schemaVersion: 1;
  homarr: { origin: string; boardName: string };
  immich: { appName: string; integrationName: string; url: string; widgets: Widget[] };
};
type Board = { id: string; name: string; isPublic: false; sections: Record<string, unknown>[]; items: Record<string, unknown>[];
  layouts?: Record<string, unknown>[] };
type Client = HomarrAttachClient;

const maxResponseFileBytes = 32 * 1024;
const boardNamePattern = /^[A-Za-z0-9-_]{1,255}$/;
const evidenceReferencePattern = /^[a-z0-9][a-z0-9._:/-]{2,127}$/i;
const statsSize = { width: 4, height: 2 };

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
function url(value: unknown, label: string, originOnly = false): string {
  const raw = text(value, label, 2048);
  let parsed: URL;
  try { parsed = new URL(raw); } catch { fail(`${label} must be an absolute URL`); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail(`${label} must be a credential-free HTTP(S) URL without query or fragment`);
  }
  if (originOnly && (parsed.pathname !== "/" || parsed.origin !== raw.replace(/\/$/, ""))) fail(`${label} must be an exact origin`);
  if (parsed.protocol === "http:" && !privateHost(parsed.hostname)) fail(`${label} needs HTTPS unless private or loopback`);
  if (originOnly) return parsed.origin;
  return parsed.href;
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
function validateOptions(kind: WidgetKind, value: unknown): Record<string, unknown> {
  if (!record(value)) fail(`${kind} options must be an object`);
  if (kind === "immich-serverStats") {
    if (!exactKeys(value, ["showUsers", "showPhotos", "showVideos", "showStorage"]) || Object.values(value).some((item) => typeof item !== "boolean")) {
      fail("immich-serverStats options must contain only the four supported boolean visibility fields");
    }
    return value;
  }
  if (!exactKeys(value, ["albumId", "rotationIntervalSeconds", "showPhotoInfo", "randomizePhotos"])) {
    fail("immich-albumCarousel options contain unsupported fields");
  }
  if (typeof value.albumId !== "string" || value.albumId.length < 1 || value.albumId.length > 128 || /[\u0000-\u001f\u007f]/.test(value.albumId)) {
    fail("immich-albumCarousel albumId is invalid");
  }
  if (!Number.isInteger(value.rotationIntervalSeconds) || Number(value.rotationIntervalSeconds) < 1 || Number(value.rotationIntervalSeconds) > 3600
    || typeof value.showPhotoInfo !== "boolean" || typeof value.randomizePhotos !== "boolean") {
    fail("immich-albumCarousel options are invalid");
  }
  return value;
}
function validateInput(value: unknown): HomarrImmichInput {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "homarr", "immich"]) || value.schemaVersion !== 1
    || !record(value.homarr) || !exactKeys(value.homarr, ["origin", "boardName"])
    || !record(value.immich) || !exactKeys(value.immich, ["appName", "integrationName", "url", "widgets"])) {
    fail("Homarr Immich input schema is invalid");
  }
  const origin = url(value.homarr.origin, "homarr.origin", true);
  const boardName = text(value.homarr.boardName, "homarr.boardName", 255);
  if (!boardNamePattern.test(boardName)) fail("homarr.boardName contains unsupported characters");
  if (!Array.isArray(value.immich.widgets) || value.immich.widgets.length < 1 || value.immich.widgets.length > 2) {
    fail("Select one or both supported Immich widgets");
  }
  const widgets = value.immich.widgets.map((candidate): Widget => {
    if (!record(candidate) || !exactKeys(candidate, ["kind", "options"])
      || (candidate.kind !== "immich-serverStats" && candidate.kind !== "immich-albumCarousel")) {
      fail("Immich widget selection is unsupported");
    }
    return { kind: candidate.kind, options: validateOptions(candidate.kind, candidate.options) };
  });
  if (new Set(widgets.map((widget) => widget.kind)).size !== widgets.length) fail("Immich widget kinds must be unique");
  return { schemaVersion: 1, homarr: { origin, boardName }, immich: {
    appName: text(value.immich.appName, "immich.appName", 64),
    integrationName: text(value.immich.integrationName, "immich.integrationName", 127),
    url: url(value.immich.url, "immich.url"), widgets,
  } };
}
async function ownerFile(path: string): Promise<string> {
  if (!isAbsolute(path) || resolve(path) !== path) fail("Input file paths must be exact and absolute");
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o777) !== 0o600
    || await realpath(path) !== path || metadata.size < 1 || metadata.size > maxResponseFileBytes) {
    fail("Input files must be owner-only regular files (0600) without links");
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail("Input file has a different owner");
  return await readFile(path, "utf8");
}
async function jsonFile(path: string, label: string): Promise<unknown> {
  try { return JSON.parse(await ownerFile(path)); } catch { fail(`${label} is not valid JSON or a safe owner-only file`); }
}
function validateAcceptance(value: unknown, input: HomarrImmichInput): void {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "kind", "service", "integrationUrl", "status", "checks"])
    || value.schemaVersion !== 1 || value.kind !== "immich-service-acceptance" || value.service !== "immich" || value.status !== "accepted"
    || !Array.isArray(value.checks)) fail("Immich acceptance evidence is incomplete or invalid");
  if (value.integrationUrl !== input.immich.url) fail("Immich acceptance evidence does not match the selected integration URL");
  const required = ["admin-login", "release-version", "test-image-upload-retrieval"];
  const ids: string[] = [];
  for (const check of value.checks) {
    if (!record(check) || !exactKeys(check, ["id", "status", "evidenceRefs"]) || typeof check.id !== "string" || check.status !== "pass"
      || !Array.isArray(check.evidenceRefs) || check.evidenceRefs.length < 1
      || check.evidenceRefs.some((reference) => typeof reference !== "string" || !evidenceReferencePattern.test(reference))) {
      fail("Immich acceptance evidence contains a missing or non-passing check");
    }
    ids.push(check.id);
  }
  if (canonical([...ids].sort()) !== canonical(required)) fail("Immich acceptance evidence is incomplete");
}
export function parseImmichApiKey(contents: string): string {
  let key = contents;
  if (key.endsWith("\r\n")) key = key.slice(0, -2);
  else if (key.endsWith("\n")) key = key.slice(0, -1);
  if (key.length < 1 || key.length > 4096 || key.trim() !== key || /[\u0000-\u001f\u007f]/.test(key)
    || /^[A-Z][A-Z0-9_]*=/.test(key)) {
    fail("Immich API key file must contain one bounded raw key, not an environment assignment");
  }
  return key;
}
function keyFingerprint(label: "homarr" | "immich", key: string): string {
  return createHash("sha256").update(`selfhost-${label}-key\0`).update(key).digest("hex");
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
  if (matches.length !== 1 || !record(matches[0]) || typeof matches[0].id !== "string") fail("Exactly one existing Homarr app must match Immich");
  const tiles = board.items.filter((item) => item.kind === "app" && record(item.options) && item.options.appId === matches[0].id);
  if (tiles.length !== 1) fail("The accepted Immich service must already have exactly one app tile on the selected board");
  return matches[0];
}
function supportedKinds(value: unknown): void {
  if (!Array.isArray(value)) fail("Homarr integration kinds are invalid");
  const matches = value.filter((entry) => record(entry) && entry.kind === "immich");
  if (matches.length !== 1 || !record(matches[0]) || canonical(matches[0].requiredSecrets) !== canonical([["apiKey"]])) {
    fail("Live Homarr does not expose the supported Immich apiKey integration contract");
  }
}
function findIntegration(value: unknown, input: HomarrImmichInput): Record<string, unknown> | null {
  if (!Array.isArray(value)) fail("Homarr integration inventory is invalid");
  const conflicts = value.filter((entry) => record(entry) && entry.name === input.immich.integrationName);
  if (conflicts.length === 0) return null;
  if (conflicts.length !== 1 || !record(conflicts[0]) || typeof conflicts[0].id !== "string" || conflicts[0].kind !== "immich"
    || conflicts[0].name !== input.immich.integrationName || conflicts[0].url !== input.immich.url
    || !record(conflicts[0].permissions) || conflicts[0].permissions.hasFullAccess !== true || conflicts[0].permissions.hasUseAccess !== true) {
    fail("An existing Immich integration conflicts with the requested exact integration or permissions");
  }
  return conflicts[0];
}
function matchingWidgets(board: Board, integrationId: string, selected: Widget[]): Record<string, unknown>[] {
  const selectedKinds = new Set(selected.map((widget) => widget.kind));
  const candidates = board.items.filter((item) => selectedKinds.has(item.kind as WidgetKind));
  for (const candidate of candidates) {
    const expected = selected.find((widget) => widget.kind === candidate.kind);
    if (!expected || canonical(candidate.integrationIds) !== canonical([integrationId]) || canonical(candidate.options) !== canonical(expected.options)) {
      fail(`Existing ${String(candidate.kind)} widget conflicts with the requested integration or options`);
    }
  }
  for (const widget of selected) {
    if (candidates.filter((item) => item.kind === widget.kind).length > 1) fail(`Duplicate ${widget.kind} widgets require manual repair`);
  }
  return candidates;
}
function validateStats(value: unknown): void {
  const keys = ["photoCount", "totalLibraryUsageInBytes", "userCount", "videoCount"];
  if (!record(value) || !exactKeys(value, keys)
    || keys.some((key) => typeof value[key] !== "number" || !Number.isFinite(value[key]) || Number(value[key]) < 0)) {
    fail("Homarr Immich server stats live response is invalid");
  }
}
function validateAlbums(value: unknown): void {
  if (!Array.isArray(value) || value.length > 1) fail("Homarr Immich albums live response is invalid");
  for (const album of value) {
    if (!record(album) || !exactKeys(album, ["albumName", "assetCount", "id"])
      || typeof album.id !== "string" || typeof album.albumName !== "string"
      || typeof album.assetCount !== "number" || !Number.isInteger(album.assetCount) || album.assetCount < 0) {
      fail("Homarr Immich albums live response is invalid");
    }
  }
}
function validateAlbum(value: unknown, selectedId: string): void {
  if (!record(value) || !exactKeys(value, ["id", "albumName", "assets"])
    || typeof value.id !== "string" || typeof value.albumName !== "string" || !Array.isArray(value.assets)) {
    fail("Homarr Immich carousel live response is invalid");
  }
  if (selectedId !== "all" && value.id !== selectedId) fail("Homarr Immich carousel returned a different album");
  let displayableImages = 0;
  for (const asset of value.assets) {
    if (!record(asset) || typeof asset.id !== "string" || !asset.id
      || typeof asset.type !== "string" || typeof asset.publicLink !== "string") {
      fail("Homarr Immich carousel returned an invalid asset");
    }
    if (asset.type === "IMAGE" && asset.publicLink.length > 0) displayableImages += 1;
  }
  if (displayableImages === 0) fail("Homarr Immich carousel has no displayable image; upload one before claiming the widget is verified");
}
async function verifyLiveWidgets(client: Client, integrationId: string, widgets: Widget[]): Promise<WidgetKind[]> {
  const verified: WidgetKind[] = [];
  for (const widget of widgets) {
    if (widget.kind === "immich-serverStats") {
      validateStats(await client.query("widget.immich.getServerStats", { integrationId }));
    } else {
      validateAlbums(await client.query("widget.immich.getAlbums", { integrationId, limit: 1 }));
      const selectedId = String(widget.options.albumId);
      const albumInput: { integrationId: string; albumId?: string } = { integrationId };
      if (selectedId !== "all") albumInput.albumId = selectedId;
      validateAlbum(await client.query("widget.immich.getAlbum", albumInput), selectedId);
    }
    verified.push(widget.kind);
  }
  return verified;
}
async function read(client: Client, input: HomarrImmichInput) {
  supportedKinds(await client.query("integration.getKinds"));
  const board = exactBoard(await client.query("board.getAllBoards"), await client.query("board.getBoardByName", { name: input.homarr.boardName }), input.homarr.boardName);
  const editable = await client.query("board.getBoardSettings", { id: board.id });
  if (!record(editable) || editable.id !== board.id || editable.name !== board.name) {
    fail("Homarr API key cannot prove modify access to the selected private board");
  }
  const app = exactApp(await client.query("app.all"), board, input.immich.appName);
  const integration = findIntegration(await client.query("integration.all"), input);
  let widgets: Record<string, unknown>[] = [];
  if (integration !== null) {
    const detail = await client.query("integration.byId", { id: integration.id });
    if (!record(detail) || !record(detail.app) || detail.app.id !== app.id || detail.kind !== "immich" || detail.url !== input.immich.url) {
      fail("Existing Immich integration is not linked to the exact app");
    }
    widgets = matchingWidgets(board, String(integration.id), input.immich.widgets);
  } else {
    const selectedKinds = new Set(input.immich.widgets.map((widget) => widget.kind));
    if (board.items.some((item) => selectedKinds.has(item.kind as WidgetKind))) fail("Immich widgets exist without the requested exact integration");
  }
  return { board, app, integration, widgets };
}
function approval(input: HomarrImmichInput, state: Awaited<ReturnType<typeof read>>, acceptance: unknown, keyFingerprints: { homarr: string; immich: string }): string {
  const snapshot = { input, acceptance, keyFingerprints, statsSize, board: state.board, app: state.app, integration: state.integration };
  return `ATTACH-IMMICH:${state.board.id}:${createHash("sha256").update(canonical(snapshot)).digest("hex")}`;
}
function assertBoardPreserved(original: Board, current: Board): void {
  if (original.id !== current.id || original.name !== current.name || current.isPublic !== false || canonical(original.sections) !== canonical(current.sections)) {
    fail("Homarr board changed during Immich attachment; re-plan");
  }
  for (const item of original.items) {
    const matches = current.items.filter((candidate) => candidate.id === item.id);
    if (matches.length !== 1 || canonical(matches[0]) !== canonical(item)) fail("Homarr board data changed during Immich attachment; re-plan");
  }
}
function write(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

function statsLayoutRepair(state: Awaited<ReturnType<typeof read>>): Board {
  const targets = state.widgets.filter((item) => item.kind === "immich-serverStats");
  if (state.integration === null || targets.length !== 1 || typeof targets[0].id !== "string") {
    fail("Stats layout repair requires exactly one selected existing managed Immich stats widget");
  }
  const board = structuredClone(state.board);
  if (!Array.isArray(board.layouts) || board.layouts.length === 0) fail("Stats layout repair needs board layout definitions");
  if (board.sections.length !== 1 || board.sections[0].kind !== "empty"
    || board.sections[0].xOffset !== 0 || board.sections[0].yOffset !== 0) {
    fail("Stats layout repair requires one empty main section; use the checked browser fallback");
  }
  const definitions = new Map<string, number>();
  for (const layout of board.layouts) {
    if (typeof layout.id !== "string" || definitions.has(layout.id)
      || !Number.isInteger(layout.columnCount) || !Number.isInteger(layout.leftGutterColumnCount)
      || !Number.isInteger(layout.rightGutterColumnCount)) fail("Stats layout repair board layout is invalid");
    const columns = Number(layout.columnCount) - Number(layout.leftGutterColumnCount) - Number(layout.rightGutterColumnCount);
    if (columns < 1) fail("Stats layout repair board has no usable columns");
    definitions.set(layout.id, columns);
  }
  const ids = new Set<string>();
  for (const item of board.items) {
    if (typeof item.id !== "string" || ids.has(item.id) || !Array.isArray(item.layouts)
      || item.layouts.length !== definitions.size) fail("Stats layout repair item layout coverage is invalid");
    ids.add(item.id);
    const seen = new Set<string>();
    for (const layout of item.layouts) {
      if (!record(layout) || typeof layout.layoutId !== "string" || seen.has(layout.layoutId)
        || !definitions.has(layout.layoutId) || typeof layout.sectionId !== "string"
        || ![layout.xOffset, layout.yOffset, layout.width, layout.height].every(Number.isInteger)
        || Number(layout.xOffset) < 0 || Number(layout.yOffset) < 0 || Number(layout.width) < 1 || Number(layout.height) < 1
        || Number(layout.xOffset) + Number(layout.width) > definitions.get(layout.layoutId)!
        || layout.sectionId !== board.sections[0].id) {
        fail("Stats layout repair item layout is invalid");
      }
      seen.add(layout.layoutId);
    }
  }
  const target = board.items.find((item) => item.id === targets[0].id)!;
  for (const layout of target.layouts as Record<string, unknown>[]) {
    const sections = board.sections.filter((entry) => entry.id === layout.sectionId);
    const section = sections[0];
    // This bounded repair moves only the target when expansion needs a free tail.
    if (sections.length !== 1 || !section || section.kind !== "empty" || section.xOffset !== 0 || section.yOffset !== 0
      || board.sections.some((entry) => entry.kind !== "empty")) {
      fail("Stats layout repair requires a main empty section without containers; use the checked browser fallback");
    }
    const width = Math.min(Math.max(Number(layout.width), statsSize.width), definitions.get(String(layout.layoutId))!);
    const height = Math.max(Number(layout.height), statsSize.height);
    let needsTail = Number(layout.xOffset) + width > definitions.get(String(layout.layoutId))!;
    let tail = 0;
    for (const item of board.items) {
      if (item.id === target.id) continue;
      for (const other of item.layouts as Record<string, unknown>[]) {
        if (other.layoutId !== layout.layoutId || other.sectionId !== layout.sectionId) continue;
        tail = Math.max(tail, Number(other.yOffset) + Number(other.height));
        if (Number(layout.xOffset) < Number(other.xOffset) + Number(other.width)
          && Number(other.xOffset) < Number(layout.xOffset) + width
          && Number(layout.yOffset) < Number(other.yOffset) + Number(other.height)
          && Number(other.yOffset) < Number(layout.yOffset) + height) {
          needsTail = true;
        }
      }
    }
    layout.width = width;
    layout.height = height;
    if (needsTail) {
      layout.xOffset = 0;
      layout.yOffset = tail;
    }
  }
  return board;
}

export async function homarrImmichCommand(args: string[]): Promise<void> {
  const action = args[0];
  if (!action || !["plan", "apply", "status", "layout-plan", "layout-apply"].includes(action)) fail("Use homarr attach immich plan, apply, status, layout-plan, or layout-apply");
  const flags: Record<string, string> = {};
  const valid = new Set(["--input", "--api-key-file", "--immich-api-key-file", "--acceptance-file", "--approve"]);
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!valid.has(name) || flags[name] || !value || value.startsWith("--")) fail(`Invalid or repeated Homarr Immich option: ${name ?? "(missing)"}`);
    flags[name] = value;
  }
  for (const required of ["--input", "--api-key-file", "--immich-api-key-file", "--acceptance-file"]) {
    if (!flags[required]) fail(`Homarr Immich attachment needs ${required}`);
  }
  const applying = action === "apply" || action === "layout-apply";
  if (applying && !flags["--approve"]) fail("Homarr Immich apply needs the exact approval from its matching plan");
  if (!applying && flags["--approve"]) fail("Only Homarr Immich apply or layout-apply accepts --approve");
  const input = validateInput(await jsonFile(flags["--input"], "Homarr Immich input"));
  const acceptance = await jsonFile(flags["--acceptance-file"], "Immich acceptance evidence");
  validateAcceptance(acceptance, input);
  const homarrKey = parseHomarrApiKey(await ownerFile(flags["--api-key-file"]));
  const immichKey = parseImmichApiKey(await ownerFile(flags["--immich-api-key-file"]));
  const keyFingerprints = { homarr: keyFingerprint("homarr", homarrKey), immich: keyFingerprint("immich", immichKey) };
  const client = new HomarrAttachClient(input.homarr.origin, homarrKey);
  const state = await read(client, input);
  if (action === "layout-plan" || action === "layout-apply") {
    const desired = statsLayoutRepair(state);
    const digest = createHash("sha256").update(canonical({
      attachmentApproval: approval(input, state, acceptance, keyFingerprints), desired,
    })).digest("hex");
    const token = `RESIZE-IMMICH-STATS:${state.board.id}:${digest}`;
    const changes = desired.items.filter((item) => item.kind === "immich-serverStats").map((item) => ({ id: item.id, layouts: item.layouts }));
    const current = canonical(state.board) === canonical(desired);
    if (action === "layout-plan") {
      write({ status: "pass", mutation: false, approval: token, alreadyCurrent: current, changes,
        scope: "Only the exact selected managed Immich stats widget dimensions and, if necessary, its position at the free section tail; all other board data is preserved." });
      return;
    }
    if (flags["--approve"] !== token) fail("Stats layout approval no longer matches the exact board snapshot; re-plan");
    const fresh = await read(client, input);
    if (canonical(fresh) !== canonical(state)) fail("Homarr board or integration changed before stats layout repair; re-plan");
    if (!current) {
      try { await client.mutate("board.saveBoard", { id: desired.id, sections: desired.sections, items: desired.items }); }
      catch { /* Reconcile only the exact expected snapshot after a possibly committed save. */ }
      const after = await read(client, input);
      if (after.board.id !== desired.id || after.board.name !== desired.name || after.board.isPublic !== false
        || canonical(after.board.sections) !== canonical(desired.sections)
        || canonical(after.board.items) !== canonical(desired.items)
        || canonical(after.board.layouts) !== canonical(desired.layouts)
        || canonical(after.app) !== canonical(state.app) || canonical(after.integration) !== canonical(state.integration)) {
        fail("Stats layout repair did not preserve the exact expected board and integration; inspect before retrying");
      }
    }
    write({ status: "stats-layout-current", mutation: !current, boardPreserved: true, changes });
    return;
  }
  const current = state.integration !== null && state.widgets.length === input.immich.widgets.length;
  if (action === "plan") {
    write({ status: "pass", mutation: false, board: { id: state.board.id, name: state.board.name, private: true },
      integration: { kind: "immich", name: input.immich.integrationName, url: input.immich.url, id: state.integration?.id ?? null },
      widgets: input.immich.widgets.map((widget) => {
        const result: Record<string, unknown> = { kind: widget.kind, alreadyCurrent: state.widgets.some((item) => item.kind === widget.kind) };
        if (widget.kind === "immich-serverStats") result.newItemSize = statsSize;
        return result;
      }),
      alreadyCurrent: current, approval: approval(input, state, acceptance, keyFingerprints),
      mutations: ["Create one tested native Immich integration linked to the existing app if absent.", "Add only missing selected Immich widgets to the existing private board."],
    });
    return;
  }
  if (action === "status") {
    let status = "needs-attachment";
    if (current) status = "attached";
    let liveWidgetKinds: WidgetKind[] = [];
    if (current && state.integration !== null) {
      try { liveWidgetKinds = await verifyLiveWidgets(client, String(state.integration.id), input.immich.widgets); }
      catch { status = "attached-live-unverified"; }
    }
    write({ status, mutation: false, integrationId: state.integration?.id ?? null,
      widgetKinds: state.widgets.map((item) => item.kind), liveWidgetKinds, integrationVerified: liveWidgetKinds.length === input.immich.widgets.length,
      boardPreserved: true, serviceAcceptanceRecorded: true });
    return;
  }
  if (flags["--approve"] !== approval(input, state, acceptance, keyFingerprints)) fail("Homarr Immich approval no longer matches this exact board, integration, acceptance, and credential state; re-plan");
  if (current) {
    const liveWidgetKinds = await verifyLiveWidgets(client, String(state.integration?.id), input.immich.widgets);
    write({ status: "already-attached", integrationId: state.integration?.id, widgetIds: state.widgets.map((item) => item.id),
      liveWidgetKinds, integrationVerified: true, boardPreserved: true, serviceAcceptanceRecorded: true });
    return;
  }
  let integration = state.integration;
  if (integration === null) {
    try {
      await client.mutate("integration.create", { name: input.immich.integrationName, url: input.immich.url, kind: "immich",
        secrets: [{ kind: "apiKey", value: immichKey }], attemptSearchEngineCreation: false, app: { id: state.app.id } });
    } catch {
      // A committed create can lose its response; reconcile only the exact integration below.
    }
    integration = findIntegration(await client.query("integration.all"), input);
    if (integration === null) fail("Homarr integration.create did not persist the exact tested Immich integration; no widget was added");
    const detail = await client.query("integration.byId", { id: integration.id });
    if (!record(detail) || !record(detail.app) || detail.app.id !== state.app.id) fail("Created Immich integration did not link to the exact existing app; no widget was added");
  }
  let board = exactBoard(await client.query("board.getAllBoards"), await client.query("board.getBoardByName", { name: input.homarr.boardName }), input.homarr.boardName);
  assertBoardPreserved(state.board, board);
  let widgets = matchingWidgets(board, String(integration.id), input.immich.widgets);
  for (const widget of input.immich.widgets) {
    if (widgets.some((item) => item.kind === widget.kind)) continue;
    const configuration: Record<string, unknown> = { boardId: board.id, kind: widget.kind, options: widget.options, integrationIds: [integration.id] };
    if (widget.kind === "immich-serverStats") configuration.size = statsSize;
    try { await client.mutate("board.addItem", configuration); }
    catch { /* Reconcile the exact item after a possibly committed write. */ }
    board = exactBoard(await client.query("board.getAllBoards"), await client.query("board.getBoardByName", { name: input.homarr.boardName }), input.homarr.boardName);
    assertBoardPreserved(state.board, board);
    widgets = matchingWidgets(board, String(integration.id), input.immich.widgets);
    if (!widgets.some((item) => item.kind === widget.kind)) fail(`Homarr board.addItem did not persist ${widget.kind}; inspect before retrying`);
  }
  if (board.items.length !== state.board.items.length + input.immich.widgets.length - state.widgets.length) {
    fail("Homarr board gained unexpected items during Immich attachment; inspect before retrying");
  }
  const liveWidgetKinds = await verifyLiveWidgets(client, String(integration.id), input.immich.widgets);
  write({ status: "attached", boardUrl: `${input.homarr.origin}/boards/${encodeURIComponent(input.homarr.boardName)}`,
    integrationId: integration.id, widgetIds: widgets.map((item) => item.id), widgetKinds: widgets.map((item) => item.kind),
    liveWidgetKinds, integrationVerified: true, boardPreserved: true, serviceAcceptanceRecorded: true });
}
