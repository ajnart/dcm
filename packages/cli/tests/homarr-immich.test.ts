import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homarrAttachCommand } from "../src/homarr-attach.ts";
import { parseImmichApiKey } from "../src/homarr-immich.ts";

const root = mkdtempSync(join(tmpdir(), "selfhost-homarr-immich-"));
const inputFile = join(root, "input.json");
const homarrKeyFile = join(root, "homarr.key");
const immichKeyFile = join(root, "immich.key");
const acceptanceFile = join(root, "acceptance.json");
writeFileSync(inputFile, JSON.stringify({
  schemaVersion: 1,
  homarr: { origin: "http://127.0.0.1:7575", boardName: "personal" },
  immich: {
    appName: "Immich", integrationName: "Immich home", url: "http://immich-server:2283/",
    widgets: [
      { kind: "immich-serverStats", options: { showUsers: true, showPhotos: true, showVideos: true, showStorage: true } },
      { kind: "immich-albumCarousel", options: { albumId: "all", rotationIntervalSeconds: 5, showPhotoInfo: false, randomizePhotos: false } },
    ],
  },
}), { mode: 0o600 });
writeFileSync(homarrKeyFile, "fixture-homarr-key-value-123456\n", { mode: 0o600 });
writeFileSync(immichKeyFile, "fixture-immich-key-value-123456!\n", { mode: 0o600 });
assert.equal(parseImmichApiKey("fixture-immich-key-value-123456!\n"), "fixture-immich-key-value-123456!");
assert.throws(() => parseImmichApiKey("HOMARR_API_KEY=fixture-value\n"), /raw key/);
writeFileSync(acceptanceFile, JSON.stringify({
  schemaVersion: 1, kind: "immich-service-acceptance", service: "immich", integrationUrl: "http://immich-server:2283/", status: "accepted",
  checks: [
    { id: "admin-login", status: "pass", evidenceRefs: ["browser:login"] },
    { id: "release-version", status: "pass", evidenceRefs: ["browser:version"] },
    { id: "test-image-upload-retrieval", status: "pass", evidenceRefs: ["browser:test-image"] },
  ],
}), { mode: 0o600 });

const appTile = { id: "tile-immich", kind: "app", options: { appId: "app-immich" }, integrationIds: [],
  layouts: [{ layoutId: "desktop", sectionId: "main", xOffset: 0, yOffset: 0, width: 2, height: 1 },
    { layoutId: "mobile", sectionId: "main", xOffset: 0, yOffset: 0, width: 2, height: 1 }] };
const unrelated = { id: "unrelated", kind: "clock", options: { timezone: "Europe/Berlin" }, integrationIds: [],
  layouts: [{ layoutId: "desktop", sectionId: "main", xOffset: 2, yOffset: 0, width: 2, height: 2 },
    { layoutId: "mobile", sectionId: "main", xOffset: 0, yOffset: 1, width: 2, height: 2 }] };
const board = { id: "board-personal", name: "personal", isPublic: false,
  layouts: [{ id: "desktop", columnCount: 12, leftGutterColumnCount: 0, rightGutterColumnCount: 0 },
    { id: "mobile", columnCount: 2, leftGutterColumnCount: 0, rightGutterColumnCount: 0 }],
  sections: [{ id: "main", kind: "empty", xOffset: 0, yOffset: 0 }], items: [appTile, unrelated] };
const apps = [{ id: "app-immich", name: "Immich", href: "http://127.0.0.1:2283/" }];
const integrations: Record<string, unknown>[] = [{ id: "integration-other", name: "Immich cabin", kind: "immich",
  url: "http://immich-cabin:2283/", permissions: { hasFullAccess: true, hasUseAccess: true, hasInteractAccess: true } }];
