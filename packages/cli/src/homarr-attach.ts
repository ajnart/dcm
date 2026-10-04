import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { assertPrivatePath, privateMode } from "./lib/platform-private.ts";
import { homarrImmichCommand } from "./homarr-immich.ts";
import { homarrUptimeKumaCommand } from "./homarr-uptime-kuma.ts";
import { homarrPaperlessCommand } from "./homarr-paperless.ts";
import { recapHeight } from "../../../scripts/lib/homarr-recap-layout.ts";
export { recapHeight } from "../../../scripts/lib/homarr-recap-layout.ts";

type Service = {
  id: string;
  name: string;
  description: string;
  href: string;
  iconUrl: string;
  access: "local" | "private-route" | "route-unverified";
  storagePath: string | null;
  credentialFile?: string | null;
};

type Input = {
  schemaVersion: 1 | 2;
  homarr: { origin: string; boardName: string };
  service: Service;
};

type Board = {
  id: string;
  name: string;
  isPublic: false;
  sections: Record<string, unknown>[];
  items: Record<string, unknown>[];
};

type App = {
  id: string;
  name: string;
  description: string | null;
  href: string | null;
  iconUrl: string;
  pingUrl: string | null;
};

type Client = {
  query(procedure: string, input?: unknown): Promise<unknown>;
  mutate(procedure: string, input: unknown): Promise<unknown>;
};

const startMarker = "<!-- selfhost-additional-services:start -->";
const endMarker = "<!-- selfhost-additional-services:end -->";
const dataPrefix = "<!-- selfhost-additional-services:data:";
const recapTitle = "Your homelab at a glance";
const additionalTitle = "More services in your homelab";
const genericPrimaryContent = `<h2>${recapTitle}</h2><p>This private board links your self-hosted services. Dashboard shortcuts do not prove integrations or runtime health.</p>`;
const mobilePrimaryHeightLimit = 12;
const maxBlockBytes = 32 * 1024;
const maxResponseBytes = 8 * 1024 * 1024;
const serviceIdPattern = /^[a-z0-9][a-z0-9-]{0,39}$/;
const boardNamePattern = /^[A-Za-z0-9-_]{1,255}$/;

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
function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function safeText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > max
    || /[\u0000-\u001f\u007f]/.test(value)) fail(`${label} is invalid`);
  return value;
}
function url(value: unknown, label: string, originOnly = false): string {
  const text = safeText(value, label, 2048);
  let parsed: URL;
  try { parsed = new URL(text); } catch { fail(`${label} must be an absolute URL`); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail(`${label} must be a credential-free HTTP(S) URL without query or fragment`);
  }
  if (originOnly && (parsed.pathname !== "/" || parsed.origin !== text.replace(/\/$/, ""))) {
    fail(`${label} must be an exact origin without a path`);
  }
  if (parsed.protocol === "http:" && !privateHttpHost(parsed.hostname)) {
    fail(`${label} needs HTTPS unless its host is a private or loopback address`);
  }
  return originOnly ? parsed.origin : parsed.href;
}
function privateHttpHost(hostname: string): boolean {
  if (["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return true;
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (octets[0] === 10 || octets[0] === 127) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}
function validateService(value: unknown): Service {
  const legacyKeys = ["id", "name", "description", "href", "iconUrl", "access", "storagePath"];
  if (!record(value) || (!exactKeys(value, legacyKeys)
    && !exactKeys(value, [...legacyKeys, "credentialFile"]))) {
    fail("Homarr service input has unexpected fields");
  }
  const id = safeText(value.id, "service.id", 40);
  if (!serviceIdPattern.test(id)) fail("service.id must be a lowercase slug");
  const name = safeText(value.name, "service.name", 64);
  const description = safeText(value.description, "service.description", 512);
  const href = url(value.href, "service.href");
  const iconUrl = url(value.iconUrl, "service.iconUrl");
  if (value.access !== "local" && value.access !== "private-route"
    && value.access !== "route-unverified") {
    fail("service.access must be local, private-route, or route-unverified");
  }
  let storagePath: string | null = null;
  if (value.storagePath !== null) {
    storagePath = safeText(value.storagePath, "service.storagePath", 1024);
    if (!isAbsolute(storagePath) || resolve(storagePath) !== storagePath || storagePath === "/") {
      fail("service.storagePath must be an exact absolute directory path or null");
    }
  }
  if (!Object.hasOwn(value, "credentialFile")) {
    return { id, name, description, href, iconUrl, access: value.access, storagePath };
  }
  let credentialFile: string | null = null;
  if (value.credentialFile !== null) {
    credentialFile = safeText(value.credentialFile, "service.credentialFile", 1024);
    if (!isAbsolute(credentialFile) || resolve(credentialFile) !== credentialFile) {
      fail("service.credentialFile must be an exact absolute file path or null");
    }
  }
  return { id, name, description, href, iconUrl, access: value.access, storagePath, credentialFile };
}
export function validateInput(value: unknown): Input {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "homarr", "service"])
    || (value.schemaVersion !== 1 && value.schemaVersion !== 2)
    || !record(value.homarr) || !exactKeys(value.homarr, ["origin", "boardName"])) fail("Homarr attach input is invalid");
  const origin = url(value.homarr.origin, "homarr.origin", true);
  const boardName = safeText(value.homarr.boardName, "homarr.boardName", 255);
  if (!boardNamePattern.test(boardName)) fail("homarr.boardName contains unsupported characters");
  const service = validateService(value.service);
  if ((value.schemaVersion === 1 && Object.hasOwn(service, "credentialFile"))
    || (value.schemaVersion === 2 && !Object.hasOwn(service, "credentialFile"))) {
    fail("Homarr attach service fields do not match its input version");
  }
  return { schemaVersion: value.schemaVersion as 1 | 2, homarr: { origin, boardName }, service };
}

async function ownerFile(path: string, maxBytes: number): Promise<string> {
  if (!isAbsolute(path) || resolve(path) !== path) fail("Input file paths must be exact and absolute");
  const metadata = await lstat(path);
  assertPrivatePath(path, 0o600);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || !privateMode(metadata, 0o600)
    || await realpath(path) !== path || metadata.size < 1 || metadata.size > maxBytes) {
    fail("Input files must be owner-only regular files (0600) without links");
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail("Input file has a different owner");
  return await readFile(path, "utf8");
}

