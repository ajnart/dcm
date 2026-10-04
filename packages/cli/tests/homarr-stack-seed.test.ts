import assert from "node:assert/strict";
import { applyHomarrStackSeed, planHomarrStackSeed, type HomarrStackSeedService } from "../src/lib/homarr-stack-seed.ts";
import { homarrStackMapping } from "../src/lib/homarr-stack-mapping.ts";

// Synthetic release/v2 tRPC contract fixture; not live service/render acceptance.
const service: HomarrStackSeedService = { id: "sonarr", appName: "Sonarr", browserUrl: "http://127.0.0.1:8989/",
  serverUrl: "http://sonarr:8989/", credentials: { apiKey: "private-fixture-secret" } };
function fixture(selected = service) {
  const app = { id: "app-1", name: selected.appName, href: selected.browserUrl,
    iconUrl: "https://example.test/icon.svg", description: "Saved user description", pingUrl: null as string | null };
  const tile = { id: "tile-1", kind: "app", options: { appId: app.id }, integrationIds: [] };
  const unrelated = { id: "clock-1", kind: "clock", options: { timezone: "UTC" }, integrationIds: [] };
  const board = { id: "board-1", name: "personal", isPublic: false, sections: [{ id: "main", kind: "empty" }], items: [tile, unrelated] as any[] };
  const integrations: any[] = [];
  const calls: string[] = [];
  let createError = false;
  let lostCreate = false;
  let lostItem = false;
  let lostPing = false;
  let rejectPing = false;
  let alternatives: string[][] = [["apiKey"]];
  let linkedAppId = app.id;
  let kind = "sonarr";
  if (selected.id === "beszel") { kind = "beszel"; alternatives = [["username", "password"]]; }
  if (selected.id === "immich") kind = "immich";
  if (selected.id === "qbittorrent") { kind = "qBittorrent"; alternatives = [["username", "password"], ["apiKey"]]; }
  const client = {
    async query(procedure: string, input?: any): Promise<unknown> {
      if (procedure === "board.getAllBoards") return [{ id: board.id, name: board.name, isPublic: board.isPublic }];
      if (procedure === "board.getBoardByName") return structuredClone(board);
      if (procedure === "board.getBoardSettings") return { id: board.id, name: board.name };
      if (procedure === "app.all") return [structuredClone(app)];
      if (procedure === "integration.all") return structuredClone(integrations);
      if (procedure === "integration.getKinds") return [{ kind, requiredSecrets: alternatives }];
      if (procedure === "widget.stats.catalog") return { name: `Auto-Stack: ${selected.id}`,
        metrics: (homarrStackMapping(selected.id)?.widgets.find((widget) => widget.kind === "stats")?.metrics ?? [])
          .map((key) => ({ key, label: key, unit: "count" })) };
      if (procedure === "integration.byId") {
        const entry = integrations.find((entry) => entry.id === input.id);
        return { ...entry, app: { id: linkedAppId }, secrets: Object.keys(selected.credentials).map((kind) => ({ kind, value: null, updatedAt: "2026-09-30" })) };
      }
      throw new Error(`Unexpected query: ${procedure}`);
    },
    async mutate(procedure: string, input: any): Promise<unknown> {
      calls.push(procedure);
      if (procedure === "app.update") {
        assert.deepEqual(input, { ...app, pingUrl: selected.serverUrl });
        if (rejectPing) return undefined;
        app.pingUrl = input.pingUrl;
        if (lostPing) throw new Error("response lost after commit");
        return undefined;
      }
      if (procedure === "integration.create") {
        // release/v2 returns {error} on failed connection without inserting.
        if (createError) return { error: { message: "connection-failed" } };
        const entry = { id: "integration-1", name: input.name, kind: input.kind, url: input.url,
          permissions: { hasFullAccess: true, hasUseAccess: true } };
        integrations.push(entry);
        if (lostCreate) throw new Error("response lost after commit");
        return { integration: entry, appId: app.id };
      }
      if (procedure === "board.addItem") {
        const itemId = `widget-${board.items.length}`;
        board.items.push({ id: itemId, kind: input.kind, options: input.options, integrationIds: input.integrationIds });
        if (lostItem) throw new Error("response lost after commit");
        return { itemId };
      }
      throw new Error(`Unexpected mutation: ${procedure}`);
    },
  };
  return { client, app, board, integrations, calls, unrelated,
    failCreate() { createError = true; }, loseResponses() { lostCreate = true; lostItem = true; lostPing = true; },
    rejectPing() { rejectPing = true; },
    breakLink() { linkedAppId = "other-app"; },
    setAlternatives(value: string[][]) { alternatives = value; } };
}
{
  const f = fixture();
  const original = structuredClone(f.board.items);
  const plan = await planHomarrStackSeed(f.client, "personal", [service]);
  assert.equal(plan.services[0].widgets.length, 3);
  assert.deepEqual(plan.services[0].pingTarget, { old: null, new: service.serverUrl, changeRequired: true });
  assert.equal(f.calls.length, 0);
  const report = await applyHomarrStackSeed(f.client, "personal", [service], plan.approval);
  assert.equal(report.services[0].connection, "tested-by-create");
  assert.equal(report.renderedContentVerified, false);
  assert.deepEqual(f.board.items.slice(0, 2), original);
  assert.deepEqual(f.calls, ["app.update", "integration.create", "board.addItem", "board.addItem", "board.addItem"]);
  assert.deepEqual(report.services[0].pingTarget, { old: null, new: service.serverUrl, changed: true, persisted: true });
  assert.equal(JSON.stringify({ plan, report }).includes(service.credentials.apiKey), false);
  const replay = await planHomarrStackSeed(f.client, "personal", [service]);
  const retained = await applyHomarrStackSeed(f.client, "personal", [service], replay.approval);
  assert.equal(retained.services[0].connection, "not-retested");
  assert.equal(f.calls.length, 5);
}
{
  const distinct = { ...service, integrationUrl: "https://sonarr.localhost:4443" };
  const f = fixture(distinct);
  const plan = await planHomarrStackSeed(f.client, "personal", [distinct]);
  assert.equal(plan.services[0].integrationUrl, distinct.integrationUrl);
  await applyHomarrStackSeed(f.client, "personal", [distinct], plan.approval);
  assert.equal(f.integrations[0].url, distinct.integrationUrl);
  assert.equal(f.app.pingUrl, distinct.serverUrl);
  assert.equal(f.app.href, distinct.browserUrl);
}
{
  const f = fixture(); f.loseResponses();
  const plan = await planHomarrStackSeed(f.client, "personal", [service]);
  const report = await applyHomarrStackSeed(f.client, "personal", [service], plan.approval);
  assert.equal(report.services[0].createResponseObserved, false);
  assert.equal(f.integrations.length, 1); assert.equal(f.calls.length, 5);
  assert.equal(report.services[0].pingTarget.persisted, true);
}
{
  const f = fixture(); f.failCreate();
  const plan = await planHomarrStackSeed(f.client, "personal", [service]);
  await assert.rejects(() => applyHomarrStackSeed(f.client, "personal", [service], plan.approval), /did not persist/);
  assert.deepEqual(f.calls, ["app.update", "integration.create"]);
}
{
  const f = fixture();
  const plan = await planHomarrStackSeed(f.client, "personal", [service]);
  f.board.items[1].options.timezone = "Europe/Berlin";
  await assert.rejects(() => applyHomarrStackSeed(f.client, "personal", [service], plan.approval), /stale/);
  assert.equal(f.calls.length, 0);
  f.app.href = "http://127.0.0.1:9999/";
  await assert.rejects(() => planHomarrStackSeed(f.client, "personal", [service]), /exact app tile/);
}
{
  const f = fixture();
  f.integrations.push({ id: "other", name: "User-owned Sonarr", kind: "sonarr", url: service.serverUrl });
  await assert.rejects(() => planHomarrStackSeed(f.client, "personal", [service]), /conflicts/);
  assert.equal(f.calls.length, 0);
}
{
  const f = fixture(); f.setAlternatives([["username", "password"]]);
  await assert.rejects(() => planHomarrStackSeed(f.client, "personal", [service]), /credential combination/);
  f.setAlternatives(["apiKey"] as unknown as string[][]);
  await assert.rejects(() => planHomarrStackSeed(f.client, "personal", [service]), /schema/);
}
{
  const f = fixture();
  const plan = await planHomarrStackSeed(f.client, "personal", [service]);
  await assert.rejects(() => applyHomarrStackSeed(f.client, "personal", [{ ...service, credentials: { apiKey: "changed-key" } }], plan.approval), /stale/);
  assert.equal(f.calls.length, 0);
  await applyHomarrStackSeed(f.client, "personal", [service], plan.approval);
  f.breakLink();
  await assert.rejects(() => planHomarrStackSeed(f.client, "personal", [service]), /linked to the exact app/);
}
for (const candidate of [
  { ...service, id: "immich", appName: "Immich" },
  { ...service, id: "beszel", appName: "Beszel", credentials: { username: "private-user", password: "private-pass" } },
  { ...service, id: "qbittorrent", appName: "qBittorrent" },
]) {
  const f = fixture(candidate);
  const plan = await planHomarrStackSeed(f.client, "personal", [candidate]);
  assert.equal(plan.services[0].widgets.some((widget) => ["immich-albumCarousel", "beszelSystemStats"].includes(widget.kind)), false);
  assert.equal(f.calls.length, 0);
}
{
  const tileOnly = { ...service, id: "grafana", appName: "Grafana", credentials: {} };
  const f = fixture(tileOnly);
  const before = structuredClone(f.app);
  const plan = await planHomarrStackSeed(f.client, "personal", [tileOnly]);
  assert.equal(plan.services[0].tileOnly, true);
  assert.deepEqual(plan.services[0].pingTarget, { old: null, new: tileOnly.serverUrl, changeRequired: true });
  const report = await applyHomarrStackSeed(f.client, "personal", [tileOnly], plan.approval);
  assert.deepEqual(f.calls, ["app.update"]);
  assert.deepEqual(f.app, { ...before, pingUrl: tileOnly.serverUrl });
  assert.equal(report.services[0].pingTarget.persisted, true);
}
{
  const f = fixture();
  f.app.pingUrl = "http://custom-health:8080/";
  await assert.rejects(() => planHomarrStackSeed(f.client, "personal", [service]), /separately approved repair/);
  assert.equal(f.calls.length, 0);
}
{
  const f = fixture();
  const plan = await planHomarrStackSeed(f.client, "personal", [service]);
  f.app.pingUrl = service.serverUrl;
  await assert.rejects(() => applyHomarrStackSeed(f.client, "personal", [service], plan.approval), /stale/);
  assert.equal(f.calls.length, 0);
}
{
  const f = fixture(); f.rejectPing();
  const plan = await planHomarrStackSeed(f.client, "personal", [service]);
  await assert.rejects(() => applyHomarrStackSeed(f.client, "personal", [service], plan.approval), /ping target update is uncertain/);
  assert.deepEqual(f.calls, ["app.update"]);
  assert.equal(f.app.pingUrl, null);
}
console.log("PASS synthetic Homarr stack seed contract (not live acceptance)");
