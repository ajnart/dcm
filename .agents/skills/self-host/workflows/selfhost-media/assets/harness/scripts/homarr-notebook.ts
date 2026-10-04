#!/usr/bin/env bun

import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { recapHeight } from "./lib/homarr-recap-layout.ts";
import {
  loadHomarrApiKey,
  loadSession,
  requireSessionPasswordScheme,
  sessionAccess,
  writeBoardAccessMetadata,
} from "./lib/session-context.ts";

export const NOTEBOOK_MARKER = "Your homelab at a glance";
export const ADDITIONAL_SERVICES_START = "<!-- selfhost-additional-services:start -->";
export const ADDITIONAL_SERVICES_END = "<!-- selfhost-additional-services:end -->";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_ADDITIONAL_SERVICES_BYTES = 32 * 1024;
const NOTEBOOK_WIDTH = 8;

function fail(message) { throw new Error(message); }
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function servicePurpose(service) {
  return {
    prowlarr: "Connect authorized download sources", radarr: "Organize movies", sonarr: "Organize TV series",
    qbittorrent: "Download authorized media", jellyfin: "Watch your media",
    seerr: "Choose movies and shows", homarr: "Your dashboard and agent gateway",
  }[service];
}
function serviceName(service) {
  return {
    prowlarr: "Prowlarr", radarr: "Radarr", sonarr: "Sonarr", qbittorrent: "qBittorrent",
    jellyfin: "Jellyfin", seerr: "Seerr", homarr: "Homarr",
  }[service];
}

export function notebookContent(session) {
  const access = sessionAccess(session);
  let exposureNote = "Media ports are published on all host interfaces; check firewall reachability before sharing access.";
  if (access.exposure === "local") {
    exposureNote = "Media ports are bound to this host only; use a verified private route or the SSH tunnel below from another device.";
  } else if (access.bindAddress !== "0.0.0.0") {
    exposureNote = `Media ports are bound to the selected private address ${access.bindAddress}; check firewall and client reachability before sharing access.`;
  }
  const rows = Object.entries(access.services).map(([service, routes]) => {
    let href = routes.browserUrl;
    let accessLabel = "this host";
    if (routes.reachableUrl !== null) {
      href = routes.reachableUrl;
      accessLabel = "private route; client not verified";
    }
    return `<li><strong><a href="${escapeHtml(href)}">${escapeHtml(serviceName(service))}</a></strong> — ${escapeHtml(servicePurpose(service))} <small>(${escapeHtml(accessLabel)})</small></li>`;
  });
  return [
    `<h2>${NOTEBOOK_MARKER}</h2><p>${escapeHtml(exposureNote)}</p>`,
    `<h3>Services</h3><ul>${rows.join("")}</ul>`,
    "<h3>Request a movie</h3><p>Press Ctrl+K in Homarr, choose Seerr media requests, verify the exact title and year, then request only authorized content. Approved movies go to Radarr; downloads require an authorized Prowlarr source.</p>",
    "<h3>Operate safely</h3><ul>",
    "<li><strong>Access:</strong> Services without a private route need a verified private connection or SSH tunnel.</li>",
    `<li><strong>Storage:</strong> In media run <code>${escapeHtml(session.runId)}</code>: settings in <code>config/</code>, media/downloads in <code>data/</code>, saved credentials in <code>artifacts/private-handoff.json</code>. Ask your agent for the exact path.</li>`,
    "<li><strong>Recovery:</strong> Backups are not configured or verified.</li>",
    "<li><strong>MCP:</strong> Keep Homarr MCP private. Its default bridge searches and shows status; a request needs confirmation for the exact authorized title.</li>",
    "<li>Tiles open apps; integrations and widgets need separate checks. Additional services appear in the companion note.</li>",
    "<li><strong>Pending:</strong> Select and configure an authorized indexer and download sources.</li></ul>",
  ].join("");
}

function unwrapTrpcResponse(payload) {
  if (!isRecord(payload) || !isRecord(payload.result) || !isRecord(payload.result.data) || !Object.hasOwn(payload.result.data, "json")) {
    fail("Homarr API returned an invalid response");
  }
  return payload.result.data.json;
}

