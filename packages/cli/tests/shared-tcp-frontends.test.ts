import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareSharedProjectFiles, sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { saveSharedProjectState } from "../src/lib/shared-project-state.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";
import { sharedUnitHandoff } from "../src/lib/shared-unit-setup.ts";
import { sharedProjectCommand } from "../src/shared-project.ts";
import { formatSharedHandoff } from "../src/lib/shared-handoff-format.ts";

const root = await mkdtemp(join(tmpdir(), "selfhost-tcp-frontends-"));
try {
  const tcpIds = ["postgresql", "valkey"];
  const appIds = [...tcpIds, "syncthing"];
  const manifests: Record<string, any> = {};
  const selections = await Promise.all(appIds.map(async (appId, index) => {
    const folder = new URL(`../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/${appId}/`, import.meta.url);
    const recipe = JSON.parse(await readFile(new URL("recipe.json", folder), "utf8"));
    manifests[appId] = JSON.parse(await readFile(new URL("manifest.json", folder), "utf8"));
    const selection: any = { appId, recipe, images: { [appId]: `${recipe.services[0].imageTag}@sha256:${"a".repeat(64)}` },
      port: 45432 + index };
    if (appId === "syncthing") selection.publishedPorts = { "sync-tcp": 45435, "sync-quic": 45436 };
    return selection;
  }));
  const candidate = sharedProjectCandidate({ projectRoot: root, projectId: "tcp-frontends",
    dockerContext: "default", uid: process.getuid!(), gid: process.getgid!(), timezone: "Etc/UTC",
    apps: selections, observed: { checkedAt: "2026-10-03T12:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
  await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
  const owner = createSelfhostComposeOwner(candidate.manifest);
  await owner.render(await owner.plan());
  await prepareSharedProjectFiles(candidate, selections);
  let previous: any = { revision: 0, manifestHash: null, checkpoint: null };
  for (const phase of ["reviewed", "attempted", "completed"] as const) {
    const saved = await saveSharedProjectState(candidate, { operation: "create", phase, appIds: [...appIds].sort() }, previous);
    previous = { revision: saved.revision, manifestHash: saved.manifestHash, checkpoint: saved.checkpoint };
  }
  const recipeFor = (appId: string) => ({ recipe: selections.find((selection) => selection.appId === appId)!.recipe,
    app: manifests[appId], boundedApply: true });
  const appFor = (appId: string) => manifests[appId];
  const output: string[] = [];
  const original = console.log;
  console.log = (value: string) => { output.push(value); };
  try {
    await sharedProjectCommand(["status", "--project-root", root, "--project-id", "tcp-frontends", "--json"],
      { recipeFor: recipeFor as any, appFor, async resolveImage() { throw new Error("read-only status must not resolve images"); } });
  } finally { console.log = original; }
  const status = JSON.parse(output.join("\n"));
  assert.deepEqual(status.urls, { postgresql: null, syncthing: "http://127.0.0.1:45434", valkey: null });
  assert.equal(status.ports.syncthing, 45434, "auxiliary synchronization ports must not hide the GUI");
  assert.deepEqual(status.endpoints.postgresql, { transport: "tcp", protocol: "postgresql", host: "127.0.0.1", port: 45432 });
  assert.deepEqual(status.endpoints.valkey, { transport: "tcp", protocol: "redis", host: "127.0.0.1", port: 45433 });
  for (const appId of tcpIds) {
    const handoff = await sharedUnitHandoff(root, "tcp-frontends", appId, recipeFor, () => "unused", appFor);
    assert.equal(handoff.url, null);
    assert.equal(handoff.frontend.kind, "tcp");
    assert.equal(handoff.serverEndpoint.host, appId);
    assert.equal(handoff.apiKeyFile, null);
    assert.ok(formatSharedHandoff(handoff, false).includes("_CONNECTION="));
    assert.ok(!formatSharedHandoff(handoff, false).includes("http://"));
    assert.ok(!formatSharedHandoff(handoff, false).includes("Jellyfin"));
  }
} finally { await rm(root, { recursive: true }); }
console.log("shared TCP status and credential recap: pass");
