import { createHash } from "node:crypto";
import { recapHeight } from "../../../../scripts/lib/homarr-recap-layout.ts";
import type { HomarrStackSeedClient } from "./homarr-stack-seed.ts";

export type HomarrNonBrowserDescriptor = {
  id: string; name: string; description: string;
  state: "tcp-applied-unverified" | "prepared" | "connector-applied-unverified" | "daemon-applied-unverified";
  endpoint?: { host: string; port: number; protocol: "postgresql" | "redis" };
};
const marker = "SELFHOST_NON_BROWSER_RECAP_V1";
type Row = Record<string, unknown>;
type Board = Row & { id: string; name: string; items: Row[]; sections: Row[] };
function fail(): never { throw new Error("Homarr non-browser recap requires exact reviewed private-board state; inspect and re-plan"); }
function row(value: unknown): value is Row { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exact(value: Row, names: string[]) { if (Object.keys(value).some((key) => !names.includes(key))) fail(); }
function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum
    && !/[\u0000-\u001f\u007f<>]/.test(value);
}
function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,127}$/.test(value);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (row(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function contentFor(descriptors: HomarrNonBrowserDescriptor[]): string {
  if (!Array.isArray(descriptors) || descriptors.length > 24) fail();
  if (descriptors.length === 0) return "";
  if (!descriptors.every((descriptor) => row(descriptor) && typeof descriptor.id === "string")) fail();
  const identities = new Set<string>();
  const entries = [...descriptors].sort((left, right) => left.id.localeCompare(right.id));
  const content = [`<!-- ${marker} --><h2>Services without a browser frontend</h2><p>Configuration recap only. Runtime health and acceptance are not verified here.</p>`];
  for (const value of entries) {
    if (!row(value)) fail(); exact(value, ["id", "name", "description", "state", "endpoint"]);
    if (typeof value.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) || value.id.length > 47 || identities.has(value.id)
      || !text(value.name, 127) || !text(value.description, 512)
      || value.name.includes(marker) || value.description.includes(marker)
      || !["tcp-applied-unverified", "prepared", "connector-applied-unverified", "daemon-applied-unverified"].includes(value.state)) fail();
    identities.add(value.id);
    let status = "TCP service configured; health and client access unverified.";
    if (value.state === "prepared") status = "Manual job prepared, not executed.";
    if (value.state === "connector-applied-unverified") status = "Connector applied; enrollment and client access unverified.";
    if (value.state === "daemon-applied-unverified") status = "Private daemon configured; runtime, enrollment and client access unverified.";
    content.push(`<h3>${escape(value.name)}</h3><p>${escape(value.description)} ${status}</p>`);
    if (value.endpoint !== undefined) {
      if (value.state !== "tcp-applied-unverified" || !row(value.endpoint)) fail();
      exact(value.endpoint, ["host", "port", "protocol"]);
      if (typeof value.endpoint.host !== "string" || value.endpoint.host.length > 253
        || !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(value.endpoint.host)
        || !Number.isInteger(value.endpoint.port) || value.endpoint.port < 1 || value.endpoint.port > 65535
        || !["postgresql", "redis"].includes(value.endpoint.protocol)) fail();
      content.push(`<p>Private ${value.endpoint.protocol} endpoint: ${escape(value.endpoint.host)}:${value.endpoint.port}. Use an authorized client; no browser or admin interface.</p>`);
    }
  }
  const result = content.join("");
  recapHeight(result, 3); recapHeight(result, 8);
  return result;
}
function layouts(note: Row): Row[] {
  if (!Array.isArray(note.layouts) || note.layouts.length === 0 || note.layouts.length > 16) fail();
  const ids = new Set<string>();
  for (const layout of note.layouts) {
    if (!row(layout) || typeof layout.layoutId !== "string" || typeof layout.sectionId !== "string"
      || ids.has(layout.layoutId) || !Number.isInteger(layout.width) || Number(layout.width) < 1 || Number(layout.width) > 24
      || !Number.isInteger(layout.height) || Number(layout.height) < 1 || Number(layout.height) > 24
      || !Number.isInteger(layout.xOffset) || Number(layout.xOffset) < 0
      || !Number.isInteger(layout.yOffset) || Number(layout.yOffset) < 0) fail();
    ids.add(layout.layoutId);
  }
  return note.layouts;
}
async function read(client: HomarrStackSeedClient, boardName: string) {
  if (!text(boardName, 127)) fail();
  const inventory = await client.query("board.getAllBoards");
  const detail = await client.query("board.getBoardByName", { name: boardName });
  if (!Array.isArray(inventory)) fail();
  const matching = inventory.filter((board) => row(board) && board.name === boardName);
  if (matching.length !== 1 || !row(matching[0]) || matching[0].isPublic !== false
    || !row(detail) || detail.id !== matching[0].id || !resourceId(detail.id)
    || detail.name !== boardName || detail.isPublic !== false || !Array.isArray(detail.items)
    || !Array.isArray(detail.sections) || !detail.sections.every(row)
    || !detail.items.every((item) => row(item) && resourceId(item.id))
    || new Set(detail.items.map((item) => item.id)).size !== detail.items.length) fail();
  const board = detail as Board;
  const editable = await client.query("board.getBoardSettings", { id: board.id });
  if (!row(editable) || editable.id !== board.id || editable.name !== boardName) fail();
  const notes = board.items.filter((item) => row(item.options) && typeof item.options.content === "string"
    && item.options.content.includes(marker));
  if (notes.length > 1) fail();
  const note = notes[0] ?? null;
  if (note !== null) {
    if (note.kind !== "notebook" || !row(note.options) || typeof note.options.content !== "string"
      || !note.options.content.startsWith(`<!-- ${marker} -->`) || note.options.content.split(marker).length !== 2
      || !Array.isArray(note.integrationIds) || note.integrationIds.length !== 0) fail();
    layouts(note);
  }
  return { board, note };
}
function token(board: Board, content: string): string {
  return `NON-BROWSER-RECAP:${board.id}:${createHash("sha256").update(canonical({ board, content })).digest("hex")}`;
}
function result(state: Awaited<ReturnType<typeof read>>, content: string, mutation: boolean) {
  const contentVerified = content.length > 0 && row(state.note?.options) && state.note.options.content === content;
  const layoutVerified = content.length > 0 && state.note !== null && layouts(state.note).every((layout) => layout.height === recapHeight(content, Number(layout.width)));
  return { boardId: state.board.id, notebookId: state.note?.id ?? null, mutation,
    skipped: content.length === 0,
    notebookContentVerified: contentVerified, notebookLayoutVerified: layoutVerified,
    renderedContentVerified: false, serviceRuntimeVerified: false, clientAccessVerified: false };
}
export async function planHomarrNonBrowserRecap(client: HomarrStackSeedClient, boardName: string, descriptors: HomarrNonBrowserDescriptor[]) {
  const content = contentFor(descriptors); const state = await read(client, boardName);
  const report = result(state, content, false);
  return { ...report, approval: token(state.board, content), alreadyCurrent: report.skipped || (report.notebookContentVerified && report.notebookLayoutVerified) };
}
export async function inspectHomarrNonBrowserRecap(client: HomarrStackSeedClient, boardName: string, descriptors: HomarrNonBrowserDescriptor[]) {
  const content = contentFor(descriptors); return result(await read(client, boardName), content, false);
}
export async function applyHomarrNonBrowserRecap(client: HomarrStackSeedClient, boardName: string, descriptors: HomarrNonBrowserDescriptor[], approval: string) {
  const content = contentFor(descriptors); let state = await read(client, boardName);
  if (approval !== token(state.board, content)) fail();
  if (content.length === 0) return result(state, content, false);
  let mutation = false;
  const before = state;
  if (state.note === null || !row(state.note.options) || state.note.options.content !== content) {
    mutation = true;
    try {
      if (state.note === null) await client.mutate("board.addItem", { boardId: state.board.id, kind: "notebook",
        options: { content, showToolbar: false, allowReadOnlyCheck: true }, integrationIds: [],
        size: { width: 8, height: recapHeight(content, 8) } });
      else await client.mutate("widget.notebook.updateContent", { itemId: state.note.id, boardId: state.board.id, content });
    } catch { /* A committed write may lose its response. Read back; never retry it here. */ }
    state = await read(client, boardName);
    if (!state.note || !row(state.note.options) || state.note.options.content !== content
      || before.board.id !== state.board.id || before.board.name !== state.board.name
      || (before.note !== null && before.note.id !== state.note.id)
      || canonical(before.board.sections) !== canonical(state.board.sections)
      || canonical(before.board.items.filter((item) => item.id !== before.note?.id))
        !== canonical(state.board.items.filter((item) => item.id !== state.note?.id))) fail();
    if (before.note !== null && row(before.note.options)
      && canonical(state.note) !== canonical({ ...before.note, options: { ...before.note.options, content } })) fail();
  }
  if (!state.note) fail();
  const note = state.note;
  const resized = layouts(note).map((layout) => ({ ...layout, height: recapHeight(content, Number(layout.width)) }));
  if (canonical(resized) !== canonical(note.layouts)) {
    // Same source-valid full-board save as the tile recap adapter; preserve every unrelated field.
    const refreshed = await read(client, boardName);
    if (canonical(refreshed.board) !== canonical(state.board)) fail();
    const items = state.board.items.map((item) => {
      if (item.id === note.id) return { ...item, layouts: resized };
      return item;
    });
    mutation = true;
    try { await client.mutate("board.saveBoard", { id: state.board.id, sections: state.board.sections, items }); }
    catch { /* Reconcile exact persisted layout before reporting success. */ }
    const next = await read(client, boardName);
    if (canonical(next.board.sections) !== canonical(state.board.sections) || canonical(next.board.items) !== canonical(items)) fail();
    state = next;
  }
  const report = result(state, content, mutation);
  if (!report.notebookContentVerified || !report.notebookLayoutVerified) fail();
  return report;
}