export class HomarrBoardApiClient {
  constructor(session, apiKey, options = {}) {
    this.baseUrl = `http://127.0.0.1:${session.manifest.HOMARR_PORT}/api/trpc`;
    this.apiKey = apiKey;
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  }
  async request(procedure, input, mutation = false) {
    if (typeof this.fetchImplementation !== "function") fail("fetch is unavailable");
    let encodedInput;
    if (input !== undefined) encodedInput = JSON.stringify({ json: input });
    let url = `${this.baseUrl}/${procedure}`;
    const requestOptions = { method: mutation ? "POST" : "GET", headers: { Accept: "application/json", ApiKey: this.apiKey }, redirect: "manual" };
    if (mutation) {
      if (encodedInput === undefined) fail("Homarr API mutation input is required");
      requestOptions.headers["Content-Type"] = "application/json";
      requestOptions.body = encodedInput;
    } else if (encodedInput !== undefined) {
      url += `?input=${encodeURIComponent(encodedInput)}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let response;
    let body;
    try {
      response = await this.fetchImplementation(url, { ...requestOptions, signal: controller.signal });
      body = await response.text();
    } catch { fail("Homarr API did not respond"); }
    finally { clearTimeout(timeout); }
    if (!response.ok || Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) fail("Homarr API request failed");
    let payload;
    try { payload = JSON.parse(body); } catch { fail("Homarr API returned invalid JSON"); }
    return unwrapTrpcResponse(payload);
  }
  query(procedure, input) { return this.request(procedure, input, false); }
  mutate(procedure, input) { return this.request(procedure, input, true); }
}

function exactPrivateBoard(boards, boardName) {
  if (!Array.isArray(boards)) fail("Homarr board list is invalid");
  const matches = boards.filter((board) => isRecord(board) && board.name === boardName);
  if (matches.length !== 1 || typeof matches[0].id !== "string") fail("exactly one accessible board must match BOARD_NAME");
  if (matches[0].isPublic !== false) fail("the selected board must be private");
  return matches[0];
}

function managedNotebook(board) {
  if (!isRecord(board) || !Array.isArray(board.items)) fail("Homarr board detail is unavailable");
  const marked = board.items.filter((item) => isRecord(item) && isRecord(item.options)
    && typeof item.options.content === "string" && item.options.content.includes(NOTEBOOK_MARKER));
  if (marked.length === 0) return null;
  if (marked.length !== 1) fail("the board contains conflicting homelab summary markers");
  const item = marked[0];
  if (item.kind !== "notebook" || typeof item.id !== "string") fail("the board contains a conflicting homelab summary notebook");
  return item;
}

function preservedAdditionalServices(notebook) {
  if (notebook === null) return "";
  const content = notebook.options.content;
  const startCount = content.split(ADDITIONAL_SERVICES_START).length - 1;
  const endCount = content.split(ADDITIONAL_SERVICES_END).length - 1;
  if (startCount === 0 && endCount === 0) return "";
  if (startCount !== 1 || endCount !== 1) fail("Homarr additional-services markers are invalid");
  const start = content.indexOf(ADDITIONAL_SERVICES_START);
  const end = content.indexOf(ADDITIONAL_SERVICES_END);
  if (end <= start + ADDITIONAL_SERVICES_START.length) fail("Homarr additional-services block is invalid");
  const block = content.slice(start, end + ADDITIONAL_SERVICES_END.length);
  if (Buffer.byteLength(block, "utf8") > MAX_ADDITIONAL_SERVICES_BYTES) fail("Homarr additional-services block is too large");
  return block;
}

function notebookIsCurrent(item, expectedContent) {
  return item !== null && item.options.content === expectedContent
    && item.options.showToolbar === false && item.options.allowReadOnlyCheck === true;
}

function layoutDimensions(board, current, content) {
  const layout = board.layouts.find((candidate) => candidate.id === current.layoutId);
  if (!isRecord(layout) || !Number.isInteger(layout.columnCount)
    || !Number.isInteger(layout.leftGutterColumnCount) || !Number.isInteger(layout.rightGutterColumnCount)) {
    fail("Homarr board layout is invalid");
  }
  const columnCount = layout.columnCount - layout.leftGutterColumnCount - layout.rightGutterColumnCount;
  if (columnCount < 1 || typeof current.sectionId !== "string"
    || !board.sections.some((section) => isRecord(section) && section.id === current.sectionId)) {
    fail("Homarr notebook layout is invalid");
  }
  const width = Math.max(current.width, Math.min(NOTEBOOK_WIDTH, columnCount));
  return Object.freeze({ columnCount, width, height: recapHeight(content, width) });
}

function notebookLayoutIsReadable(board, notebook, content) {
  if (!Array.isArray(board.layouts) || !Array.isArray(board.sections)
    || !Array.isArray(notebook.layouts) || notebook.layouts.length === 0) {
    fail("Homarr notebook layouts are unavailable");
  }
  const notebookLayoutIds = new Set(notebook.layouts.map((current) => current.layoutId));
  if (notebookLayoutIds.size !== notebook.layouts.length
    || board.layouts.some((layout) => !isRecord(layout) || !notebookLayoutIds.has(layout.id))) {
    fail("Homarr notebook layout coverage is invalid");
  }
  return notebook.layouts.every((current) => {
    const target = layoutDimensions(board, current, content);
    return Number.isInteger(current.xOffset) && Number.isInteger(current.yOffset)
      && Number.isInteger(current.width) && Number.isInteger(current.height)
      && current.xOffset >= 0 && current.yOffset >= 0
      && current.xOffset + current.width <= target.columnCount
      && current.width >= Math.min(NOTEBOOK_WIDTH, target.columnCount) && current.height >= target.height;
  });
}

function rectanglesOverlap(left, right) {
  return left.xOffset < right.xOffset + right.width
    && left.xOffset + left.width > right.xOffset
    && left.yOffset < right.yOffset + right.height
    && left.yOffset + left.height > right.yOffset;
}

function resizedNotebookBoard(board, notebook, content) {
  const nextBoard = structuredClone(board);
  const nextNotebook = nextBoard.items.find((item) => item.id === notebook.id);
  if (!isRecord(nextNotebook) || !Array.isArray(nextNotebook.layouts)) fail("Homarr summary notebook layout is invalid");
  let changed = false;
  for (const current of nextNotebook.layouts) {
    const target = layoutDimensions(nextBoard, current, content);
    if (!Number.isInteger(current.xOffset) || !Number.isInteger(current.yOffset)
      || !Number.isInteger(current.width) || !Number.isInteger(current.height)
      || current.xOffset < 0 || current.yOffset < 0 || current.width < 1 || current.height < 1) {
      fail("Homarr summary notebook layout is invalid");
    }
    const desired = {
      ...current,
      width: target.width,
      height: Math.max(current.height, target.height),
    };
    if (desired.xOffset + desired.width > target.columnCount) {
      fail("Homarr summary notebook cannot be resized safely; use the checked browser layout fallback");
    }
    for (const item of nextBoard.items) {
      if (item.id === nextNotebook.id || !Array.isArray(item.layouts)) continue;
      for (const candidate of item.layouts) {
        if (candidate.layoutId !== desired.layoutId || candidate.sectionId !== desired.sectionId) continue;
        if (!Number.isInteger(candidate.xOffset) || !Number.isInteger(candidate.yOffset)
          || !Number.isInteger(candidate.width) || !Number.isInteger(candidate.height)
          || candidate.xOffset < 0 || candidate.yOffset < 0 || candidate.width < 1 || candidate.height < 1) {
          fail("Homarr board item layout is invalid");
        }
        if (rectanglesOverlap(desired, candidate)) {
          fail("Homarr summary notebook cannot be resized safely; use the checked browser layout fallback");
        }
      }
    }
    if (current.width !== desired.width || current.height !== desired.height) changed = true;
    Object.assign(current, desired);
  }
  if (!changed) return null;
  return nextBoard;
}

function boardSnapshotMatches(actual, expected) {
  if (!isRecord(actual) || actual.id !== expected.id || actual.name !== expected.name
    || actual.isPublic !== expected.isPublic || !Array.isArray(actual.items)
    || !Array.isArray(actual.sections) || !Array.isArray(actual.layouts)) {
    return false;
  }
  return isDeepStrictEqual(actual.items, expected.items)
    && isDeepStrictEqual(actual.sections, expected.sections)
    && isDeepStrictEqual(actual.layouts, expected.layouts);
}

async function ensureReadableNotebookLayout(client, board, notebook, boardName, content) {
  if (notebookLayoutIsReadable(board, notebook, content)) return Object.freeze({ board, changed: false });
  const fresh = await matchingBoardDetail(client, board, boardName);
  if (!boardSnapshotMatches(fresh, board)) {
    fail("Homarr board changed before the notebook resize; refusing a stale whole-board save");
  }
  const freshNotebook = managedNotebook(fresh);
  if (freshNotebook === null) fail("Homarr summary notebook changed before the resize");
  const expected = resizedNotebookBoard(fresh, freshNotebook, content);
  if (expected === null || !notebookLayoutIsReadable(expected, managedNotebook(expected), content)) {
    fail("Homarr summary notebook cannot be resized safely; use the checked browser layout fallback");
  }
  try {
    await client.mutate("board.saveBoard", {
      id: expected.id,
      sections: expected.sections,
      items: expected.items,
    });
  } catch (mutationError) {
    try {
      const reconciled = await matchingBoardDetail(client, board, boardName);
      const reconciledNotebook = managedNotebook(reconciled);
      if (boardSnapshotMatches(reconciled, expected)
        && reconciledNotebook !== null && notebookLayoutIsReadable(reconciled, reconciledNotebook, content)) {
        return Object.freeze({ board: reconciled, changed: true });
      }
    } catch { /* Preserve the original mutation failure. */ }
    throw mutationError;
  }
  const saved = await matchingBoardDetail(client, board, boardName);
  const savedNotebook = managedNotebook(saved);
  if (!boardSnapshotMatches(saved, expected)
    || savedNotebook === null || !notebookLayoutIsReadable(saved, savedNotebook, content)) {
    fail("Homarr summary notebook resize did not persist exactly with a readable layout");
  }
  return Object.freeze({ board: saved, changed: true });
}

async function updateNotebookContent(client, board, notebook, content) {
  await client.mutate("widget.notebook.updateContent", { itemId: notebook.id, boardId: board.id, content });
}

export function configureNotebook(board, boardName, content) {
  if (!isRecord(board) || typeof board.id !== "string" || board.name !== boardName) fail("notebook target board is invalid");
  if (typeof content !== "string" || !content.includes(NOTEBOOK_MARKER)) fail("notebook content is invalid");
  return Object.freeze({
    boardId: board.id,
    kind: "notebook",
    options: Object.freeze({ content, showToolbar: false, allowReadOnlyCheck: true }),
    integrationIds: Object.freeze([]),
    size: Object.freeze({ width: NOTEBOOK_WIDTH, height: recapHeight(content, NOTEBOOK_WIDTH) }),
  });
}

async function matchingBoardDetail(client, board, boardName) {
  const detail = await client.query("board.getBoardByName", { name: boardName });
  if (!isRecord(detail) || detail.id !== board.id || detail.name !== boardName) fail("Homarr board detail does not match the selected board");
  return detail;
}

function stableSnapshot(value) {
  if (Array.isArray(value)) return value.map(stableSnapshot);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableSnapshot(value[key])]));
}

function notebookDigest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableSnapshot(value))).digest("hex")}`;
}

function notebookSnapshot(detail, content) {
  return notebookDigest({ board: { id: detail.id, name: detail.name, isPublic: detail.isPublic,
    items: detail.items, sections: detail.sections, layouts: detail.layouts }, content });
}

/** Exact read-only plan for the owned media recap, never another Notebook. */
export async function planHomelabNotebook(client, session, boardName) {
  if (typeof boardName !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/u.test(boardName)) fail("BOARD_NAME is invalid");
  const board = exactPrivateBoard(await client.query("board.getAllBoards"), boardName);
  const detail = await matchingBoardDetail(client, board, boardName);
  if (detail.isPublic !== false || !Array.isArray(detail.sections) || !Array.isArray(detail.layouts)) fail("private board snapshot is invalid");
  const existing = managedNotebook(detail);
  const content = notebookContent(session) + preservedAdditionalServices(existing);
  if (existing !== null && (existing.options.showToolbar !== false || existing.options.allowReadOnlyCheck !== true)) {
    fail("Homarr summary notebook options require the checked browser fallback");
  }
  let resized = null;
  if (existing !== null) {
    const readable = notebookLayoutIsReadable(detail, existing, content);
    const checkedResize = resizedNotebookBoard(detail, existing, content);
    if (!readable) resized = checkedResize;
  }
  const layoutDeltas = [];
  if (resized !== null) {
    const next = managedNotebook(resized);
    if (!notebookLayoutIsReadable(resized, next, content)) fail("planned notebook layout is not readable");
    for (const current of existing.layouts) {
      const desired = next.layouts.find((layout) => layout.layoutId === current.layoutId);
      if (current.width !== desired.width || current.height !== desired.height) {
        layoutDeltas.push({ layoutId: current.layoutId, from: { width: current.width, height: current.height },
          to: { width: desired.width, height: desired.height } });
      }
    }
  }
  const snapshotDigest = notebookSnapshot(detail, content);
  const sourceSha256 = createHash("sha256").update(await readFile(fileURLToPath(import.meta.url)))
    .update(await readFile(fileURLToPath(new URL("./lib/homarr-recap-layout.ts", import.meta.url)))).digest("hex");
  return Object.freeze({ schemaVersion: 1, kind: "selfhost-homarr-media-notebook-plan/v1", runId: session.runId,
    live: false, mutation: false, board: { id: board.id, name: boardName, private: true },
    notebookId: existing?.id ?? null,
    actions: { create: existing === null, updateContent: existing !== null && !notebookIsCurrent(existing, content), resize: resized !== null },
    layoutDeltas, contentSha256: `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`, snapshotDigest,
    approvalDigest: notebookDigest({ snapshotDigest, sourceSha256, runId: session.runId, boardName }), status: "planned",
    limits: ["Only the owned primary media recap may change; companion and other board items are preserved.",
      "Creation requests width 8 with content-estimated height and server-default placement; guarded growth uses the shared content/width estimate, at most 24 rows, without shrinking existing items. Exact placement is verified after creation, not predicted.",
      "Growth is collision-checked; rendered desktop and mobile endings still require browser proof."] });
}

export async function applyHomelabNotebook(client, session, boardName, approvedDigest) {
  const plan = await planHomelabNotebook(client, session, boardName);
  if (!/^sha256:[0-9a-f]{64}$/u.test(approvedDigest) || approvedDigest !== plan.approvalDigest) fail("Notebook approval no longer matches the exact plan");
  const before = await client.query("board.getBoardByName", { name: boardName });
  const originalNote = managedNotebook(before);
  const content = notebookContent(session) + preservedAdditionalServices(originalNote);
  if (notebookSnapshot(before, content) !== plan.snapshotDigest) fail("Notebook board changed before apply");
  let expectedNote = null;
  if (originalNote !== null) {
    expectedNote = structuredClone(originalNote);
    if (plan.actions.updateContent) expectedNote.options.content = content;
    for (const delta of plan.layoutDeltas) {
      const layout = expectedNote.layouts.find((current) => current.layoutId === delta.layoutId);
      if (layout === undefined || layout.width !== delta.from.width || layout.height !== delta.from.height) {
        fail("Notebook approved target layout is invalid");
      }
      layout.width = delta.to.width;
      layout.height = delta.to.height;
    }
  }
  const result = await ensureHomelabNotebook(client, session, boardName,
    { expectedSnapshotDigest: plan.snapshotDigest, writeAccessMetadata: false });
  const after = await matchingBoardDetail(client, plan.board, boardName);
  const note = managedNotebook(after);
  if (after.isPublic !== false || !notebookIsCurrent(note, content) || !notebookLayoutIsReadable(after, note, content)
    || !isDeepStrictEqual(after.sections, before.sections) || !isDeepStrictEqual(after.layouts, before.layouts)
    || after.items.length !== before.items.length + Number(plan.actions.create)
    || before.items.some((item) => item.id !== plan.notebookId
      && !isDeepStrictEqual(item, after.items.find((candidate) => candidate.id === item.id)))) {
    fail("Notebook apply did not preserve the exact board");
  }
  if (expectedNote !== null) {
    if (!isDeepStrictEqual(note, expectedNote)) fail("Notebook target did not persist exactly as approved");
  } else {
    const requested = configureNotebook(plan.board, boardName, content);
    if (note.kind !== requested.kind || !isDeepStrictEqual(note.options, requested.options)
      || !isDeepStrictEqual(note.integrationIds, requested.integrationIds)) {
      fail("Created Notebook target did not match the requested configuration");
    }
  }
  // Even a server-created layout already large enough must not overlap another item.
  resizedNotebookBoard(after, note, content);
  return Object.freeze({ ...plan, live: true, mutation: result.created || result.updated, status: "applied" });
}

export async function ensureHomelabNotebook(client, session, boardName, options = {}) {
  if (typeof boardName !== "string" || boardName.trim() !== boardName || boardName.length < 1 || boardName.length > 255) fail("BOARD_NAME is invalid");
  const board = exactPrivateBoard(await client.query("board.getAllBoards"), boardName);
  let detail = await matchingBoardDetail(client, board, boardName);
  let existing = managedNotebook(detail);
  const content = notebookContent(session) + preservedAdditionalServices(existing);
  if (options.expectedSnapshotDigest !== undefined && notebookSnapshot(detail, content) !== options.expectedSnapshotDigest) {
    fail("Notebook board no longer matches the approved snapshot");
  }
  const recordAccess = () => {
    if (options.writeAccessMetadata !== false) writeBoardAccessMetadata(session, board);
  };
  if (existing !== null && (existing.options.showToolbar !== false || existing.options.allowReadOnlyCheck !== true)) {
    fail("Homarr summary notebook options require the checked browser fallback");
  }
  let layoutChanged = false;
  if (existing !== null) {
    const layoutResult = await ensureReadableNotebookLayout(client, detail, existing, boardName, content);
    detail = layoutResult.board;
    layoutChanged = layoutResult.changed;
    existing = managedNotebook(detail);
  }
  if (existing !== null && notebookIsCurrent(existing, content)) {
    recordAccess();
    return Object.freeze({ created: false, updated: layoutChanged });
  }
  if (existing !== null) {
    await updateNotebookContent(client, detail, existing, content);
    detail = await matchingBoardDetail(client, board, boardName);
    const updated = managedNotebook(detail);
    if (!notebookIsCurrent(updated, content) || !notebookLayoutIsReadable(detail, updated, content)) fail("Homarr summary notebook update did not persist");
    recordAccess();
    return Object.freeze({ created: false, updated: true });
  }
  const configuration = configureNotebook(board, boardName, content);
  try {
    await client.mutate("board.addItem", configuration);
  } catch (mutationError) {
    try {
      detail = await matchingBoardDetail(client, board, boardName);
      existing = managedNotebook(detail);
      if (notebookIsCurrent(existing, content) && notebookLayoutIsReadable(detail, existing, content)) {
        recordAccess();
        return Object.freeze({ created: true, updated: false });
      }
    } catch { /* Preserve the original mutation failure. */ }
    throw mutationError;
  }
  detail = await matchingBoardDetail(client, board, boardName);
  existing = managedNotebook(detail);
  if (existing !== null) {
    const layoutResult = await ensureReadableNotebookLayout(client, detail, existing, boardName, content);
    detail = layoutResult.board;
    existing = managedNotebook(detail);
  }
  if (!notebookIsCurrent(existing, content) || !notebookLayoutIsReadable(detail, existing, content)) fail("Homarr summary notebook did not persist with a readable layout");
  recordAccess();
  return Object.freeze({ created: true, updated: false });
}

async function notebookMode(args) {
  const [action, runId, boardName] = args;
  if ((action !== "plan" && action !== "apply") || (action === "plan" && args.length !== 3) || (action === "apply"
    && (args.length !== 5 || args[3] !== "--approve" || !/^sha256:[0-9a-f]{64}$/u.test(args[4])))) fail("notebook plan/apply arguments are invalid");
  const session = loadSession(runId);
  requireSessionPasswordScheme(session);
  const { apiKey } = loadHomarrApiKey(session);
  const client = new HomarrBoardApiClient(session, apiKey);
  let result;
  if (action === "plan") result = await planHomelabNotebook(client, session, boardName);
  else result = await applyHomelabNotebook(client, session, boardName, args[4]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (Bun.argv[1] !== undefined && import.meta.url === pathToFileURL(Bun.argv[1]).href) {
  notebookMode(Bun.argv.slice(2)).catch(() => { process.stdout.write("FAIL Homarr homelab summary notebook\n"); process.exitCode = 1; });
}
