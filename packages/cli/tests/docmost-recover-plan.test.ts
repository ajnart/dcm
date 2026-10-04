#!/usr/bin/env bun

import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docmostCommand } from "../src/docmost.ts";

const startScript = `#!/usr/bin/env bash
set -euo pipefail
umask 077
APP_SECRET="$(< /run/secrets/docmost_app_secret)"
DB_SECRET="$(< /run/secrets/docmost_db_password)"
if [[ ! "$APP_SECRET" =~ ^[0-9a-f]{64}$ || ! "$DB_SECRET" =~ ^[0-9a-f]{64}$ ]]; then
  printf 'Docmost secret file is invalid\\n' >&2
  exit 1
fi
export APP_SECRET
export DATABASE_URL="postgresql://docmost:"
DATABASE_URL+="$DB_SECRET"
DATABASE_URL+="@database:5432/docmost"
unset DB_SECRET
cd /app
exec "$@"
`;

async function privateFile(path: string, value: string): Promise<void> {
  await writeFile(path, value, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function captureOutput(action: () => Promise<void>): Promise<string> {
  const priorWrite = process.stdout.write;
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    if (typeof chunk === "string") output += chunk;
    else output += Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
  try {
    await action();
    return output;
  } finally {
    process.stdout.write = priorWrite;
  }
}

const root = await mkdtemp(join(tmpdir(), "selfhost-docmost-recovery-"));
const priorPath = process.env.PATH;
const priorMode = process.env.SELFHOST_RECOVERY_MODE;
const priorComposeFile = process.env.SELFHOST_RECOVERY_COMPOSE_FILE;
const priorDocmostState = process.env.SELFHOST_RECOVERY_DOCMOST_STATE;
try {
  const projectId = "docmost-recovery";
  const runId = "failed-rootless";
  const projectDirectory = join(root, projectId);
  const data = join(projectDirectory, "data");
  const attachments = join(data, "attachments");
  const database = join(data, "database");
  const redis = join(data, "redis");
  const secrets = join(projectDirectory, "secrets");
  const appSecret = join(secrets, "docmost-app-secret");
  const databasePassword = join(secrets, "docmost-database-password");
  const scriptPath = join(projectDirectory, "docmost-start.sh");
  const inputPath = join(root, "docmost-input.json");
  const accountPath = join(root, "docmost-account.json");
  const stateDirectory = join(root, ".selfhost", "docmost", runId);
  const statePath = join(stateDirectory, "state.json");
  const handoffPath = join(stateDirectory, "private-handoff.json");
  const composeFile = join(projectDirectory, "compose.0123456789abcdef.yaml");
  for (const directory of [projectDirectory, data, attachments, database, redis, secrets,
    join(root, ".selfhost"), join(root, ".selfhost", "docmost"), stateDirectory]) {
    await mkdir(directory, { mode: 0o700 });
    await chmod(directory, 0o700);
  }
  const retainedSentinel = "DO_NOT_READ_RETAINED_SECRET";
  await privateFile(appSecret, retainedSentinel);
  await privateFile(databasePassword, retainedSentinel);
  await privateFile(handoffPath, retainedSentinel);
  await privateFile(scriptPath, startScript);
  await privateFile(composeFile, "name: retained-failed-plan\n");

  const digest = "a".repeat(64);
  const input = {
    schemaVersion: 1,
    project: {
      dockerContext: "rootless",
      id: projectId,
      owner: projectId,
      root,
      directory: projectDirectory,
      ownership: "new",
    },
    observed: { checkedAt: "2026-09-25T10:00:00Z", project: null, ports: [], paths: [], networks: [] },
    images: {
      docmost: `docker.io/docmost/docmost:0.96.0@sha256:${digest}`,
      postgres: `docker.io/library/postgres:18.6@sha256:${digest}`,
      redis: `docker.io/library/redis:8.10.2@sha256:${digest}`,
    },
    hostIp: "127.0.0.1",
    publishedPort: 3000,
  };
  const account = { schemaVersion: 1, username: "admin", email: "admin@example.com", name: "Admin" };
  const checkpoint = {
    schemaVersion: 1,
    project: projectId,
    runId,
    approvalDigest: "b".repeat(64),
    composeFile,
    handoffPath,
    health: false,
    ownerSetup: "browser-evidence-required",
  };
  await privateFile(inputPath, `${JSON.stringify(input, null, 2)}\n`);
  await privateFile(accountPath, `${JSON.stringify(account, null, 2)}\n`);
  await privateFile(statePath, `${JSON.stringify(checkpoint, null, 2)}\n`);

  const bin = join(root, "bin");
  await mkdir(bin, { mode: 0o700 });
  const log = join(root, "docker-calls.jsonl");
  await privateFile(log, "\n");
  const fakeDocker = `#!${process.execPath}
import fs from "node:fs";
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
if (args[2] === "info") {
  process.stdout.write('["name=seccomp","name=rootless"]\\n');
  process.exit(0);
}
if (args[2] === "container" && args[3] === "ls") {
  const configFile = process.env.SELFHOST_RECOVERY_COMPOSE_FILE || ${JSON.stringify(composeFile)};
  const docmostState = process.env.SELFHOST_RECOVERY_DOCMOST_STATE || "exited";
  const rows = [
    ["${"1".repeat(64)}", "${projectId}-docmost-1", "docker.io/docmost/docmost:0.96.0", docmostState, "${projectId}", "docmost", configFile, ${JSON.stringify(projectDirectory)}, "False"],
    ["${"2".repeat(64)}", "${projectId}-database-1", "postgres:18.6", "exited", "${projectId}", "database", configFile, ${JSON.stringify(projectDirectory)}, "False"],
    ["${"3".repeat(64)}", "${projectId}-redis-1", "redis:8.10.2", "exited", "${projectId}", "redis", configFile, ${JSON.stringify(projectDirectory)}, "False"],
  ];
  if (process.env.SELFHOST_RECOVERY_MODE === "extra") {
    rows.push(["${"4".repeat(64)}", "${projectId}-unrelated-1", "alpine:3.21", "exited", "${projectId}", "unrelated", configFile, ${JSON.stringify(projectDirectory)}, "False"]);
  }
  process.stdout.write(rows.map((row) => row.join("\\t")).join("\\n") + "\\n");
  process.exit(0);
}
if (args[2] === "container" && args[3] === "inspect") {
  const id = args[args.length - 1];
  if (id === "${"1".repeat(64)}") {
    process.stdout.write(JSON.stringify({"3000/tcp": [{HostIp: "127.0.0.1", HostPort: "3000"}]}) + "\\n");
  } else {
    process.stdout.write("null\\n");
  }
  process.exit(0);
}
if (args[2] === "port") {
  if (args[3] === "${"1".repeat(64)}" && process.env.SELFHOST_RECOVERY_DOCMOST_STATE !== "created") {
    process.stdout.write("3000/tcp -> 127.0.0.1:3000\\n");
  }
  process.exit(0);
}
if (args[2] === "network" && args[3] === "ls") {
  process.stdout.write(["${"a".repeat(12)}", "${projectId}-private", "bridge", "local", "${projectId}", "private"].join("\\t") + "\\n");
  process.exit(0);
}
process.exit(91);
`;
  const dockerPath = join(bin, "docker");
  await writeFile(dockerPath, fakeDocker, { mode: 0o700 });
  await chmod(dockerPath, 0o700);
  process.env.PATH = `${bin}:${priorPath}`;
  await privateFile(log, "\n");

  const args = ["recover-plan", "--project-root", root, "--input", inputPath,
    "--run-id", runId, "--account-file", accountPath];
  const output = await captureOutput(() => docmostCommand(args));
  const plan = JSON.parse(output);
  assert.equal(plan.kind, "docmost-v0.96.0-recovery-plan");
  assert.deepEqual(plan.mutation, { inputRevised: true, docker: false });
  assert.equal(plan.compose.status, "pass");
  assert.equal(plan.compose.project.ownership, "verified-existing");
  assert.match(plan.approval, new RegExp(`^APPLY:${projectId}:[0-9a-f]{64}$`));
  assert.doesNotMatch(output, new RegExp(retainedSentinel));

  const revised = JSON.parse(await readFile(inputPath, "utf8"));
  assert.equal(revised.project.ownership, "verified-existing");
  assert.deepEqual(revised.observed.project, { id: projectId, directory: projectDirectory, owner: projectId });
  assert.deepEqual(revised.observed.ports, [{ hostIp: "127.0.0.1", published: 3000, protocol: "tcp", owner: projectId }]);
  assert.deepEqual(revised.observed.networks, [{ name: `${projectId}-private`, owner: projectId }]);
  assert.deepEqual(revised.observed.paths.map((entry: { path: string }) => entry.path),
    [attachments, database, redis, scriptPath].sort());
  assert.equal(await readFile(handoffPath, "utf8"), retainedSentinel);
  assert.equal((await readdir(root)).some((name) => name.startsWith(".docmost-recovery.")), false);
  const calls = (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(calls.length, 9);
  const inspectCalls = calls.filter((call: string[]) => call[2] === "container" && call[3] === "inspect");
  assert.equal(inspectCalls.length, 3);
  assert.equal(inspectCalls.every((call: string[]) => call[4] === "--format"
    && call[5] === "{{json .HostConfig.PortBindings}}"), true);

  await privateFile(inputPath, `${JSON.stringify(input, null, 2)}\n`);
  await privateFile(statePath, `${JSON.stringify({ ...checkpoint, health: true }, null, 2)}\n`);
  await privateFile(log, "\n");
  let healthyRejected = false;
  try { await captureOutput(() => docmostCommand(args)); }
  catch (error) { healthyRejected = error instanceof Error && /refuses a healthy prior checkpoint/.test(error.message); }
  assert.equal(healthyRejected, true);
  assert.equal((await readFile(log, "utf8")).trim(), "");

  await privateFile(statePath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  process.env.SELFHOST_RECOVERY_MODE = "extra";
  let unrelatedRejected = false;
  try { await captureOutput(() => docmostCommand(args)); }
  catch (error) { unrelatedRejected = error instanceof Error && /exactly three bounded Compose-labeled containers/.test(error.message); }
  assert.equal(unrelatedRejected, true);
  assert.equal(JSON.parse(await readFile(inputPath, "utf8")).project.ownership, "new");

  delete process.env.SELFHOST_RECOVERY_MODE;
  await rm(statePath);
  await privateFile(log, "\n");
  let derivedComposeFile = "";
  try { await captureOutput(() => docmostCommand(args)); }
  catch (error) {
    if (error instanceof Error) {
      const match = error.message.match(/exact failed Compose file: (.+)$/);
      if (match) derivedComposeFile = match[1];
    }
  }
  assert.match(derivedComposeFile, new RegExp(`^${projectDirectory}/compose\\.[0-9a-f]{16}\\.yaml$`));
  await privateFile(derivedComposeFile, "name: retained-pre-checkpoint-plan\n");
  process.env.SELFHOST_RECOVERY_COMPOSE_FILE = derivedComposeFile;
  process.env.SELFHOST_RECOVERY_DOCMOST_STATE = "running";
  let runningRejected = false;
  try { await captureOutput(() => docmostCommand(args)); }
  catch (error) { runningRejected = error instanceof Error && /active, unrelated, or mismatched/.test(error.message); }
  assert.equal(runningRejected, true);
  process.env.SELFHOST_RECOVERY_DOCMOST_STATE = "created";
  const preCheckpointOutput = await captureOutput(() => docmostCommand(args));
  const preCheckpointPlan = JSON.parse(preCheckpointOutput);
  assert.equal(preCheckpointPlan.recovery.source, "pre-checkpoint-compose");
  assert.equal(preCheckpointPlan.compose.status, "pass");
  assert.equal(JSON.parse(await readFile(inputPath, "utf8")).project.ownership, "verified-existing");

  process.stdout.write("PASS Docmost recover-plan adopts only the exact failed rootless project\n");
} finally {
  if (priorMode === undefined) delete process.env.SELFHOST_RECOVERY_MODE;
  else process.env.SELFHOST_RECOVERY_MODE = priorMode;
  if (priorComposeFile === undefined) delete process.env.SELFHOST_RECOVERY_COMPOSE_FILE;
  else process.env.SELFHOST_RECOVERY_COMPOSE_FILE = priorComposeFile;
  if (priorDocmostState === undefined) delete process.env.SELFHOST_RECOVERY_DOCMOST_STATE;
  else process.env.SELFHOST_RECOVERY_DOCMOST_STATE = priorDocmostState;
  process.env.PATH = priorPath;
  await rm(root, { recursive: true });
}
