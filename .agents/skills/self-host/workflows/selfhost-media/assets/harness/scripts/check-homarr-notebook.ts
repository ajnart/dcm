#!/usr/bin/env bun

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureNotebook, ensureHomelabNotebook, HomarrBoardApiClient, NOTEBOOK_MARKER, notebookContent } from "./homarr-notebook.ts";
import { privateHandoffContents, redactedHandoffContents } from "./lib/session-context.ts";

const sessionRoot = mkdtempSync(join(tmpdir(), "homarr-notebook-"));
mkdirSync(join(sessionRoot, "artifacts"), { mode: 0o700 });
const session = { runId: "notebook-test", sessionDir: sessionRoot, manifestFile: join(sessionRoot, "manifest.env"), secretsFile: join(sessionRoot, "secrets.env"), manifest: {
  ADMIN_USERNAME: "alice", SESSION_PASSWORD_SCHEME: "hmac-v1",
  PROWLARR_PORT: "21000", RADARR_PORT: "21001", SONARR_PORT: "21002", QBITTORRENT_PORT: "21003",
  JELLYFIN_PORT: "21004", SEERR_PORT: "21005", HOMARR_PORT: "21006",
}, secrets: {
  HOMARR_ENCRYPTION_KEY: "a".repeat(64), PROWLARR_API_KEY: "b".repeat(32), RADARR_API_KEY: "c".repeat(32),
  SONARR_API_KEY: "d".repeat(32), SEERR_API_KEY: "e".repeat(32),
} };
const content = notebookContent(session);
assert.match(content, new RegExp(NOTEBOOK_MARKER));
assert.match(content, /Backups are not configured or verified/);
assert.match(content, /Pending:.*sources/i);
assert.match(content, /private-handoff\.json/);
assert.match(content, /read-only bridge/);
assert.equal(content.includes("API_KEY="), false);
assert.deepEqual(configureNotebook({ id: "board-1", name: "Personal" }, "Personal", content), {
  boardId: "board-1", kind: "notebook", options: { content, showToolbar: false, allowReadOnlyCheck: true }, integrationIds: [],
});

function clientFor(boardItems = []) {
  const calls = [];
  const board = {
    id: "board-1", name: "Personal", isPublic: false,
    layouts: [
      { id: "mobile", columnCount: 3, leftGutterColumnCount: 0, rightGutterColumnCount: 0 },
      { id: "desktop", columnCount: 12, leftGutterColumnCount: 0, rightGutterColumnCount: 0 },
    ],
    sections: [{ id: "main", kind: "empty", xOffset: 0, yOffset: 0 }],
    items: boardItems,
  };
  return { calls,
    async query(procedure, input) {
      calls.push({ operation: "query", procedure, input });
      if (procedure === "board.getAllBoards") return [{ id: "board-1", name: "Personal", isPublic: false }];
      if (procedure === "board.getBoardByName") return board;
      throw new Error("unexpected query");
    },
    async mutate(procedure, input) {
      calls.push({ operation: "mutate", procedure, input });
      if (procedure === "board.addItem") {
        boardItems.push({ id: "notebook-1", kind: input.kind, options: input.options, integrationIds: [], advancedOptions: {}, layouts: [
          { layoutId: "mobile", sectionId: "main", xOffset: 0, yOffset: 1, width: 1, height: 1 },
          { layoutId: "desktop", sectionId: "main", xOffset: 1, yOffset: 0, width: 1, height: 1 },
        ] });
        return { itemId: "notebook-1" };
      }
      assert.equal(procedure, "board.saveBoard");
      assert.equal(input.sections, board.sections);
      board.items = input.items;
      boardItems.splice(0, boardItems.length, ...input.items);
    },
  };
}

