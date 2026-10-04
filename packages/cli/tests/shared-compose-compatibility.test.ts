import assert from "node:assert/strict";
import { mock } from "bun:test";
import * as childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { saveSharedProjectState } from "../src/lib/shared-project-state.ts";
import { loadCompatibilityReceipts } from "../src/lib/compatibility-receipts.ts";

let inspect: (args: string[]) => string = () => { throw new Error("Unexpected Docker call"); };
const sourceSubprocess = childProcess.spawnSync;
mock.module("node:child_process", () => ({ ...childProcess, spawnSync(command: string, args: string[], options: any) {
  if (command === "bun") return sourceSubprocess(command, args, options);
  assert.equal(command, "docker");
  return { status: 0, stdout: inspect(args), stderr: "" };
} }));
const { witnessSharedComposeCompatibilityCreate, readSharedComposeCompatibilityIdentity } = await import("../src/lib/shared-compose-compatibility.ts");
const root = await mkdtemp(join(tmpdir(), "selfhost-compose-compatibility-"));
try {
  const appIds = ["glances", "linkwarden", "ntfy", "traefik", "vector"];
  const recipes = new Map<string, { recipe: any; recipeSha256: string; boundedApply: boolean }>();
  const apps = new Map<string, any>();
  const selections = [];
  for (const appId of appIds) {
    const base = new URL(`../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/${appId}/`, import.meta.url);
    const bytes = await readFile(new URL("recipe.json", base), "utf8");
    const recipe = JSON.parse(bytes);
    const app = JSON.parse(await readFile(new URL("manifest.json", base), "utf8"));
    recipes.set(appId, { recipe, recipeSha256: createHash("sha256").update(bytes).digest("hex"), boundedApply: true });
    apps.set(appId, app);
    selections.push({ appId, recipe,
      images: Object.fromEntries(recipe.services.map((service: any) => [service.id, `${service.imageTag}@sha256:${"a".repeat(64)}`])),
      port: 18000 + selections.length });
  }
  const dependencies = { recipeFor: (id: string) => recipes.get(id)!, appFor: (id: string) => apps.get(id)! };
  const projectId = "compose-proof";
  const candidate = sharedProjectCandidate({ projectRoot: root, projectId, dockerContext: "default",
    uid: process.getuid!(), gid: process.getgid!(), timezone: "Etc/UTC", apps: selections,
    observed: { checkedAt: "2026-10-03T10:00:00Z", ports: [], paths: [], networks: [] } });
  await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
  for (const service of candidate.manifest.services) {
    for (const mount of service.mounts) {
      if (mount.kind === "volume") continue;
      if (service.id === "vector") {
        await mkdir(dirname(mount.source), { recursive: true });
        await writeFile(mount.source, "synthetic config\n");
      } else await mkdir(mount.source, { recursive: true });
    }
  }
  assert.deepEqual(candidate.manifest.services.find((service) => service.id === "glances")!.mounts, []);
  assert.equal(candidate.manifest.services.find((service) => service.id === "vector")!.mounts.length, 1);
  assert.ok(candidate.manifest.services.find((service) => service.id === "vector")!.mounts
    .every((mount: any) => mount.readOnly === true), "Generated configuration is approved read-only storage");
  const reviewed = await saveSharedProjectState(candidate,
    { operation: "create", phase: "reviewed", appIds }, { revision: 0, manifestHash: null, checkpoint: null });
  const attempted = await saveSharedProjectState(candidate, { ...reviewed.checkpoint, phase: "attempted" },
    { revision: reviewed.revision, manifestHash: reviewed.manifestHash, checkpoint: reviewed.checkpoint });
  const composeTarget = join(candidate.projectDirectory, "compose.aaaaaaaaaaaaaaaa.yaml");
  let applied = false; let applyCalls = 0; let selectedService = ""; const observedServices = new Set<string>();
  inspect = (args) => {
    if (args[0] === "context") return JSON.stringify("unix:///var/run/docker.sock");
    assert.equal(args[0], "--context");
    assert.equal(args[1], "default");
    if (args[2] === "compose") {
      assert.deepEqual(args.slice(3, 7), ["--project-name", projectId, "--file", composeTarget]);
      assert.deepEqual(args.slice(7, 11), ["ps", "--all", "--quiet", args[10]]);
      selectedService = args[10]!;
      if (!applied) return "";
      return "c".repeat(64);
    }
    if (args[2] === "image") return JSON.stringify({ imageId: `sha256:${"b".repeat(64)}` });
    if (args[2] === "volume") {
      const name = args[4]!;
      return JSON.stringify({ driver: "local", project: projectId, volume: name, owner: projectId,
        id: name.slice(projectId.length + 1) });
    }
    if (args[2] === "inspect") {
      const id = selectedService;
      observedServices.add(id);
      const service = candidate.manifest.services.find((item) => item.id === id)!;
      const ports = Object.fromEntries(service.ports.map((port: any) => [`${port.target}/${port.protocol}`,
        [{ HostIp: port.hostIp, HostPort: String(port.published) }]]));
      if (id === "ntfy") ports[`${service.ports[0].target}/tcp`][0].HostIp = "0.0.0.0";
      const mounts = service.mounts.map((mount: any) => ({ Type: mount.kind ?? "bind", Name: mount.name,
        Source: mount.source, Destination: mount.target, RW: !mount.readOnly }));
      if (id === "traefik") mounts.push({ Type: "volume", Name: "unowned-volume",
        Source: "/synthetic/unowned-volume", Destination: "/unexpected-data", RW: true });
      return JSON.stringify({ imageId: `sha256:${"b".repeat(64)}`, image: service.image, state: "running",
        project: projectId, service: id, file: composeTarget, directory: candidate.projectDirectory, networkMode: "bridge", ports,
        mounts });
    }
    throw new Error("Unexpected selected inspection");
  };
  await witnessSharedComposeCompatibilityCreate(attempted, composeTarget, async () => {
    applied = true; applyCalls += 1;
    return saveSharedProjectState(candidate, { ...attempted.checkpoint, phase: "completed" },
      { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
  }, dependencies);
  assert.equal(applyCalls, 1);
  assert.equal(observedServices.size, candidate.manifest.services.length, "Every app, DB and cache container is observed");
  const identities = await Promise.all(appIds.map((id) => readSharedComposeCompatibilityIdentity(root, projectId, id, dependencies)));
  assert.ok(identities.every(Boolean));
  const loaded = await loadCompatibilityReceipts(join(root, `selfhost-verification-${projectId}`), identities.map((item) => item!.contract),
    { checkedAt: new Date().toISOString(), requiredAnchors: identities.map((item) => item!.anchor) });
  assert.equal(loaded.receipts.find((item) => item.appId === "linkwarden")?.result, "pass");
  assert.equal(loaded.receipts.find((item) => item.appId === "glances")?.result, "pass", "Approved empty storage inventory earns Compose credit");
  assert.equal(loaded.receipts.find((item) => item.appId === "vector")?.result, "pass", "Approved generated/read-only storage earns Compose credit");
  assert.equal(loaded.receipts.find((item) => item.appId === "traefik")?.result, "fail", "An unknown writable mount cannot earn Compose credit");
  assert.equal(loaded.receipts.find((item) => item.appId === "ntfy")?.result, "fail", "Wildcard actual exposure cannot earn credit");
  await assert.rejects(witnessSharedComposeCompatibilityCreate({ ...attempted, checkpoint: { ...attempted.checkpoint, phase: "completed" } },
    composeTarget, async () => { throw new Error("Must not replay"); }, dependencies), /fresh approved create/);
  assert.equal(await readSharedComposeCompatibilityIdentity(root, projectId, "wud", dependencies), null, "Missing ledger never manufactures proof");
  const gapId = "compose-gap";
  const gap = sharedProjectCandidate({ projectRoot: root, projectId: gapId, dockerContext: "default",
    uid: process.getuid!(), gid: process.getgid!(), timezone: "Etc/UTC", apps: selections,
    observed: { checkedAt: "2026-10-03T10:00:00Z", ports: [], paths: [], networks: [] } });
  await mkdir(gap.projectDirectory, { recursive: true, mode: 0o700 });
  const gapReviewed = await saveSharedProjectState(gap, { operation: "create", phase: "reviewed", appIds },
    { revision: 0, manifestHash: null, checkpoint: null });
  const gapAttempted = await saveSharedProjectState(gap, { ...gapReviewed.checkpoint, phase: "attempted" },
    { revision: gapReviewed.revision, manifestHash: gapReviewed.manifestHash, checkpoint: gapReviewed.checkpoint });
  inspect = () => { throw new Error("Synthetic unavailable inspection"); };
  const warnings: string[] = []; const originalError = console.error;
  console.error = (line) => { warnings.push(line); };
  try {
    await witnessSharedComposeCompatibilityCreate(gapAttempted, join(gap.projectDirectory, "compose.aaaaaaaaaaaaaaaa.yaml"), async () => {
      applyCalls += 1;
      return saveSharedProjectState(gap, { ...gapAttempted.checkpoint, phase: "completed" },
        { revision: gapAttempted.revision, manifestHash: gapAttempted.manifestHash, checkpoint: gapAttempted.checkpoint });
    }, { ...dependencies, appFor(id) { if (id === "linkwarden") throw new Error("Missing descriptor"); return apps.get(id)!; } });
  } finally { console.error = originalError; }
  assert.equal(applyCalls, 2, "Evidence-only inspection failure does not prevent or replay approved apply");
  assert.equal(warnings.length, 1, "One descriptor failure is exposed without suppressing the next app");
  assert.equal(await readSharedComposeCompatibilityIdentity(root, gapId, "linkwarden", dependencies), null);
  const incomplete = await readSharedComposeCompatibilityIdentity(root, gapId, "ntfy", dependencies);
  assert.ok(incomplete);
  const incompleteReceipts = await loadCompatibilityReceipts(join(root, `selfhost-verification-${gapId}`), [incomplete.contract],
    { checkedAt: new Date().toISOString(), requiredAnchors: [incomplete.anchor] });
  assert.equal(incompleteReceipts.receipts.length, 0, "Unobserved runtime produces no scoring receipt");
  console.log("Compose compatibility: synthetic witnessed-create, all-service identity/storage and actual exposure fixture passed; no live credit.");
} finally { await rm(root, { recursive: true, force: true }); }