async function loadInput(path: string): Promise<Input> {
  let value: unknown;
  try { value = JSON.parse(await ownerFile(path, 16 * 1024)); } catch { fail("Homarr attach input is not valid JSON or a safe owner-only file"); }
  return validateInput(value);
}

export function parseHomarrApiKey(contents: string): string {
  const trimmed = contents.trim();
  let key = trimmed;
  if (trimmed.startsWith("HOMARR_API_KEY=") || trimmed.includes("\n")) {
    const entries = contents.split(/\r?\n/).filter((line) => line.startsWith("HOMARR_API_KEY="));
    if (entries.length !== 1) fail("Homarr API key file must contain exactly one HOMARR_API_KEY entry");
    key = entries[0].slice("HOMARR_API_KEY=".length);
  }
  if (!/^[A-Za-z0-9_.-]{16,600}$/.test(key)) fail("Homarr API key file is invalid");
  return key;
}

async function loadApiKey(path: string): Promise<string> {
  return parseHomarrApiKey(await ownerFile(path, 32 * 1024));
}

export class HomarrAttachClient implements Client {
  constructor(private origin: string, private apiKey: string, private fetchImpl = globalThis.fetch) {}
  private async request(procedure: string, input: unknown, mutation: boolean): Promise<unknown> {
    const base = `${this.origin}/api/trpc/${procedure}`;
    const encoded = input === undefined ? undefined : JSON.stringify({ json: input });
    let endpoint = base;
    const headers: Record<string, string> = { Accept: "application/json", ApiKey: this.apiKey };
    const options: RequestInit = { method: mutation ? "POST" : "GET", headers, redirect: "manual", signal: AbortSignal.timeout(12_000) };
    if (mutation) {
      if (encoded === undefined) fail(`Homarr ${procedure}: mutation input is missing`);
      headers["Content-Type"] = "application/json";
      options.body = encoded;
    } else if (encoded !== undefined) endpoint += `?input=${encodeURIComponent(encoded)}`;
    let response: Response;
    try { response = await this.fetchImpl(endpoint, options); } catch { fail(`Homarr ${procedure}: endpoint did not respond`); }
    if (!response.ok) { await response.body?.cancel(); fail(`Homarr ${procedure}: HTTP ${response.status}; inspect credentials, access and live schema`); }
    let body: string;
    try { body = await response.text(); } catch { fail(`Homarr ${procedure}: response could not be read`); }
    if (Buffer.byteLength(body, "utf8") > maxResponseBytes) fail(`Homarr ${procedure}: response was too large`);
    let payload: unknown;
    try { payload = JSON.parse(body); } catch { fail(`Homarr ${procedure}: response was not JSON`); }
    if (!record(payload) || !record(payload.result) || !record(payload.result.data) || !Object.hasOwn(payload.result.data, "json")) {
      fail(`Homarr ${procedure}: tRPC response shape differs from release/v2`);
    }
    return payload.result.data.json;
  }
  query(procedure: string, input?: unknown): Promise<unknown> { return this.request(procedure, input, false); }
  mutate(procedure: string, input: unknown): Promise<unknown> { return this.request(procedure, input, true); }
}

function exactBoard(boards: unknown, detail: unknown, name: string): Board {
  if (!Array.isArray(boards)) fail("Homarr board list is invalid");
  const matches = boards.filter((board) => record(board) && board.name === name);
  if (matches.length !== 1 || !record(matches[0]) || typeof matches[0].id !== "string" || matches[0].isPublic !== false) {
    fail("Exactly one private Homarr board must match the selected name");
  }
  if (!record(detail) || detail.id !== matches[0].id || detail.name !== name || detail.isPublic !== false
    || !Array.isArray(detail.items) || !Array.isArray(detail.sections)
    || detail.items.some((item) => !record(item) || typeof item.id !== "string")
    || detail.sections.some((section) => !record(section))) fail("Homarr private board detail is invalid");
  return detail as Board;
}

function exactApp(apps: unknown, service: Service, adoptExisting: boolean, repairLink = false): App | null {
  if (!Array.isArray(apps)) fail("Homarr app inventory is invalid");
  const matches = apps.filter((app) => record(app) && app.name === service.name);
  if (matches.length === 0) return null;
  if (matches.length !== 1 || !record(matches[0]) || typeof matches[0].id !== "string") {
    fail("Homarr already has ambiguous apps with this name");
  }
  const app = matches[0];
  if (app.href !== service.href && !repairLink) fail("Homarr already has an app with this name but a different URL; choose an explicit repair");
  if (!adoptExisting && app.iconUrl !== service.iconUrl) {
    fail("Homarr app has the same URL but a different icon; use --adopt-existing-app to preserve its icon and description");
  }
  return app as App;
}

function adoptedService(app: App | null, service: Service, adoptExisting: boolean): Service {
  if (!adoptExisting) return service;
  if (app === null) fail("--adopt-existing-app requires exactly one existing app with the same name and URL");
  const description = safeText(app.description, "existing app description", 512);
  const iconUrl = url(app.iconUrl, "existing app icon URL");
  return { ...service, description, iconUrl };
}

function tileItems(board: Board, appId: string): Record<string, unknown>[] {
  return board.items.filter((item) => item.kind === "app" && record(item.options) && item.options.appId === appId);
}

function notebook(board: Board): Record<string, unknown> | null {
  const matches = board.items.filter((item) => item.kind === "notebook" && record(item.options)
    && typeof item.options.content === "string" && item.options.content.includes(recapTitle));
  if (matches.length > 1) fail("Homarr has multiple stack recap Notebooks; select one manually");
  if (matches.length === 0) return null;
  return matches[0];
}

function additionalNotebook(board: Board): Record<string, unknown> | null {
  const matches = board.items.filter((item) => item.kind === "notebook" && record(item.options)
    && typeof item.options.content === "string" && item.options.content.includes(additionalTitle));
  if (matches.length > 1) fail("Homarr has multiple additional-services Notebooks; select one manually");
  if (matches.length === 0) return null;
  if (!matches[0].options.content.includes(startMarker)) {
    fail("Homarr has an unowned additional-services Notebook; select it manually");
  }
  return matches[0];
}

