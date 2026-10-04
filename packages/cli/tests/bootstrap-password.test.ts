import assert from "node:assert/strict";
import { mock } from "bun:test";
import * as childProcess from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every subprocess is replaced; this fixture never contacts a Docker daemon.
let subprocess: (command: string, args: string[], options: any) => any = () => {
  throw new Error("Unexpected subprocess");
};
mock.module("node:child_process", () => ({ ...childProcess,
  spawnSync: (command: string, args: string[], options: any) => subprocess(command, args, options) }));
const { createSetupTransportFacilities } = await import("../src/control-panel/setup-transport.ts");
const root = await mkdtemp(join(tmpdir(), "selfhost-bootstrap-password-"));
const projectId = "bootstrap_fixture";
const projectDirectory = join(root, ".selfhost", "shared", projectId);
const composeTarget = join(projectDirectory, "compose.aaaaaaaaaaaaaaaa.yaml");
const containerId = "c".repeat(64);
const startedAt = "2026-10-01T12:00:00.123456789Z";
const qbtPassword = "syntheticQbt123";
const frigatePassword = "a".repeat(32);
const format = '{{.Id}}|{{.State.StartedAt}}|{{.State.Running}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}';
function log(text: string, at = "2026-10-01T12:00:00.123456790Z") { return `${at} ${text}\n`; }
const border = "********************************************************";
const fresh = "***    Auth is enabled, but no users exist.          ***";
const created = "***    Created a default user:                       ***";
const admin = "***    User: admin                                   ***";
const passwordLine = `***    Password: ${frigatePassword}   ***`;
const block = [border, border, fresh, created, admin, passwordLine, border, border]
  .map((line) => log(`[2026-10-01 12:00:00] frigate.app INFO : ${line}`)).join("");
type Scenario = { appId?: string; logs?: string; stderr?: string; fields?: string[];
  psOutput?: string; failStage?: string; restart?: boolean; started?: string };

