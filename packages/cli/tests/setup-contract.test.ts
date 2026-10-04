import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setupContractSha256 } from "../src/lib/setup-contract.ts";

const first = await setupContractSha256("ollama");
assert.match(first, /^[a-f0-9]{64}$/);
assert.equal(first, await setupContractSha256("ollama"));
assert.notEqual(first, await setupContractSha256("caddy"));
await assert.rejects(setupContractSha256("../ollama"), /contract/);
await assert.rejects(setupContractSha256("absent-app"), /contract/);

const directory = await mkdtemp(join(tmpdir(), "setup-contract-fixture-"));
try {
  const bundle = join(directory, "app.js");
  const build = Bun.spawnSync([process.execPath, "build",
    new URL("../src/lib/setup-contract.ts", import.meta.url).pathname,
    "--target=node", `--outfile=${bundle}`]);
  assert.equal(build.exitCode, 0, build.stderr.toString());
  const appDirectory = join(directory, "workflows", "selfhost", "references", "catalog", "apps", "ollama");
  await mkdir(appDirectory, { recursive: true });
  const adapter = join(appDirectory, "setup.js");
  await writeFile(adapter, "export default { appId: 'ollama' };\n", { mode: 0o644 });
  for (const path of ["selfhost-compose/scripts/compose-project.ts",
    "selfhost-compose/scripts/compose-lifecycle.sh", "selfhost-host/scripts/inspect-host.sh",
    "selfhost/references/catalog/types/manual-job.ts", "selfhost/references/catalog/types/non-secret-policy.ts",
    "selfhost/references/catalog/types/private-daemon.ts", "selfhost/references/catalog/types/runtime-resources.ts",
    "selfhost/references/catalog/types/recipe-image-reference.ts", "selfhost/references/catalog/types/owner-directory.ts",
    "selfhost/references/catalog/types/docker-cli-tls.ts"]) {
    const target = join(directory, "workflows", path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, "// synthetic external owner\n", { mode: 0o644 });
  }
  const compiled = await import(pathToFileURL(bundle).href);
  const compiledHash = await compiled.setupContractSha256("ollama");
  assert.notEqual(compiledHash, first);
  assert.equal(compiledHash, await compiled.setupContractSha256("ollama"));
  const peerDirectory = join(directory, "workflows", "selfhost", "references", "catalog", "apps", "jellyfin");
  await mkdir(peerDirectory);
  const peer = join(peerDirectory, "setup.js");
  await writeFile(peer, "export default { appId: 'jellyfin' };\n", { mode: 0o644 });
  const peerHash = await compiled.setupContractSha256("ollama", ["jellyfin", "ollama"]);
  assert.notEqual(peerHash, compiledHash);
  assert.equal(peerHash, await compiled.setupContractSha256("ollama", ["ollama", "jellyfin"]));
  await writeFile(peer, "export default { appId: 'jellyfin', changed: true };\n");
  assert.notEqual(peerHash, await compiled.setupContractSha256("ollama", ["jellyfin", "ollama"]));
  const profile = join(appDirectory, "bootstrap-password.json");
  const beforeProfile = await compiled.setupContractSha256("ollama");
  await writeFile(profile, '{"synthetic":"first"}\n', { mode: 0o644 });
  const firstProfile = await compiled.setupContractSha256("ollama");
  assert.notEqual(beforeProfile, firstProfile);
  await writeFile(profile, '{"synthetic":"changed"}\n');
  assert.notEqual(firstProfile, await compiled.setupContractSha256("ollama"));
  const peerProfile = join(peerDirectory, "bootstrap-password.json");
  const beforePeerProfile = await compiled.setupContractSha256("ollama", ["jellyfin", "ollama"]);
  await writeFile(peerProfile, '{"synthetic":"peer"}\n', { mode: 0o644 });
  assert.notEqual(beforePeerProfile, await compiled.setupContractSha256("ollama", ["jellyfin", "ollama"]));
  assert.equal(await compiled.setupContractSha256("ollama", ["jellyfin", "ollama"]),
    await compiled.setupContractSha256("ollama", ["ollama", "jellyfin"]));
  await rm(peerProfile);
  assert.equal(beforePeerProfile, await compiled.setupContractSha256("ollama", ["jellyfin", "ollama"]));
  await chmod(profile, 0o666);
  await assert.rejects(compiled.setupContractSha256("ollama"), /contract/);
  await chmod(profile, 0o644);
  await writeFile(profile, "x".repeat(4097));
  await assert.rejects(compiled.setupContractSha256("ollama"), /contract/);
  await rm(profile);
  assert.equal(beforeProfile, await compiled.setupContractSha256("ollama"));
  await symlink(peer, profile);
  await assert.rejects(compiled.setupContractSha256("ollama"), /contract/);
  await rm(profile);
  await writeFile(adapter, "export default { appId: 'ollama', changed: true };\n");
  const changedAdapter = await compiled.setupContractSha256("ollama");
  assert.notEqual(compiledHash, changedAdapter);
  const originalBundle = await readFile(bundle, "utf8");
  await writeFile(bundle, `${originalBundle}\n// transport change fixture\n`);
  await assert.rejects(compiled.setupContractSha256("ollama"), /changed while the CLI was running/);
  await writeFile(bundle, originalBundle);
  const external = join(directory, "workflows", "selfhost-compose", "scripts", "compose-project.ts");
  await writeFile(external, "// changed external owner\n");
  await assert.rejects(compiled.setupContractSha256("ollama"), /changed while the CLI was running/);
  await writeFile(external, "// synthetic external owner\n");
  await chmod(adapter, 0o666);
  await assert.rejects(compiled.setupContractSha256("ollama"), /contract/);
  await chmod(adapter, 0o644);
  await writeFile(adapter, `export default { appId: 'ollama', credentialCommand: 'app handoff',
    apiKey: 'not-created', healthSource: null, homarrIntegration: null,
    firstRun: async () => ({}), ready: () => false,
    inspect: async (context) => {
      if (!context.jmap || typeof context.jmap.request !== 'function') throw new Error('Missing engine JMAP contract');
      for (const request of [{ effect: 'write' }, { effect: 'read', beforeSend: async () => {} }]) {
        try { await context.jmap.request(request); }
        catch (error) {
          if (!error.message.includes('read-only JMAP owner profile')) throw error;
          continue;
        }
        throw new Error('Inspection accepted a JMAP mutation');
      }
      return context.jmap.request({ endpoint: 'recovery', path: '/api', effect: 'read',
        authorization: 'Basic c3ludGhldGljOnBhc3N3b3Jk', body: '{}' });
    } };\n`);
  const engineBundle = join(directory, "engine.js");
  const engineBuild = Bun.spawnSync([process.execPath, "build",
    new URL("../src/control-panel/setup-engine.ts", import.meta.url).pathname,
    "--target=node", `--outfile=${engineBundle}`]);
  assert.equal(engineBuild.exitCode, 0, engineBuild.stderr.toString());
  const engine = await import(pathToFileURL(engineBundle).href);
  assert.equal(await engine.setupAdapterAvailable("ollama"), true);
  const inspected = await engine.inspectFirstRunSetup(directory, "ollama", async () => {
    throw new Error("Invalid JMAP requests must not inspect an owner or send bytes");
  });
  assert.equal(inspected.state, "needs-inspection");
  assert.match(inspected.detail, /JMAP accepts only the pinned Stalwart management contract/);
  await writeFile(adapter, `${await readFile(adapter, "utf8")}\n// changed after import\n`);
  await assert.rejects(engine.setupAdapterAvailable("ollama"), /adapter changed while the CLI was running/);
  await rm(adapter);
  await symlink(bundle, adapter);
  // Adding engine.js changes the executable set: the earlier import must
  // reject warm drift before inspecting the now-unsafe adapter path.
  await assert.rejects(compiled.setupContractSha256("ollama"), /changed while the CLI was running/);
  await assert.rejects(compiled.setupAdapterSource("ollama"), /contract/);
  console.log("setup source and compiled contracts: pass");
} finally { await rm(directory, { recursive: true, force: true }); }
