import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sharedProjectCommand } from "../src/shared-project.ts";
import { sharedPlanApproval } from "../src/shared-project.ts";
import { sharedPrivateHttpsCommand } from "../src/lib/shared-private-https-command.ts";
import { prepareSharedProjectFiles, sharedProjectCandidate, type SharedProjectObservation } from "../src/lib/shared-compose-project.ts";
import { loadSharedProjectState, saveSharedProjectState } from "../src/lib/shared-project-state.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";
import { createSharedPrivateHttpsBinding, saveSharedPrivateHttpsBinding,
  loadSharedPrivateHttpsBinding, restoreSharedPrivateHttpsSelection } from "../src/lib/shared-private-https-state.ts";
import { planSharedPrivateHttps } from "../src/lib/shared-private-https.ts";

const temporary = await mkdtemp(join(tmpdir(), "shared-https-command-"));
try {
  const dependencies = {
    recipeFor(): never { assert.fail("invalid/read-only-ownerless input must not load recipes"); },
    async resolveImage(): Promise<never> { assert.fail("invalid/read-only-ownerless input must not contact a registry"); },
  };
  const base = ["https-plan", "--project-root", temporary, "--project-id", "test",
    "--app", "alpha", "--json"];
  for (const [extra, expected] of [
    [["--approve", "anything"], /read-only/],
    [["--approve-step", "anything"], /read-only/],
    [["--port", "alpha=18080"], /read-only/],
    [["--input", "alpha.name=example"], /read-only/],
    [["--secret-file", "alpha:token=/tmp/not-read"], /owner secret input/],
    [["--secret-stdin", "alpha:token"], /owner secret input/],
    [["--live"], /only for shared status/],
    [["--show"], /only for explicit shared credential handoff/],
    [["--https-port", "443"], /unprivileged/],
    [["--https-port", "65536"], /unprivileged/],
    [["--https-port", "4443", "--https-port", "4444"], /exactly once/],
    [["--hostname", "alpha=photos.localhost", "--hostname", "alpha=second.localhost"], /at most one/],
    [["--hostname", "beta=photos.localhost"], /unique selected/],
    [["--hostname", "alpha=photos.example.com"], /owned DNS review/],
    [["--hostname", "alpha=bad..localhost"], /owned DNS review/],
    [["--hostname", "alpha=https:\/\/photos.localhost"], /unique selected/],
    [["--hostname", "alpha=photos.localhost\nadmin off"], /unique selected/],
  ] as Array<[string[], RegExp]>) {
    await assert.rejects(sharedProjectCommand([...base, ...extra], dependencies), expected);
  }
  for (const extra of [[], ["--hostname", "alpha=photos.localhost", "--https-port", "28443"],
    ["--hostname", "alpha=photos.home.arpa", "--https-port", "28443"]]) {
    await assert.rejects(sharedProjectCommand([...base, ...extra], dependencies), /completed saved shared project/);
  }
  await assert.rejects(sharedProjectCommand(["status", "--project-root", temporary,
    "--project-id", "test", "--hostname", "alpha=alpha.localhost"], dependencies), /only for the read-only shared HTTPS plan/);
  await assert.rejects(sharedProjectCommand(["status", "--project-root", temporary,
    "--project-id", "test", "--https-port", "4443"], dependencies), /only for the read-only shared HTTPS plan/);
  assert.deepEqual(await readdir(temporary), []);
  await assert.rejects(sharedProjectCommand(["https-apply", "--project-root", temporary,
    "--project-id", "test", "--app", "alpha"], dependencies), /exact --approve/);
  await assert.rejects(sharedProjectCommand(["https-proof", "--project-root", temporary,
    "--project-id", "test", "--app", "alpha"], dependencies), /takes only/);
  await assert.rejects(sharedProjectCommand(["https-proof", "--project-root", temporary,
    "--project-id", "test"], dependencies), /completed saved shared project/);

  const recipe = JSON.parse(await readFile(new URL(
    "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/caddy/recipe.json", import.meta.url), "utf8"));
  const imageTag = "docker.io/library/busybox:1.37.0";
  const app = { appId: "alpha", port: 18080, images: { alpha: `${imageTag}@sha256:${"a".repeat(64)}` },
    recipe: { schemaVersion: 2, kind: "multi-service-compose", appId: "alpha",
      services: [{ id: "alpha", imageTag, user: "image-default",
        imageUserEvidence: { officialUrl: "https://example.test", reason: "official-image-runtime-contract" },
        restart: "unless-stopped", readOnly: false, environment: [], hostEnvironment: [], fileEnvironment: [],
        mounts: [{ kind: "volume", name: "state", target: "/state" }], dependsOn: [], publishTargetPort: 8080 }],
      privateFiles: [], defaults: { hostIp: "127.0.0.1" } } };
  const tools = join(temporary, "tools");
  await mkdir(tools, { mode: 0o700 });
  const calls = join(temporary, "calls.jsonl");
  await writeFile(join(tools, "docker"), `#!/usr/bin/env node
const fs=require('node:fs'); const args=process.argv.slice(2);
fs.appendFileSync(process.env.SHARED_HTTPS_FIXTURE_CALLS,JSON.stringify(args)+'\\n');
const project=process.env.SHARED_HTTPS_FIXTURE_PROJECT;
if(args.includes('context')&&args.includes('inspect')) fs.writeSync(1,JSON.stringify('unix:///var/run/docker.sock'));
else if(args.includes('info')) fs.writeSync(1,'27.0.0\\n');
else if(args.includes('volume')&&args.includes('ls')) {
 if(args.includes('name='+project+'-alpha-state')) fs.writeSync(1,project+'-alpha-state\\n');
}
else if(args.includes('volume')&&args.includes('inspect')) {
 const name=args[args.indexOf('inspect')+1];
 if(name!==project+'-alpha-state') process.exit(9);
 fs.writeSync(1,[name,'local',project,name,project,'alpha-state'].join('\\t')+'\\n');
}
else if(args.includes('config')&&args.includes('--quiet')) {}
else if(args.includes('ps')&&args.includes('--all')) {}
else if(args.includes('exec')&&args.includes('cat')) fs.writeSync(1,process.env.SHARED_HTTPS_FIXTURE_CA);
else if(args.includes('up')&&args.includes('--no-deps')&&args.at(-1)==='caddy') {
 if(process.env.SHARED_HTTPS_FIXTURE_FAIL==='1') process.exit(17);
}
else process.exit(9);
`, { mode: 0o700 });
  await writeFile(join(tools, "curl"), "#!/usr/bin/env node\nrequire('node:fs').writeSync(1, '502');\n", { mode: 0o700 });
  const publicRoot = rootCertificates.find((pem) => {
    const cert = new X509Certificate(pem);
    return cert.ca && cert.verify(cert.publicKey) && Date.parse(cert.validFrom) < Date.now() && Date.parse(cert.validTo) > Date.now();
  });
  assert.ok(publicRoot);
  process.env.SHARED_HTTPS_FIXTURE_CA = publicRoot;
  const previousPath = process.env.PATH;
  process.env.PATH = `${tools}:${previousPath}`;
  process.env.SHARED_HTTPS_FIXTURE_CALLS = calls;
  try {
    for (const projectId of ["https-ok", "https-fail", "https-reviewed", "https-attempted"]) {
      process.env.SHARED_HTTPS_FIXTURE_PROJECT = projectId;
      process.env.SHARED_HTTPS_FIXTURE_FAIL = String(Number(projectId === "https-fail"));
      const candidate = sharedProjectCandidate({ projectRoot: temporary, projectId,
        dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC", apps: [app],
        observed: { checkedAt: "2026-10-03T12:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
      await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
      const owner = createSelfhostComposeOwner(candidate.manifest);
      await owner.render(await owner.plan());
      let state = await saveSharedProjectState(candidate, { operation: "create", phase: "reviewed", appIds: ["alpha"] },
        { revision: 0, manifestHash: null, checkpoint: null });
      for (const phase of ["attempted", "completed"] as const) state = await saveSharedProjectState(candidate,
        { operation: "create", phase, appIds: ["alpha"] },
        { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
      const credentialPath = join(candidate.projectDirectory, "fixture-credential");
      await writeFile(credentialPath, "synthetic-retained-credential", { mode: 0o600 });
      let imageDigest = "b".repeat(64);
      let occupied = false;
      let checks = 0;
      const adapter = {
        recipeFor: () => ({ recipe, boundedApply: false }),
        image: async () => `${recipe.services[0].imageTag}@sha256:${imageDigest}`,
        validateSaved: () => {}, desiredApproval: sharedPlanApproval,
        inspect: (): SharedProjectObservation => ({ checkedAt: new Date(Date.now() + checks++).toISOString(),
          project: { id: projectId, directory: state.project.directory, owner: projectId },
          ports: occupied ? [{ hostIp: "127.0.0.1", published: 28443, protocol: "tcp", owner: "other" }] : [], paths: [],
          networks: state.manifest.networks.map((network: any) => ({ name: network.name, owner: projectId })),
          volumes: [{ name: `${projectId}-alpha-state`, driver: "local", owner: projectId, labels: {
            "com.docker.compose.project": projectId, "com.docker.compose.volume": `${projectId}-alpha-state`,
            "io.selfhost.project": projectId, "io.selfhost.volume": "alpha-state" } }] }),
        runtime: async (current: any) => Object.fromEntries(Object.keys(current.units).map((id) => [id, "running"])),
      };
      const options = { action: "https-plan" as const, projectRoot: temporary, projectId,
        appIds: ["alpha"], hostnames: {}, httpsPort: 28443, approval: null };
      for (const invalid of [{ ...recipe, schemaVersion: 1 }, { ...recipe, kind: "single-service-compose" }]) {
        await assert.rejects(sharedPrivateHttpsCommand(options, { ...adapter,
          recipeFor: () => ({ recipe: invalid, boundedApply: false }),
          image: async () => { assert.fail("Invalid shared recipes must fail before image resolution"); } }),
        /bundled Caddy recipe is unavailable/);
      }
      const review = await sharedPrivateHttpsCommand(options, adapter);
      assert.equal(review.status, "review");
      assert.equal(review.applyAvailable, true);
      assert.equal((await loadSharedProjectState(candidate.projectDirectory, projectId))?.recordHash, state.recordHash);
      assert.ok(!(await readdir(candidate.projectDirectory)).includes("private-https-binding.json"));
      const approved = { ...options, action: "https-apply" as const, approval: review.approval! };
      await assert.rejects(sharedPrivateHttpsCommand({ ...approved, approval: "wrong" }, adapter), /exact saved-owner approval/);
      imageDigest = "c".repeat(64);
      await assert.rejects(sharedPrivateHttpsCommand(approved, adapter), /exact saved-owner approval/);
      imageDigest = "b".repeat(64);
      occupied = true;
      await assert.rejects(sharedPrivateHttpsCommand(approved, adapter), /conflicts/);
      occupied = false;
      await assert.rejects(sharedPrivateHttpsCommand({ ...approved, hostnames: { alpha: "changed.localhost" } }, adapter), /exact saved-owner approval/);
      if (projectId === "https-reviewed" || projectId === "https-attempted") {
        const observed = adapter.inspect();
        const planned = planSharedPrivateHttps(state, recipe, await adapter.image(),
          [{ appId: "alpha", hostname: "alpha.localhost" }], 28443, observed);
        const binding = createSharedPrivateHttpsBinding(state, recipe, planned, observed);
        await saveSharedPrivateHttpsBinding(candidate.projectDirectory, binding, recipe);
        await prepareSharedProjectFiles(planned.candidate, [planned.caddySelection]);
        const plannedOwner = createSelfhostComposeOwner(planned.candidate.manifest);
        const rendered = await plannedOwner.render(await plannedOwner.plan());
        const pending = await saveSharedProjectState(planned.candidate,
          { operation: "add", phase: "reviewed", appIds: ["caddy"] },
          { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
        const renderedBytes = await readFile(rendered);
        await writeFile(rendered, Buffer.concat([renderedBytes, Buffer.from("# fixture tamper\n")]));
        await assert.rejects(sharedPrivateHttpsCommand(options, adapter), /rendered check failed/);
        await writeFile(rendered, renderedBytes);
        const caddyfile = join(candidate.projectDirectory, "data", "caddy", "config-files", "caddyfile");
        const caddyBytes = await readFile(caddyfile);
        await writeFile(caddyfile, Buffer.concat([caddyBytes, Buffer.from("# fixture tamper\n")]));
        await assert.rejects(sharedPrivateHttpsCommand(options, adapter), /Caddyfile differs/);
        await writeFile(caddyfile, caddyBytes);
        const recovery = await sharedPrivateHttpsCommand(options, adapter);
        assert.equal(recovery.status, "resume-reviewed");
        assert.equal(recovery.resumeReviewed, true);
        assert.notEqual(recovery.approval, approved.approval);
        assert.equal((await loadSharedProjectState(candidate.projectDirectory, projectId))?.recordHash, pending.recordHash);
        await assert.rejects(sharedPrivateHttpsCommand(approved, adapter), /exact saved-owner approval/);
        approved.approval = recovery.approval!;
        imageDigest = "c".repeat(64);
        await assert.rejects(sharedPrivateHttpsCommand(approved, adapter), /candidate differ/);
        imageDigest = "b".repeat(64);
        if (projectId === "https-attempted") {
          const attempted = await saveSharedProjectState(planned.candidate,
            { operation: "add", phase: "attempted", appIds: ["caddy"] },
            { revision: pending.revision, manifestHash: pending.manifestHash, checkpoint: pending.checkpoint });
          await assert.rejects(sharedPrivateHttpsCommand(options, adapter), /inspect pending or uncertain/);
          await assert.rejects(sharedPrivateHttpsCommand(approved, adapter), /inspect pending or uncertain/);
          assert.equal((await loadSharedProjectState(candidate.projectDirectory, projectId))?.recordHash, attempted.recordHash);
          continue;
        }
      }
      if (projectId === "https-fail") {
        await assert.rejects(sharedPrivateHttpsCommand(approved, adapter), /outcome is uncertain/);
      } else {
        const applied = await sharedPrivateHttpsCommand(approved, adapter);
        assert.equal(applied.status, "added-transport-unverified");
        assert.equal(applied.applicationVerified, false);
        assert.equal(applied.transportVerified, false);
      }
      const latest = await loadSharedProjectState(candidate.projectDirectory, projectId);
      assert.ok(latest);
      assert.equal(latest.revision, state.revision + 3);
      let expectedPhase = "completed";
      if (projectId === "https-fail") expectedPhase = "inspect-required";
      assert.equal(latest.checkpoint.phase, expectedPhase);
      assert.equal(latest.checkpoint.operation, "add");
      const binding = await loadSharedPrivateHttpsBinding(candidate.projectDirectory, recipe);
      restoreSharedPrivateHttpsSelection(latest, recipe, binding);
      assert.equal(await readFile(credentialPath, "utf8"), "synthetic-retained-credential");
      if (projectId === "https-fail") {
        await assert.rejects(sharedPrivateHttpsCommand(approved, adapter), /inspect pending or uncertain/);
      } else {
        const proof = await sharedPrivateHttpsCommand({ ...options, action: "https-proof", appIds: [] }, adapter);
        assert.match(proof.approval!, /^SHARED-HTTPS-PROOF:/);
        assert.equal(proof.composeMutation, false);
        const approvedProof = { ...options, action: "https-proof" as const, appIds: [], approval: proof.approval! };
        const proved = await sharedPrivateHttpsCommand(approvedProof, adapter);
        assert.equal(proved.status, "transport-verified-application-pending");
        assert.equal(proved.transportVerified, true);
        assert.equal(proved.applicationVerified, false);
        assert.equal(proved.proofs[0].httpStatus, 502);
        const repeated = await sharedPrivateHttpsCommand(approvedProof, adapter);
        assert.deepEqual(repeated.proofs, proved.proofs, "repeated probes retain original immutable proof timestamps");
        assert.equal(repeated.transportProofPath, proved.transportProofPath);
      }
    }
    const invocations = (await readFile(calls, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const writes = invocations.filter((argv) => argv.includes("up"));
    assert.equal(writes.length, 3);
    assert.ok(writes.every((argv) => argv.includes("--no-deps") && argv.at(-1) === "caddy" && !argv.includes("--force-recreate")));
    assert.ok(invocations.every((argv) => !argv.includes("down") && !argv.includes("prune") && !argv.includes("pull")));
  } finally { process.env.PATH = previousPath; }
  console.log("shared HTTPS CLI guards, Caddy-only apply, immutable bindings and uncertain replay refusal passed (fixture Docker only)");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
