import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const temporary = mkdtempSync(join(tmpdir(), "compose-manual-jobs-"));
const validator = join(import.meta.dir, "compose-project.ts");
const wrapper = join(import.meta.dir, "compose-lifecycle.sh");
const input = join(temporary, "manifest.json");
const log = join(temporary, "calls.txt");
const tools = join(temporary, "tools");
mkdirSync(tools, { mode: 0o700 });
writeFileSync(join(tools, "docker"), `#!/usr/bin/env bash
printf '%s|%s\\n' "$COMPOSE_PROFILES" "$*" >> "$MANUAL_JOB_FIXTURE_LOG"
if [[ "$*" == *'info --format'* ]]; then printf '27.0.0\\n'; fi
if [[ "$*" == *' run '* ]]; then printf 'raw-probe-output-must-be-withheld\\n'; fi
`, { mode: 0o700 });
chmodSync(join(tools, "docker"), 0o700);
const automatic = { id: "web", image: "docker.io/library/alpine:3.21.3", restart: "unless-stopped",
  readOnly: true, user: "1000:1000", environment: [], ports: [], mounts: [], networks: ["private"], secretRefs: [] };
const job = { ...automatic, id: "backup", restart: "no", profiles: ["self-host-manual"], hostname: "stable-backup", command: ["restic", "--version"] };
const manifest = (id: string, services: unknown[]) => ({ schemaVersion: 1,
  project: { dockerContext: "default", id, owner: id, root: temporary, directory: join(temporary, id), ownership: "new" as "new" | "verified-existing" },
  services, networks: [{ id: "private", name: `${id}-private`, driver: "bridge", internal: true, owner: id, ownership: "new" }],
  observed: { checkedAt: "2026-10-03T00:00:00Z", project: null as { id: string; owner: string; directory: string } | null, ports: [], paths: [], networks: [] } });