type RecapLayout = { layoutId: string; sectionId: string; xOffset: number; yOffset: number; width: number; height: number };

function itemLayouts(item: Record<string, unknown>, label: string): RecapLayout[] {
  if (!Array.isArray(item.layouts) || item.layouts.length === 0) fail(`${label} layouts are missing`);
  const layouts: RecapLayout[] = [];
  const layoutIds = new Set<string>();
  for (const value of item.layouts) {
    if (!record(value) || typeof value.layoutId !== "string" || typeof value.sectionId !== "string"
      || !Number.isInteger(value.xOffset) || !Number.isInteger(value.yOffset)
      || !Number.isInteger(value.width) || !Number.isInteger(value.height)
      || (value.xOffset as number) < 0 || (value.yOffset as number) < 0
      || (value.width as number) < 1 || (value.width as number) > 24
      || (value.height as number) < 1 || (value.height as number) > 24) {
      fail(`${label} has an invalid item layout`);
    }
    const layout = value as RecapLayout;
    if (layoutIds.has(layout.layoutId)) fail(`${label} has colliding item layouts`);
    layoutIds.add(layout.layoutId);
    layouts.push(layout);
  }
  return layouts;
}

function recapLayoutUpdates(note: Record<string, unknown> | null, content: string) {
  if (note === null) return [];
  const updates: Array<{ layout: RecapLayout; targetHeight: number }> = [];
  for (const layout of itemLayouts(note, "Homarr recap Notebook")) {
    const targetHeight = recapHeight(content, layout.width);
    if (layout.height !== targetHeight) updates.push({ layout, targetHeight });
  }
  return updates;
}

function companionPositionUpdates(board: Board, base: Record<string, unknown> | null,
  additional: Record<string, unknown> | null, baseContent: string, additionalContent: string) {
  if (base === null || additional === null) return [];
  const baseLayouts = itemLayouts(base, "Homarr recap Notebook");
  const additionalLayouts = itemLayouts(additional, "Homarr additional-services Notebook");
  const updates: Array<{ layout: RecapLayout; targetYOffset: number }> = [];
  for (const layout of additionalLayouts) {
    const preceding = baseLayouts.find((candidate) => candidate.layoutId === layout.layoutId
      && candidate.sectionId === layout.sectionId);
    if (preceding === undefined) fail("Homarr recap and companion use different sections or layouts");
    let targetYOffset = preceding.yOffset + recapHeight(baseContent, preceding.width);
    const targetHeight = recapHeight(additionalContent, layout.width);
    const occupied: RecapLayout[] = [];
    for (const item of board.items) {
      if (item.id === base.id || item.id === additional.id) continue;
      for (const occupiedLayout of itemLayouts(item, "Homarr board item")) {
        if (occupiedLayout.layoutId !== layout.layoutId || occupiedLayout.sectionId !== layout.sectionId) continue;
        const horizontal = layout.xOffset < occupiedLayout.xOffset + occupiedLayout.width
          && occupiedLayout.xOffset < layout.xOffset + layout.width;
        if (horizontal) occupied.push(occupiedLayout);
      }
    }
    occupied.sort((left, right) => left.yOffset - right.yOffset);
    for (const obstacle of occupied) {
      if (targetYOffset >= obstacle.yOffset + obstacle.height) continue;
      if (targetYOffset + targetHeight <= obstacle.yOffset) break;
      targetYOffset = obstacle.yOffset + obstacle.height;
    }
    if (layout.yOffset === targetYOffset) continue;
    updates.push({ layout, targetYOffset });
  }
  return updates;
}

async function saveItemLayout(client: Client, board: Board, boardName: string, itemId: string,
  originalLayout: RecapLayout, replacement: RecapLayout, label: string): Promise<Board> {
  const live = exactBoard(await client.query("board.getAllBoards"),
    await client.query("board.getBoardByName", { name: boardName }), boardName);
  if (JSON.stringify(live.sections) !== JSON.stringify(board.sections)
    || JSON.stringify(live.items) !== JSON.stringify(board.items)) {
    fail("Homarr board changed during attachment; re-plan");
  }
  const targetItems = live.items.filter((item) => item.id === itemId);
  if (targetItems.length !== 1) fail(`Homarr ${label} layout target collided; re-plan`);
  const target = targetItems[0];
  const layouts = itemLayouts(target, `Homarr ${label}`);
  const targetLayouts = layouts.filter((layout) => layout.layoutId === originalLayout.layoutId);
  if (targetLayouts.length !== 1 || canonical(targetLayouts[0]) !== canonical(originalLayout)) {
    fail(`Homarr ${label} layout target collided or changed; re-plan`);
  }
  const items = live.items.map((item) => {
    if (item.id !== itemId) return item;
    const updatedLayouts = layouts.map((layout) => {
      if (layout.layoutId !== originalLayout.layoutId) return layout;
      return replacement;
    });
    return { ...item, layouts: updatedLayouts };
  });
  let mutationError: string | null = null;
  try { await client.mutate("board.saveBoard", { id: live.id, sections: live.sections, items }); }
  catch (error) {
    // A committed full-board save can lose its response; reconcile its exact snapshot before failing.
    if (error instanceof Error) mutationError = error.message;
  }
  const current = exactBoard(await client.query("board.getAllBoards"),
    await client.query("board.getBoardByName", { name: boardName }), boardName);
  if (JSON.stringify(current.sections) !== JSON.stringify(live.sections)
    || JSON.stringify(current.items) !== JSON.stringify(items)) {
    if (mutationError !== null) fail(`Homarr ${label} layout update failed: ${mutationError}`);
    fail(`Homarr ${label} layout did not persist; use the checked browser layout fallback`);
  }
  return current;
}

