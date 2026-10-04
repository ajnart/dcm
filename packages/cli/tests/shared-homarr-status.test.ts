import assert from "node:assert/strict";
import { checkSharedHomarrServices, inspectSharedHomarrServices } from "../src/shared-homarr.ts";
import { recapHeight, validateInput } from "../src/homarr-attach.ts";
import { dashboardRecap } from "../src/control-panel/dashboard-recap.ts";
import { homarrStackWidgets } from "../src/lib/homarr-stack-mapping.ts";

const input = validateInput({ schemaVersion: 2,
  homarr: { origin: "http://127.0.0.1:41070", boardName: "personal" },
  service: { id: "sonarr", name: "Sonarr", description: "Organizes TV shows.",
    href: "http://127.0.0.1:41071", iconUrl: "https://example.test/sonarr.svg",
    access: "local", storagePath: null, credentialFile: null } });
const selected = { input, seed: { id: "sonarr", appName: input.service.name,
  browserUrl: input.service.href, serverUrl: "http://sonarr:8989/",
  credentials: {} } };
function fixture() {
  const app = { id: "app-sonarr", name: input.service.name, href: input.service.href,
    iconUrl: input.service.iconUrl, description: input.service.description };
  const tile = { id: "tile-sonarr", kind: "app", options: { appId: app.id }, integrationIds: [],
    layouts: [{ layoutId: "desktop", sectionId: "main", xOffset: 0, yOffset: 0, width: 2, height: 1 }] };
  const board = { id: "board-personal", name: "personal", isPublic: false,
    sections: [{ id: "main", kind: "empty" }], items: [tile] as any[] };
  const integration = { id: "integration-sonarr", name: "Auto-Stack: sonarr", kind: "sonarr",
    url: selected.seed.serverUrl, permissions: { hasFullAccess: true, hasUseAccess: true } };
  let duplicateBoard = false;
  let duplicateApp = false;
  let writes = 0;
  const calls: string[] = [];
  const client = {
    async query(procedure: string, _input?: unknown): Promise<unknown> {
      calls.push(procedure);
      if (procedure === "board.getAllBoards") {
        const rows = [{ id: board.id, name: board.name, isPublic: board.isPublic }];
        if (duplicateBoard) rows.push({ ...rows[0], id: "duplicate" });
        return rows;
      }
      if (procedure === "board.getBoardByName") return structuredClone(board);
      if (procedure === "board.getBoardSettings") return { id: board.id, name: board.name };
      if (procedure === "app.all") {
        if (duplicateApp) return [app, { ...app, id: "duplicate" }];
        return [app];
      }
      if (procedure === "integration.all") return [integration];
      if (procedure === "integration.byId") return { ...integration, app: { id: app.id },
        secrets: [{ kind: "apiKey", value: "NEVER-EMIT-PRIVATE-FIXTURE", updatedAt: "2026-10-03" }] };
      if (procedure === "widget.stats.catalog") return { name: integration.name,
        metrics: ["shows", "downloaded", "missing", "queued"].map((key) => ({ key, label: key, unit: "count" })) };
      throw new Error(`Unexpected query: ${procedure}`);
    },
    async mutate(): Promise<never> { writes += 1; throw new Error("Status must never mutate"); },
  };
  return { client, board, tile, app, calls, writes: () => writes,
    duplicateBoard() { duplicateBoard = true; },
    duplicateApp() { duplicateApp = true; } };
}
{
  const f = fixture();
  const missing = await inspectSharedHomarrServices(f.client, "personal", [selected]);
  assert.equal(missing.status, "needs-attachment");
  assert.equal(missing.mutation, false);
  assert.equal(missing.apiKeyAuthorizationVerified, true);
  assert.equal(missing.services[0].metadataVerified, true);
  assert.equal(missing.services[0].structureVerified, true);
  assert.equal(missing.services[0].notebookContentVerified, false);
  assert.equal(missing.services[0].integrationStructureVerified, true);
  assert.equal(missing.services[0].widgetStructureVerified, false);
  assert.deepEqual(missing.services[0].widgets, [
    { kind: "calendar", present: false }, { kind: "mediaMissing", present: false }, { kind: "stats", present: false } ]);
  assert.equal(missing.serviceRuntimeVerified, false);
  assert.equal(missing.renderedContentVerified, false);
  assert.equal(JSON.stringify(missing).includes("NEVER-EMIT-PRIVATE-FIXTURE"), false);
  for (const procedure of ["board.getAllBoards", "board.getBoardByName", "board.getBoardSettings",
    "app.all", "integration.all", "integration.byId"]) {
    assert.equal(f.calls.filter((called) => called === procedure).length, 1,
      `${procedure} must be memoized within one status invocation`);
  }
  for (const widget of homarrStackWidgets("sonarr", {}, "integration-sonarr")) {
    f.board.items.push({ id: widget.kind, kind: widget.kind, options: widget.options, integrationIds: ["integration-sonarr"] });
  }
  const widgets = await inspectSharedHomarrServices(f.client, "personal", [selected]);
  assert.equal(widgets.services[0].widgetStructureVerified, true);
  assert.equal(widgets.services[0].notebookContentVerified, false);
  assert.equal(widgets.status, "needs-attachment");
  assert.equal(f.calls.filter((procedure) => procedure === "board.getBoardByName").length, 2,
    "query caches must never survive an invocation");
  // Independently assembled owned-recap fixture: inspect must read it, never create it.
  const service = Object.fromEntries(Object.entries(input.service).sort(([a], [b]) => a.localeCompare(b)));
  const encoded = Buffer.from(JSON.stringify([service])).toString("base64url");
  const content = "<h2>Your homelab at a glance</h2><p>This private board links your self-hosted services. Dashboard shortcuts do not prove integrations or runtime health.</p>"
    + `<!-- selfhost-additional-services:start -->\n<!-- selfhost-additional-services:data:${encoded} -->\n`
    + `<h3>Your services</h3><ul><li><strong>Sonarr</strong> — Organizes TV shows. <a href="${input.service.href}">Open Sonarr</a> (Docker-host browser only; not a remote link). `
    + "Storage path not recorded by this attachment. Credentials are managed outside this attachment. Backup restore has not been verified by this attachment.</li></ul>\n"
    + "<!-- selfhost-additional-services:end -->";
  f.board.items.push({ id: "recap", kind: "notebook", options: { content }, integrationIds: [],
    layouts: [{ layoutId: "desktop", sectionId: "main", xOffset: 0, yOffset: 4,
      width: 8, height: recapHeight(content, 8) }] });
  const complete = await inspectSharedHomarrServices(f.client, "personal", [selected]);
  assert.equal(complete.status, "attached");
  assert.equal(complete.services[0].notebookContentVerified, true);
  assert.equal(complete.services[0].notebookLayoutVerified, true);
  assert.equal(f.writes(), 0);
  assert.ok(f.calls.every((procedure) => !["integration.test", "apiKeys.create",
    "user.initUser", "onboard.completeSetup"].includes(procedure)));
}
{
  const f = fixture();
  const restricted = { ...selected, nativeEligibility: { eligible: false,
    reasonCode: "native-recipe-contract-changed", requirement: "Review the saved recipe." } };
  const status = await inspectSharedHomarrServices(f.client, "personal", [restricted]);
  assert.equal(status.services[0].metadataVerified, true, "Recipe drift must retain tile inspection");
  assert.equal(status.services[0].structureVerified, true);
  assert.equal(status.services[0].nativeIntegrationReason, "native-recipe-contract-changed");
  assert.equal(status.services[0].integrationStructureVerified, false);
  assert.equal(status.services[0].widgetStructureVerified, false);
  assert.equal(status.services[0].connectionVerification, "blocked-native");
  assert.ok(!f.calls.includes("integration.all"), "Restrictive context must prevent native structural lookup");
  assert.deepEqual(await checkSharedHomarrServices(f.client, "personal", [restricted], async () => {
    throw new Error("Blocked native services must not run stored integration checks");
  }), []);
  assert.ok(f.calls.every((procedure) => !procedure.startsWith("widget.")));
  assert.equal(f.writes(), 0);
}
{
  const f = fixture(); f.board.isPublic = true;
  await assert.rejects(() => inspectSharedHomarrServices(f.client, "personal", [selected]), /private/);
  assert.equal(f.writes(), 0);
}
{
  const f = fixture(); f.duplicateBoard();
  await assert.rejects(() => inspectSharedHomarrServices(f.client, "personal", [selected]), /private/);
  assert.equal(f.writes(), 0);
}
{
  const f = fixture(); f.duplicateApp();
  await assert.rejects(() => inspectSharedHomarrServices(f.client, "personal", [selected]), /ambiguous|conflicts/);
  assert.equal(f.writes(), 0);
  const partial = await inspectSharedHomarrServices(f.client, "personal", [selected], true);
  assert.equal(partial.status, "needs-attachment");
  assert.equal(partial.services[0].status, "resource-readback-failed");
  assert.equal(partial.services[0].structureVerified, false);
  assert.equal(partial.mutation, false);
  const summary = dashboardRecap({ ...partial, command: "app shared homarr-status",
    projectRoot: "/tmp/synthetic-homarr-project", projectId: "example", preparedJobs: [] },
  "/tmp/synthetic-homarr-project", "example", ["sonarr"]);
  assert.match(summary, /sonarr: dashboard resources could not be read/);
  assert.match(summary, /not proof that resources are missing/);
  assert.equal(summary.includes("NEVER-EMIT-PRIVATE-FIXTURE"), false);
  assert.equal(f.writes(), 0);
}
{
  const f = fixture(); f.board.items.push({ ...f.tile, id: "duplicate-tile" });
  await assert.rejects(() => inspectSharedHomarrServices(f.client, "personal", [selected]), /duplicate/);
  assert.equal(f.writes(), 0);
}
console.log("PASS read-only shared Homarr structural readback (synthetic, not live acceptance)");
