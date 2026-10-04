import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import sonarr from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/sonarr/setup.ts";
import type { SetupCheckpoint, SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { createSharedSetupObservationJournal } from "../src/shared-project.ts";
import { sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { saveSharedProjectState } from "../src/lib/shared-project-state.ts";
import { setupContractSha256 } from "../src/lib/setup-contract.ts";
import { readSetupObservationJournal } from "../src/lib/setup-observation-journal.ts";
import { readSharedSetupCompatibilityIdentity } from "../src/lib/shared-setup-compatibility.ts";
import { loadCompatibilityReceipts } from "../src/lib/compatibility-receipts.ts";
import { loadCatalogCompatibility } from "../src/catalog-compatibility.ts";

const root = await mkdtemp(join(tmpdir(), "shared-setup-compatibility-"));
try {
  const base = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/sonarr/", import.meta.url);
  const bytes = await readFile(new URL("recipe.json", base), "utf8");
  const recipe = JSON.parse(bytes);
  const app = JSON.parse(await readFile(new URL("manifest.json", base), "utf8"));
  const recipeFor = () => ({ recipe, defaults: recipe.defaults, storage: recipe.storage,
    recipeSha256: createHash("sha256").update(bytes).digest("hex"), boundedApply: true });
  const dependencies = { recipeFor, appFor: () => app };
  const setupContracts = { sonarr: await setupContractSha256("sonarr", ["sonarr"]) };
  async function owner(projectId: string) {
    const candidate = sharedProjectCandidate({ projectRoot: root, projectId, dockerContext: "default",
      uid: process.getuid!(), gid: process.getgid!(), timezone: "Etc/UTC",
      apps: [{ appId: "sonarr", recipe,
        images: Object.fromEntries(recipe.services.map((service: any) =>
          [service.id, `${service.imageTag}@sha256:${"a".repeat(64)}`])),
        port: recipe.defaults.publishedPort,
        hostPaths: { "media-data": join(root, ".selfhost", "shared", projectId, "data", "shared") } }],
      observed: { checkedAt: new Date().toISOString(), ports: [], paths: [], networks: [] } });
    await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
    const reviewed = await saveSharedProjectState(candidate, { operation: "create", phase: "reviewed", appIds: ["sonarr"] },
      { revision: 0, manifestHash: null, checkpoint: null });
    const attempted = await saveSharedProjectState(candidate, { ...reviewed.checkpoint, phase: "attempted" },
      { revision: reviewed.revision, manifestHash: reviewed.manifestHash, checkpoint: reviewed.checkpoint });
    const state = await saveSharedProjectState(candidate, { ...attempted.checkpoint, phase: "completed" },
      { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
    const observer = await createSharedSetupObservationJournal(state, ["sonarr"], recipeFor, setupContracts, dependencies.appFor);
    const privateFiles = join(state.project.directory, "synthetic-private");
    const passwordFile = join(privateFiles, "admin-password");
    const apiKeyFile = join(privateFiles, "sonarr-api-key");
    let checkpoint: SetupCheckpoint | null = null;
    let apiKey: string | null = null;
    let config: any = { id: 1, authenticationMethod: "none", authenticationRequired: "disabled", username: "", password: "" };
    let loginCalls = 0;
    let authWrites = 0;
    const never = async (): Promise<never> => { throw new Error("Unexpected fixture transport"); };
    const context = {
      appId: "sonarr", projectRoot: root, installedAppIds: ["sonarr"], inputs: {},
      async status() { return { command: "app status", mutation: false, appId: "sonarr", projectRoot: root,
        ownerKind: "shared", status: "applied", runtime: { state: "running" }, passwordFile, privateFiles }; },
      read: never, apply: never, webSocket: { request: never }, container: { exec: never },
      checkpoint: {
        async read() { return structuredClone(checkpoint); },
        async compareAndSet(next: any) {
          assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
          checkpoint = { schemaVersion: 1, appId: "sonarr", projectRoot: root, revision: (checkpoint?.revision ?? 0) + 1,
            stage: next.stage, data: next.data ?? {}, attemptedActions: checkpoint?.attemptedActions ?? [] };
          return structuredClone(checkpoint);
        },
      },
      secrets: { async readAdminPassword() { return "p".repeat(48); },
        async readServiceConfigXmlApiKey() { return "a".repeat(32); },
        async readApiKey() { return apiKey; }, async apiKeyPath() { return apiKeyFile; },
        async writeApiKey(value: string) { apiKey = value; return apiKeyFile; } },
      http: { async request(request: any) {
        let status = 200; let value: unknown = null; const headers = new Headers();
        if (request.path === "/api/v3/config/host") value = structuredClone(config);
        else if (request.path === "/api/v3/config/host/1" && request.method === "PUT") {
          assert.equal(checkpoint, null);
          assert.equal(request.beforeSendCheckpoint.expectedRevision, null);
          checkpoint = { schemaVersion: 1, appId: "sonarr", projectRoot: root, revision: 1,
            stage: request.beforeSendCheckpoint.stage, data: request.beforeSendCheckpoint.data,
            attemptedActions: [request.approval.action] };
          config = JSON.parse(request.body); status = 202; authWrites += 1;
        } else if (request.path === "/login" && request.method === "POST") {
          assert.equal(new URLSearchParams(request.body).get("password"), "p".repeat(48));
          loginCalls += 1; status = 302; headers.set("location", "/");
          headers.set("set-cookie", "SonarrAuth=synthetic-session; Path=/; HttpOnly");
        } else if (request.path === "/" && request.method === "GET") {
          if (request.headers?.Cookie !== "SonarrAuth=synthetic-session") {
            status = 302; headers.set("location", "/login?returnUrl=%2F");
          }
          assert.equal(request.headers?.["X-Api-Key"], undefined);
        } else assert.fail(`Unexpected synthetic request: ${request.method} ${request.path}`);
        return { status, ok: status >= 200 && status < 300, headers,
          async json() { return value; }, async text() { return ""; }, async arrayBuffer() { return new ArrayBuffer(0); } };
      } },
    } as unknown as SetupContext;
    async function run(includeResult = true) {
      const attemptId = await observer.before({ appId: "sonarr", phase: "first-run" });
      const record = await sonarr.firstRun(context);
      assert.equal(sonarr.ready(record), true);
      const result = sonarr.compatibilityResult!(record);
      assert.equal(sonarr.compatibilityResult!(structuredClone(record)), null, "Copied saved markers are not live result proof");
      if (includeResult && result) await observer.after(attemptId, result);
      else await observer.after(attemptId);
      return result;
    }
    return { state, observer, run, context, counts: () => ({ loginCalls, authWrites }) };
  }
  const fixture = await owner("setup-proof");
  assert.deepEqual(await fixture.run(), { origin: "fresh", credentialReadback: "verified" });
  assert.equal(await readSharedSetupCompatibilityIdentity(root, "setup-proof", "sonarr", dependencies), null,
    "Fresh success alone cannot earn setup credit");
  const inspection = await sonarr.inspect!(fixture.context);
  assert.equal(sonarr.compatibilityResult!(inspection), null, "Saved Forms login is not a current password login");
  assert.deepEqual(await fixture.run(), { origin: "resume", credentialReadback: "verified" });
  assert.deepEqual(fixture.counts(), { loginCalls: 2, authWrites: 1 }, "Resume must authenticate without replaying creation");
  const identity = await readSharedSetupCompatibilityIdentity(root, "setup-proof", "sonarr", dependencies);
  assert.ok(identity);
  const evidenceRoot = join(root, "selfhost-verification-setup-proof");
  const loaded = await loadCompatibilityReceipts(evidenceRoot, [identity.contract],
    { checkedAt: new Date().toISOString(), requiredAnchors: [identity.anchor] });
  assert.equal(loaded.receipts.length, 1);
  assert.deepEqual(loaded.receipts[0]!.checks, ["first-run", "credential-or-no-account-readback", "resume-readback"]);
  const report = await loadCatalogCompatibility(new Date().toISOString(), "sonarr",
    { projectRoot: root, projectId: "setup-proof" });
  assert.equal(report.appCount, 94, "Focused owner never shrinks the full catalog denominator");
  assert.equal(report.earnedPoints, 20, "Only the complete setup dimension receives points in this synthetic fixture");
  const journal = readSetupObservationJournal(fixture.state.project.directory);
  assert.equal(journal.filter((event) => event.compatibility).length, 2);
  assert.ok(!JSON.stringify(journal).includes("synthetic-session"));
  assert.ok(!JSON.stringify(journal).includes("p".repeat(48)));

  const pending = await fixture.observer.before({ appId: "sonarr", phase: "first-run" });
  await assert.rejects(readSharedSetupCompatibilityIdentity(root, "setup-proof", "sonarr", dependencies), /chronology/,
    "A later pending attempt withholds earlier credit");
  await fixture.observer.error(pending, "failed");
  await assert.rejects(readSharedSetupCompatibilityIdentity(root, "setup-proof", "sonarr", dependencies), /chronology/);
  await fixture.run();
  const recovered = await readSharedSetupCompatibilityIdentity(root, "setup-proof", "sonarr", dependencies);
  assert.ok(recovered && recovered.anchor.revision > identity.anchor.revision, "New live resume re-verifies and anchors the latest ledger");
  const ledgerPath = join(fixture.state.project.directory, "setup-run-sonarr.json");
  await chmod(ledgerPath, 0o644);
  await assert.rejects(readSharedSetupCompatibilityIdentity(root, "setup-proof", "sonarr", dependencies), /chronology/);
  await chmod(ledgerPath, 0o600);
  const ledgerBytes = await readFile(ledgerPath, "utf8");
  const ledger = JSON.parse(ledgerBytes);
  ledger.journalProofHash = "f".repeat(64);
  await writeFile(ledgerPath, JSON.stringify(ledger), { mode: 0o600 });
  await assert.rejects(readSharedSetupCompatibilityIdentity(root, "setup-proof", "sonarr", dependencies), /chronology/);
  await writeFile(ledgerPath, ledgerBytes, { mode: 0o600 });
  const latestIndex = join(evidenceRoot, "registry", `revision-${String(recovered.anchor.revision).padStart(6, "0")}.json`);
  const heldIndex = join(root, "synthetic-held-registry-index");
  await rename(latestIndex, heldIndex);
  await assert.rejects(fixture.run(), /required registry anchor/,
    "A later real resume must not silently re-anchor a rolled-back valid registry prefix");
  assert.equal(await readFile(ledgerPath, "utf8"), ledgerBytes);
  await rename(heldIndex, latestIndex);
  await fixture.run();

  const legacy = await owner("setup-legacy");
  await legacy.run(false);
  await legacy.run();
  assert.equal(await readSharedSetupCompatibilityIdentity(root, "setup-legacy", "sonarr", dependencies), null,
    "Historical ready-only journal cannot be upgraded retrospectively");
  const skipped = await legacy.observer.before({ appId: "sonarr", phase: "first-run" });
  await legacy.observer.error(skipped, "deferred");
  assert.equal(await readSharedSetupCompatibilityIdentity(root, "setup-legacy", "sonarr", dependencies), null);

  // Compile two independent consumers before importing either. Same shipped
  // executable set must yield one identity, while warm consumers reject drift.
  const compiledRoot = join(root, "compiled");
  await mkdir(compiledRoot);
  for (const name of ["app", "catalog-compatibility"]) {
    const result = Bun.spawnSync([process.execPath, "build", new URL("../src/lib/setup-contract.ts", import.meta.url).pathname,
      "--target=node", `--outfile=${join(compiledRoot, `${name}.js`)}`]);
    assert.equal(result.exitCode, 0, result.stderr.toString());
  }
  const engineBuild = Bun.spawnSync([process.execPath, "build", new URL("../src/control-panel/setup-engine.ts", import.meta.url).pathname,
    "--target=node", `--outfile=${join(compiledRoot, "engine.js")}`]);
  assert.equal(engineBuild.exitCode, 0, engineBuild.stderr.toString());
  for (const path of ["selfhost-compose/scripts/compose-project.ts", "selfhost-compose/scripts/compose-lifecycle.sh",
    "selfhost-host/scripts/inspect-host.sh", "selfhost/references/catalog/types/manual-job.ts",
    "selfhost/references/catalog/types/non-secret-policy.ts", "selfhost/references/catalog/apps/sonarr/setup.js"]) {
    const target = join(compiledRoot, "workflows", path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, "// synthetic packaged source\n", { mode: 0o644 });
  }
  await writeFile(join(compiledRoot, "workflows/selfhost/references/catalog/apps/sonarr/setup.js"),
    `export default { appId: 'sonarr', credentialCommand: 'app handoff', apiKey: 'not-created',
      healthSource: null, homarrIntegration: null, ready: () => true,
      firstRun: async (context) => ({ appId: context.appId, projectRoot: context.projectRoot }),
      compatibilityResult: () => ({ origin: 'resume', credentialReadback: 'verified' }) };\n`, { mode: 0o644 });
  const compiledApp = await import(pathToFileURL(join(compiledRoot, "app.js")).href);
  const compiledCatalog = await import(pathToFileURL(join(compiledRoot, "catalog-compatibility.js")).href);
  assert.equal(await compiledApp.setupContractSha256("sonarr"), await compiledCatalog.setupContractSha256("sonarr"));
  const engine = await import(pathToFileURL(join(compiledRoot, "engine.js")).href);
  const originalError = console.error; const evidenceErrors: string[] = [];
  console.error = (message: string) => { evidenceErrors.push(message); };
  try {
    const never = async () => { assert.fail("No app transport is used by the synthetic compiled adapter"); };
    const outcomes = await engine.runFirstRunSetups(root, ["sonarr"],
      { read: never, mutate: never, approve: never }, undefined, {}, undefined,
      { async before() { return "synthetic-attempt"; },
        async after(_id: string, result: unknown) {
          assert.deepEqual(result, { origin: "resume", credentialReadback: "verified" });
          throw new Error("Synthetic evidence disk failure");
        }, error: never });
    assert.equal(outcomes[0].state, "ready", "Evidence failure cannot relabel completed setup for mutation replay");
    assert.equal(evidenceErrors.length, 1);
  } finally { console.error = originalError; }
  await writeFile(join(compiledRoot, "catalog-compatibility.js"), "// changed executable\n");
  await assert.rejects(compiledApp.setupContractSha256("sonarr"), /changed while the CLI was running/);
  console.log("shared setup receipt chronology and compiled consumer parity: pass (synthetic only)");
} finally { await rm(root, { recursive: true, force: true }); }