async function positionCompanion(client: Client, board: Board, baseContent: string, additionalContent: string,
  boardName: string, direction: "down" | "up"): Promise<Board> {
  let current = board;
  for (const update of companionPositionUpdates(current, notebook(current), additionalNotebook(current),
    baseContent, additionalContent)) {
    if (direction === "down" && update.targetYOffset < update.layout.yOffset) continue;
    if (direction === "up" && update.targetYOffset > update.layout.yOffset) continue;
    const before = current;
    const additional = additionalNotebook(current);
    if (additional === null) fail("Homarr additional-services Notebook disappeared");
    const replacement = { ...update.layout, yOffset: update.targetYOffset };
    current = await saveItemLayout(client, current, boardName, additional.id as string,
      update.layout, replacement, "companion position");
    unchanged(before, current, new Set([additional.id as string]));
    const updated = additionalNotebook(current);
    if (updated?.id !== additional.id || !Array.isArray(updated.layouts)
      || !updated.layouts.some((layout) => record(layout) && layout.layoutId === replacement.layoutId
        && layout.xOffset === replacement.xOffset && layout.yOffset === replacement.yOffset
        && layout.width === replacement.width && layout.height === replacement.height)) {
      fail("Homarr companion position did not persist; use the checked browser layout fallback");
    }
  }
  return current;
}

async function resizeRecap(client: Client, board: Board, note: Record<string, unknown>, content: string,
  boardName: string): Promise<Board> {
  let current = board;
  for (const update of recapLayoutUpdates(note, content)) {
    const before = current;
    const replacement = { ...update.layout, height: update.targetHeight };
    current = await saveItemLayout(client, current, boardName, note.id as string,
      update.layout, replacement, "recap");
    unchanged(before, current, new Set([note.id as string]));
    const updated = current.items.find((item) => item.id === note.id);
    if (updated?.id !== note.id || !Array.isArray(updated.layouts)
      || !updated.layouts.some((layout) => record(layout) && layout.layoutId === replacement.layoutId
        && layout.sectionId === replacement.sectionId && layout.xOffset === replacement.xOffset
        && layout.yOffset === replacement.yOffset && layout.width === replacement.width
        && layout.height === replacement.height)) {
      fail("Homarr recap layout did not persist; use the checked browser layout fallback");
    }
  }
  return current;
}

function serviceLine(service: Service): string {
  let storage = "Storage path not recorded by this attachment.";
  if (service.storagePath !== null) storage = `Storage: <code>${escapeHtml(service.storagePath)}</code>.`;
  let access = "Docker-host browser only; not a remote link";
  if (service.access === "private-route") access = "Private route";
  if (service.access === "route-unverified") access = "Operator-supplied route; privacy and reachability unverified";
  let credentials = "";
  if (service.credentialFile === null) {
    credentials = " Credentials are managed outside this attachment.";
  } else if (typeof service.credentialFile === "string") {
    credentials = ` Credential handoff path: <code>${escapeHtml(service.credentialFile)}</code> `
      + "(owner-only when prepared; the account may still need setup; no password is on this board).";
  }
  return `<li><strong>${escapeHtml(service.name)}</strong> — ${escapeHtml(service.description)} `
    + `<a href="${escapeHtml(service.href)}">Open ${escapeHtml(service.name)}</a> (${access}). ${storage}${credentials} `
    + "Backup restore has not been verified by this attachment.</li>";
}

function renderBlock(entries: Service[], heading = "Additional services"): string {
  const sorted = [...entries].sort((left, right) => left.id.localeCompare(right.id));
  const data = Buffer.from(canonical(sorted), "utf8").toString("base64url");
  const block = `${startMarker}\n${dataPrefix}${data} -->\n<h3>${heading}</h3><ul>${sorted.map(serviceLine).join("")}</ul>\n${endMarker}`;
  if (Buffer.byteLength(block, "utf8") > maxBlockBytes) fail("Homarr additional-services Notebook block exceeds 32 KiB");
  return block;
}

function parseBlock(content: string): { entries: Service[]; start: number; end: number } {
  const starts = content.split(startMarker).length - 1;
  const ends = content.split(endMarker).length - 1;
  if (starts === 0 && ends === 0) return { entries: [], start: -1, end: -1 };
  if (starts !== 1 || ends !== 1) fail("Homarr additional-services Notebook markers are malformed or duplicated");
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker) + endMarker.length;
  if (end <= start + startMarker.length) fail("Homarr additional-services Notebook block is malformed");
  const block = content.slice(start, end);
  if (Buffer.byteLength(block, "utf8") > maxBlockBytes) fail("Homarr additional-services Notebook block exceeds 32 KiB");
  const match = /^<!-- selfhost-additional-services:start -->\n<!-- selfhost-additional-services:data:([A-Za-z0-9_-]+) -->\n/.exec(block);
  if (!match) fail("Homarr additional-services Notebook data marker is missing");
  let raw: unknown;
  try { raw = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")); } catch { fail("Homarr additional-services Notebook data is invalid"); }
  if (!Array.isArray(raw) || raw.length > 24) fail("Homarr additional-services Notebook entries are invalid");
  const entries = raw.map(validateService);
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length
    || (renderBlock(entries) !== block && renderBlock(entries, "Your services") !== block)) {
    fail("Homarr additional-services Notebook block differs from its structured data");
  }
  return { entries, start, end };
}

export function compactLegacyMediaRecap(content: string): string {
  const oldRemote = "<h3>Remote access</h3><p>For services without a private route, use one SSH session: <code>";
  const oldCredentials = "<h3>Credentials and agent access</h3><p>Private credentials can be exported separately to the owner-only handoff artifact; this notebook contains no password or API key.</p>";
  const oldMcp = "<p>After MCP client generation, use the local read-only bridge for searches and status. Keep Homarr's native MCP endpoint and key private. Media requests and downloads require explicit approval for the selected owned or licensed title.</p>";
  const oldTiles = "<p>A tile opens an app; it does not by itself prove that Homarr has a working integration or widget. Additional checked services appear below when attached.</p>";
  if (!content.includes(oldRemote) || !content.includes(oldCredentials)
    || !content.includes(oldMcp) || !content.includes(oldTiles)) return content;
  if (content.indexOf(oldRemote) !== content.lastIndexOf(oldRemote)) {
    fail("Homarr media recap has repeated remote-access instructions; inspect it before compaction");
  }
  const start = content.indexOf(oldRemote);
  const end = content.indexOf("</code></p>", start);
  if (end < 0) fail("Homarr media recap has an incomplete SSH instruction; inspect it before compaction");
  let compact = `${content.slice(0, start)}<h3>Remote access</h3><p>For services without a private route, use a separately verified private connection or SSH tunnel from another device.</p>${content.slice(end + "</code></p>".length)}`;
  compact = compact.replaceAll("; use the SSH tunnel below for private remote access.", ".");
  compact = compact.replace(oldCredentials, "<h3>Credentials and agent access</h3><p>Credentials stay in the owner-only handoff, not this board. Keep Homarr MCP private; its default bridge searches and shows status. A media request needs confirmation for the exact authorized title.</p>");
  compact = compact.replace(oldMcp, "");
  compact = compact.replace(oldTiles, "<p>Tiles open apps; integrations and widgets need separate checks. Additional services appear in the companion note.</p>");
  return compact;
}

