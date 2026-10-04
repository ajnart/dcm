#!/usr/bin/env bun

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ADDITIONAL_SERVICES_END, ADDITIONAL_SERVICES_START,
  configureNotebook, ensureHomelabNotebook, HomarrBoardApiClient, NOTEBOOK_MARKER, notebookContent,
  planHomelabNotebook, applyHomelabNotebook,
} from "./homarr-notebook.ts";
import { privateHandoffContents, redactedHandoffContents } from "./lib/session-context.ts";
import { recapHeight } from "./lib/homarr-recap-layout.ts";

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
assert.equal(recapHeight(content, 8), 6, "actual primary fixture desktop estimate");
assert.equal(recapHeight(content, 3), 14, "actual primary fixture mobile estimate");
assert.match(content, new RegExp(NOTEBOOK_MARKER));
assert.match(content, /ports are published on all host interfaces/);
const loopbackContent = notebookContent({ ...session, manifest: { ...session.manifest, HOMARR_BIND_ADDRESS: "127.0.0.1" } });
assert.match(loopbackContent, /ports are bound to this host only/);
assert.equal(loopbackContent.includes("published on all host interfaces"), false);
const privateAddressContent = notebookContent({ ...session, manifest: { ...session.manifest, HOMARR_BIND_ADDRESS: "192.168.1.20" } });
assert.match(privateAddressContent, /ports are bound to the selected private address 192\.168\.1\.20/);
assert.match(content, /Backups are not configured or verified/);
assert.match(content, /Pending:.*sources/i);
assert.match(content, /private-handoff\.json/);
assert.match(content, /default bridge searches and shows status/);
assert.match(content, /private connection or SSH tunnel/);
assert.match(content, /Approved movies go to Radarr/);
assert.match(content, /authorized Prowlarr source/);
for (const [service, name] of Object.entries({ prowlarr: "Prowlarr", radarr: "Radarr", sonarr: "Sonarr", qbittorrent: "qBittorrent", jellyfin: "Jellyfin", seerr: "Seerr", homarr: "Homarr" })) {
  assert.match(content, new RegExp(`<strong><a href="http://127\\.0\\.0\\.1:${session.manifest[`${service.toUpperCase()}_PORT`]}">${name}</a></strong>`));
  assert.match(content, new RegExp(`127\\.0\\.0\\.1:${session.manifest[`${service.toUpperCase()}_PORT`]}`));
}
assert.equal(content.includes(sessionRoot), false, "machine-specific absolute paths must not overwhelm the dashboard recap");
assert.match(content, /In media run <code>notebook-test<\/code>/);
assert.equal(content.includes("use the SSH tunnel below for private remote access"), false);
assert.equal(content.includes("API_KEY="), false);
assert.deepEqual(configureNotebook({ id: "board-1", name: "Personal" }, "Personal", content), {
  boardId: "board-1", kind: "notebook", options: { content, showToolbar: false, allowReadOnlyCheck: true }, integrationIds: [],
  size: { width: 8, height: 6 },
});

