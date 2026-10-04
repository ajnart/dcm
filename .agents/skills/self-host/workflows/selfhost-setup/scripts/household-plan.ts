#!/usr/bin/env bun

import fs from "node:fs";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";

type Storage = { path: string; owner: string; ownership: "new" | "verified-existing" };
type LocalStorage = Storage & { localFilesystem: true };
type CommonApp = {
  image: string;
  uid: number;
  gid: number;
  hostIp: string;
  publishedPort: number;
};

type HouseholdInput = {
  schemaVersion: 1;
  project: Record<string, unknown>;
  observed: Record<string, unknown>;
  network: { id: string; name: string; internal: boolean; subnet?: string };
  integrationNetwork?: { id: string; name: string; owner: string };
  apps: {
    navidrome?: CommonApp & { storage: { data: Storage; music: Storage } };
    audiobookshelf?: CommonApp & { storage: { config: LocalStorage; metadata: Storage; audiobooks: Storage } };
    vaultwarden?: CommonApp & { storage: { data: Storage }; domain: string; bootstrapRegistration?: boolean };
  };
};

const APP_IDS = ["audiobookshelf", "navidrome", "vaultwarden"] as const;

function fail(message: string): never {
  throw new Error(message);
}

function requireObject(value: unknown, name: string): Record<string, any> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} must be an object`);
  }
  return value as Record<string, any>;
}

function exactKeys(value: Record<string, any>, required: string[], optional: string[], name: string): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail(`${name} contains an unsupported field`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail(`${name} is missing ${key}`);
    }
  }
}

function isPrivateHost(hostIp: string): boolean {
  if (hostIp === "127.0.0.1" || hostIp === "::1") {
    return true;
  }
  if (isIP(hostIp) === 4) {
    const parts = hostIp.split(".").map(Number);
    return parts[0] === 10 || parts[0] === 127 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
  }
  const lowered = hostIp.toLowerCase();
  return isIP(hostIp) === 6 && (lowered.startsWith("fc") || lowered.startsWith("fd") || lowered.startsWith("fe8") || lowered.startsWith("fe9") || lowered.startsWith("fea") || lowered.startsWith("feb"));
}

function normalizeStorage(value: unknown, name: string): Storage {
  const storage = requireObject(value, name);
  exactKeys(storage, ["path", "owner", "ownership"], [], name);
  return storage as Storage;
}

function normalizeLocalStorage(value: unknown, name: string): LocalStorage {
  const storage = requireObject(value, name);
  exactKeys(storage, ["path", "owner", "ownership", "localFilesystem"], [], name);
  if (storage.localFilesystem !== true) {
    fail(`${name}.localFilesystem must be true`);
  }
  return storage as LocalStorage;
}

function normalizeCommon(value: Record<string, any>, name: string, extraRequired: string[], optional: string[]): CommonApp {
  exactKeys(value, ["image", "uid", "gid", "hostIp", "publishedPort", "storage", ...extraRequired], optional, name);
  if (typeof value.image !== "string" || !value.image.includes("@sha256:")) {
    fail(`${name}.image must include an immutable sha256 digest`);
  }
  return value as CommonApp;
}

function mount(storage: Storage, target: string, readOnly: boolean) {
  return {
    source: storage.path,
    target,
    readOnly,
    shared: readOnly,
    owner: storage.owner,
    ownership: storage.ownership
  };
}

function serviceBase(id: string, app: CommonApp, target: number, networkIds: string[]) {
  return {
    id,
    image: app.image,
    restart: "unless-stopped",
    readOnly: false,
    user: `${app.uid}:${app.gid}`,
    environment: [] as { name: string; value: string }[],
    ports: [{ hostIp: app.hostIp, published: app.publishedPort, target, protocol: "tcp", purpose: "application", publicApproved: false }],
    mounts: [] as ReturnType<typeof mount>[],
    networks: networkIds,
    secretRefs: []
  };
}

function requireHttpsOrigin(value: unknown): string {
  if (typeof value !== "string") {
    fail("apps.vaultwarden.domain must be an approved HTTPS origin");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail("apps.vaultwarden.domain must be an approved HTTPS origin");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    fail("apps.vaultwarden.domain must be an approved HTTPS origin");
  }
  return parsed.origin;
}

export function buildHouseholdManifest(rawInput: unknown) {
  const input = requireObject(rawInput, "input") as HouseholdInput;
  exactKeys(input, ["schemaVersion", "project", "observed", "network", "apps"], ["integrationNetwork"], "input");
  if (input.schemaVersion !== 1) {
    fail("schemaVersion must be 1");
  }
  const project = requireObject(input.project, "project");
  const network = requireObject(input.network, "network");
  exactKeys(network, ["id", "name", "internal"], ["subnet"], "network");
  if (Object.hasOwn(network, "subnet") && typeof network.subnet !== "string") {
    fail("network.subnet must be a string when supplied");
  }
  const apps = requireObject(input.apps, "apps");
  exactKeys(apps, [], [...APP_IDS], "apps");
  if (Object.keys(apps).length === 0) {
    fail("apps must select at least one supported application");
  }

  const primaryNetwork: Record<string, unknown> = {
    id: network.id,
    name: network.name,
    driver: "bridge",
    internal: network.internal,
    owner: project.owner,
    ownership: "new"
  };
  if (network.subnet !== undefined) {
    primaryNetwork.subnet = network.subnet;
  }
  const networks = [primaryNetwork];
  const networkIds = [network.id];
  if (input.integrationNetwork) {
    const integration = requireObject(input.integrationNetwork, "integrationNetwork");
    exactKeys(integration, ["id", "name", "owner"], [], "integrationNetwork");
    networks.push({ id: integration.id, name: integration.name, driver: "bridge", internal: false, owner: integration.owner, ownership: "verified-existing" });
    networkIds.push(integration.id);
  }

  const services: ReturnType<typeof serviceBase>[] = [];
  if (apps.navidrome) {
    const navidrome = requireObject(apps.navidrome, "apps.navidrome");
    normalizeCommon(navidrome, "apps.navidrome", [], []);
    const navStorage = requireObject(navidrome.storage, "apps.navidrome.storage");
    exactKeys(navStorage, ["data", "music"], [], "apps.navidrome.storage");
    const nav = serviceBase("navidrome", navidrome as CommonApp, 4533, networkIds);
    nav.environment = [{ name: "ND_DATAFOLDER", value: "/data" }, { name: "ND_MUSICFOLDER", value: "/music" }];
    nav.mounts = [mount(normalizeStorage(navStorage.data, "navidrome data"), "/data", false), mount(normalizeStorage(navStorage.music, "navidrome music"), "/music", true)];
    services.push(nav);
  }
  if (apps.audiobookshelf) {
    const audiobookshelf = requireObject(apps.audiobookshelf, "apps.audiobookshelf");
    normalizeCommon(audiobookshelf, "apps.audiobookshelf", [], []);
    const audioStorage = requireObject(audiobookshelf.storage, "apps.audiobookshelf.storage");
    exactKeys(audioStorage, ["config", "metadata", "audiobooks"], [], "apps.audiobookshelf.storage");
    const audio = serviceBase("audiobookshelf", audiobookshelf as CommonApp, 80, networkIds);
    audio.mounts = [
      mount(normalizeLocalStorage(audioStorage.config, "audiobookshelf config"), "/config", false),
      mount(normalizeStorage(audioStorage.metadata, "audiobookshelf metadata"), "/metadata", false),
      mount(normalizeStorage(audioStorage.audiobooks, "audiobookshelf audiobooks"), "/audiobooks", true)
    ];
    services.push(audio);
  }
  if (apps.vaultwarden) {
    const vaultwarden = requireObject(apps.vaultwarden, "apps.vaultwarden");
    normalizeCommon(vaultwarden, "apps.vaultwarden", ["domain"], ["bootstrapRegistration"]);
    if (Object.hasOwn(vaultwarden, "bootstrapRegistration") && typeof vaultwarden.bootstrapRegistration !== "boolean") {
      fail("apps.vaultwarden.bootstrapRegistration must be boolean");
    }
    const domain = requireHttpsOrigin(vaultwarden.domain);
    if (vaultwarden.bootstrapRegistration === true && !isPrivateHost(vaultwarden.hostIp)) {
      fail("Vaultwarden bootstrap registration requires a private host bind");
    }
    const vaultStorage = requireObject(vaultwarden.storage, "apps.vaultwarden.storage");
    exactKeys(vaultStorage, ["data"], [], "apps.vaultwarden.storage");
    const vault = serviceBase("vaultwarden", vaultwarden as CommonApp, 8080, networkIds);
    vault.environment = [
      { name: "DOMAIN", value: domain },
      { name: "INVITATIONS_ALLOWED", value: "false" },
      { name: "ROCKET_PORT", value: "8080" },
      { name: "SIGNUPS_ALLOWED", value: vaultwarden.bootstrapRegistration === true ? "true" : "false" }
    ];
    vault.mounts = [mount(normalizeStorage(vaultStorage.data, "vaultwarden data"), "/data", false)];
    services.push(vault);
  }

  services.sort((left, right) => left.id.localeCompare(right.id));
  return { schemaVersion: 1, project: input.project, services, networks, observed: input.observed };
}

function readInput(file: string): unknown {
  if (!path.isAbsolute(file)) {
    fail("--input must be an absolute path");
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function validateWithComposeOwner(manifest: unknown): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "household-plan-"));
  const input = path.join(directory, "manifest.json");
  try {
    fs.writeFileSync(input, `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
    const owner = path.resolve(import.meta.dir, "../../selfhost-compose/scripts/compose-project.ts");
    const result = Bun.spawnSync([process.execPath, owner, "validate", "--input", input], { stdout: "ignore", stderr: "ignore" });
    if (result.exitCode !== 0) {
      fail("selfhost-compose rejected the household manifest");
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function main(): void {
  const argv = Bun.argv.slice(2);
  if (argv.length !== 2 || argv[0] !== "--input") {
    fail("usage: household-plan.ts --input ABSOLUTE_JSON_FILE");
  }
  const manifest = buildHouseholdManifest(readInput(argv[1]));
  validateWithComposeOwner(manifest);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (import.meta.main) {
  try {
    main();
  } catch {
    process.stderr.write("household-plan.ts: manifest generation failed\n");
    process.exit(2);
  }
}
