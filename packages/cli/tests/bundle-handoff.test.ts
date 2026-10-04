#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHouseholdCredentials } from "../../../.agents/skills/self-host/workflows/selfhost-setup/scripts/household-credentials.ts";
import { checkBundleVaultwardenHandoff, exportBundleHandoff } from "../src/bundle-handoff.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function privateJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

const root = await mkdtemp(join(tmpdir(), "selfhost-bundle-handoff-"));
try {
  const mediaPassword = ["fixture-media", "password", "0123456789"].join("-");
  await chmod(root, 0o700);
  const state = join(root, ".selfhost");
  await mkdir(state, { mode: 0o700 });
  await writeFile(join(state, ".gitignore"), "*\n", { mode: 0o600 });
  const bundleDir = join(state, "bundles", "home");
  await mkdir(bundleDir, { recursive: true, mode: 0o700 });

  const mediaRun = "media-home";
  const mediaArtifacts = join(state, "media-harness", ".sessions", mediaRun, "artifacts");
  await mkdir(mediaArtifacts, { recursive: true, mode: 0o700 });
  const mediaServices: Record<string, unknown> = {};
  const sentinel = join(root, "shell-command-must-not-run");
  const shellPayload = `$(touch${"${IFS}"}${sentinel})'quoted`;
  for (const name of ["homarr", "jellyfin", "prowlarr", "qbittorrent", "radarr", "seerr", "sonarr"]) {
    mediaServices[name] = {
      url: "http://localhost:21000", localUrl: "http://127.0.0.1:21000", userUrl: null,
      username: name === "jellyfin" ? shellPayload : "admin", password: mediaPassword, apiKey: null,
    };
  }
  await privateJson(join(mediaArtifacts, "private-handoff.json"), { runId: mediaRun, services: mediaServices });

  createHouseholdCredentials({ projectRoot: root, runId: "immich-home", username: "admin",
    email: "admin@example.invalid", services: ["immich"] });
  createHouseholdCredentials({ projectRoot: root, runId: "vault-home", username: "admin",
    email: "admin@example.invalid", services: ["vaultwarden"] });
  const immichAccount = join(bundleDir, "immich-account.json");
  const immichInput = join(bundleDir, "immich-input.json");
  const docmostAccount = join(bundleDir, "docmost-account.json");
  const vaultAccount = join(bundleDir, "vault-account.json");
  const vaultHttps = join(bundleDir, "vault-https.json");
  await privateJson(immichAccount, { username: "admin", email: "admin@example.invalid" });
  await privateJson(immichInput, { hostIp: "127.0.0.1", publishedPort: 2283 });
  const docmostIdentity = { schemaVersion: 1, username: "admin", email: "admin@example.invalid", name: "Home Admin" };
  await privateJson(docmostAccount, docmostIdentity);
  await privateJson(vaultAccount, { username: "admin", email: "admin@example.invalid" });
  await privateJson(vaultHttps, { origin: "https://vaultwarden.localhost:28443" });
  const docmostDir = join(state, "docmost", "docmost-home");
  await mkdir(docmostDir, { recursive: true, mode: 0o700 });
  const digest = "a".repeat(64);
  const docmostInput = join(bundleDir, "docmost-input.json");
  await privateJson(docmostInput, {
    schemaVersion: 1,
    project: { dockerContext: "default", id: "docmost-home", owner: "fixture", root,
      directory: join(root, "docmost-home"), ownership: "new" },
    observed: {},
    images: { docmost: `docker.io/docmost/docmost:0.96.0@sha256:${digest}`,
      postgres: `docker.io/library/postgres:18.6@sha256:${digest}`,
      redis: `docker.io/library/redis:8.10.2@sha256:${digest}` },
    hostIp: "127.0.0.1", publishedPort: 3000,
  });
  await privateJson(join(docmostDir, "private-handoff.json"), {
    schemaVersion: 1, kind: "docmost-private-handoff", runId: "docmost-home", projectId: "docmost-home",
    account: docmostIdentity, url: "http://127.0.0.1:3000", password: digest,
    appSecret: "b".repeat(64), databasePassword: "c".repeat(64), status: "first-owner-browser-required",
  });
  const bundle = {
    id: "home", projectRoot: root,
    services: {
      media: { runId: mediaRun },
      immich: { runId: "immich-home", accountFile: immichAccount, input: immichInput },
      docmost: { runId: "docmost-home", accountFile: docmostAccount, input: docmostInput },
      vaultwarden: { runId: "vault-home", accountFile: vaultAccount, httpsPlan: vaultHttps },
    },
  };
  const first = await exportBundleHandoff(bundle);
  check(first.pending.includes("immich-api-key-not-recorded"), "missing Immich key was not reported");
  check(!first.pending.includes("jellyfin-api-key-not-recorded") && !first.pending.includes("qbittorrent-api-key-not-recorded"),
    "account-based media services were incorrectly marked as missing API keys");
  check(!JSON.stringify(first).includes(mediaPassword), "handoff result exposed a password");
  check(((await stat(first.path)).mode & 0o777) === 0o600, "combined handoff was not private");
  const initial = await readFile(first.path, "utf8");
  check((await checkBundleVaultwardenHandoff(bundle)).matches, "fresh vault handoff did not match its adapter credential");
  const stale = initial.replace(/^VAULTWARDEN_PASSWORD='[^']+'$/m, `VAULTWARDEN_PASSWORD='${"x".repeat(43)}'`);
  check(stale !== initial, "fixture could not locate the vault password field");
  await writeFile(first.path, stale, { mode: 0o600 });
  check(!(await checkBundleVaultwardenHandoff(bundle)).matches, "stale vault handoff was not detected");
  await writeFile(first.path, initial, { mode: 0o600 });
  const homarrPasswordName = ["HOMARR", "PASSWORD"].join("_");
  const docmostPasswordName = ["DOCMOST", "PASSWORD"].join("_");
  check(initial.includes(`${homarrPasswordName}='${mediaPassword}'`)
    && initial.includes(`${docmostPasswordName}='${digest}'`)
    && initial.includes("VAULTWARDEN_URL='https://vaultwarden.localhost:28443'"),
  "combined handoff omitted a selected service");
  const shell = spawnSync("bash", ["-c", "source \"$1\"; printf '%s' \"$JELLYFIN_USERNAME\"", "bash", first.path],
    { encoding: "utf8" });
  check(shell.status === 0 && shell.stdout === shellPayload, "handoff shell quoting altered a value");
  let shellExecuted = false;
  try { await stat(sentinel); shellExecuted = true; } catch { /* expected */ }
  check(!shellExecuted, "sourcing the handoff executed a value as shell code");

  const keyFile = join(bundleDir, "immich-api-key");
  await writeFile(keyFile, "fixture-immich-api-key-0123456789\n", { mode: 0o600 });
  const refreshed = await exportBundleHandoff(bundle, keyFile);
  check(!refreshed.pending.includes("immich-api-key-not-recorded")
    && (await readFile(refreshed.path, "utf8")).includes("IMMICH_API_KEY='fixture-immich-api-key-0123456789'"),
  "refreshed handoff omitted the privately supplied Immich key");
  const conventionalKey = join(bundleDir, "immich-homarr-api-key");
  await writeFile(conventionalKey, "fixture-conventional-key-0123456789\n", { mode: 0o600 });
  const automatic = await exportBundleHandoff(bundle);
  check(!automatic.pending.includes("immich-api-key-not-recorded")
    && (await readFile(automatic.path, "utf8")).includes("IMMICH_API_KEY='fixture-conventional-key-0123456789'"),
  "combined handoff did not include the conventional owner-only Immich key");

  const docmostHandoffPath = join(docmostDir, "private-handoff.json");
  const originalDocmostHandoff = await readFile(docmostHandoffPath, "utf8");
  const changedDocmostHandoff = JSON.parse(originalDocmostHandoff);
  changedDocmostHandoff.projectId = "another-project";
  await privateJson(docmostHandoffPath, changedDocmostHandoff);
  let wrongProjectRejected = false;
  try { await exportBundleHandoff(bundle, keyFile); } catch { wrongProjectRejected = true; }
  check(wrongProjectRejected && (await readFile(refreshed.path, "utf8")).includes("IMMICH_API_KEY='fixture-conventional-key-0123456789'"),
    "cross-project Docmost handoff replaced the valid combined export");
  await writeFile(docmostHandoffPath, originalDocmostHandoff, { mode: 0o600 });

  await unlink(refreshed.path);
  await symlink(keyFile, refreshed.path);
  let rejected = false;
  try { await exportBundleHandoff(bundle, keyFile); } catch { rejected = true; }
  check(rejected, "combined handoff accepted a symlink output");
  console.log("PASS combined household handoff is owner-only, refreshable, and rejects output links");
} finally {
  await rm(root, { recursive: true, force: true });
}
