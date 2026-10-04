import assert from "node:assert/strict";
import { chmod, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
const postgresStartScript = `#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ "$(id -u)" != "0" ]]; then
  printf 'PostgreSQL rootless parent setup requires container UID 0\n' >&2
  exit 1
fi
if [[ ! -d /var/lib/postgresql || -L /var/lib/postgresql ]]; then
  printf 'PostgreSQL parent must be the expected real directory\n' >&2
  exit 1
fi
chown postgres:postgres /var/lib/postgresql
chmod 0700 /var/lib/postgresql
exec /usr/local/bin/docker-entrypoint.sh "$@"
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

const fixtureRoot = join(tmpdir(), `selfhost-docmost-pgdata-fixture-${process.pid}-${Date.now()}`);
const priorPath = process.env.PATH ?? "";
try {
  await mkdir(fixtureRoot, { mode: 0o700 });
  const projectId = "docmost-pgdata-repair";
  const runId = "initial";
  const directory = join(fixtureRoot, projectId);
  const data = join(directory, "data");
  const attachments = join(data, "attachments");
  const database = join(data, "database");
  const redis = join(data, "redis");
  const secrets = join(directory, "secrets");
  const appSecret = join(secrets, "docmost-app-secret");
  const databasePassword = join(secrets, "docmost-database-password");
  const scriptPath = join(directory, "docmost-start.sh");
  const postgresScriptPath = join(directory, "postgres-rootless-start.sh");
  const stateDirectory = join(fixtureRoot, ".selfhost", "docmost", runId);
  const handoffPath = join(stateDirectory, "private-handoff.json");
  const statePath = join(stateDirectory, "state.json");
  const inputPath = join(fixtureRoot, "docmost-input.json");
  const accountPath = join(fixtureRoot, "docmost-account.json");
  for (const path of [directory, data, attachments, database, redis, secrets,
    join(fixtureRoot, ".selfhost"), join(fixtureRoot, ".selfhost", "docmost"), stateDirectory]) {
    await mkdir(path, { mode: 0o700 });
    await chmod(path, 0o700);
  }

  const publishedPort = 31321;
  const digest = "a".repeat(64);
  const account = { schemaVersion: 1, username: "admin", email: "admin@example.com", name: "Admin" };
  const input = {
    schemaVersion: 1,
    project: { dockerContext: "rootless", id: projectId, owner: projectId,
      root: fixtureRoot, directory, ownership: "verified-existing" },
    observed: {
      checkedAt: "2026-09-25T10:00:00Z",
      project: { id: projectId, directory, owner: projectId },
      ports: [{ hostIp: "127.0.0.1", published: publishedPort, protocol: "tcp", owner: projectId }],
      paths: [attachments, database, redis, scriptPath, postgresScriptPath]
        .sort().map((path) => ({ path, owner: projectId })),
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
  const handoff = {
    schemaVersion: 1, kind: "docmost-private-handoff", runId, projectId, account,
    url: `http://127.0.0.1:${publishedPort}`, password: "b".repeat(64), appSecret: "c".repeat(64),
    databasePassword: "d".repeat(64), status: "first-owner-browser-required",
  };
  await privateFile(inputPath, `${JSON.stringify(input, null, 2)}\n`);
  await privateFile(accountPath, `${JSON.stringify(account, null, 2)}\n`);
  await privateFile(handoffPath, `${JSON.stringify(handoff, null, 2)}\n`);
  await privateFile(appSecret, `${handoff.appSecret}\n`);
  await privateFile(databasePassword, `${handoff.databasePassword}\n`);
  await privateFile(scriptPath, startScript);
  await privateFile(postgresScriptPath, postgresStartScript);

  const bin = join(fixtureRoot, "bin");
  await mkdir(bin, { mode: 0o700 });
  const fakeDocker = `#!${process.execPath}
const args = process.argv.slice(2);
if (args[2] === "info") {
  process.stdout.write('["name=seccomp","name=rootless"]\\n');
  process.exit(0);
}
if (args[2] === "compose") process.exit(0);
if (args[2] === "container" && args[3] === "ls") {
  const file = process.env.SELFHOST_REPAIR_COMPOSE_FILE;
  const directory = ${JSON.stringify(directory)};
  const project = ${JSON.stringify(projectId)};
  const rows = [
    ["${"1".repeat(64)}", project + "-docmost-1", "docker.io/docmost/docmost:0.96.0", "created", project, "docmost", file, directory, "False"],
    ["${"2".repeat(64)}", project + "-database-1", "postgres:18.6", "exited", project, "database", file, directory, "False"],
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

  const common = ["--project-root", fixtureRoot, "--input", inputPath, "--run-id", runId, "--account-file", accountPath];
  const ordinaryPlan = JSON.parse(await captureOutput(() => docmostCommand(["plan", ...common])));
  process.env.SELFHOST_REPAIR_COMPOSE_FILE = ordinaryPlan.compose.render.target;
  await captureOutput(() => docmostCommand(
    ["apply", ...common, "--approve", ordinaryPlan.approval],
    { composeApply: async () => {}, healthAfterApply: async () => true },
  ));
  const checkpoint = JSON.parse(await readFile(statePath, "utf8"));
  checkpoint.health = false;
  await privateFile(statePath, `${JSON.stringify(checkpoint, null, 2)}\n`);

  const versionDirectory = join(database, "18");
  const pgdata = join(versionDirectory, "docker");
  await mkdir(versionDirectory, { mode: 0o755 });
  await chmod(versionDirectory, 0o755);
  await mkdir(pgdata, { mode: 0o700 });
  await chmod(pgdata, 0o700);
  await writeFile(join(pgdata, "retained-marker"), "retained\n", { mode: 0o600 });
  const original = await lstat(pgdata);
  const repairRuntime = {
    composePreflight: async () => {},
    rootlessDirectoryMetadata: async (path: string) => {
      const metadata = await lstat(path);
      if (path !== database) return metadata;
      return new Proxy(metadata, {
        get(target, property) {
          if (property === "uid" || property === "gid") return 100998;
          const value = Reflect.get(target, property, target);
          if (typeof value === "function") return value.bind(target);
          return value;
        },
      });
    },
    pgdataMetadata: async (path: string) => {
      const metadata = await lstat(path);
      if (metadata.ino !== original.ino) return metadata;
      return new Proxy(metadata, {
        get(target, property) {
          if (property === "uid") return 65534;
          const value = Reflect.get(target, property, target);
          if (typeof value === "function") return value.bind(target);
          return value;
        },
      });
    },
  };

  const repairArgs = ["repair-pgdata", "plan", ...common];
  const hostRootParentRuntime = {
    ...repairRuntime,
    rootlessDirectoryMetadata: async (path: string) => {
      const metadata = await lstat(path);
      if (path !== database) return metadata;
      return new Proxy(metadata, {
        get(target, property) {
          if (property === "uid" || property === "gid") return 0;
          const value = Reflect.get(target, property, target);
          if (typeof value === "function") return value.bind(target);
          return value;
        },
      });
    },
  };
  await assert.rejects(
    captureOutput(() => docmostCommand(repairArgs, hostRootParentRuntime)),
    /database parent directory has an unverified owner/,
  );
  const repairPlan = JSON.parse(await captureOutput(() => docmostCommand(repairArgs, repairRuntime)));
  assert.equal(repairPlan.kind, "docmost-v0.96.0-pgdata-repair-plan");
  assert.equal(repairPlan.mutation, false);
  assert.match(repairPlan.approval, new RegExp(`^REPAIR-PGDATA:${projectId}:[0-9a-f]{64}$`));
  assert.equal(await readFile(join(pgdata, "retained-marker"), "utf8"), "retained\n");

  await assert.rejects(
    captureOutput(() => docmostCommand(["repair-pgdata", "apply", ...common, "--approve", `${repairPlan.approval}0`], repairRuntime)),
    /exact approval token/,
  );
  const changedParentRuntime = {
    ...repairRuntime,
    rootlessDirectoryMetadata: async (path: string) => {
      const metadata = await lstat(path);
      if (path !== database) return metadata;
      return new Proxy(metadata, {
        get(target, property) {
          if (property === "uid" || property === "gid") return 100998;
          if (property === "ino") return metadata.ino + 1;
          const value = Reflect.get(target, property, target);
          if (typeof value === "function") return value.bind(target);
          return value;
        },
      });
    },
  };
  await assert.rejects(
    captureOutput(() => docmostCommand(
      ["repair-pgdata", "apply", ...common, "--approve", repairPlan.approval], changedParentRuntime)),
    /exact approval token/,
  );
  const applied = JSON.parse(await captureOutput(() => docmostCommand(
    ["repair-pgdata", "apply", ...common, "--approve", repairPlan.approval], repairRuntime)));
  assert.equal(applied.status, "repaired");
  assert.equal(applied.mutation.dataDeleted, false);
  assert.equal(applied.quarantine, repairPlan.repair.quarantine);
  assert.equal(await readFile(join(applied.quarantine, "retained-marker"), "utf8"), "retained\n");
  assert.equal((await lstat(pgdata)).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(pgdata), []);
  assert.equal(applied.retry.approval, ordinaryPlan.approval);

  await assert.rejects(
    captureOutput(() => docmostCommand(repairArgs, repairRuntime)),
    /inaccessible non-host owner/,
  );
  process.stdout.write("PASS Docmost PGDATA repair quarantines only the exact inaccessible directory\n");
} finally {
  delete process.env.SELFHOST_REPAIR_COMPOSE_FILE;
  process.env.PATH = priorPath;
  await rm(fixtureRoot, { recursive: true, force: true });
}