function withoutCredentialFile(service: Service): Service {
  const core = { ...service };
  delete core.credentialFile;
  return core;
}

function expectedContent(base: Record<string, unknown> | null, additional: Record<string, unknown> | null,
  service: Service, repairLink = false) {
  let baseContent = genericPrimaryContent;
  if (base !== null) {
    if (!record(base.options) || typeof base.options.content !== "string") fail("Homarr stack recap Notebook is invalid");
    baseContent = base.options.content;
  }
  const embedded = parseBlock(baseContent);
  if (embedded.start >= 0) baseContent = `${baseContent.slice(0, embedded.start)}${baseContent.slice(embedded.end)}`;
  baseContent = compactLegacyMediaRecap(baseContent);
  let additionalContent: string | null = null;
  if (additional !== null) {
    if (!record(additional.options) || typeof additional.options.content !== "string") fail("Homarr additional-services Notebook is invalid");
    additionalContent = additional.options.content;
  }
  const prior = parseBlock(additionalContent ?? "");
  const comparableEntries = (entries: Service[]) => entries.map((entry) => {
    const comparable = withoutCredentialFile(entry);
    if (repairLink && entry.id === service.id) {
      comparable.href = service.href;
      comparable.access = service.access;
    }
    return comparable;
  });
  if (embedded.entries.length > 0 && prior.entries.length > 0
    && canonical(comparableEntries(embedded.entries))
      !== canonical(comparableEntries(prior.entries))) {
    fail("Homarr additional services differ between recap Notebooks; inspect the board before retrying");
  }
  const entriesBefore = prior.entries.length > 0 ? prior.entries : embedded.entries;
  const matching = entriesBefore.find((entry) => entry.id === service.id);
  if (repairLink && (matching === undefined
    || canonical({ ...matching, href: service.href, access: service.access }) !== canonical(service))) {
    fail("Link repair needs one existing managed service entry matching every field except its link and access label");
  }
  if (!repairLink && matching && canonical(matching) !== canonical(service)
    && (Object.hasOwn(matching, "credentialFile")
      || canonical(withoutCredentialFile(matching)) !== canonical(withoutCredentialFile(service)))) {
    fail("This service ID is already attached with different details; use a reviewed repair");
  }
  const entries = matching
    ? entriesBefore.map((entry) => entry.id === service.id ? service : entry)
    : [...entriesBefore, service];
  const block = renderBlock(entries);
  const primaryCandidate = `${baseContent}${renderBlock(entries, "Your services")}`;
  let useCompanion = additional !== null || baseContent !== genericPrimaryContent;
  if (!useCompanion) {
    try { useCompanion = recapHeight(primaryCandidate, 3) > mobilePrimaryHeightLimit; }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes("split the recap before attachment")) throw error;
      useCompanion = true;
    }
  }
  if (!useCompanion) return { baseContent: primaryCandidate, additionalContent };
  if (additionalContent === null) {
    additionalContent = `<h2>${additionalTitle}</h2><p>These apps extend your private dashboard. A tile is a shortcut, not a service-health check.</p>`;
  }
  if (prior.start < 0) additionalContent = `${additionalContent}${block}`;
  else additionalContent = `${additionalContent.slice(0, prior.start)}${block}${additionalContent.slice(prior.end)}`;
  return { baseContent, additionalContent };
}

async function readState(client: Client, input: Input, adoptExisting: boolean, repairLink = false) {
  const boards = await client.query("board.getAllBoards");
  const detail = await client.query("board.getBoardByName", { name: input.homarr.boardName });
  const board = exactBoard(boards, detail, input.homarr.boardName);
  const editable = await client.query("board.getBoardSettings", { id: board.id });
  if (!record(editable) || editable.id !== board.id || editable.name !== board.name) {
    fail("Homarr API key cannot prove modify access to the selected private board");
  }
  const apps = await client.query("app.all");
  const app = exactApp(apps, input.service, adoptExisting, repairLink);
  const service = adoptedService(app, input.service, adoptExisting);
  const tiles = app ? tileItems(board, app.id) : [];
  if (tiles.length > 1) fail("Homarr board already has duplicate tiles for this app");
  if (repairLink && (app === null || tiles.length !== 1
    || app.description !== input.service.description || app.iconUrl !== input.service.iconUrl
    || (app.pingUrl !== null && typeof app.pingUrl !== "string"))) {
    fail("Link repair needs one previously attached tile and matching app fields");
  }
  const note = notebook(board);
  const additional = additionalNotebook(board);
  const { baseContent, additionalContent } = expectedContent(note, additional, service, repairLink);
  for (const content of [baseContent, additionalContent]) {
    if (content === null) continue;
    recapHeight(content, 8);
    recapHeight(content, 3);
  }
  const layoutUpdates = [
    ...recapLayoutUpdates(note, baseContent).map((value) => ({ ...value, itemId: note?.id })),
    ...(additionalContent === null ? [] : recapLayoutUpdates(additional, additionalContent)
      .map((value) => ({ ...value, itemId: additional?.id }))),
  ];
  const positionUpdates = additionalContent === null ? []
    : companionPositionUpdates(board, note, additional, baseContent, additionalContent);
  return { board, app, tile: tiles[0] ?? null, note, additional, baseContent, additionalContent,
    service, layoutUpdates, positionUpdates };
}

