import assert from "node:assert/strict";
import { chmod, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

async function captureOutput(callback: () => Promise<void>): Promise<string> {
  let output = "";
  const prior = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try { await callback(); }
  finally { process.stdout.write = prior; }
  return output;
}

const root = join(tmpdir(), `selfhost-docmost-postgres-parent-${process.pid}-${Date.now()}`);
const priorPath = process.env.PATH ?? "";
try {
  await mkdir(root, { mode: 0o700 });
  const projectId = "docmost-postgres-parent";
  const runId = "initial";
  const directory = join(root, projectId);
  const data = join(directory, "data");
  const attachments = join(data, "attachments");
  const database = join(data, "database");
  const redis = join(data, "redis");
  const secrets = join(directory, "secrets");
  const appSecret = join(secrets, "docmost-app-secret");
  const databasePassword = join(secrets, "docmost-database-password");
  const scriptPath = join(directory, "docmost-start.sh");
  const postgresScriptPath = join(directory, "postgres-rootless-start.sh");
  const stateDirectory = join(root, ".selfhost", "docmost", runId);
  const handoffPath = join(stateDirectory, "private-handoff.json");
  const inputPath = join(root, "docmost-input.json");
  const accountPath = join(root, "docmost-account.json");
  for (const path of [directory, data, attachments, database, redis, secrets,
    join(root, ".selfhost"), join(root, ".selfhost", "docmost"), stateDirectory]) {
    await mkdir(path, { mode: 0o700 });
    await chmod(path, 0o700);
  }

  const publishedPort = 31322;
  const digest = "a".repeat(64);
  const input = {
    schemaVersion: 1,
    project: { dockerContext: "rootless", id: projectId, owner: projectId,
      root, directory, ownership: "verified-existing" },
    observed: {
      checkedAt: "2026-09-25T10:00:00Z",
      project: { id: projectId, directory, owner: projectId },
      ports: [{ hostIp: "127.0.0.1", published: publishedPort, protocol: "tcp", owner: projectId }],
      paths: [attachments, database, redis, scriptPath].sort().map((path) => ({ path, owner: projectId })),
      networks: [{ name: `${projectId}-private`, owner: projectId }],
    },
    images: {
      docmost: `docker.io/docmost/docmost:0.96.0@sha256:${digest}`,
      postgres: `docker.io/library/postgres:18.6@sha256:${digest}`,
      redis: `docker.io/library/redis:8.10.2@sha256:${digest}`,
    },
    hostIp: "127.0.0.1",
    publishedPort,
  };
  const account = { schemaVersion: 1, username: "admin", email: "admin@example.com", name: "Admin" };
  const retained = "b".repeat(64);
  const handoff = {
    schemaVersion: 1, kind: "docmost-private-handoff", runId, projectId, account,
    url: `http://127.0.0.1:${publishedPort}`, password: retained, appSecret: "c".repeat(64),
    databasePassword: "d".repeat(64), status: "first-owner-browser-required",
  };
  await privateFile(inputPath, `${JSON.stringify(input, null, 2)}\n`);
  await privateFile(accountPath, `${JSON.stringify(account, null, 2)}\n`);
  await privateFile(appSecret, `${handoff.appSecret}\n`);
  await privateFile(databasePassword, `${handoff.databasePassword}\n`);
  await privateFile(handoffPath, `${JSON.stringify(handoff, null, 2)}\n`);
  await privateFile(scriptPath, startScript);

  const bin = join(root, "bin");
  await mkdir(bin, { mode: 0o700 });
  const fakeDocker = `#!${process.execPath}
const args = process.argv.slice(2);
if (args[2] === "info") {
  process.stdout.write('["name=seccomp","name=rootless"]\\n');
  process.exit(0);
}
if (args[2] === "container" && args[3] === "ls") {
  const file = process.env.SELFHOST_POSTGRES_PARENT_COMPOSE_FILE;
  const databaseFile = process.env.SELFHOST_POSTGRES_COMMAND_COMPOSE_FILE || file;
  const directory = ${JSON.stringify(directory)};
  const project = ${JSON.stringify(projectId)};
  const rows = [
    ["${"1".repeat(64)}", project + "-docmost-1", "docker.io/docmost/docmost:0.96.0", "created", project, "docmost", file, directory, "False"],
    ["${"2".repeat(64)}", project + "-database-1", "postgres:18.6", "exited", project, "database", databaseFile, directory, "False"],
    ["${"3".repeat(64)}", project + "-redis-1", "redis:8.10.2", "exited", project, "redis", file, directory, "False"],
  ];
  process.stdout.write(rows.map((row) => row.join("\\t")).join("\\n") + "\\n");
  process.exit(0);
}
if (args[2] === "container" && args[3] === "inspect") {
  const id = args[args.length - 1];
  if (id === "${"1".repeat(64)}") {
    process.stdout.write(JSON.stringify({"3000/tcp": [{HostIp: "127.0.0.1", HostPort: ${JSON.stringify(String(publishedPort))}}]}) + "\\n");
  } else process.stdout.write("null\\n");
  process.exit(0);
}
if (args[2] === "port") process.exit(0);
if (args[2] === "network" && args[3] === "ls") {
  process.stdout.write(["${"e".repeat(12)}", ${JSON.stringify(`${projectId}-private`)}, "bridge", "local", ${JSON.stringify(projectId)}, "private"].join("\\t") + "\\n");
  process.exit(0);
}
process.exit(91);
`;
  const dockerPath = join(bin, "docker");
  await writeFile(dockerPath, fakeDocker, { mode: 0o700 });
  await chmod(dockerPath, 0o700);
  process.env.PATH = `${bin}:${priorPath}`;

  const common = ["--project-root", root, "--input", inputPath, "--run-id", runId, "--account-file", accountPath];
  const planArgs = ["recover-postgres-parent", "plan", ...common];
  let priorComposeFile = "";
  try { await captureOutput(() => docmostCommand(planArgs, { composePreflight: async () => {} })); }
  catch (error) {
    if (error instanceof Error) {
      const match = error.message.match(/exact prior Compose file: (.+)$/);
      if (match) priorComposeFile = match[1];
    }
  }
  assert.match(priorComposeFile, new RegExp(`^${directory}/compose\\.[0-9a-f]{16}\\.yaml$`));
  await privateFile(priorComposeFile, "name: retained-prior-rootless-plan\n");
  process.env.SELFHOST_POSTGRES_PARENT_COMPOSE_FILE = priorComposeFile;

  const databaseMetadataAs = (uid: number, gid: number) => async (path: string) => {
    const metadata = await lstat(path);
    if (path !== database) return metadata;
    return new Proxy(metadata, {
      get(target, property) {
        if (property === "uid") return uid;
        if (property === "gid") return gid;
        const value = Reflect.get(target, property, target);
        if (typeof value === "function") return value.bind(target);
        return value;
      },
    });
  };
  const overflowDatabaseMetadata = databaseMetadataAs(65534, 65534);
  await assert.rejects(
    captureOutput(() => docmostCommand(planArgs, {
      composePreflight: async () => {},
      rootlessDirectoryMetadata: overflowDatabaseMetadata,
    })),
    /database parent directory has an unverified owner/,
  );
  const runtime = { composePreflight: async () => {} };
  const plan = JSON.parse(await captureOutput(() => docmostCommand(planArgs, runtime)));
  assert.equal(plan.kind, "docmost-v0.96.0-postgres-parent-recovery-plan");
  assert.equal(plan.mutation, false);
  assert.equal(plan.recovery.priorComposeFile, priorComposeFile);
  assert.notEqual(plan.retry.composeFile, priorComposeFile);
  assert.match(plan.approval, new RegExp(`^RECOVER-POSTGRES-PARENT:${projectId}:[0-9a-f]{64}$`));
  assert.doesNotMatch(JSON.stringify(plan), new RegExp(retained));

  await assert.rejects(
    captureOutput(() => docmostCommand(
      ["recover-postgres-parent", "apply", ...common, "--approve", `${plan.approval}0`], runtime)),
    /exact approval token/,
  );
  const applied = JSON.parse(await captureOutput(() => docmostCommand(
    ["recover-postgres-parent", "apply", ...common, "--approve", plan.approval], runtime)));
  assert.equal(applied.status, "recovered");
  assert.equal(applied.mutation.docker, false);
  assert.equal((await lstat(postgresScriptPath)).mode & 0o777, 0o600);
  const wrapper = await readFile(postgresScriptPath, "utf8");
  assert.match(wrapper, /chown postgres:postgres \/var\/lib\/postgresql/);
  assert.match(wrapper, /chmod 0700 \/var\/lib\/postgresql/);
  assert.match(wrapper, /exec gosu postgres \/usr\/local\/bin\/docker-entrypoint\.sh/);
  const revised = JSON.parse(await readFile(inputPath, "utf8"));
  assert.equal(revised.observed.paths.some((entry: { path: string }) => entry.path === postgresScriptPath), true);

  let commandlessComposeFile = "";
  try { await captureOutput(() => docmostCommand(planArgs, runtime)); }
  catch (error) {
    if (error instanceof Error) {
      const match = error.message.match(/exact prior Compose file: (.+)$/);
      if (match) commandlessComposeFile = match[1];
    }
  }
  assert.match(commandlessComposeFile, new RegExp(`^${directory}/compose\\.[0-9a-f]{16}\\.yaml$`));
  assert.notEqual(commandlessComposeFile, priorComposeFile);
  await privateFile(commandlessComposeFile, "name: retained-wrapper-without-command-plan\n");
  process.env.SELFHOST_POSTGRES_COMMAND_COMPOSE_FILE = commandlessComposeFile;
  const subordinateRuntime = {
    composePreflight: async () => {},
    rootlessDirectoryMetadata: databaseMetadataAs(100998, 100998),
  };
  const hostRootRuntime = {
    composePreflight: async () => {},
    rootlessDirectoryMetadata: databaseMetadataAs(0, 0),
  };
  await assert.rejects(
    captureOutput(() => docmostCommand(planArgs, hostRootRuntime)),
    /database parent directory has an unverified owner/,
  );
  const subordinatePlan = JSON.parse(await captureOutput(() => docmostCommand(planArgs, subordinateRuntime)));
  assert.equal(subordinatePlan.recovery.phase, "postgres-command");
  assert.equal(subordinatePlan.recovery.priorComposeFile, commandlessComposeFile);
  assert.equal(subordinatePlan.recovery.retainedComposeFile, priorComposeFile);
  const overflowRuntime = {
    composePreflight: async () => {},
    rootlessDirectoryMetadata: overflowDatabaseMetadata,
  };
  await assert.rejects(
    captureOutput(() => docmostCommand(
      ["recover-postgres-parent", "apply", ...common, "--approve", subordinatePlan.approval], overflowRuntime)),
    /exact approval token/,
  );
  const commandPlan = JSON.parse(await captureOutput(() => docmostCommand(planArgs, overflowRuntime)));
  const commandApplied = JSON.parse(await captureOutput(() => docmostCommand(
    ["recover-postgres-parent", "apply", ...common, "--approve", commandPlan.approval], overflowRuntime)));
  assert.equal(commandApplied.mutation.inputRevised, false);
  assert.equal(commandApplied.mutation.wrapperCreated, false);

  const normalPlan = JSON.parse(await captureOutput(() => docmostCommand(["plan", ...common])));
  assert.equal(normalPlan.approval, commandApplied.retry.approval);
  assert.equal(normalPlan.compose.render.target, commandApplied.retry.composeFile);
  const rootlessRuntime = {
    composeApply: async () => {},
    healthAfterApply: async () => true,
    health: async () => true,
    rootlessDirectoryMetadata: overflowDatabaseMetadata,
  };
  const applyArgs = ["apply", ...common, "--approve", normalPlan.approval];
  const firstApply = JSON.parse(await captureOutput(() => docmostCommand(applyArgs, rootlessRuntime)));
  assert.equal(firstApply.status, "applied-awaiting-owner");
  const rendered = await readFile(normalPlan.compose.render.target, "utf8");
  assert.match(rendered, /entrypoint: \["\/bin\/bash","\/opt\/selfhost\/postgres-rootless-start\.sh"\]/);
  assert.match(rendered, /command: \["postgres"\]/);
  const secondApply = JSON.parse(await captureOutput(() => docmostCommand(applyArgs, rootlessRuntime)));
  assert.equal(secondApply.status, "applied-awaiting-owner");
  const status = JSON.parse(await captureOutput(() => docmostCommand([
    "status", "--project-root", root, "--input", inputPath, "--run-id", runId,
  ], rootlessRuntime)));
  assert.equal(status.health, true);
  assert.equal(status.checkpoint.recorded, true);
  await assert.rejects(
    captureOutput(() => docmostCommand(planArgs, overflowRuntime)),
    /refuses a healthy checkpoint/,
  );
  process.stdout.write("PASS Docmost recovers the exact stopped project with a rootless PostgreSQL parent wrapper\n");
} finally {
  delete process.env.SELFHOST_POSTGRES_PARENT_COMPOSE_FILE;
  delete process.env.SELFHOST_POSTGRES_COMMAND_COMPOSE_FILE;
  process.env.PATH = priorPath;
  await rm(root, { recursive: true, force: true });
}
