#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { mediaCommand } from "../src/media.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function executeFixture(): Promise<void> {
  const root = process.argv[3];
  const runId = process.argv[4];
  check(root && runId, "fixture execution needs project root and run ID");
  await mediaCommand(["status", "--project-root", root, "--run-id", runId, "--json", "yes"]);
}

async function runFixture(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "selfhost-media-status-"));
  try {
    await chmod(root, 0o700);
    const source = resolve(".agents/skills/self-host/workflows/selfhost-media/assets/harness");
    const harness = join(root, ".selfhost", "media-harness");
    await mkdir(harness, { recursive: true, mode: 0o700 });
    const bundle = JSON.parse(await readFile(join(source, "bundle-manifest.json"), "utf8"));
    const files = bundle.files.filter((entry: { path: string }) => {
      if (entry.path === "docker-compose.yml" || entry.path === "docs/browser-paths.json") return true;
      if (!entry.path.startsWith("scripts/")) return false;
      const name = entry.path.split("/").at(-1);
      return !name?.startsWith("check-") && name !== "render-prompt.sh";
    });
    const runtimeFiles = [];
    for (const entry of files) {
      const sourceFile = join(source, entry.path);
      const destination = join(harness, entry.path);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await cp(sourceFile, destination);
      const executable = entry.mode === "0755";
      let mode = 0o644;
      if (executable) mode = 0o755;
      await chmod(destination, mode);
      const sha256 = createHash("sha256").update(await readFile(destination)).digest("hex");
      check(sha256 === entry.sha256, `fixture source drifted: ${entry.path}`);
      runtimeFiles.push({ path: entry.path, sha256, mode });
    }
    const runtimeManifest = join(harness, "runtime-manifest.json");
    const runtimeManifestContent = `${JSON.stringify({ schemaVersion: 1, files: runtimeFiles }, null, 2)}\n`;
    await writeFile(runtimeManifest, runtimeManifestContent, { mode: 0o600 });
    await chmod(runtimeManifest, 0o600);
    for (const directory of [join(root, ".selfhost"), harness, join(harness, "docs"), join(harness, "scripts")]) {
      await chmod(directory, 0o700);
    }

    const runId = "legacy-loopback";
    const intents = join(root, ".selfhost", "cli-intents");
    const intentPath = join(intents, `${runId}.json`);
    await mkdir(intents, { mode: 0o700 });
    await writeFile(intentPath, `${JSON.stringify({
      schemaVersion: 1,
      runId,
      username: "admin",
      credentialHandoff: false,
      runtimeSha256: createHash("sha256").update(runtimeManifestContent).digest("hex"),
    }, null, 2)}\n`, { mode: 0o600 });
    const session = join(harness, ".sessions", runId);
    await mkdir(session, { recursive: true, mode: 0o700 });
    await chmod(join(harness, ".sessions"), 0o700);
    await chmod(session, 0o700);
    await writeFile(join(session, "manifest.env"), [
      `RUN_ID=${runId}`,
      `COMPOSE_PROJECT_NAME=autostack-${runId}`,
      `SESSION_ROOT=${session}`,
      "HOMARR_BIND_ADDRESS=127.0.0.1",
    ].join("\n") + "\n", { mode: 0o600 });

    const bin = join(root, "bin");
    const listInvocation = join(root, "docker-list-args.txt");
    const inspectInvocation = join(root, "docker-inspect-args.txt");
    await mkdir(bin, { mode: 0o700 });
    const services = ["prowlarr", "radarr", "sonarr", "qbittorrent", "jellyfin", "seerr", "homarr"];
    const containerIds = services.map((_, index) => String(index + 1).repeat(64));
    const listRecords = services.map((service, index) => JSON.stringify({
      id: containerIds[index], project: `autostack-${runId}`, service, state: "running",
    }));
    const inspectRecords = services.map((service, index) => {
      let health = "";
      if (service === "seerr") health = "healthy";
      if (health === "") health = "unavailable";
      return JSON.stringify({ id: containerIds[index], project: `autostack-${runId}`, service, state: "running", health });
    });
    await writeFile(join(bin, "docker"), `#!/bin/sh
if [ "$2" = "ls" ]; then
  printf '%s\\n' "$@" > "${listInvocation}"
  printf '%s\\n' ${listRecords.map((record) => `'${record}'`).join(" ")}
  exit 0
fi
if [ "$2" = "inspect" ]; then
  printf '%s\\n' "$@" > "${inspectInvocation}"
  printf '%s\\n' ${inspectRecords.map((record) => `'${record}'`).join(" ")}
  exit 0
fi
exit 2
`, { mode: 0o755 });
    await chmod(join(bin, "docker"), 0o755);
    const command = Bun.spawnSync({
      cmd: [process.execPath, import.meta.path, "--execute", root, runId],
      cwd: resolve("."),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      stdout: "pipe",
      stderr: "pipe",
    });
    check(command.exitCode === 0, `legacy media status failed: ${command.stderr.toString()}`);
    const output = command.stdout.toString();
    const status = JSON.parse(output);
    check(status.provenance === "cli-managed" && status.runId === runId && status.composeProject === `autostack-${runId}`,
      "status did not retain the exact legacy run identity");
    check(status.summary.expected === 7 && status.summary.present === 7 && status.summary.running === 7
      && status.summary.healthy === 1, "status did not summarize the seven exact services");
    const listArgs = (await readFile(listInvocation, "utf8")).trim().split("\n");
    check(JSON.stringify(listArgs.slice(0, 6)) === JSON.stringify(["container", "ls", "--all", "--no-trunc", "--filter",
      `label=com.docker.compose.project=autostack-${runId}`]) && !listArgs.some((value) => value.includes("HealthStatus")),
    "status did not use the compatible exact Compose project listing");
    const inspectArgs = (await readFile(inspectInvocation, "utf8")).trim().split("\n");
    check(JSON.stringify(inspectArgs.slice(0, 3)) === JSON.stringify(["container", "inspect", "--format"])
      && JSON.stringify(inspectArgs.slice(4)) === JSON.stringify(containerIds),
    "status did not inspect only the exact project container IDs");
    check(![...listArgs, ...inspectArgs].some((value) => value.includes("secrets.env")) && !existsSync(join(session, "secrets.env")),
      "structured status required or forwarded the session secrets file");
    check(!existsSync(join(session, "artifacts", "cli-approval-plan.json")),
      "structured status required a current apply plan");
    await writeFile(join(bin, "docker"), "#!/bin/sh\nprintf 'private docker failure detail\\n' >&2\nexit 1\n", { mode: 0o755 });
    const unavailable = Bun.spawnSync({
      cmd: [process.execPath, import.meta.path, "--execute", root, runId],
      cwd: resolve("."),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      stdout: "pipe",
      stderr: "pipe",
    });
    check(unavailable.exitCode !== 0
      && unavailable.stderr.toString().includes("container list could not query Docker")
      && unavailable.stderr.toString().includes("self-host doctor")
      && !unavailable.stderr.toString().includes("private docker failure detail"),
    "status did not explain an inaccessible Docker daemon without leaking child output");
    await rm(intentPath);
    const unmanaged = Bun.spawnSync({
      cmd: [process.execPath, import.meta.path, "--execute", root, runId],
      cwd: resolve("."),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      stdout: "pipe",
      stderr: "pipe",
    });
    check(unmanaged.exitCode !== 0 && unmanaged.stderr.toString().includes("not managed by this CLI")
      && !unmanaged.stdout.toString().includes("selfhost-media-status"),
    "status did not distinguish a harness-only run from CLI ownership");
    console.log("PASS legacy loopback media status stays exact, structured, and secret-free");
  } finally {
    await rm(root, { recursive: true });
  }
}

if (process.argv[2] === "--execute") await executeFixture();
else await runFixture();