function run(value: unknown, ...args: string[]) {
  writeFileSync(input, JSON.stringify(value), { mode: 0o600 });
  return Bun.spawnSync([process.execPath, validator, ...args, "--input", input], { stdout: "pipe", stderr: "pipe" });
}
function apply(value: ReturnType<typeof manifest>) {
  const rendered = run(value, "render", "--output-dir", value.project.directory);
  assert.equal(rendered.exitCode, 0, rendered.stderr.toString());
  const target = JSON.parse(rendered.stdout.toString()).target;
  const result = Bun.spawnSync(["bash", wrapper, "apply", "--manifest", input, "--context", "default",
    "--project", value.project.id, "--file", target, "--approval", `APPLY:${value.project.id}`], {
    stdout: "pipe", stderr: "pipe", env: { ...process.env, PATH: `${tools}:${dirname(process.execPath)}:${process.env.PATH}`,
      MANUAL_JOB_FIXTURE_LOG: log, COMPOSE_PROFILES: "self-host-manual" },
  });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  return target;
}
try {
  const mixed = manifest("mixed", [automatic, job]);
  const target = apply(mixed);
  const yaml = readFileSync(target, "utf8");
  assert.match(yaml, /profiles: \["self-host-manual"\]/);
  assert.match(yaml, /hostname: "stable-backup"/);
  assert.equal(run(mixed, "automatic-services").stdout.toString().trim(), "web");
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
  assert.ok(calls.every((line) => line.startsWith("|")), "ambient profiles cleared");
  assert.ok(calls.some((line) => line.endsWith("up --detach web")));
  assert.ok(!calls.some((line) => /(?:up|run).*backup/.test(line)));
  writeFileSync(log, "");
  apply(manifest("job-only", [job]));
  assert.ok(!readFileSync(log, "utf8").includes(" up "));
  const addition = manifest("add-jobs", [{ ...automatic, ownership: "new" }, { ...job, ownership: "new" }]);
  addition.project.ownership = "verified-existing";
  addition.observed.project = { id: addition.project.id, owner: addition.project.owner, directory: addition.project.directory };
  mkdirSync(addition.project.directory, { mode: 0o700 });
  const addRender = run(addition, "render", "--output-dir", addition.project.directory);
  assert.equal(addRender.exitCode, 0, addRender.stderr.toString());
  const selection = run(addition, "selected-plan", "--services", "backup,web", "--operation", "add");
  assert.equal(selection.exitCode, 0, selection.stderr.toString());
  writeFileSync(log, "");
  const addResult = Bun.spawnSync(["bash", wrapper, "selected-add", "--manifest", input, "--context", "default",
    "--project", addition.project.id, "--file", JSON.parse(addRender.stdout.toString()).target,
    "--services", "backup,web", "--approval", JSON.parse(selection.stdout.toString()).approval], {
    stdout: "pipe", stderr: "pipe", env: { ...process.env, PATH: `${tools}:${dirname(process.execPath)}:${process.env.PATH}`,
      MANUAL_JOB_FIXTURE_LOG: log, COMPOSE_PROFILES: "self-host-manual" },
  });
  assert.equal(addResult.exitCode, 0, addResult.stderr.toString());
  const addCalls = readFileSync(log, "utf8");
  assert.match(addCalls, /up --detach --no-deps web/);
  assert.ok(!/(?:up|run).*backup/.test(addCalls));
  for (const operation of ["start", "recreate"]) {
    const result = run(mixed, "selected-plan", "--services", "backup", "--operation", operation);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr.toString(), /cannot execute manual jobs/);
  }
  assert.equal(run(mixed, "selected-plan", "--services", "backup", "--operation", "stop").exitCode, 0);
  for (const invalid of [{ ...job, restart: "always" }, { ...job, profiles: ["other"] },
    { ...job, hostname: "bad.example" }, { ...job, hostname: "x".repeat(64) },
    { ...job, ports: [{ hostIp: "127.0.0.1", published: 18080, target: 8080, protocol: "tcp", purpose: "application", publicApproved: false }] }]) {
    assert.equal(run(manifest("invalid", [invalid]), "validate").exitCode, 2);
  }
  assert.equal(run(manifest("indirect", [{ ...automatic, dependsOn: [{ service: "backup", condition: "service_started" }] }, job]), "validate").exitCode, 2);
  const probe = { argv: ["restic", "version"], officialUrl: "https://github.com/restic/restic/releases/tag/v0.19.1" };
  const versionJob = { ...job, image: `ghcr.io/restic/restic:0.19.1@sha256:${"a".repeat(64)}`, manualProbe: probe };
  const probeManifest = manifest("version-probe", [versionJob]);
  const probeRender = run(probeManifest, "render", "--output-dir", probeManifest.project.directory);
  assert.equal(probeRender.exitCode, 0, probeRender.stderr.toString());
  const probeSelection = run(probeManifest, "selected-plan", "--services", "backup", "--operation", "probe");
  assert.equal(probeSelection.exitCode, 0, probeSelection.stderr.toString());
  const probeApproval = JSON.parse(probeSelection.stdout.toString()).approval;
  assert.match(probeApproval, /^SELECTED-PROBE:version-probe:[0-9a-f]{64}$/);
  function invokeProbe(approval: string) {
    return Bun.spawnSync(["bash", wrapper, "selected-probe", "--manifest", input, "--context", "default",
      "--project", probeManifest.project.id, "--file", JSON.parse(probeRender.stdout.toString()).target,
      "--services", "backup", "--approval", approval], {
      stdout: "pipe", stderr: "pipe", env: { ...process.env, PATH: `${tools}:${dirname(process.execPath)}:${process.env.PATH}`,
        MANUAL_JOB_FIXTURE_LOG: log, COMPOSE_PROFILES: "self-host-manual" },
    });
  }
  writeFileSync(log, "");
  const rejectedProbe = invokeProbe(`APPLY:${probeManifest.project.id}`);
  assert.equal(rejectedProbe.exitCode, 2);
  assert.equal(readFileSync(log, "utf8"), "");
  const approvedProbe = invokeProbe(probeApproval);
  assert.equal(approvedProbe.exitCode, 0, approvedProbe.stderr.toString());
  assert.equal(JSON.parse(approvedProbe.stdout.toString()).exitCode, 0);
  assert.ok(!approvedProbe.stdout.toString().includes("raw-probe-output"));
  assert.match(readFileSync(log, "utf8"), /run --rm --no-deps --entrypoint restic backup version/);
  for (const invalid of [{ ...versionJob, manualProbe: { ...probe, argv: ["restic", "backup"] } },
    { ...versionJob, manualProbe: { ...probe, officialUrl: "https://unowned.invalid/" } },
    { ...versionJob, manualProbe: { ...probe, argv: ["sh", "-c"] } },
    { ...versionJob, image: `ghcr.io/restic/restic:0.19.0@sha256:${"a".repeat(64)}` },
    { ...versionJob, profiles: undefined }]) {
    assert.equal(run(manifest("invalid-probe", [invalid]), "validate").exitCode, 2);
  }
  assert.equal(run(manifest("no-probe", [job]), "selected-plan", "--services", "backup", "--operation", "probe").exitCode, 2);
  assert.equal(run(manifest("multi-probe", [versionJob, { ...versionJob, id: "other" }]), "selected-plan", "--services", "backup,other", "--operation", "probe").exitCode, 2);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log("manual jobs: inert preparation, ambient-profile safety, selection and validation passed");
