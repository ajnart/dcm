#!/usr/bin/env bun

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mediaCommand } from "../src/media.ts";

const root = await mkdtemp(join(tmpdir(), "selfhost-media-board-polish-"));
const runId = "media-board";
const boardName = "personal";
const approval = `sha256:${"a".repeat(64)}`;

async function captureOutput(callback: () => Promise<void>) {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => { lines.push(values.map(String).join(" ")); };
  try { await callback(); }
  finally { console.log = original; }
  return lines.join("\n");
}

try {
  await chmod(root, 0o700);
  const local = join(root, ".selfhost");
  const harness = join(local, "media-harness");
  const session = join(harness, ".sessions", runId);
  const scripts = join(harness, "scripts");
  const intents = join(local, "cli-intents");
  for (const directory of [local, harness, join(harness, ".sessions"), session, join(session, "artifacts"), scripts, join(scripts, "lib"), intents]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
  }

  const invocation = join(root, "board-polish-invocation.txt");
  process.env.BOARD_POLISH_FIXTURE_INVOCATION = invocation;
  const sessionScript = join(scripts, "session.sh");
  await writeFile(sessionScript, `#!/bin/sh
printf '%s\\n' "$@" > "$BOARD_POLISH_FIXTURE_INVOCATION"
if [ "$1" = "access-proxy" ] && [ "$2" = "set" ]; then
  bun --eval 'import {existsSync,readFileSync,writeFileSync} from "node:fs";
    const [run,service,origin,dns]=process.argv.slice(-4);
    const path=".sessions/"+run+"/artifacts/access.json";
    const value=existsSync(path)?JSON.parse(readFileSync(path,"utf8")):{schemaVersion:1,routes:{}};
    value.routes[service]={origin,privateDnsConfirmed:dns==="--private-dns-confirmed"};
    writeFileSync(path,JSON.stringify(value),{mode:0o600});' "$3" "$4" "$5" "\${6:-unconfirmed}"
  printf '%s\\n' 'fixture-private-child-marker'
  exit 0
fi
layout_mode=managed-y
plan_action=remove-exact-starter-items
for option in "$@"; do
  if [ "$option" = "--reflow-all" ]; then
    layout_mode=all-top-left
    plan_action=reflow-all-items
  fi
done
if [ "$2" = "plan" ]; then
  printf '%s\\n' '{"schema":"selfhost-homarr-starter-board-polish-plan/v2","live":false,"board":{"id":"board-1","name":"personal","private":true},"action":"'"$plan_action"'","layoutMode":"'"$layout_mode"'","removeItems":[],"preserve":{},"approvalDigest":"${approval}","limits":[]}'
  exit 0
fi
if [ "$2" = "apply" ]; then
  printf '%s\\n' '{"schema":"selfhost-homarr-starter-board-polish-plan/v2","live":true,"board":{"id":"board-1","name":"personal","private":true},"action":"applied","layoutMode":"'"$layout_mode"'","removeItems":[],"preserve":{},"approvalDigest":"${approval}","limits":[]}'
  exit 0
fi
exit 2
`, { mode: 0o755 });
  await chmod(sessionScript, 0o755);
  const accessReader = join(scripts, "lib", "session-context.ts");
  await writeFile(accessReader, `import {existsSync,readFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
export function loadSessionAccessConfig(session) {
  const path=join(session.sessionDir,"artifacts","access.json");
  if (!existsSync(path)) return {routes:{}};
  return {routes:JSON.parse(readFileSync(path,"utf8")).routes};
}
if(Bun.argv[1] && resolve(Bun.argv[1])===fileURLToPath(import.meta.url)) {
  process.stdout.write("FAIL fixture imported helper mistaken for direct invocation\\n");
  process.exitCode=1;
}
`, { mode: 0o644 });
  await chmod(accessReader, 0o644);
  const reconcileFixture = `import {createHash} from "node:crypto";
import {existsSync,readFileSync,writeFileSync} from "node:fs";
let scope="links";
if (import.meta.url.endsWith("homarr-notebook.ts")) scope="notebook";
const [action,runId,boardName]=Bun.argv.slice(2);
const path=".sessions/"+runId+"/artifacts/fixture-"+scope+"-state.json";
let state={revision:0};
if(existsSync(path)) state=JSON.parse(readFileSync(path,"utf8"));
const hash=value=>"sha256:"+createHash("sha256").update(JSON.stringify(value)).digest("hex");
const digest=hash({scope,state,boardName});
const board={id:"board-1",name:boardName,private:true};
const managedApps=["sonarr","radarr","prowlarr","qbittorrent","jellyfin","seerr"].map(service=>({
service,appId:"onboarding_app_"+service,desired:{description:"Safe managed purpose",href:"https://"+service+".private.test",pingUrl:"http://"+service+":8989"},change:state.revision===0,preserveName:true,preserveIcon:true}));
let live=false;
if(action==="apply") {
 if(Bun.argv[6]!==digest) throw new Error("fixture stale approval");
 if(existsSync(".sessions/"+runId+"/artifacts/fixture-reconcile-fail")) throw new Error("fixture-private-reconcile-marker");
 writeFileSync(path,JSON.stringify({revision:state.revision+1}),{mode:0o600});
 live=true;
}
const common={schemaVersion:1,runId,live,mutation:live&&state.revision===0,board,snapshotDigest:digest,approvalDigest:digest,limits:[]};
let output;
if(scope==="links") {
 let action="update-managed-app-links";
 if(state.revision>0) action="already-current";
 if(live) action="applied";
 output={...common,kind:"selfhost-homarr-media-links-plan/v1",action,managedApps,updates:managedApps.filter(entry=>entry.change)};
} else {
 let status="planned";
 if(live) status="applied";
 output={...common,kind:"selfhost-homarr-media-notebook-plan/v1",notebookId:"notebook-1",actions:{create:false,updateContent:state.revision===0,resize:false},layoutDeltas:[],contentSha256:hash("safe content"),status};
}
console.log(JSON.stringify(output));
`;
  for (const name of ["homarr-finalize.ts", "homarr-notebook.ts"]) {
    await writeFile(join(scripts, name), reconcileFixture, { mode: 0o644 });
    await chmod(join(scripts, name), 0o644);
  }
  const composePath = join(harness, "docker-compose.yml");
  await writeFile(composePath, "services: {}\n", { mode: 0o644 });
  await chmod(composePath, 0o644);
  const scriptHash = createHash("sha256").update(await readFile(sessionScript)).digest("hex");
  const runtimeManifestContent = `${JSON.stringify({
    schemaVersion: 1,
    files: [{ path: "scripts/session.sh", sha256: scriptHash, mode: 0o755 },
      { path: "scripts/lib/session-context.ts", sha256: createHash("sha256").update(await readFile(accessReader)).digest("hex"), mode: 0o644 },
      { path: "scripts/homarr-finalize.ts", sha256: createHash("sha256").update(reconcileFixture).digest("hex"), mode: 0o644 },
      { path: "scripts/homarr-notebook.ts", sha256: createHash("sha256").update(reconcileFixture).digest("hex"), mode: 0o644 },
      { path: "docker-compose.yml", sha256: createHash("sha256").update("services: {}\n").digest("hex"), mode: 0o644 }],
  }, null, 2)}\n`;
  const runtimeManifest = join(harness, "runtime-manifest.json");
  await writeFile(runtimeManifest, runtimeManifestContent, { mode: 0o600 });
  await chmod(runtimeManifest, 0o600);
  await writeFile(join(intents, `${runId}.json`), `${JSON.stringify({
    schemaVersion: 1,
    runId,
    username: "admin",
    credentialHandoff: false,
    runtimeSha256: createHash("sha256").update(runtimeManifestContent).digest("hex"),
  }, null, 2)}\n`, { mode: 0o600 });
  await writeFile(join(session, "manifest.env"), [
    `RUN_ID=${runId}`,
    `COMPOSE_PROJECT_NAME=autostack-${runId}`,
    `SESSION_ROOT=${session}`,
    "SESSION_PASSWORD_SCHEME=hmac-v1",
    "ADMIN_USERNAME=admin",
    "HOMARR_BIND_ADDRESS=0.0.0.0",
    ...["PROWLARR_PORT", "RADARR_PORT", "SONARR_PORT", "QBITTORRENT_PORT", "JELLYFIN_PORT", "SEERR_PORT", "HOMARR_PORT"].map((key, index) => `${key}=${31000 + index}`),
  ].join("\n") + "\n", { mode: 0o600 });
  const deploymentFacts = { schemaVersion: 1, runId, projectRoot: root, harness, composeProject: `autostack-${runId}`,
    adminUsername: "admin", bind: "0.0.0.0", runtimeSha256: createHash("sha256").update(runtimeManifestContent).digest("hex"),
    credentialHandoff: false, composeSha256: createHash("sha256").update("services: {}\n").digest("hex"),
    ports: Object.fromEntries(["PROWLARR_PORT", "RADARR_PORT", "SONARR_PORT", "QBITTORRENT_PORT", "JELLYFIN_PORT", "SEERR_PORT", "HOMARR_PORT"].map((key, index) => [key, String(31000 + index)])) };
  const deploymentApproval = createHash("sha256").update(JSON.stringify(deploymentFacts)).digest("hex");
  await writeFile(join(session, "artifacts", "cli-approval-plan.json"), JSON.stringify({ ...deploymentFacts, approvalDigest: deploymentApproval }), { mode: 0o600 });
  await writeFile(join(session, "artifacts", "cli-approved.json"), JSON.stringify({ schemaVersion: 1, approvalDigest: deploymentApproval, firewallScope: "router-private" }), { mode: 0o600 });

  const planOutput = await captureOutput(() => mediaCommand([
    "board-polish", "plan", "--project-root", root, "--run-id", runId, "--board", boardName,
  ]));
  const plan = JSON.parse(planOutput);
  assert.equal(plan.live, false);
  assert.equal(plan.action, "remove-exact-starter-items");
  assert.equal(plan.approvalDigest, approval);
  assert.deepEqual((await readFile(invocation, "utf8")).trim().split("\n"), [
    "homarr-board-polish", "plan", runId, boardName,
  ]);

  const applyOutput = await captureOutput(() => mediaCommand([
    "board-polish", "apply", "--project-root", root, "--run-id", runId, "--board", boardName,
    "--approve", approval,
  ]));
  const applied = JSON.parse(applyOutput);
  assert.equal(applied.live, true);
  assert.equal(applied.action, "applied");
  assert.equal(applied.approvalDigest, approval);
  assert.deepEqual((await readFile(invocation, "utf8")).trim().split("\n"), [
    "homarr-board-polish", "apply", runId, boardName, "--approve", approval,
  ]);

  const reflowPlan = JSON.parse(await captureOutput(() => mediaCommand([
    "board-polish", "plan", "--project-root", root, "--run-id", runId, "--board", boardName, "--reflow-all",
  ])));
  assert.equal(reflowPlan.action, "reflow-all-items");
  assert.equal(reflowPlan.layoutMode, "all-top-left");
  assert.deepEqual((await readFile(invocation, "utf8")).trim().split("\n"), [
    "homarr-board-polish", "plan", runId, boardName, "--reflow-all",
  ]);
  const reflowApplied = JSON.parse(await captureOutput(() => mediaCommand([
    "board-polish", "apply", "--project-root", root, "--run-id", runId, "--board", boardName,
    "--reflow-all", "--approve", approval,
  ])));
  assert.equal(reflowApplied.layoutMode, "all-top-left");
  assert.deepEqual((await readFile(invocation, "utf8")).trim().split("\n"), [
    "homarr-board-polish", "apply", runId, boardName, "--approve", approval, "--reflow-all",
  ]);
  await assert.rejects(mediaCommand([
    "board-polish", "plan", "--project-root", root, "--run-id", runId, "--board", boardName,
    "--reflow-all", "--reflow-all",
  ]), /Unexpected or repeated/u);

  await assert.rejects(
    mediaCommand(["board-polish", "plan", "--project-root", root, "--run-id", runId,
      "--board", boardName, "--approve", approval]),
    /Unexpected or incomplete media option/u,
  );
  await assert.rejects(
    mediaCommand(["board-polish", "apply", "--project-root", root, "--run-id", runId, "--board", boardName]),
    /Missing --approve/u,
  );
  await assert.rejects(
    mediaCommand(["board-polish", "apply", "--project-root", root, "--run-id", runId,
      "--board", boardName, "--approve", "a".repeat(64)]),
    /sha256-prefixed digest/u,
  );
  await assert.rejects(
    mediaCommand(["board-polish", "plan", "--project-root", root, "--run-id", runId,
      "--board", "not valid"]),
    /Invalid Homarr board name/u,
  );
  await assert.rejects(
    mediaCommand(["board-polish", "remove", "--project-root", root, "--run-id", runId,
      "--board", boardName]),
    /accepts plan or apply/u,
  );

  const proxyArgs = ["--project-root", root, "--run-id", runId, "--service", "jellyfin",
    "--origin", "https://JELLYFIN.private.test:443/", "--private-dns-confirmed"];
  const invocationBeforeProxyPlan = await readFile(invocation, "utf8");
  const accessFile = join(session, "artifacts", "access.json");
  const proxyPlan = JSON.parse(await captureOutput(() => mediaCommand(["access-proxy", "plan", ...proxyArgs])));
  assert.equal(proxyPlan.mutation, false);
  assert.equal(proxyPlan.selected.origin, "https://jellyfin.private.test");
  assert.match(proxyPlan.approvalDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(existsSync(accessFile), false);
  assert.equal(await readFile(invocation, "utf8"), invocationBeforeProxyPlan);
  await assert.rejects(mediaCommand(["access-proxy", "apply", ...proxyArgs, "--approve", `sha256:${"b".repeat(64)}`]), /exact digest/u);
  assert.equal(existsSync(accessFile), false);
  const proxyAppliedText = await captureOutput(() => mediaCommand(["access-proxy", "apply", ...proxyArgs, "--approve", proxyPlan.approvalDigest]));
  const proxyApplied = JSON.parse(proxyAppliedText);
  assert.equal(proxyApplied.status, "metadata-updated");
  assert.equal(proxyApplied.mutation.homarr, false);
  assert.equal(proxyApplied.mutation.proxy, false);
  assert.equal(proxyApplied.homarrRefresh.requiresSeparateApproval, true);
  assert.match(proxyApplied.homarrRefresh.linksPlanCommand, /reconcile-links plan/u);
  assert.match(proxyApplied.homarrRefresh.notebookPlanCommand, /reconcile-notebook plan/u);
  assert.match(proxyApplied.homarrRefresh.warning, /fresh Notebook plan/u);
  assert.doesNotMatch(proxyAppliedText, /fixture-private-child-marker/u);
  assert.deepEqual((await readFile(invocation, "utf8")).trim().split("\n"), [
    "access-proxy", "set", runId, "jellyfin", "https://jellyfin.private.test", "--private-dns-confirmed",
  ]);
  const existingAccess = JSON.parse(await readFile(accessFile, "utf8"));
  assert.deepEqual(existingAccess.routes.jellyfin, { origin: "https://jellyfin.private.test", privateDnsConfirmed: true });
  await assert.rejects(mediaCommand(["access-proxy", "apply", ...proxyArgs, "--approve", proxyPlan.approvalDigest]), /unchanged plan/u);
  const changedPlan = JSON.parse(await captureOutput(() => mediaCommand(["access-proxy", "plan", ...proxyArgs])));
  existingAccess.routes.seerr = { origin: "https://seerr.private.test", privateDnsConfirmed: true };
  await writeFile(accessFile, JSON.stringify(existingAccess), { mode: 0o600 });
  await assert.rejects(mediaCommand(["access-proxy", "apply", ...proxyArgs, "--approve", changedPlan.approvalDigest]), /unchanged plan/u);
  const rejectedUserinfo = ["https://", "user", ":", "fixture", "@", "10.0.0.2"].join("");
  for (const origin of ["http://10.0.0.2", rejectedUserinfo, "https://10.0.0.2/?secret=x", "https://10.0.0.2/#token", "https://10.0.0.2/path"]) {
    await assert.rejects(mediaCommand(["access-proxy", "plan", "--project-root", root, "--run-id", runId, "--service", "jellyfin", "--origin", origin]));
  }
  await assert.rejects(mediaCommand(["access-proxy", "plan", ...proxyArgs.slice(0, -1)]), /confirmed private DNS fact/u);
  await assert.rejects(mediaCommand(["access-proxy", "plan", ...proxyArgs, "--private-dns-confirmed"]), /repeated/u);
  const invalidServiceArgs = [...proxyArgs];
  invalidServiceArgs[invalidServiceArgs.indexOf("--service") + 1] = "not-media";
  await assert.rejects(mediaCommand(["access-proxy", "plan", ...invalidServiceArgs]), /Invalid media access service/u);

  const reconcileArgs = ["--project-root", root, "--run-id", runId, "--board", boardName];
  for (const scope of ["links", "notebook"]) {
    const action = `reconcile-${scope}`;
    const planned = JSON.parse(await captureOutput(() => mediaCommand([action, "plan", ...reconcileArgs])));
    assert.equal(planned.mutation, false);
    assert.equal(planned.deployment.approvalDigest, deploymentApproval);
    assert.deepEqual(planned.stages, [`homarr-${scope}-only`]);
    assert.equal(existsSync(join(session, "artifacts", `fixture-${scope}-state.json`)), false);
    await assert.rejects(mediaCommand([action, "apply", ...reconcileArgs, "--approve", approval]), /exact digest/u);
    const applied = JSON.parse(await captureOutput(() => mediaCommand([action, "apply", ...reconcileArgs, "--approve", planned.approvalDigest])));
    assert.equal(applied.status, "applied");
    assert.equal(applied.mutation.handoff, false);
    assert.equal(applied.mutation.docker, false);
    assert.equal(applied.mutation.legacyDeletion, false);
    await assert.rejects(mediaCommand([action, "apply", ...reconcileArgs, "--approve", planned.approvalDigest]), /unchanged plan/u);
    const noOpPlan = JSON.parse(await captureOutput(() => mediaCommand([action, "plan", ...reconcileArgs])));
    const noOpApply = JSON.parse(await captureOutput(() => mediaCommand([action, "apply", ...reconcileArgs, "--approve", noOpPlan.approvalDigest])));
    assert.equal(noOpApply.status, "applied");
    assert.equal(noOpApply.mutation.managedLinks, false);
    assert.equal(noOpApply.mutation.primaryNotebook, false);
  }
  const nextLinksPlan = JSON.parse(await captureOutput(() => mediaCommand(["reconcile-links", "plan", ...reconcileArgs])));
  await writeFile(join(session, "artifacts", "fixture-reconcile-fail"), "fixture-only\n", { mode: 0o600 });
  const failureOutput = await captureOutput(() => mediaCommand(["reconcile-links", "apply", ...reconcileArgs, "--approve", nextLinksPlan.approvalDigest]));
  const failed = JSON.parse(failureOutput);
  assert.equal(failed.status, "unknown-no-auto-replay");
  assert.equal(failed.failedStage, "homarr-links-only");
  assert.match(failed.diagnosisCommand, /reconcile-links plan/u);
  assert.doesNotMatch(failureOutput, /fixture-private-reconcile-marker/u);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;

  await writeFile(sessionScript, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await assert.rejects(
    mediaCommand(["board-polish", "plan", "--project-root", root, "--run-id", runId,
      "--board", boardName]),
    /Media runtime changed: scripts\/session\.sh/u,
  );

  console.log("PASS standalone media board-polish routing, approval guards and installed-runtime verification");
} finally {
  delete process.env.BOARD_POLISH_FIXTURE_INVOCATION;
  await rm(root, { recursive: true });
}