const calls: Array<{ procedure: string; input: unknown }> = [];
let nextItem = 0;
let failLive = false;
let failCarousel = false;
let emptyCarousel = false;
let failSaveResponse = false;
let changeBoardBeforeSave = false;
let changeAfterBoardReads = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (endpoint, request) => {
  const requestUrl = new URL(String(endpoint));
  const procedure = requestUrl.pathname.split("/").at(-1) ?? "";
  const options = request as RequestInit;
  assert.equal((options.headers as Record<string, string>).ApiKey, "fixture-homarr-key-value-123456");
  let input: any;
  if (options.method === "POST") input = JSON.parse(String(options.body)).json;
  if (options.method !== "POST" && requestUrl.searchParams.has("input")) input = JSON.parse(requestUrl.searchParams.get("input") as string).json;
  calls.push({ procedure, input });
  let result: unknown;
  if (procedure === "integration.getKinds") result = [{ kind: "immich", name: "Immich", requiredSecrets: [["apiKey"]] }];
  else if (procedure === "board.getAllBoards") result = [{ id: board.id, name: board.name, isPublic: false }];
  else if (procedure === "board.getBoardByName") {
    if (changeAfterBoardReads > 0) {
      changeAfterBoardReads -= 1;
      if (changeAfterBoardReads === 0) changeBoardBeforeSave = true;
    }
    if (changeBoardBeforeSave) { board.items.find((item) => item.id === unrelated.id)!.options.timezone = "UTC"; changeBoardBeforeSave = false; }
    result = structuredClone(board);
  }
  else if (procedure === "board.getBoardSettings") result = { id: board.id, name: board.name };
  else if (procedure === "app.all") result = structuredClone(apps);
  else if (procedure === "integration.all") result = structuredClone(integrations);
  else if (procedure === "integration.byId") {
    const integration = integrations.find((candidate) => candidate.id === input.id);
    result = { ...integration, app: apps[0], secrets: [{ kind: "apiKey", value: null }] };
  }
  else if (procedure === "integration.create") {
    assert.equal(input.kind, "immich");
    assert.equal(input.secrets[0].value, "fixture-immich-key-value-123456!");
    assert.deepEqual(input.app, { id: "app-immich" });
    integrations.push({ id: "integration-immich", name: input.name, kind: input.kind, url: input.url,
      permissions: { hasFullAccess: true, hasUseAccess: true, hasInteractAccess: true } });
    result = { integration: integrations[1], appId: "app-immich" };
  } else if (procedure === "board.addItem") {
    assert.equal(input.boardId, board.id);
    assert.deepEqual(input.integrationIds, ["integration-immich"]);
    nextItem += 1;
    if (input.kind === "immich-serverStats") assert.deepEqual(input.size, { width: 4, height: 2 });
    if (input.kind === "immich-albumCarousel") assert.equal(Object.hasOwn(input, "size"), false);
    board.items.push({ id: `widget-${nextItem}`, kind: input.kind, options: input.options,
      integrationIds: input.integrationIds, layouts: board.layouts.map((layout) => ({ layoutId: layout.id,
        sectionId: "main", xOffset: 0, yOffset: nextItem * 4, width: Math.min(input.size?.width ?? 1, layout.columnCount),
        height: input.size?.height ?? 1 })) });
    result = { itemId: `widget-${nextItem}` };
  } else if (procedure === "board.saveBoard") {
    assert.equal(input.id, board.id);
    assert.deepEqual(input.sections, board.sections);
    board.items = structuredClone(input.items);
    if (failSaveResponse) return new Response("lost response", { status: 503 });
    result = null;
  } else if (procedure === "widget.immich.getServerStats") {
    if (failLive) return new Response("unavailable", { status: 503 });
    assert.equal(input.integrationId, "integration-immich");
    result = { userCount: 2, photoCount: 12, videoCount: 3, totalLibraryUsageInBytes: 4096 };
  } else if (procedure === "widget.immich.getAlbums") {
    assert.deepEqual(input, { integrationId: "integration-immich", limit: 1 });
    result = [{ id: "album-1", albumName: "Family", assetCount: 8 }];
  } else if (procedure === "widget.immich.getAlbum") {
    if (failCarousel) return new Response("unavailable", { status: 503 });
    assert.deepEqual(input, { integrationId: "integration-immich" });
    result = { id: "", albumName: "", assets: [{ id: "asset-1", type: "IMAGE", publicLink: "/api/image-proxy/asset-1" }] };
    if (emptyCarousel) result = { id: "", albumName: "", assets: [] };
  } else assert.fail(`Unexpected procedure ${procedure}`);
  return new Response(JSON.stringify({ result: { data: { json: result } } }), { status: 200 });
};