function clientFor(boardItems = [], options = {}) {
  const calls = [];
  let boardDetailQueryCount = 0;
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
      if (procedure === "board.getBoardByName") {
        boardDetailQueryCount += 1;
        if (typeof options.beforeBoardDetailResponse === "function") {
          options.beforeBoardDetailResponse(board, boardDetailQueryCount);
        }
        return structuredClone(board);
      }
      throw new Error("unexpected query");
    },
    async mutate(procedure, input) {
      calls.push({ operation: "mutate", procedure, input });
      if (procedure === "board.addItem") {
        boardItems.push({ id: "notebook-1", kind: input.kind, options: structuredClone(input.options), integrationIds: [], advancedOptions: {}, layouts: [
          { layoutId: "mobile", sectionId: "main", xOffset: 0, yOffset: 1, width: 3, height: input.size.height },
          { layoutId: "desktop", sectionId: "main", xOffset: 0, yOffset: 1, width: 8, height: input.size.height },
        ] });
        return { itemId: "notebook-1" };
      }
      if (procedure === "board.saveBoard") {
        assert.equal(input.id, board.id);
        board.sections.splice(0, board.sections.length, ...structuredClone(input.sections));
        boardItems.splice(0, boardItems.length, ...structuredClone(input.items));
        return { boardId: board.id };
      }
      assert.equal(procedure, "widget.notebook.updateContent");
      assert.equal(input.boardId, board.id);
      const notebook = boardItems.find((item) => item.id === input.itemId);
      assert.ok(notebook);
      notebook.options.content = input.content;
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
  "query:board.getBoardByName", "mutate:board.saveBoard", "query:board.getBoardByName",
]);
assert.equal(createdItems.length, 2);
assert.deepEqual(createdItems[0], preservedApp);
assert.deepEqual(createdItems[1].layouts, [
  { layoutId: "mobile", sectionId: "main", xOffset: 0, yOffset: 1, width: 3, height: 14 },
  { layoutId: "desktop", sectionId: "main", xOffset: 0, yOffset: 1, width: 8, height: 6 },
]);
assert.equal(statSync(join(sessionRoot, "artifacts", "board-access.json")).mode & 0o777, 0o600);
writeFileSync(join(sessionRoot, "artifacts", "mcp-client.json"), "{}\n", { mode: 0o600 });
const privateHandoff = JSON.parse(privateHandoffContents(session));
assert.equal(privateHandoff.homarrNotebook, "verified-at-recording");
assert.equal(privateHandoff.access.board.board.name, "Personal");
assert.equal(privateHandoff.access.board.urls.local, "http://127.0.0.1:21006/boards/Personal");
assert.equal(privateHandoff.mcp.clientConfig, join(sessionRoot, "artifacts", "mcp-client.json"));
assert.equal(privateHandoff.acceptance.startsWith("unverified by handoff"), true);
const redactedHandoff = redactedHandoffContents(session);
assert.match(redactedHandoff, /\[View dashboard\]\(http:\/\/127\.0\.0\.1:21006\/boards\/Personal\)/);
assert.match(redactedHandoff, /open on this host or establish the SSH tunnel above/);
assert.match(redactedHandoff, /private board and Notebook verified via API/);
assert.match(redactedHandoff, /board page rendering and overall acceptance remain unverified/);