function unchanged(original: Board, current: Board, allowedChange: Set<string>): void {
  if (original.id !== current.id || original.name !== current.name || current.isPublic !== false
    || canonical(original.sections) !== canonical(current.sections)) fail("Homarr board changed during attachment; re-plan");
  for (const item of original.items) {
    const currentItem = current.items.filter((candidate) => candidate.id === item.id);
    if (currentItem.length !== 1) fail("Homarr board item changed during attachment; re-plan");
    if (!allowedChange.has(item.id as string) && canonical(currentItem[0]) !== canonical(item)) {
      fail("Homarr board item changed during attachment; re-plan");
    }
  }
}

function approval(input: Input, state: Awaited<ReturnType<typeof readState>>, adoptExisting: boolean,
  repairLink = false): string {
  const digest = createHash("sha256").update(canonical({ input, board: state.board, app: state.app, adoptExisting, repairLink })).digest("hex");
  return `ATTACH:${state.board.id}:${digest}`;
}

function output(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

async function ensureBoardNotebook(client: Client, board: Board, boardName: string, content: string,
  select: (board: Board) => Record<string, unknown> | null, label: string) {
  const found = select(board);
  let mutationError: string | null = null;
  if (found === null) {
    try {
      await client.mutate("board.addItem", {
        boardId: board.id, kind: "notebook",
        options: { content, showToolbar: false, allowReadOnlyCheck: true },
        integrationIds: [], size: { width: 8, height: recapHeight(content, 8) },
      });
    } catch (error) {
      if (error instanceof Error) mutationError = error.message;
    }
  } else if (!record(found.options) || found.options.content !== content) {
    try { await client.mutate("widget.notebook.updateContent", { itemId: found.id, boardId: board.id, content }); }
    catch (error) {
      if (error instanceof Error) mutationError = error.message;
    }
  }
  let current = exactBoard(await client.query("board.getAllBoards"),
    await client.query("board.getBoardByName", { name: boardName }), boardName);
  unchanged(board, current, new Set(found === null ? [] : [found.id as string]));
  let note = select(current);
  if (!note || !record(note.options) || note.options.content !== content || (found !== null && note.id !== found.id)) {
    if (mutationError !== null) fail(`Homarr ${label} Notebook update failed: ${mutationError}`);
    fail(`Homarr ${label} Notebook did not persist; inspect this board before retrying`);
  }
  current = await resizeRecap(client, current, note, content, boardName);
  note = select(current);
  if (!note || recapLayoutUpdates(note, content).length !== 0) {
    fail(`Homarr ${label} Notebook layout is still too small; use the checked browser layout fallback`);
  }
  return { board: current, note };
}

async function attach(client: Client, input: Input, initial: Awaited<ReturnType<typeof readState>>,
  adoptExisting: boolean, repairLink = false) {
  let app = initial.app;
  if (app === null) {
    try {
      await client.mutate("app.create", {
        name: input.service.name,
        description: input.service.description,
        href: input.service.href,
        iconUrl: input.service.iconUrl,
        pingUrl: null,
      });
    } catch {
      // The create response can be lost after a committed write; reconcile by exact fields.
    }
    app = exactApp(await client.query("app.all"), input.service, false);
    if (app === null) fail("Homarr app.create did not persist; no board item was added");
  } else if (repairLink && app.href !== input.service.href) {
    const beforeUpdate = exactApp(await client.query("app.all"), input.service, false, true);
    if (beforeUpdate === null || canonical(beforeUpdate) !== canonical(app)) {
      fail("Homarr app changed after link review; re-plan before repair");
    }
    try {
      await client.mutate("app.update", {
        id: app.id, name: app.name, description: app.description,
        iconUrl: app.iconUrl, href: input.service.href, pingUrl: app.pingUrl,
      });
    } catch {
      // A committed URL update can lose its response; require exact read-back.
    }
    const updated = exactApp(await client.query("app.all"), input.service, false);
    if (updated === null || updated.id !== app.id
      || updated.name !== app.name || updated.description !== app.description
      || updated.iconUrl !== app.iconUrl || updated.pingUrl !== app.pingUrl
      || updated.href !== input.service.href) {
      fail("Homarr app link repair did not persist exactly; inspect this app before retrying");
    }
    app = updated;
  } else if (!adoptExisting && app.description !== input.service.description) {
    if (app.pingUrl !== null && typeof app.pingUrl !== "string") {
      fail("Homarr app has an unsupported ping URL; description was not changed");
    }
    const beforeUpdate = exactApp(await client.query("app.all"), input.service, false);
    if (beforeUpdate === null || canonical(beforeUpdate) !== canonical(app)) {
      fail("Homarr app changed after review; re-plan before updating its description");
    }
    try {
      await client.mutate("app.update", {
        id: app.id,
        name: app.name,
        description: input.service.description,
        iconUrl: app.iconUrl,
        href: app.href,
        pingUrl: app.pingUrl,
      });
    } catch {
      // Reconcile a committed update after a lost response.
    }
    const updated = exactApp(await client.query("app.all"), input.service, false);
    if (updated === null || updated.id !== app.id || updated.description !== input.service.description
      || updated.pingUrl !== app.pingUrl) {
      fail("Homarr app description update did not persist; inspect this app before retrying");
    }
    app = updated;
  } else if (adoptExisting) {
    const beforeAttachment = exactApp(await client.query("app.all"), input.service, true);
    if (beforeAttachment === null || canonical(beforeAttachment) !== canonical(app)) {
      fail("Homarr app changed after adoption review; re-plan before updating the board");
    }
  }
  let current = exactBoard(await client.query("board.getAllBoards"),
    await client.query("board.getBoardByName", { name: input.homarr.boardName }), input.homarr.boardName);
  unchanged(initial.board, current, new Set());
  let tiles = tileItems(current, app.id);
  if (tiles.length > 1) fail("Homarr board has duplicate app tiles; no Notebook write was attempted");
  if (tiles.length === 0) {
    try {
      await client.mutate("board.addItem", {
        boardId: current.id,
        kind: "app",
        options: { appId: app.id, openInNewTab: true, showTitle: true, pingEnabled: false },
        integrationIds: [],
        size: { width: 2, height: 1 },
      });
    } catch {
      // Read back the exact app link before declaring a failed or partial write.
    }
    current = exactBoard(await client.query("board.getAllBoards"),
      await client.query("board.getBoardByName", { name: input.homarr.boardName }), input.homarr.boardName);
    unchanged(initial.board, current, new Set());
    tiles = tileItems(current, app.id);
    if (tiles.length !== 1) fail("Homarr board.addItem did not persist exactly one app tile; Notebook was not changed");
  }
  if (notebook(current)?.id !== initial.note?.id || additionalNotebook(current)?.id !== initial.additional?.id) {
    fail("Homarr recap Notebooks changed during attachment; re-plan");
  }
  const expected = expectedContent(notebook(current), additionalNotebook(current), initial.service, repairLink);
  if (expected.baseContent !== initial.baseContent || expected.additionalContent !== initial.additionalContent) {
    fail("Homarr recap contents changed during attachment; re-plan");
  }
  if (initial.additionalContent !== null) {
    current = await positionCompanion(client, current, initial.baseContent, initial.additionalContent,
      input.homarr.boardName, "down");
  }
  let additionalId: string | null = null;
  const currentNote = notebook(current);
  const movingEmbedded = currentNote !== null && record(currentNote.options)
    && typeof currentNote.options.content === "string" && parseBlock(currentNote.options.content).start >= 0;
  // Persist the destination before removing an embedded block from the primary recap.
  if (movingEmbedded && initial.additionalContent !== null) {
    const result = await ensureBoardNotebook(client, current, input.homarr.boardName,
      initial.additionalContent, additionalNotebook, "additional services");
    current = result.board;
    additionalId = result.note.id as string;
  }
  const baseResult = await ensureBoardNotebook(client, current, input.homarr.boardName,
    initial.baseContent, notebook, "stack recap");
  current = baseResult.board;
  if (initial.additionalContent !== null) {
    if (!movingEmbedded) {
      const result = await ensureBoardNotebook(client, current, input.homarr.boardName,
        initial.additionalContent, additionalNotebook, "additional services");
      current = result.board;
      additionalId = result.note.id as string;
    }
    current = await positionCompanion(client, current, initial.baseContent, initial.additionalContent,
      input.homarr.boardName, "down");
    current = await positionCompanion(client, current, initial.baseContent, initial.additionalContent,
      input.homarr.boardName, "up");
  }
  if (tileItems(current, app.id).length !== 1) fail("Homarr app tile changed during attachment; inspect this board before retrying");
  const allowed = new Set<string>();
  if (initial.note !== null) allowed.add(initial.note.id as string);
  if (initial.additional !== null) allowed.add(initial.additional.id as string);
  unchanged(initial.board, current, allowed);
  const expectedCount = initial.board.items.length + (initial.tile ? 0 : 1)
    + (initial.note ? 0 : 1) + (initial.additionalContent !== null && !initial.additional ? 1 : 0);
  if (current.items.length !== expectedCount) fail("Homarr board gained unexpected items during attachment; inspect before retrying");
  return { appId: app.id, tileId: tileItems(current, app.id)[0].id,
    notebookId: baseResult.note.id, additionalNotebookId: additionalId };
}

/** Reuse the bounded tile/recap adapter inside an already reviewed stack operation. */
export async function inspectHomarrService(client: Client, value: unknown) {
  const input = validateInput(value);
  const state = await readState(client, input, false);
  const metadataVerified = state.app !== null && state.app.href === state.service.href
    && state.app.description === state.service.description && state.app.iconUrl === state.service.iconUrl;
  const structureVerified = state.tile !== null;
  const notebookContentVerified = state.note !== null
    && record(state.note.options) && state.note.options.content === state.baseContent
    && (state.additionalContent === null || (record(state.additional?.options)
      && state.additional.options.content === state.additionalContent));
  return { id: input.service.id, board: { id: state.board.id, name: state.board.name, private: true },
    appId: state.app?.id ?? null, tileId: state.tile?.id ?? null,
    notebookId: state.note?.id ?? null, additionalNotebookId: state.additional?.id ?? null,
    metadataVerified, structureVerified, notebookContentVerified,
    notebookLayoutVerified: state.note !== null
      && (state.additionalContent === null || state.additional !== null)
      && state.layoutUpdates.length === 0 && state.positionUpdates.length === 0 };
}

export async function planHomarrService(client: Client, value: unknown) {
  const input = validateInput(value);
  const state = await readState(client, input, false);
  return { approval: approval(input, state, false), appId: state.app?.id ?? null };
}

export async function applyHomarrService(client: Client, value: unknown, token: string) {
  const input = validateInput(value);
  const state = await readState(client, input, false);
  if (token !== approval(input, state, false)) fail("Homarr service changed after review; re-plan");
  return attach(client, input, state, false);
}

export async function homarrAttachCommand(args: string[]): Promise<void> {
  if (args[0] === "immich") {
    await homarrImmichCommand(args.slice(1));
    return;
  }
  if (args[0] === "uptime-kuma") {
    await homarrUptimeKumaCommand(args.slice(1));
    return;
  }
  if (args[0] === "paperless") {
    await homarrPaperlessCommand(args.slice(1));
    return;
  }
  const action = args[0];
  if (!["plan", "apply", "status"].includes(action)) fail("Use homarr attach plan, apply, or status");
  const flags: Record<string, string> = {};
  const valid = new Set(["--input", "--api-key-file", "--approve"]);
  let adoptExisting = false;
  let repairLink = false;
  for (let index = 1; index < args.length;) {
    const name = args[index];
    if (name === "--adopt-existing-app") {
      if (adoptExisting) fail("--adopt-existing-app was repeated");
      adoptExisting = true;
      index += 1;
      continue;
    }
    if (name === "--repair-existing-link") {
      if (repairLink) fail("--repair-existing-link was repeated");
      repairLink = true;
      index += 1;
      continue;
    }
    const value = args[index + 1];
    if (!valid.has(name) || flags[name] || !value || value.startsWith("--")) fail(`Invalid or repeated Homarr attach option: ${name ?? "(missing)"}`);
    flags[name] = value;
    index += 2;
  }
  if (!flags["--input"] || !flags["--api-key-file"]) fail("Homarr attach needs --input and --api-key-file");
  if (repairLink && adoptExisting) fail("Link repair cannot adopt an existing app");
  if (action === "apply" && !flags["--approve"]) fail("Homarr attach apply needs the exact approval from plan");
  if (action !== "apply" && flags["--approve"]) fail("Only Homarr attach apply accepts --approve");
  const input = await loadInput(flags["--input"]);
  const client = new HomarrAttachClient(input.homarr.origin, await loadApiKey(flags["--api-key-file"]));
  const state = await readState(client, input, adoptExisting, repairLink);
  const current = state.app !== null && state.app.href === state.service.href
    && state.app.description === state.service.description
    && state.tile !== null && state.note !== null
    && (state.additionalContent === null || state.additional !== null)
    && record(state.note.options) && state.note.options.content === state.baseContent
    && (state.additionalContent === null || (record(state.additional?.options)
      && state.additional.options.content === state.additionalContent))
    && state.layoutUpdates.length === 0 && state.positionUpdates.length === 0;
  if (action === "plan") {
    let descriptionUpdate: { from: string | null; to: string } | null = null;
    if (!adoptExisting && state.app !== null && state.app.description !== input.service.description) {
      descriptionUpdate = { from: state.app.description, to: input.service.description };
    }
    let adoptedApp: { description: string; iconUrl: string } | null = null;
    if (adoptExisting) adoptedApp = { description: state.service.description, iconUrl: state.service.iconUrl };
    output({ status: "pass", mutation: false, board: { id: state.board.id, name: state.board.name, private: true },
      service: { id: input.service.id, name: input.service.name, href: input.service.href,
        description: state.service.description, storagePath: input.service.storagePath,
        credentialFile: input.service.credentialFile ?? null },
      resources: { appId: state.app?.id ?? null, tileId: state.tile?.id ?? null, notebookId: state.note?.id ?? null,
        additionalNotebookId: state.additional?.id ?? null,
        moveEmbeddedServicesToCompanion: state.additionalContent !== null
          && state.note !== null && record(state.note.options)
          && typeof state.note.options.content === "string" && parseBlock(state.note.options.content).start >= 0,
        compactLegacyMediaRecap: state.note !== null && record(state.note.options)
          && typeof state.note.options.content === "string"
          && compactLegacyMediaRecap(state.note.options.content) !== state.note.options.content,
        createAdditionalNotebook: state.additionalContent !== null && state.additional === null,
        updatePrimaryNotebookContent: state.note !== null
          && (!record(state.note.options) || state.note.options.content !== state.baseContent),
        updateCompanionNotebookContent: state.additionalContent !== null && state.additional !== null
          && (!record(state.additional.options) || state.additional.options.content !== state.additionalContent),
        mobilePrimaryHeightLimit,
        descriptionUpdate, adoptedApp,
        linkUpdate: repairLink && state.app?.href !== input.service.href
          ? { from: state.app?.href, to: input.service.href } : null,
        alreadyCurrent: current,
        recapLayoutUpdates: state.layoutUpdates.map(({ itemId, layout, targetHeight }) => ({
          itemId, layoutId: layout.layoutId, xOffset: layout.xOffset, yOffset: layout.yOffset,
          width: layout.width, fromHeight: layout.height, toHeight: targetHeight,
        })),
        companionPositionUpdates: state.positionUpdates.map(({ layout, targetYOffset }) => ({
          itemId: state.additional?.id, layoutId: layout.layoutId,
          fromYOffset: layout.yOffset, toYOffset: targetYOffset,
        })) },
      approval: approval(input, state, adoptExisting, repairLink),
      limitations: ["Creates an app shortcut and a primary recap; a companion Notebook is used for media/custom recaps or when the managed primary exceeds 12 estimated mobile rows. This does not configure an integration or verify service runtime.",
        repairLink
          ? "Link repair changes only the exact existing app URL and its managed Notebook entry; the tile, icon, description, and ping URL are preserved. A partial API write needs fresh status and plan review."
          : "A matching existing app may receive only the reviewed description update; its URL, icon, and ping URL are preserved.",
        "--adopt-existing-app preserves an existing same-URL app's icon and description and uses that description in the Notebook; it never updates the app.",
        "Recap sizing and collision-checked companion placement save one exact item-layout change through board.saveBoard; the browser must still prove rendered readability.",
        "Any board or app change after this plan requires a new plan and approval."],
    });
    return;
  }
  if (action === "status") {
    output({ status: current ? "attached" : "needs-attachment", mutation: false,
      board: { id: state.board.id, name: state.board.name, private: true },
      boardUrl: current ? `${input.homarr.origin}/boards/${encodeURIComponent(state.board.name)}` : null,
      appId: state.app?.id ?? null, tileId: state.tile?.id ?? null, notebookId: state.note?.id ?? null,
      additionalNotebookId: state.additional?.id ?? null,
      credentialFile: input.service.credentialFile ?? null, notebookContentVerified: current,
      integrationVerified: false, serviceRuntimeVerified: false });
    return;
  }
  if (flags["--approve"] !== approval(input, state, adoptExisting, repairLink)) fail("Homarr attach approval no longer matches this exact private board and app state; re-plan");
  if (current) {
    output({ status: "already-attached", boardUrl: `${input.homarr.origin}/boards/${encodeURIComponent(state.board.name)}`,
      appId: state.app?.id, tileId: state.tile?.id, notebookId: state.note?.id,
      additionalNotebookId: state.additional?.id, credentialFile: input.service.credentialFile ?? null,
      integrationVerified: false, serviceRuntimeVerified: false });
    return;
  }
  const result = await attach(client, input, state, adoptExisting, repairLink);
  output({ status: "attached", boardUrl: `${input.homarr.origin}/boards/${encodeURIComponent(state.board.name)}`,
    ...result, credentialFile: input.service.credentialFile ?? null,
    integrationVerified: false, serviceRuntimeVerified: false,
    next: "Read back the private board in a browser. Configure an official integration separately if supported and approved." });
}
