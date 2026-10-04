#!/usr/bin/env bun

import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleCommand } from "../src/bundle.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function privateJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function capture(action: () => Promise<void>): Promise<Record<string, any>> {
  const priorLog = console.log;
  const priorWrite = process.stdout.write;
  let output = "";
  console.log = (...values: unknown[]) => { output += `${values.map(String).join(" ")}\n`; };
  process.stdout.write = ((value: string | Uint8Array) => {
    if (typeof value === "string") output += value;
    else output += Buffer.from(value).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
  try { await action(); }
  finally { console.log = priorLog; process.stdout.write = priorWrite; }
  return JSON.parse(output);
}

const root = await mkdtemp(join(tmpdir(), "selfhost-bundle-homarr-inputs-"));
const bundleId = "home";
const bundleDirectory = join(root, ".selfhost", "bundles", bundleId);
await mkdir(bundleDirectory, { recursive: true, mode: 0o700 });
await chmod(join(root, ".selfhost"), 0o700);
await chmod(join(root, ".selfhost", "bundles"), 0o700);
await chmod(bundleDirectory, 0o700);

const project = (id: string) => ({ dockerContext: "default", id, owner: id, root,
  directory: join(root, id), ownership: "new" });
const storage = (path: string, owner: string) => ({ path, owner, ownership: "new" });
const immichInput = join(bundleDirectory, "immich-input.json");
const immichAccount = join(bundleDirectory, "immich-account.json");
const docmostInput = join(bundleDirectory, "docmost-input.json");
const docmostAccount = join(bundleDirectory, "docmost-account.json");
const vaultwardenInput = join(bundleDirectory, "vaultwarden-input.json");
const vaultwardenAccount = join(bundleDirectory, "vaultwarden-account.json");
const vaultwardenHttps = join(bundleDirectory, "vaultwarden-https.json");
const bundleInput = join(bundleDirectory, "household-bundle.json");
const immichProject = project("home-immich");
const docmostProject = project("home-docmost");
const vaultProject = project("home-vault");
await privateJson(immichInput, { schemaVersion: 1, project: immichProject, hostIp: "192.168.1.20", publishedPort: 2283,
  integrationNetwork: { id: "homarr", name: "autostack-home-media_web", owner: "external", internal: true },
  storage: { uploads: storage(join(immichProject.directory, "data", "uploads"), immichProject.id) } });
await privateJson(immichAccount, { schemaVersion: 1, username: "admin", email: "owner@example.test", name: "Owner" });
await privateJson(docmostInput, { schemaVersion: 1, project: docmostProject, hostIp: "127.0.0.1", publishedPort: 3000 });
await privateJson(docmostAccount, { schemaVersion: 1, username: "admin", email: "owner@example.test", name: "Owner" });
await privateJson(vaultwardenInput, { schemaVersion: 1, project: vaultProject,
  apps: { vaultwarden: { storage: { data: storage(join(vaultProject.directory, "data"), vaultProject.id) } } } });
await privateJson(vaultwardenAccount, { schemaVersion: 1, username: "admin", email: "owner@example.test" });
await privateJson(vaultwardenHttps, { schemaVersion: 1, origin: "https://vault.home.arpa", exposure: "private",
  routeStatus: "configured", routeOwner: "caddy", tlsOwner: "caddy", clientCertificateTrust: "verified-for-intended-client",
  backend: { hostIp: "127.0.0.1", publishedPort: 8080 } });
await privateJson(bundleInput, { schemaVersion: 1, id: bundleId, projectRoot: root, services: {
  media: { runId: "home-media", username: "admin", credentialHandoff: true },
  immich: { input: immichInput, runId: "home-immich", accountFile: immichAccount },
  docmost: { input: docmostInput, runId: "home-docmost", accountFile: docmostAccount },
  vaultwarden: { input: vaultwardenInput, runId: "home-vault", accountFile: vaultwardenAccount, httpsPlan: vaultwardenHttps },
} });

const session = join(root, ".selfhost", "media-harness", ".sessions", "home-media");
await mkdir(session, { recursive: true, mode: 0o700 });
const connections = join(session, "connections.env");
await writeFile(connections, "HOMARR_API_KEY=fixture-key-not-read-by-bundle\n", { mode: 0o600 });
await chmod(connections, 0o600);
const mediaServices = ["Homarr", "Jellyfin", "Seerr", "Sonarr", "Radarr", "Prowlarr", "qBittorrent"].map((name, index) => ({
  name, purpose: `${name} purpose`, url: `http://127.0.0.1:${7575 + index}`,
}));
const dependencies = {
  media: async () => { console.log(JSON.stringify({ schemaVersion: 1, runId: "home-media", projectRoot: root,
    composeProject: "autostack-home-media", services: mediaServices })); },
  immich: async () => {}, docmost: async () => {}, vaultwarden: async () => {},
};

const plan = await capture(() => bundleCommand(["homarr-inputs", "plan", "--project-root", root, "--input", bundleInput], dependencies));
check(plan.status === "ready-for-review" && plan.mutation === false, "Homarr input plan was not read-only");
check(plan.homarr.origin === "http://127.0.0.1:7575" && plan.homarr.boardName === "personal",
  "Homarr input plan did not select the managed origin and board");
const shortcuts = plan.inputs.filter((entry: any) => Object.hasOwn(entry.content, "service"));
const nativeInputs = plan.inputs.filter((entry: any) => Object.hasOwn(entry.content, "immich"));
check(shortcuts.length === 3 && nativeInputs.length === 1 && plan.inputs.every((entry: any) => entry.mode === "0600"),
  "Homarr input plan did not preserve three shortcuts and add one owner-only native Immich target");
check(plan.inputs[0].content.service.href === "http://192.168.1.20:2283"
  && plan.inputs[1].content.service.href === "http://127.0.0.1:3000"
  && plan.inputs[2].content.service.href === "https://vault.home.arpa",
"Homarr input plan did not derive the three reviewed access URLs");
check(plan.inputs[0].content.service.iconUrl.endsWith("/svg/immich.svg")
  && plan.inputs[1].content.service.iconUrl.endsWith("/png/docmost.png")
  && plan.inputs[2].content.service.iconUrl.endsWith("/svg/vaultwarden.svg"),
"Homarr input plan did not use the existing dashboard-icons references");
check(plan.inputs[0].content.service.storagePath === join(root, "home-immich", "data", "uploads")
  && plan.inputs[1].content.service.storagePath === join(root, "home-docmost", "data", "attachments")
  && plan.inputs[2].content.service.storagePath === join(root, "home-vault", "data"),
"Homarr input plan did not derive the bounded storage paths");
const nativeInput = nativeInputs[0];
const immichApiKeyFile = join(bundleDirectory, "immich-homarr-api-key");
const immichAcceptanceFile = join(bundleDirectory, "immich-acceptance.json");
check(JSON.stringify(nativeInput.content) === JSON.stringify({
  schemaVersion: 1,
  homarr: { origin: "http://127.0.0.1:7575", boardName: "personal" },
  immich: {
    appName: "Immich", integrationName: "Immich", url: "http://immich-server:2283/",
    widgets: [{ kind: "immich-serverStats", options: {
      showUsers: true, showPhotos: true, showVideos: true, showStorage: true,
    } }],
  },
}), "Homarr input plan did not use the native Immich adapter's exact schema");
const nativeCommand = plan.next.commands.find((entry: any) => entry.service === "immich-native");
check(plan.apiKeyFile === connections && plan.immichApiKeyFile === immichApiKeyFile
  && plan.immichAcceptanceFile === immichAcceptanceFile && plan.next.commands.length === 4
  && JSON.stringify(nativeCommand.argv) === JSON.stringify([
    "self-host", "homarr", "attach", "immich", "plan", "--input", nativeInput.path,
    "--api-key-file", connections, "--immich-api-key-file", immichApiKeyFile,
    "--acceptance-file", immichAcceptanceFile,
  ]), "Homarr input plan did not return the exact native plan argv and prerequisite paths");
check(plan.next.commands.filter((entry: any) => entry.service !== "immich-native")
  .every((entry: any) => entry.argv.at(-1) === connections),
"Homarr input plan changed the three shortcut attach commands");
check(plan.inputs.every((entry: any) => !existsSync(entry.path)), "Read-only plan wrote a Homarr input");
check(!existsSync(immichApiKeyFile) && !existsSync(immichAcceptanceFile),
  "Read-only plan created an Immich key or acceptance record");

let wrongApprovalRejected = false;
try {
  await capture(() => bundleCommand(["homarr-inputs", "apply", "--project-root", root, "--input", bundleInput,
    "--approve", "HOMARR-INPUTS:home:wrong"], dependencies));
} catch (error) {
  wrongApprovalRejected = error instanceof Error && error.message.includes("exact approval");
}
check(wrongApprovalRejected && plan.inputs.every((entry: any) => !existsSync(entry.path)),
  "Homarr input apply accepted the wrong approval or wrote a partial result");

const applied = await capture(() => bundleCommand(["homarr-inputs", "apply", "--project-root", root, "--input", bundleInput,
  "--approve", plan.approval], dependencies));
check(applied.status === "created" && applied.created.length === 4,
  "Homarr input apply did not create the three shortcuts and native Immich input");
for (const entry of plan.inputs) {
  check((await lstat(entry.path)).mode % 0o1000 === 0o600, `${entry.path} is not mode 0600`);
  check(JSON.stringify(JSON.parse(await readFile(entry.path, "utf8"))) === JSON.stringify(entry.content),
    `${entry.path} differs from the reviewed generated content`);
}
check(!existsSync(immichApiKeyFile) && !existsSync(immichAcceptanceFile),
  "Homarr input apply created an Immich key or acceptance record");
const repeated = await capture(() => bundleCommand(["homarr-inputs", "apply", "--project-root", root, "--input", bundleInput,
  "--approve", plan.approval], dependencies));
check(repeated.status === "already-current" && repeated.created.length === 0, "Identical Homarr input apply was not idempotent");

await privateJson(immichAccount, { schemaVersion: 1, username: "admin", email: "changed@example.test", name: "Owner" });
let changedBundleRejected = false;
try {
  await capture(() => bundleCommand(["homarr-inputs", "apply", "--project-root", root, "--input", bundleInput,
    "--approve", plan.approval], dependencies));
} catch (error) {
  changedBundleRejected = error instanceof Error && error.message.includes("exact approval");
}
check(changedBundleRejected, "Homarr input apply did not bind approval to the full bundle fingerprint");
await privateJson(immichAccount, { schemaVersion: 1, username: "admin", email: "owner@example.test", name: "Owner" });

await privateJson(nativeInput.path, { changed: true });
let overwriteRejected = false;
try {
  await capture(() => bundleCommand(["homarr-inputs", "apply", "--project-root", root, "--input", bundleInput,
    "--approve", plan.approval], dependencies));
} catch (error) {
  overwriteRejected = error instanceof Error && error.message.includes("no file was overwritten");
}
check(overwriteRejected, "Homarr input apply overwrote a different existing native Immich file");
await privateJson(nativeInput.path, nativeInput.content);

const unboundImmich = JSON.parse(await readFile(immichInput, "utf8"));
delete unboundImmich.integrationNetwork;
await privateJson(immichInput, unboundImmich);
const unboundPlan = await capture(() => bundleCommand(
  ["homarr-inputs", "plan", "--project-root", root, "--input", bundleInput], dependencies));
check(unboundPlan.inputs.length === 3
  && unboundPlan.inputs.every((entry: any) => Object.hasOwn(entry.content, "service"))
  && unboundPlan.next.commands.length === 3
  && unboundPlan.next.immichNative.status === "pending-network"
  && unboundPlan.next.immichNative.pending.includes("Homarr-reachable external network")
  && unboundPlan.limitations.includes(unboundPlan.next.immichNative.pending),
"Missing Immich network did not preserve the three shortcuts with an explicit native pending reason");
const unboundApplied = await capture(() => bundleCommand(
  ["homarr-inputs", "apply", "--project-root", root, "--input", bundleInput,
    "--approve", unboundPlan.approval], dependencies));
check(unboundApplied.status === "already-current" && unboundApplied.created.length === 0
  && unboundApplied.inputs.length === 3,
"Missing Immich network prevented idempotent apply of the three shortcut inputs");
unboundImmich.integrationNetwork = {
  id: "homarr", name: "autostack-home-media_web", owner: "external", internal: true,
};
await privateJson(immichInput, unboundImmich);

const unsafeImmich = JSON.parse(await readFile(immichInput, "utf8"));
unsafeImmich.storage.uploads.path = join(root, "outside-immich");
await privateJson(immichInput, unsafeImmich);
let unsafeStorageRejected = false;
try {
  await capture(() => bundleCommand(["homarr-inputs", "plan", "--project-root", root, "--input", bundleInput], dependencies));
} catch (error) {
  unsafeStorageRejected = error instanceof Error && error.message.includes("exact bundle-owned path");
}
check(unsafeStorageRejected, "Homarr input plan accepted an unsafe storage path");

await rm(root, { recursive: true });
console.log("PASS bundle Homarr inputs are deterministic, owner-only, approval-bound, and non-overwriting");
