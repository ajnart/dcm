import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sharedHomarr } from "../src/shared-homarr.ts";
import { prepareSharedProjectFiles, sharedProjectCandidate, type SharedAppSelection } from "../src/lib/shared-compose-project.ts";
import { loadSharedProjectState, saveSharedProjectState, type SharedProjectExpected } from "../src/lib/shared-project-state.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";

const key = "SYNTHETIC-HOMARR-KEY-NOT-A-REAL-CREDENTIAL";
let requests = 0;
let writes = 0;
let rejectPublication = false;
let homeAssistantPresent = false;
const queried: string[] = [];
const automationId = "automation.selected";
const homeAssistantApp = { id: "ha-app", name: "home-assistant", href: "http://127.0.0.1:19076/",
  pingUrl: "http://home-assistant:8080", iconUrl: "https://example.test/home-assistant.svg",
  description: "home-assistant synthetic purpose." };
const homeAssistantIntegration = { id: "ha-integration", name: "Auto-Stack: home-assistant", kind: "homeAssistant",
  url: homeAssistantApp.pingUrl, permissions: { hasFullAccess: true, hasUseAccess: true } };
const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
  fetch(request) {
    requests += 1;
    assert.equal(request.headers.get("ApiKey"), key);
    if (request.method !== "GET") writes += 1;
    if (rejectPublication && request.method === "POST") {
      return Response.json({ error: { message: "Synthetic publication stop" } }, { status: 500 });
    }
    assert.equal(request.method, "GET");
    const path = new URL(request.url).pathname;
    if (homeAssistantPresent && path === "/api/integrations/ha-integration/test-connection") {
      return Response.json({ success: true });
    }
    const procedure = path.split("/").at(-1);
    queried.push(procedure!);
    const board = { id: "private-board", name: "personal", isPublic: false,
      items: [] as any[], sections: [{ id: "main", kind: "empty" }] };
    if (homeAssistantPresent) board.items.push(
      { id: "ha-tile", kind: "app", options: { appId: homeAssistantApp.id }, integrationIds: [] },
      { id: "ha-calendar", kind: "calendar", options: {}, integrationIds: [homeAssistantIntegration.id] },
      { id: "ha-automation", kind: "smartHome-executeAutomation", options: { automationId }, integrationIds: [homeAssistantIntegration.id] });
    let result: unknown;
    if (procedure === "board.getAllBoards") result = [board];
    else if (procedure === "board.getBoardByName") result = board;
    else if (procedure === "board.getBoardSettings") result = { id: board.id, name: board.name };
    else if (homeAssistantPresent && procedure === "app.all") result = [homeAssistantApp];
    else if (homeAssistantPresent && procedure === "integration.all") result = [homeAssistantIntegration];
    else if (homeAssistantPresent && procedure === "integration.byId") result = { ...homeAssistantIntegration, app: homeAssistantApp, secrets: [] };
    else if (homeAssistantPresent && procedure === "widget.stats.catalog") result = { name: homeAssistantIntegration.name,
      metrics: ["entities", "unavailable", "lightsOn", "peopleHome"].map((key) => ({ key, label: key, unit: "count" })) };
    else if (homeAssistantPresent && procedure === "widget.app.ping") result = { url: homeAssistantApp.pingUrl, statusCode: 200 };
    else if (homeAssistantPresent && procedure === "widget.calendar.findAllEvents") result = [{ integration: { id: homeAssistantIntegration.id }, events: [] }];
    else if (["app.all", "integration.all", "integration.getKinds"].includes(procedure!)) result = [];
    else throw new Error("Unexpected synthetic Homarr query");
    return Response.json({ result: { data: { json: result } } });
  },
});
const root = await mkdtemp(join(tmpdir(), "selfhost-homarr-drift-fixture-"));
try {
  const selection = (appId: string, port: number): SharedAppSelection => {
    const imageTag = "docker.io/library/busybox:1.37.0";
    return { appId, recipe: { schemaVersion: 2, kind: "multi-service-compose", appId,
        services: [{ id: appId, imageTag, purpose: `${appId} synthetic purpose.`,
          user: "image-default", imageUserEvidence: { officialUrl: "https://example.test",
            reason: "official-image-runtime-contract" }, restart: "unless-stopped", readOnly: false,
          environment: [], hostEnvironment: [], fileEnvironment: [], mounts: [], dependsOn: [],
          publishTargetPort: 8080 }],
        privateFiles: [{ id: "admin-password", bytes: 32 }],
        onboarding: { kind: "manual-first-admin", username: "admin", fileId: "admin-password" },
        defaults: { hostIp: "127.0.0.1", publishedPort: port } },
      images: { [appId]: `${imageTag}@sha256:${"a".repeat(64)}` }, port };
  };
  const reviewedCaddy = JSON.parse(await readFile(join(import.meta.dir,
    "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/caddy/recipe.json"), "utf8"));
  const oldCaddy = structuredClone(reviewedCaddy);
  oldCaddy.configFiles[0].content = "{\n  admin off\n}\nhttp://:2015 {\n  respond /health 200\n}\n";
  const caddySelection = { ...selection("caddy", 19077), recipe: oldCaddy,
    images: { caddy: `${oldCaddy.services[0].imageTag}@sha256:${"a".repeat(64)}` } };
  const selections = [selection("homarr", server.port!), selection("ntfy", 19073),
    selection("immich", 19074), selection("beszel", 19075), selection("home-assistant", 19076), caddySelection];
  const candidate = sharedProjectCandidate({ projectRoot: root, projectId: "drift-test",
    dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC", apps: selections,
    observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [] } });
  await mkdir(join(root, ".selfhost", "shared"), { recursive: true, mode: 0o700 });
  const owner = createSelfhostComposeOwner(candidate.manifest);
  await owner.render(await owner.plan());
  await prepareSharedProjectFiles(candidate, selections);
  let previous: SharedProjectExpected = { revision: 0, manifestHash: null, checkpoint: null };
  for (const phase of ["reviewed", "attempted", "completed"] as const) {
    const next = await saveSharedProjectState(candidate,
      { operation: "create", phase, appIds: selections.map((app) => app.appId).sort() }, previous);
    previous = { revision: next.revision, manifestHash: next.manifestHash, checkpoint: next.checkpoint };
  }
  await writeFile(join(candidate.projectDirectory, "secrets", "homarr", "homarr-api-key"), key,
    { mode: 0o600, flag: "wx" });
  // An unsafe app credential must be irrelevant to dashboard-only inspection.
  await chmod(join(candidate.projectDirectory, "secrets", "ntfy", "admin-password"), 0o644);
  const changedNtfy = structuredClone(selections[1]!.recipe);
  changedNtfy.services[0]!.environment.push({ name: "NTFY_CACHE_FILE", value: "/var/lib/ntfy/cache.db" });
  const dependencies = {
    recipeFor(appId: string) {
      const selected = selections.find((value) => value.appId === appId);
      if (!selected) throw new Error("Missing synthetic recipe");
      if (appId === "caddy") return { recipe: reviewedCaddy, previousRecipes: [oldCaddy], boundedApply: true };
      return { recipe: appId === "ntfy" ? changedNtfy : selected.recipe, boundedApply: true };
    },
    appFor(appId: string) {
      return { id: appId, name: appId, categories: ["monitoring"], homarr: {
        iconUrl: `https://example.test/${appId}.svg` } };
    },
    approvalFor() { return "SYNTHETIC-APPROVAL"; },
  };
  const before = await loadSharedProjectState(candidate.projectDirectory, "drift-test");
  const status = await sharedHomarr(root, "drift-test", ["homarr", "ntfy"], {}, null, dependencies, true);
  assert.equal(status.mutation, false);
  assert.equal(status.apiKeyAuthorizationVerified, true);
  assert.deepEqual(status.recipeChecks, { homarr: "matches-saved-selection", ntfy: "recipe-unavailable-or-changed" });
  assert.equal(status.recipeMigrationVerified, false);
  assert.equal(status.services.length, 2);
  const drifted = status.services.find((service: any) => service.id === "ntfy");
  assert.equal(drifted.nativeIntegrationPending, true);
  assert.equal(drifted.nativeIntegrationReason, "native-recipe-contract-changed");
  assert.equal(drifted.integrationStructureVerified, false);
  assert.equal(drifted.widgetStructureVerified, false);
  assert.equal(drifted.connectionVerification, "blocked-native");
  assert.deepEqual(status.pendingNativeIntegrations.map((service: any) => ({ id: service.id, reasonCode: service.reasonCode })),
    [{ id: "ntfy", reasonCode: "native-recipe-contract-changed" }]);
  assert.equal(status.status, "needs-attachment");
  assert.ok(requests > 0);
  assert.equal(writes, 0);
  const oldCaddyStatus = await sharedHomarr(root, "drift-test", ["caddy"], {}, null, dependencies, true, true);
  assert.equal(oldCaddyStatus.recipeChecks.caddy, "matches-saved-selection", "Historical recipe restoration proves ownership, not native API compatibility");
  assert.equal(oldCaddyStatus.services[0].nativeIntegrationReason, "native-recipe-contract-changed");
  assert.equal(oldCaddyStatus.services[0].integrationStructureVerified, false);
  assert.equal(oldCaddyStatus.services[0].widgetStructureVerified, false);
  assert.deepEqual(oldCaddyStatus.functional, [], "Saved admin-off Caddy must never run native provider or stored-integration probes");
  assert.equal(writes, 0);
  await assert.rejects(() => sharedHomarr(root, "drift-test", ["caddy"], {}, null, {
    ...dependencies, recipeFor(appId: string) {
      if (appId === "caddy") return { recipe: reviewedCaddy, boundedApply: true };
      return dependencies.recipeFor(appId);
    },
  }, true), /differs from its exact saved selection/,
  "An unknown old recipe must not bypass generated-route binding checks");
  // Exercise the actual shared owner/publication path, not a helper-only mapping.
  await writeFile(join(candidate.projectDirectory, "secrets", "immich", "immich-api-key"),
    "SYNTHETIC-IMMICH-KEY", { mode: 0o600, flag: "wx" });
  const current = { ...dependencies, recipeFor(appId: string) {
    return { recipe: selections.find((app) => app.appId === appId)!.recipe, boundedApply: true };
  } };
  const appIds = ["immich", "beszel"];
  const omitted = await sharedHomarr(root, "drift-test", appIds, {}, null, current);
  assert.equal(omitted.services.find((app: any) => app.id === "immich").omittedWidgets[0].kind, "immich-albumCarousel");
  assert.equal(omitted.services.find((app: any) => app.id === "beszel").omittedWidgets[0].kind, "beszelSystemStats");
  const inputs = { immich: { "immich-album-id": "selected-album" }, beszel: { "beszel-system-id": "selected-system" } };
  const chosen = await sharedHomarr(root, "drift-test", appIds, inputs, null, current);
  assert.equal(chosen.pending.length, 0);
  assert.ok(chosen.services.find((app: any) => app.id === "immich").widgets.includes("immich-albumCarousel"));
  assert.ok(chosen.services.find((app: any) => app.id === "beszel").widgets.includes("beszelSystemStats"));
  assert.ok(chosen.services.every((app: any) => app.omittedWidgets.length === 0));
  await assert.rejects(() => sharedHomarr(root, "drift-test", appIds,
    { ...inputs, immich: { "immich-album-id": "changed-album" } }, chosen.approval, current), /approval is stale/);
  await assert.rejects(() => sharedHomarr(root, "drift-test", appIds,
    { ...inputs, beszel: { "beszel-system-id": "changed-system" } }, chosen.approval, current), /approval is stale/);
  await assert.rejects(() => sharedHomarr(root, "drift-test", appIds,
    { immich: { "beszel-system-id": "wrong-app" } }, null, current), /unknown or invalid/);
  await assert.rejects(() => sharedHomarr(root, "drift-test", appIds,
    { immich: { "immich-album-id": "bad\u007fid" } }, null, current), /unknown or invalid/);
  assert.equal(writes, 0, "Changed selections and invalid IDs must fail before API writes");
  // The owner saves approved choices before an uncertain API attempt. Resume
  // must preserve them even when publication fails; this fixture creates no apps.
  rejectPublication = true;
  await assert.rejects(() => sharedHomarr(root, "drift-test", appIds, inputs, chosen.approval, current), /app.create did not persist/);
  const saved = JSON.parse(await readFile(join(candidate.projectDirectory, "connections.json"), "utf8"));
  assert.deepEqual(saved.inputs, inputs);
  const resumed = await sharedHomarr(root, "drift-test", appIds, {}, null, current, true);
  assert.ok(resumed.services.find((app: any) => app.id === "immich").widgets.some((widget: any) => widget.kind === "immich-albumCarousel"));
  assert.ok(resumed.services.find((app: any) => app.id === "beszel").widgets.some((widget: any) => widget.kind === "beszelSystemStats"));
  assert.ok(resumed.services.every((app: any) => app.omittedWidgets.length === 0));
  // Configuration derives from declared widgets, not read queries: an automation
  // widget is configurable, but the read-only verifier must never execute it.
  await writeFile(join(candidate.projectDirectory, "secrets", "home-assistant", "home-assistant-api-key"),
    "SYNTHETIC-HA-KEY", { mode: 0o600, flag: "wx" });
  const automationInputs = { "home-assistant": { "home-assistant-automation-id": automationId } };
  const automationPlan = await sharedHomarr(root, "drift-test", ["home-assistant"], automationInputs, null, current);
  assert.ok(automationPlan.services[0].widgets.includes("smartHome-executeAutomation"));
  assert.deepEqual(automationPlan.services[0].omittedWidgets.map((widget: any) => widget.kind), ["smartHome-entityState"]);
  await assert.rejects(() => sharedHomarr(root, "drift-test", ["immich"],
    { immich: { "home-assistant-automation-id": automationId } }, null, current), /unknown or invalid/);
  await assert.rejects(() => sharedHomarr(root, "drift-test", ["home-assistant"],
    { "home-assistant": { "unknown-id": "rejected" } }, null, current), /unknown or invalid/);
  await assert.rejects(() => sharedHomarr(root, "drift-test", ["home-assistant"], automationInputs,
    automationPlan.approval, current), /app.create did not persist/);
  const retained = JSON.parse(await readFile(join(candidate.projectDirectory, "connections.json"), "utf8"));
  assert.deepEqual(retained.inputs, { ...inputs, ...automationInputs },
    "Subset publication must retain previously approved widget prerequisites");
  assert.deepEqual(retained.services.map((service: any) => service.id).sort(),
    ["homarr", "immich", "beszel", "home-assistant"].sort(),
    "Subset publication must retain the other saved app connection records");
  const retainedStatus = await sharedHomarr(root, "drift-test", appIds, {}, null, current, true);
  assert.ok(retainedStatus.services.every((app: any) => app.omittedWidgets.length === 0),
    "Readback must still check the selected optional widgets after another app was published");
  homeAssistantPresent = true;
  const automationStatus = await sharedHomarr(root, "drift-test", ["home-assistant"], {}, null, current, true, true);
  assert.equal(automationStatus.services[0].widgets.find((widget: any) => widget.kind === "smartHome-executeAutomation").present, true,
    "Shared status must match the exact catalog-derived automationId option");
  const automationRead = automationStatus.functional[0].widgets.find((widget: any) => widget.kind === "smartHome-executeAutomation");
  assert.equal(automationRead.structure.status, "pass");
  assert.equal(automationRead.data.status, "not-run");
  assert.equal(automationRead.data.reason, "widget-query-not-supported");
  assert.ok(queried.every((procedure) => !procedure.toLowerCase().includes("executeautomation")));
  assert.equal(JSON.stringify(status).includes(key), false);
  assert.equal((await loadSharedProjectState(candidate.projectDirectory, "drift-test"))?.recordHash, before?.recordHash);
  const writesBeforeDrift = writes;
  await assert.rejects(() => sharedHomarr(root, "drift-test", ["homarr", "ntfy"], {}, null, dependencies),
    /saved selection differs/);
  assert.equal(writes, writesBeforeDrift);
} finally {
  server.stop(true);
  await rm(root, { recursive: true });
}
console.log("PASS dashboard-only recipe-drift inspection; publication remains strict (synthetic)");