try {
  await mkdir(projectDirectory, { recursive: true, mode: 0o700 });
  await writeFile(composeTarget, "synthetic-compose-only", { mode: 0o600 });
  for (const appId of ["qbittorrent", "frigate", "sonarr"]) {
    const privateFiles = join(projectDirectory, "secrets", appId);
    await mkdir(privateFiles, { recursive: true, mode: 0o700 });
    await writeFile(join(privateFiles, "admin-password"), "saved-generated-password", { mode: 0o600 });
  }
  async function fixture(scenario: Scenario = {}) {
    const appId = scenario.appId ?? "frigate";
    const privateFiles = join(projectDirectory, "secrets", appId);
    const status = { command: "app status", ownerKind: "shared", appId, projectRoot: root,
      mutation: false, status: "applied", runtime: { state: "running" }, projectId,
      dockerContext: "default", port: 18971, url: "http://127.0.0.1:18971", composeTarget,
      applyApproval: `SHARED-APPLY:${projectId}:${"b".repeat(64)}`, ownerRevision: 1,
      manifestHash: "d".repeat(64), privateFiles, passwordFile: join(privateFiles, "admin-password") };
    const registered: string[] = [];
    const calls: string[][] = [];
    let inspectCalls = 0;
    subprocess = (command, args, options) => {
      assert.equal(command, "docker");
      assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
      assert.equal(options.timeout, 15_000);
      assert.equal(options.encoding, "utf8");
      calls.push(args);
      let stdout = "";
      let stderr = "";
      let stage = "ps";
      if (args[2] === "compose") {
        assert.deepEqual(args, ["--context", "default", "compose", "--project-name", projectId,
          "--file", composeTarget, "ps", "-q", appId]);
        assert.equal(options.maxBuffer, 64 * 1024);
        stdout = scenario.psOutput ?? `${containerId}\n`;
      } else if (args[3] === "inspect") {
        stage = "inspect";
        assert.deepEqual(args, ["--context", "default", "container", "inspect", "--format", format, containerId]);
        assert.equal(options.maxBuffer, 64 * 1024);
        const fields = scenario.fields ?? [containerId, scenario.started ?? startedAt, "true", projectId,
          appId, composeTarget, projectDirectory];
        if (++inspectCalls > 1 && scenario.restart) fields[1] = "2026-10-01T12:00:01Z";
        stdout = `${fields.join("|")}\n`;
      } else {
        stage = "logs";
        assert.deepEqual(args, ["--context", "default", "container", "logs", "--since",
          scenario.started ?? startedAt, "--timestamps", containerId]);
        assert.equal(options.maxBuffer, 256 * 1024);
        stdout = scenario.logs ?? block;
        stderr = scenario.stderr ?? "";
      }
      let code = 0;
      if (scenario.failStage === stage) { code = 1; stderr = "private-fixture-log-no-output"; }
      return { status: code, stdout, stderr };
    };
    const facilities = createSetupTransportFacilities({ appId, projectRoot: root,
      async readStatus() { return status; }, async readHandoff() { throw new Error("Unexpected handoff"); },
      async approve() { throw new Error("Bootstrap reading is not a mutation approval"); },
      approvalQueue: { tail: Promise.resolve() }, registerSecret(value) { registered.push(value); },
      redact(value) { return registered.reduce((safe, secret) => safe.replaceAll(secret, "[redacted]"), value); } });
    return { facilities, registered, calls };
  }
  const frigate = await fixture();
  assert.equal(await frigate.facilities.secrets.readBootstrapPassword(), frigatePassword);
  assert.ok(frigate.registered.includes(frigatePassword));
  assert.equal(frigate.calls.length, 4);
  const stderrBlock = await fixture({ logs: "", stderr: block });
  assert.equal(await stderrBlock.facilities.secrets.readBootstrapPassword(), frigatePassword);
  const duplicated = await fixture({ logs: block + block });
  await assert.rejects(duplicated.facilities.secrets.readBootstrapPassword(), /unique complete/);
  assert.ok(duplicated.registered.includes(frigatePassword));
  const qbt = await fixture({ appId: "qbittorrent", logs: log(`The WebUI administrator password was not set. A temporary password is provided for this session: ${qbtPassword}`) });
  assert.equal(await qbt.facilities.secrets.readBootstrapPassword(), qbtPassword);
  assert.ok(qbt.registered.includes(qbtPassword));
  assert.equal(await qbt.facilities.secrets.readQbittorrentTemporaryPassword(), qbtPassword);
  await assert.rejects(frigate.facilities.secrets.readQbittorrentTemporaryPassword(), /limited to qBittorrent/);
  const unsupported = await fixture({ appId: "sonarr" });
  await assert.rejects(unsupported.facilities.secrets.readBootstrapPassword(), /allowlisted profile/);
  assert.equal(unsupported.calls.length, 0);
  const failures: Scenario[] = [
    { logs: block + block }, { logs: log(passwordLine) },
    { logs: block + log("***    Reset admin password set in the config.       ***") },
    { logs: block.replace(admin, "***    User: other                                   ***") },
    { logs: block.replace(frigatePassword, "b".repeat(31)) },
    { logs: block.replace(frigatePassword, "A".repeat(32)) },
    { logs: block.replaceAll(".123456790Z", ".123456788Z") },
    { logs: block.replaceAll("2026-10-01", "2036-10-01") },
    { logs: block.replace(/^[^ ]+ /gm, "") },
    { logs: "x".repeat(256 * 1024 + 1) }, { restart: true },
    { psOutput: `${containerId}\n${containerId}\n` },
    { started: "2036-10-01T12:00:00Z" }, { started: "invalid" },
    { failStage: "ps" }, { failStage: "inspect" }, { failStage: "logs" },
    { appId: "qbittorrent", logs: log(`temporary password is provided for this session: ${qbtPassword}`)
      + log(`temporary password is provided for this session: ${qbtPassword}`) },
    { appId: "qbittorrent", logs: log("temporary password is provided for this session: abc") },
    { appId: "qbittorrent", logs: log("temporary password is provided for this session: invalid\0password") },
  ];
  for (let index = 0; index < 7; index++) {
    const fields = [containerId, startedAt, "true", projectId, "frigate", composeTarget, projectDirectory];
    fields[index] = "wrong-owner-field";
    failures.push({ fields });
  }
  failures.push({ fields: [containerId, startedAt, "true", projectId, "frigate", composeTarget, projectDirectory, "extra"] });
  for (const scenario of failures) {
    const f = await fixture(scenario);
    await assert.rejects(f.facilities.secrets.readBootstrapPassword(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(frigatePassword), false);
      assert.equal(error.message.includes(qbtPassword), false);
      assert.equal(error.message.includes("private-fixture-log-no-output"), false);
      return true;
    });
  }
  for (const variable of ["DOCKER_HOST", "DOCKER_CONTEXT"]) {
    const ambient = process.env[variable];
    try {
      process.env[variable] = "synthetic-unowned-context";
      const f = await fixture();
      await assert.rejects(f.facilities.secrets.readBootstrapPassword(), /exact saved local Docker context/);
      assert.equal(f.calls.length, 0);
    } finally {
      if (ambient === undefined) delete process.env[variable];
      else process.env[variable] = ambient;
    }
  }
} finally {
  mock.restore();
  await rm(root, { recursive: true });
}
console.log("Bootstrap passwords: allowlisted profiles, exact subprocess ownership/current-start checks, duplicates/reset rejection and private registration passed");