const output: string[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = ((value: string) => { output.push(value); return true; }) as typeof process.stdout.write;
const common = ["--input", inputFile, "--api-key-file", homarrKeyFile, "--immich-api-key-file", immichKeyFile,
  "--acceptance-file", acceptanceFile];
try {
  await homarrAttachCommand(["immich", "plan", ...common]);
  const plan = JSON.parse(output.pop() as string);
  assert.match(plan.approval, /^ATTACH-IMMICH:board-personal:[a-f0-9]{64}$/);
  assert.equal(plan.alreadyCurrent, false);
  writeFileSync(immichKeyFile, "changed-immich-key-value-123456!\n", { mode: 0o600 });
  await assert.rejects(homarrAttachCommand(["immich", "apply", ...common, "--approve", plan.approval]), /credential state/);
  assert.equal(calls.filter((call) => call.procedure === "integration.create").length, 0);
  writeFileSync(immichKeyFile, "fixture-immich-key-value-123456!\n", { mode: 0o600 });
  await homarrAttachCommand(["immich", "apply", ...common, "--approve", plan.approval]);
  const applied = JSON.parse(output.pop() as string);
  assert.equal(applied.status, "attached");
  assert.equal(applied.integrationVerified, true);
  assert.equal(applied.serviceAcceptanceRecorded, true);
  assert.equal(Object.hasOwn(applied, "serviceAcceptanceVerified"), false);
  assert.deepEqual(applied.widgetKinds, ["immich-serverStats", "immich-albumCarousel"]);
  assert.deepEqual(board.items.slice(0, 2), [appTile, unrelated]);
  assert.equal(calls.filter((call) => call.procedure === "integration.create").length, 1);
  assert.equal(calls.filter((call) => call.procedure === "board.addItem").length, 2);
  const stats = board.items.find((item) => item.kind === "immich-serverStats")!;
  assert.deepEqual(stats.layouts.map((layout) => [layout.width, layout.height]), [[4, 2], [2, 2]]);
  const othersBefore = structuredClone(board.items.filter((item) => item.id !== stats.id));
  for (const layout of stats.layouts) { layout.width = 1; layout.height = 1; layout.xOffset = 1; layout.yOffset = 0; }
  await homarrAttachCommand(["immich", "layout-plan", ...common]);
  const layoutPlan = JSON.parse(output.pop() as string);
  assert.match(layoutPlan.approval, /^RESIZE-IMMICH-STATS:board-personal:[a-f0-9]{64}$/);
  assert.equal(layoutPlan.alreadyCurrent, false);
  const mutationsBefore = calls.filter((call) => call.procedure === "board.saveBoard").length;
  await assert.rejects(homarrAttachCommand(["immich", "layout-apply", ...common, "--approve", plan.approval]), /layout approval/);
  assert.equal(calls.filter((call) => call.procedure === "board.saveBoard").length, mutationsBefore);
  failSaveResponse = true;
  await homarrAttachCommand(["immich", "layout-apply", ...common, "--approve", layoutPlan.approval]);
  assert.equal(JSON.parse(output.pop() as string).status, "stats-layout-current");
  failSaveResponse = false;
  const resizedStats = board.items.find((item) => item.id === stats.id)!;
  assert.deepEqual(board.items.filter((item) => item.id !== stats.id), othersBefore);
  assert.deepEqual(resizedStats.options, stats.options);
  assert.deepEqual(resizedStats.integrationIds, stats.integrationIds);
  assert.deepEqual(resizedStats.layouts.map((layout) => [layout.xOffset, layout.yOffset, layout.width, layout.height]),
    [[0, 9, 4, 2], [0, 9, 2, 2]]);
  await homarrAttachCommand(["immich", "layout-plan", ...common]);
  const currentLayoutPlan = JSON.parse(output.pop() as string);
  assert.equal(currentLayoutPlan.alreadyCurrent, true);
  changeBoardBeforeSave = true;
  await assert.rejects(homarrAttachCommand(["immich", "layout-apply", ...common, "--approve", currentLayoutPlan.approval]), /snapshot/);
  board.items.find((item) => item.id === unrelated.id)!.options.timezone = "Europe/Berlin";
  changeAfterBoardReads = 2;
  await assert.rejects(homarrAttachCommand(["immich", "layout-apply", ...common, "--approve", currentLayoutPlan.approval]), /changed before/);
  assert.equal(calls.filter((call) => call.procedure === "board.saveBoard").length, mutationsBefore + 1,
    "stale or concurrently changed boards must not be saved");
  board.items.find((item) => item.id === unrelated.id)!.options.timezone = "Europe/Berlin";
  await homarrAttachCommand(["immich", "status", ...common]);
  const status = JSON.parse(output.pop() as string);
  assert.equal(status.status, "attached");
  assert.equal(status.integrationVerified, true);
  assert.equal(calls.filter((call) => call.procedure === "widget.immich.getAlbum").length, 2);
  failCarousel = true;
  await homarrAttachCommand(["immich", "status", ...common]);
  const carouselUnavailable = JSON.parse(output.pop() as string);
  assert.equal(carouselUnavailable.status, "attached-live-unverified");
  assert.equal(carouselUnavailable.integrationVerified, false);
  failCarousel = false;
  emptyCarousel = true;
  await homarrAttachCommand(["immich", "status", ...common]);
  const empty = JSON.parse(output.pop() as string);
  assert.equal(empty.status, "attached-live-unverified");
  assert.equal(empty.integrationVerified, false);
  emptyCarousel = false;
  failLive = true;
  await homarrAttachCommand(["immich", "status", ...common]);
  const unavailable = JSON.parse(output.pop() as string);
  assert.equal(unavailable.status, "attached-live-unverified");
  assert.equal(unavailable.integrationVerified, false);
} finally {
  process.stdout.write = originalWrite as typeof process.stdout.write;
  globalThis.fetch = originalFetch;
}
process.stdout.write("PASS Homarr native Immich attachment fixture\n");