const readableLayouts = [
  { layoutId: "mobile", sectionId: "main", xOffset: 0, yOffset: 0, width: 3, height: 14 },
  { layoutId: "desktop", sectionId: "main", xOffset: 0, yOffset: 0, width: 8, height: 6 },
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
const additionalBlock = `${ADDITIONAL_SERVICES_START}<h3>Additional services</h3><ul><li>Immich — photos</li></ul>${ADDITIONAL_SERVICES_END}`;
const extendedItems = [{ ...existing, id: "notebook-extended", options: { ...existing.options,
  content: `<h2>${NOTEBOOK_MARKER}</h2><p>old media recap</p>${additionalBlock}`,
} }];
assert.deepEqual(await ensureHomelabNotebook(clientFor(extendedItems), session, "Personal"), { created: false, updated: true });
assert.equal(extendedItems[0].options.content, content + additionalBlock);
assert.deepEqual(await ensureHomelabNotebook(clientFor(extendedItems), session, "Personal"), { created: false, updated: false });
const malformedItems = [{ ...existing, id: "notebook-malformed", options: { ...existing.options,
  content: `<h2>${NOTEBOOK_MARKER}</h2>${ADDITIONAL_SERVICES_START}<p>missing end</p>`,
} }];
await assert.rejects(ensureHomelabNotebook(clientFor(malformedItems), session, "Personal"), /markers are invalid/);
const tinyItems = [{ ...existing, id: "notebook-tiny", layouts: readableLayouts.map((layout) => ({ ...layout, width: 1, height: 1 })) }];
const resized = clientFor(tinyItems);
assert.deepEqual(await ensureHomelabNotebook(resized, session, "Personal"), { created: false, updated: true });
assert.deepEqual(tinyItems[0].layouts, readableLayouts);
assert.deepEqual(resized.calls.map(({ operation, procedure }) => `${operation}:${procedure}`), [
  "query:board.getAllBoards", "query:board.getBoardByName", "query:board.getBoardByName",
  "mutate:board.saveBoard", "query:board.getBoardByName",
]);
const staleItems = [{ ...existing, id: "notebook-stale", layouts: readableLayouts.map((layout) => ({ ...layout, width: 1, height: 1 })) }];
const stale = clientFor(staleItems, { beforeBoardDetailResponse(board, queryCount) {
  if (queryCount === 2) board.items[0].advancedOptions.title = "Concurrent edit";
} });
await assert.rejects(ensureHomelabNotebook(stale, session, "Personal"), /refusing a stale whole-board save/);
assert.equal(stale.calls.some(({ operation }) => operation === "mutate"), false);
const changedLayoutItems = [{ ...existing, id: "notebook-layout-readback", layouts: readableLayouts.map((layout) => ({ ...layout, width: 1, height: 1 })) }];
const changedLayout = clientFor(changedLayoutItems, { beforeBoardDetailResponse(board, queryCount) {
  if (queryCount === 3) board.layouts[0].columnCount = 4;
} });
await assert.rejects(ensureHomelabNotebook(changedLayout, session, "Personal"), /did not persist exactly with a readable layout/);
assert.equal(changedLayout.calls.filter(({ procedure }) => procedure === "board.saveBoard").length, 1);
const blockedLayouts = readableLayouts.map((layout) => ({ ...layout, width: 1, height: 1 }));
const blockingItem = { ...preservedApp, id: "blocking-app", layouts: [
  { layoutId: "mobile", sectionId: "main", xOffset: 0, yOffset: 1, width: 3, height: 1 },
  { layoutId: "desktop", sectionId: "main", xOffset: 0, yOffset: 1, width: 8, height: 1 },
] };
const blocked = clientFor([{ ...existing, id: "notebook-blocked", layouts: blockedLayouts }, blockingItem]);
await assert.rejects(ensureHomelabNotebook(blocked, session, "Personal"), /cannot be resized safely/);
assert.equal(blocked.calls.some(({ operation }) => operation === "mutate"), false);
const nonstandardOptions = [{ ...existing, options: { ...existing.options, showToolbar: true } }];
await assert.rejects(ensureHomelabNotebook(clientFor(nonstandardOptions), session, "Personal"), /browser fallback/);
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

const companion = { id: "companion-preserved", kind: "notebook", integrationIds: [], advancedOptions: {},
  options: { content: "private-companion-canary", showToolbar: false, allowReadOnlyCheck: true }, layouts: [
    { layoutId: "mobile", sectionId: "main", xOffset: 0, yOffset: 40, width: 3, height: 8 },
    { layoutId: "desktop", sectionId: "main", xOffset: 0, yOffset: 40, width: 8, height: 8 },
  ] };
const approvedItems = [structuredClone(companion)];
const approvedClient = clientFor(approvedItems);
const approvedPlan = await planHomelabNotebook(approvedClient, session, "Personal");
assert.equal(approvedPlan.actions.create, true);
assert.equal(approvedClient.calls.some(({ operation }) => operation === "mutate"), false);
assert.equal(JSON.stringify(approvedPlan).includes("private-companion-canary"), false);
assert.equal(JSON.stringify(approvedPlan).includes(content), false);
approvedItems[0].options.content = "concurrent-companion-change";
await assert.rejects(applyHomelabNotebook(approvedClient, session, "Personal", approvedPlan.approvalDigest), /approval/);
assert.equal(approvedClient.calls.some(({ operation }) => operation === "mutate"), false);
approvedItems[0].options.content = companion.options.content;
const approvedResult = await applyHomelabNotebook(approvedClient, session, "Personal", approvedPlan.approvalDigest);
assert.equal(approvedResult.mutation, true);
assert.deepEqual(approvedItems.find((item) => item.id === companion.id), companion);
assert.equal(approvedItems.length, 2);
const currentNotebookPlan = await planHomelabNotebook(approvedClient, session, "Personal");
assert.deepEqual(currentNotebookPlan.actions, { create: false, updateContent: false, resize: false });
const mutationCount = approvedClient.calls.filter(({ operation }) => operation === "mutate").length;
await applyHomelabNotebook(approvedClient, session, "Personal", currentNotebookPlan.approvalDigest);
assert.equal(approvedClient.calls.filter(({ operation }) => operation === "mutate").length, mutationCount);
assert.deepEqual(approvedItems.find((item) => item.id === companion.id), companion);

const plannedResizeItems = [{ ...structuredClone(existing), layouts: readableLayouts.map((layout) => ({ ...layout, width: 1, height: 1 })) },
  structuredClone(companion)];
const plannedResizeClient = clientFor(plannedResizeItems);
const resizePlan = await planHomelabNotebook(plannedResizeClient, session, "Personal");
assert.deepEqual(resizePlan.actions, { create: false, updateContent: false, resize: true });
assert.deepEqual(resizePlan.layoutDeltas, [
  { layoutId: "mobile", from: { width: 1, height: 1 }, to: { width: 3, height: 14 } },
  { layoutId: "desktop", from: { width: 1, height: 1 }, to: { width: 8, height: 6 } },
]);
assert.equal(plannedResizeClient.calls.some(({ operation }) => operation === "mutate"), false);
assert.equal((await applyHomelabNotebook(plannedResizeClient, session, "Personal", resizePlan.approvalDigest)).mutation, true);
assert.deepEqual(plannedResizeItems[0].layouts, readableLayouts);
assert.deepEqual(plannedResizeItems[1], companion);

const sharedMinimumItems = [structuredClone(existing), structuredClone(companion)];
const sharedMinimumClient = clientFor(sharedMinimumItems);
const sharedMinimumPlan = await planHomelabNotebook(sharedMinimumClient, session, "Personal");
assert.deepEqual(sharedMinimumPlan.actions, { create: false, updateContent: false, resize: false });
assert.deepEqual(sharedMinimumPlan.layoutDeltas, []);
assert.equal((await applyHomelabNotebook(sharedMinimumClient, session, "Personal", sharedMinimumPlan.approvalDigest)).mutation, false);
assert.equal(sharedMinimumClient.calls.some(({ operation }) => operation === "mutate"), false);
assert.deepEqual(sharedMinimumItems[0], existing, "attachment-sized primary must not regrow");
const oversizedItems = [{ ...structuredClone(existing), layouts: readableLayouts.map((layout) => ({ ...layout, height: layout.height + 2 })) }];
const oversizedBefore = structuredClone(oversizedItems);
const oversizedClient = clientFor(oversizedItems);
const oversizedPlan = await planHomelabNotebook(oversizedClient, session, "Personal");
assert.equal((await applyHomelabNotebook(oversizedClient, session, "Personal", oversizedPlan.approvalDigest)).mutation, false);
assert.deepEqual(oversizedItems, oversizedBefore, "canonical reconciliation must remain grow-only");

const targetDrifts = [
  (note) => { note.layouts.find((layout) => layout.layoutId === "desktop").xOffset += 1; },
  (note) => { note.layouts.find((layout) => layout.layoutId === "desktop").yOffset += 1; },
  (note) => { note.layouts.find((layout) => layout.layoutId === "desktop").width += 1; },
  (note) => { note.integrationIds.push("unapproved-integration"); },
  (note) => { note.options.unapprovedOption = true; },
  (note) => { note.advancedOptions.unapprovedOption = true; },
];
for (const drift of targetDrifts) {
  const driftItems = [{ ...structuredClone(existing), options: { ...existing.options, content: `<h2>${NOTEBOOK_MARKER}</h2><p>old</p>` } },
    structuredClone(companion)];
  const driftClient = clientFor(driftItems);
  const driftPlan = await planHomelabNotebook(driftClient, session, "Personal");
  const mutate = driftClient.mutate.bind(driftClient);
  driftClient.mutate = async (procedure, input) => {
    const result = await mutate(procedure, input);
    if (procedure === "widget.notebook.updateContent") drift(driftItems[0]);
    return result;
  };
  await assert.rejects(applyHomelabNotebook(driftClient, session, "Personal", driftPlan.approvalDigest), /target did not persist exactly/);
}
for (const drift of [targetDrifts[3], targetDrifts[4]]) {
  const creationItems = [structuredClone(companion)];
  const creationClient = clientFor(creationItems);
  const creationPlan = await planHomelabNotebook(creationClient, session, "Personal");
  const mutate = creationClient.mutate.bind(creationClient);
  creationClient.mutate = async (procedure, input) => {
    const result = await mutate(procedure, input);
    if (procedure === "board.addItem") drift(creationItems.find((item) => item.id === "notebook-1"));
    return result;
  };
  await assert.rejects(applyHomelabNotebook(creationClient, session, "Personal", creationPlan.approvalDigest), /requested configuration/);
}

process.stdout.write("PASS Homarr homelab notebook workflow and bounded approval\n");