const preservedApp = { id: "app-1", kind: "app", options: { href: "http://sonarr:8989" }, integrationIds: [], advancedOptions: {}, layouts: [
  { layoutId: "mobile", sectionId: "main", xOffset: 0, yOffset: 0, width: 1, height: 1 },
  { layoutId: "desktop", sectionId: "main", xOffset: 0, yOffset: 0, width: 1, height: 1 },
] };
const createdItems = [preservedApp];
const created = clientFor(createdItems);
assert.deepEqual(await ensureHomelabNotebook(created, session, "Personal"), { created: true, updated: false });
assert.deepEqual(created.calls.map(({ operation, procedure }) => `${operation}:${procedure}`), [
  "query:board.getAllBoards", "query:board.getBoardByName", "mutate:board.addItem", "query:board.getBoardByName",
  "mutate:board.saveBoard", "query:board.getBoardByName",
]);
assert.equal(createdItems.length, 2);
assert.equal(createdItems[0], preservedApp);
assert.equal(statSync(join(sessionRoot, "artifacts", "board-access.json")).mode & 0o777, 0o600);
writeFileSync(join(sessionRoot, "artifacts", "mcp-client.json"), "{}\n", { mode: 0o600 });
const privateHandoff = JSON.parse(privateHandoffContents(session));
assert.equal(privateHandoff.homarrNotebook, "verified-at-recording");
assert.equal(privateHandoff.access.board.board.name, "Personal");
assert.equal(privateHandoff.access.board.urls.local, "http://127.0.0.1:21006/boards/Personal");
assert.equal(privateHandoff.mcp.clientConfig, join(sessionRoot, "artifacts", "mcp-client.json"));
assert.equal(privateHandoff.acceptance.startsWith("unverified by handoff"), true);
const redactedHandoff = redactedHandoffContents(session);
assert.match(redactedHandoff, /Personal board: `http:\/\/127\.0\.0\.1:21006\/boards\/Personal`/);
assert.match(redactedHandoff, /current board state and overall acceptance remain separate/);

const readableLayouts = [
  { layoutId: "mobile", sectionId: "main", xOffset: 0, yOffset: 0, width: 3, height: 4 },
  { layoutId: "desktop", sectionId: "main", xOffset: 0, yOffset: 0, width: 8, height: 4 },
];
const existing = { id: "notebook-existing", kind: "notebook", options: { content, showToolbar: false, allowReadOnlyCheck: true }, integrationIds: [], advancedOptions: {}, layouts: readableLayouts };
const idempotent = clientFor([existing]);
assert.deepEqual(await ensureHomelabNotebook(idempotent, session, "Personal"), { created: false, updated: false });
assert.equal(idempotent.calls.some(({ operation }) => operation === "mutate"), false);
const outdatedItems = [{ id: "notebook-outdated", kind: "notebook", options: {
  content: `<h2>${NOTEBOOK_MARKER}</h2><p>changed</p>`, showToolbar: false, allowReadOnlyCheck: true,
}, integrationIds: [], advancedOptions: {}, layouts: readableLayouts }];
assert.deepEqual(await ensureHomelabNotebook(clientFor(outdatedItems), session, "Personal"), { created: false, updated: true });
assert.equal(outdatedItems[0].options.content, content);
const tinyItems = [preservedApp, { ...existing, id: "notebook-tiny", layouts: readableLayouts.map((layout) => ({ ...layout, width: 1, height: 1 })) }];
assert.deepEqual(await ensureHomelabNotebook(clientFor(tinyItems), session, "Personal"), { created: false, updated: true });
assert.deepEqual(tinyItems[1].layouts, [
  { layoutId: "mobile", sectionId: "main", xOffset: 0, yOffset: 1, width: 3, height: 4 },
  { layoutId: "desktop", sectionId: "main", xOffset: 0, yOffset: 1, width: 8, height: 4 },
]);
await assert.rejects(ensureHomelabNotebook(clientFor([existing, { ...existing }]), session, "Personal"), /conflicting/);

const publicClient = clientFor([]);
publicClient.query = async (procedure) => {
  if (procedure === "board.getAllBoards") return [{ id: "board-1", name: "Personal", isPublic: true }];
  throw new Error("unexpected operation");
};
await assert.rejects(ensureHomelabNotebook(publicClient, session, "Personal"), /private/);

const requests = [];
const api = new HomarrBoardApiClient(session, "fixture.key-value", { fetchImplementation: async (url, options) => {
  requests.push({ url, options });
  return { ok: true, async text() { return JSON.stringify({ result: { data: { json: { ok: true } } } }); } };
} });
assert.deepEqual(await api.query("board.getAllBoards"), { ok: true });
assert.deepEqual(await api.query("board.getBoardByName", { name: "Personal" }), { ok: true });
assert.deepEqual(await api.mutate("board.addItem", { boardId: "board-1" }), { ok: true });
assert.equal(requests[0].url, "http://127.0.0.1:21006/api/trpc/board.getAllBoards");
assert.equal(requests[0].options.method, "GET");
assert.equal(requests[0].options.headers.ApiKey, "fixture.key-value");
assert.match(requests[1].url, /^http:\/\/127\.0\.0\.1:21006\/api\/trpc\/board\.getBoardByName\?input=/);
assert.equal(requests[2].options.method, "POST");
assert.deepEqual(JSON.parse(requests[2].options.body), { json: { boardId: "board-1" } });

process.stdout.write("PASS Homarr homelab notebook workflow\n");
