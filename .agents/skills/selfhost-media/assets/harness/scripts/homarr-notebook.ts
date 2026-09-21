#!/usr/bin/env bun

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadHomarrApiKey,
  loadSession,
  requireSessionPasswordScheme,
  sessionAccess,
  writeBoardAccessMetadata,
} from "./lib/session-context.ts";
import { sessionSshTunnel } from "./lib/session-access.ts";

export const NOTEBOOK_MARKER = "Your homelab at a glance";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function fail(message) { throw new Error(message); }
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function servicePurpose(service) {
  return {
    prowlarr: "Indexer coordination", radarr: "Movie library automation", sonarr: "Series library automation",
    qbittorrent: "Authorized-content downloads", jellyfin: "Private media playback",
    seerr: "Movie and series requests", homarr: "Dashboard and private agent control plane",
  }[service];
}

export function notebookContent(session) {
  const access = sessionAccess(session);
  const tunnel = sessionSshTunnel(access);
  const rows = Object.entries(access.services).map(([service, routes]) => {
    let route = `Local only: ${routes.browserUrl}; use the SSH tunnel below for remote access.`;
    if (routes.reachableUrl !== null) route = `${routes.reachableUrl} (configured private route; client reachability is not verified here).`;
    return `<li><strong>${escapeHtml(service)}</strong> — ${escapeHtml(servicePurpose(service))}. ${escapeHtml(route)}</li>`;
  });
  return [
    `<h2>${NOTEBOOK_MARKER}</h2><p>This board is the control plane for this private media stack.</p>`,
    `<h3>Services</h3><ul>${rows.join("")}</ul>`,
    `<h3>Remote access</h3><p>For services without a private route, use one SSH session: <code>${escapeHtml(tunnel.command)}</code></p>`,
    `<h3>Storage</h3><ul><li>Configuration: <code>${escapeHtml(join(session.sessionDir, "config"))}</code></li>`,
    `<li>Media and download data: <code>${escapeHtml(join(session.sessionDir, "data"))}</code></li>`,
    `<li>Private handoff: <code>${escapeHtml(join(session.sessionDir, "artifacts", "private-handoff.json"))}</code></li></ul>`,
    "<p><strong>Recovery:</strong> Backups are not configured or verified by this setup.</p>",
    "<h3>Credentials and agent access</h3><p>Private credentials can be exported separately to the owner-only handoff artifact; this notebook contains no password or API key.</p>",
    "<p>After MCP client generation, use the local read-only bridge for searches and status. Keep Homarr's native MCP endpoint and key private. Media requests and downloads require explicit approval for the selected owned or licensed title.</p>",
    "<p><strong>Pending:</strong> Select and configure authorized indexer and download sources before expecting acquisition workflows to work.</p>",
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

function notebookIsCurrent(item, expectedContent) {
  return item !== null && item.options.content === expectedContent
    && item.options.showToolbar === false && item.options.allowReadOnlyCheck === true;
}

function readableNotebookLayouts(board, notebook) {
  if (!Array.isArray(board.layouts) || !Array.isArray(board.sections)
    || !Array.isArray(notebook.layouts) || notebook.layouts.length === 0) {
    fail("Homarr notebook layouts are unavailable");
  }
  return notebook.layouts.map((current) => {
    const layout = board.layouts.find((candidate) => candidate.id === current.layoutId);
    if (!isRecord(layout) || !Number.isInteger(layout.columnCount)
      || !Number.isInteger(layout.leftGutterColumnCount) || !Number.isInteger(layout.rightGutterColumnCount)) {
      fail("Homarr board layout is invalid");
    }
    const columnCount = layout.columnCount - layout.leftGutterColumnCount - layout.rightGutterColumnCount;
    if (columnCount < 1 || typeof current.sectionId !== "string") fail("Homarr notebook layout is invalid");
    const occupied = [
      ...board.items.flatMap((item) => item.id === notebook.id || !Array.isArray(item.layouts) ? [] : item.layouts),
      ...board.sections.flatMap((section) => section.kind !== "container" || !Array.isArray(section.layouts) ? [] : section.layouts),
    ].filter((candidate) => candidate.layoutId === current.layoutId
      && (candidate.sectionId === current.sectionId || candidate.parentSectionId === current.sectionId));
    const yOffset = occupied.reduce((bottom, candidate) => {
      if (!Number.isInteger(candidate.yOffset) || !Number.isInteger(candidate.height)) fail("Homarr board placement is invalid");
      return Math.max(bottom, candidate.yOffset + candidate.height);
    }, 0);
    return { ...current, xOffset: 0, yOffset, width: Math.min(8, columnCount), height: 4 };
  });
}

function notebookLayoutIsCurrent(board, notebook) {
  const expected = readableNotebookLayouts(board, notebook);
  return expected.every((layout, index) => {
    const current = notebook.layouts[index];
    return current.layoutId === layout.layoutId && current.sectionId === layout.sectionId
      && current.xOffset === layout.xOffset && current.yOffset === layout.yOffset
      && current.width === layout.width && current.height === layout.height;
  });
}

async function saveReadableNotebook(client, board, notebook, content) {
  const layouts = readableNotebookLayouts(board, notebook);
  const items = board.items.map((item) => {
    if (item.id !== notebook.id) return item;
    return {
      ...item,
      options: { content, showToolbar: false, allowReadOnlyCheck: true },
      layouts,
    };
  });
  await client.mutate("board.saveBoard", { id: board.id, sections: board.sections, items });
}

export function configureNotebook(board, boardName, content) {
  if (!isRecord(board) || typeof board.id !== "string" || board.name !== boardName) fail("notebook target board is invalid");
  if (typeof content !== "string" || !content.includes(NOTEBOOK_MARKER)) fail("notebook content is invalid");
  return Object.freeze({
    boardId: board.id,
    kind: "notebook",
    options: Object.freeze({ content, showToolbar: false, allowReadOnlyCheck: true }),
    integrationIds: Object.freeze([]),
  });
}

async function matchingBoardDetail(client, board, boardName) {
  const detail = await client.query("board.getBoardByName", { name: boardName });
  if (!isRecord(detail) || detail.id !== board.id || detail.name !== boardName) fail("Homarr board detail does not match the selected board");
  return detail;
}

export async function ensureHomelabNotebook(client, session, boardName) {
  if (typeof boardName !== "string" || boardName.trim() !== boardName || boardName.length < 1 || boardName.length > 255) fail("BOARD_NAME is invalid");
  const board = exactPrivateBoard(await client.query("board.getAllBoards"), boardName);
  const content = notebookContent(session);
  let detail = await matchingBoardDetail(client, board, boardName);
  let existing = managedNotebook(detail);
  if (existing !== null && notebookIsCurrent(existing, content) && notebookLayoutIsCurrent(detail, existing)) {
    writeBoardAccessMetadata(session, board);
    return Object.freeze({ created: false, updated: false });
  }
  if (existing !== null) {
    await saveReadableNotebook(client, detail, existing, content);
    detail = await matchingBoardDetail(client, board, boardName);
    const updated = managedNotebook(detail);
    if (!notebookIsCurrent(updated, content) || !notebookLayoutIsCurrent(detail, updated)) fail("Homarr summary notebook update did not persist");
    writeBoardAccessMetadata(session, board);
    return Object.freeze({ created: false, updated: true });
  }
  const configuration = configureNotebook(board, boardName, content);
  try {
    await client.mutate("board.addItem", configuration);
  } catch (mutationError) {
    try {
      detail = await matchingBoardDetail(client, board, boardName);
      existing = managedNotebook(detail);
      if (notebookIsCurrent(existing, content)) {
        if (!notebookLayoutIsCurrent(detail, existing)) {
          await saveReadableNotebook(client, detail, existing, content);
          detail = await matchingBoardDetail(client, board, boardName);
          existing = managedNotebook(detail);
        }
        if (!notebookLayoutIsCurrent(detail, existing)) fail("Homarr summary notebook layout did not persist");
        writeBoardAccessMetadata(session, board);
        return Object.freeze({ created: true, updated: false });
      }
    } catch { /* Preserve the original mutation failure. */ }
    throw mutationError;
  }
  detail = await matchingBoardDetail(client, board, boardName);
  existing = managedNotebook(detail);
  if (!notebookIsCurrent(existing, content)) fail("Homarr summary notebook did not persist");
  await saveReadableNotebook(client, detail, existing, content);
  detail = await matchingBoardDetail(client, board, boardName);
  existing = managedNotebook(detail);
  if (!notebookIsCurrent(existing, content) || !notebookLayoutIsCurrent(detail, existing)) fail("Homarr summary notebook layout did not persist");
  writeBoardAccessMetadata(session, board);
  return Object.freeze({ created: true, updated: false });
}

async function main() {
  if (Bun.argv.length !== 4) fail("usage: homarr-notebook.ts RUN_ID BOARD_NAME");
  const session = loadSession(Bun.argv[2]);
  requireSessionPasswordScheme(session);
  const { apiKey } = loadHomarrApiKey(session);
  const result = await ensureHomelabNotebook(new HomarrBoardApiClient(session, apiKey), session, Bun.argv[3]);
  let status = "already current";
  if (result.created) status = "created";
  if (result.updated) status = "updated";
  process.stdout.write(`PASS Homarr homelab summary notebook ${status}\n`);
}

if (Bun.argv[1] !== undefined && import.meta.url === pathToFileURL(Bun.argv[1]).href) {
  main().catch(() => { process.stdout.write("FAIL Homarr homelab summary notebook\n"); process.exitCode = 1; });
}
