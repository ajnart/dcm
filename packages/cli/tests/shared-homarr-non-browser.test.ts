import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sharedHomarr } from "../src/shared-homarr.ts";
import { prepareSharedProjectFiles, sharedProjectCandidate, type SharedAppSelection } from "../src/lib/shared-compose-project.ts";
import { saveSharedProjectState, type SharedProjectExpected } from "../src/lib/shared-project-state.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";

// Local HTTP contract fixture, not a Docker deployment or provider acceptance receipt.
const key = "SYNTHETIC-HOMARR-KEY-NOT-A-REAL-CREDENTIAL";
const board: any = { id: "private-board", name: "personal", isPublic: false,
  items: [], sections: [{ id: "main", kind: "empty" }] };
const mutations: string[] = [];
const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    assert.equal(request.headers.get("ApiKey"), key);
    const procedure = new URL(request.url).pathname.split("/").at(-1);
    let result: unknown = null;
    if (request.method === "GET") {
      if (procedure === "board.getAllBoards") result = [board];
      else if (procedure === "board.getBoardByName") result = board;
      else if (procedure === "board.getBoardSettings") result = { id: board.id, name: board.name };
      else if (["app.all", "integration.all", "integration.getKinds"].includes(procedure!)) result = [];
      else assert.fail("Unexpected synthetic Homarr read");
    } else {
      assert.equal(request.method, "POST");
      mutations.push(procedure!);
      const input = (await request.json() as any).json;
      assert.equal(procedure, "board.addItem", "TCP services must not publish app tiles, integrations, or pings");
      assert.equal(input.boardId, board.id);
      assert.equal(input.kind, "notebook");
      assert.deepEqual(input.integrationIds, []);
      board.items.push({ id: "non-browser-recap", kind: input.kind, options: input.options,
        integrationIds: [], layouts: [{ layoutId: "desktop", sectionId: "main", width: input.size.width,
          height: input.size.height, xOffset: 0, yOffset: 0 }] });
    }
    return Response.json({ result: { data: { json: result } } });
  },
});
const root = await mkdtemp(join(tmpdir(), "selfhost-non-browser-fixture-"));
try {
  const folder = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/postgresql/", import.meta.url);
  const databaseRecipe = JSON.parse(await readFile(new URL("recipe.json", folder), "utf8"));
  const databaseApp = JSON.parse(await readFile(new URL("manifest.json", folder), "utf8"));
  const valkeyFolder = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/valkey/", import.meta.url);
  const valkeyRecipe = JSON.parse(await readFile(new URL("recipe.json", valkeyFolder), "utf8"));
  const valkeyApp = JSON.parse(await readFile(new URL("manifest.json", valkeyFolder), "utf8"));
  const imageTag = "docker.io/library/busybox:1.37.0";
  const homarrRecipe = { schemaVersion: 2, kind: "multi-service-compose", appId: "homarr",
    services: [{ id: "homarr", imageTag, purpose: "Synthetic private dashboard.",
      user: "image-default", imageUserEvidence: { officialUrl: "https://example.test",
        reason: "official-image-runtime-contract" }, restart: "unless-stopped", readOnly: false,
      environment: [], hostEnvironment: [], fileEnvironment: [], mounts: [], dependsOn: [], publishTargetPort: 7575 }],
    privateFiles: [{ id: "admin-password", bytes: 32 }],
    onboarding: { kind: "manual-first-admin", username: "admin", fileId: "admin-password" },
    defaults: { hostIp: "127.0.0.1", publishedPort: server.port } };
  const selections: SharedAppSelection[] = [
    { appId: "homarr", recipe: homarrRecipe, images: { homarr: `${imageTag}@sha256:${"a".repeat(64)}` }, port: server.port! },
    { appId: "postgresql", recipe: databaseRecipe,
      images: { postgresql: `${databaseRecipe.services[0].imageTag}@sha256:${"a".repeat(64)}` }, port: 45432 },
    { appId: "valkey", recipe: valkeyRecipe,
      images: { valkey: `${valkeyRecipe.services[0].imageTag}@sha256:${"a".repeat(64)}` }, port: 45433 },
  ];
  const candidate = sharedProjectCandidate({ projectRoot: root, projectId: "non-browser",
    dockerContext: "default", uid: process.getuid!(), gid: process.getgid!(), timezone: "Etc/UTC", apps: selections,
    observed: { checkedAt: "2026-10-03T12:00:00Z", ports: [], paths: [], networks: [] } });
  await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
  const owner = createSelfhostComposeOwner(candidate.manifest);
  await owner.render(await owner.plan());
  await prepareSharedProjectFiles(candidate, selections);
  let previous: SharedProjectExpected = { revision: 0, manifestHash: null, checkpoint: null };
  for (const phase of ["reviewed", "attempted", "completed"] as const) {
    const next = await saveSharedProjectState(candidate, { operation: "create", phase,
      appIds: selections.map((selection) => selection.appId) }, previous);
    previous = { revision: next.revision, manifestHash: next.manifestHash, checkpoint: next.checkpoint };
  }
  await writeFile(join(candidate.projectDirectory, "secrets", "homarr", "homarr-api-key"), key, { mode: 0o600, flag: "wx" });
  const dependencies = {
    recipeFor(appId: string) { return { recipe: selections.find((selection) => selection.appId === appId)!.recipe, boundedApply: true }; },
    appFor(appId: string) {
      if (appId === "postgresql") return databaseApp;
      if (appId === "valkey") return valkeyApp;
      return { id: "homarr", name: "Homarr", categories: ["dashboard"] };
    },
    approvalFor() { return "SYNTHETIC-APPROVAL"; },
  };
  const planned = await sharedHomarr(root, "non-browser", ["postgresql"], {}, null, dependencies);
  assert.deepEqual(planned.services, []);
  assert.equal(planned.nonBrowserServices[0].state, "tcp-applied-unverified");
  assert.equal(planned.nonBrowserRecap.notebookContentVerified, false);
  assert.deepEqual(mutations, []);
  const applied = await sharedHomarr(root, "non-browser", ["postgresql"], {}, planned.approval, dependencies);
  assert.equal(applied.nonBrowserRecap.notebookContentVerified, true);
  assert.equal(applied.nonBrowserRecap.notebookLayoutVerified, true);
  assert.deepEqual(mutations, ["board.addItem"]);
  assert.ok(board.items[0].options.content.includes("postgresql:5432"));
  assert.ok(board.items[0].options.content.includes("valkey:6379"));
  assert.equal(board.items[0].options.content.includes("href="), false);
  assert.equal(board.items[0].options.content.includes(key), false);
  const ready = await sharedHomarr(root, "non-browser", ["postgresql"], {}, null, dependencies);
  assert.equal(ready.nonBrowserRecap.alreadyCurrent, true);
  const replay = await sharedHomarr(root, "non-browser", ["postgresql"], {}, ready.approval, dependencies);
  assert.equal(replay.nonBrowserRecap.mutation, false);
  assert.deepEqual(mutations, ["board.addItem"]);
  const subset = await sharedHomarr(root, "non-browser", ["valkey"], {}, null, dependencies);
  assert.equal(subset.nonBrowserRecap.alreadyCurrent, true);
  await sharedHomarr(root, "non-browser", ["valkey"], {}, subset.approval, dependencies);
  assert.ok(board.items[0].options.content.includes("postgresql:5432"), "a subset publication must retain the installed PostgreSQL recap");
  assert.deepEqual(mutations, ["board.addItem"]);
  const status = await sharedHomarr(root, "non-browser", ["postgresql"], {}, null, dependencies, true);
  assert.equal(status.nonBrowserRecap.notebookContentVerified, true);
  assert.equal(status.nonBrowserRecap.clientAccessVerified, false);
  assert.equal(JSON.stringify(status).includes(key), false);
  assert.deepEqual(mutations, ["board.addItem"]);
} finally {
  server.stop(true);
  await rm(root, { recursive: true });
}
console.log("PASS shared Homarr non-browser recap publication and safe replay (synthetic)");
