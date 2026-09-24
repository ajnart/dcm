#!/usr/bin/env bun

import fs from "node:fs";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";

type RecordValue = Record<string, any>;

function fail(message: string): never {
  throw new Error(message);
}

function object(value: unknown, context: string): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${context} must be an object`);
  return value as RecordValue;
}

function exact(value: RecordValue, required: string[], optional: string[], context: string): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${context} contains an unsupported field`);
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${context} is missing ${key}`);
}

function text(value: unknown, context: string, maximum = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) fail(`${context} must be bounded text`);
  return value;
}

function image(value: unknown, context: string): { pinnedRef: string; officialUrl: string } {
  const selected = object(value, context);
  exact(selected, ["pinnedRef", "officialUrl"], [], context);
  const pinnedRef = text(selected.pinnedRef, `${context}.pinnedRef`);
  if (!/@sha256:[a-f0-9]{64}$/.test(pinnedRef)) fail(`${context}.pinnedRef must include an immutable sha256 digest`);
  const officialUrl = httpsUrl(selected.officialUrl, `${context}.officialUrl`).href;
  return { pinnedRef, officialUrl };
}

function requireImageRole(selected: { pinnedRef: string; officialUrl: string }, role: "nextcloud" | "database" | "cache"): void {
  if (role === "nextcloud" && (!/^docker\.io\/library\/nextcloud:[A-Za-z0-9_.-]+-apache@sha256:/.test(selected.pinnedRef) || !selected.officialUrl.startsWith("https://github.com/nextcloud/docker/"))) {
    fail("images.nextcloud must be the official pinned Apache image with official Docker-image evidence");
  }
  if (role === "database" && (!/^docker\.io\/library\/postgres:17(?:[.-][A-Za-z0-9_.-]*)?@sha256:/.test(selected.pinnedRef) || selected.officialUrl !== "https://hub.docker.com/_/postgres")) {
    fail("images.database must be the official pinned PostgreSQL 17 image with official image evidence");
  }
  if (role === "cache" && (!/^docker\.io\/library\/redis:[A-Za-z0-9_.-]+@sha256:/.test(selected.pinnedRef) || selected.officialUrl !== "https://hub.docker.com/_/redis")) {
    fail("images.cache must be the official pinned Redis image with official image evidence");
  }
}

function httpsUrl(value: unknown, context: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(text(value, context));
  } catch {
    fail(`${context} must be an HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) fail(`${context} must be an HTTPS URL without credentials, query, or fragment`);
  return parsed;
}

function privateHost(value: unknown): string {
  const host = text(value, "hostIp", 64);
  if (host === "127.0.0.1" || host === "::1") return host;
  if (isIP(host) === 4) {
    const parts = host.split(".").map(Number);
    if (parts[0] === 10 || parts[0] === 127 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)) return host;
  }
  fail("hostIp must be loopback or an explicit private address");
}

function port(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 65535) fail("publishedPort must be 1 to 65535");
  return Number(value);
}

function storage(value: unknown, context: string): RecordValue {
  const selected = object(value, context);
  exact(selected, ["path", "owner", "ownership"], [], context);
  return selected;
}

function localStorage(value: unknown, context: string): RecordValue {
  const selected = object(value, context);
  exact(selected, ["path", "owner", "ownership", "localFilesystem"], [], context);
  if (selected.localFilesystem !== true) fail(`${context}.localFilesystem must be true`);
  return selected;
}

function secret(value: unknown, context: string): { ref: string; filePath: string } {
  const selected = object(value, context);
  exact(selected, ["ref", "filePath"], [], context);
  return { ref: text(selected.ref, `${context}.ref`), filePath: text(selected.filePath, `${context}.filePath`) };
}

function trustedProxy(value: unknown): string {
  const proxy = text(value, "trusted proxy", 64);
  if (isIP(proxy) !== 0) return proxy;
  const cidr = proxy.match(/^([^/]+)\/(\d{1,3})$/);
  if (!cidr || isIP(cidr[1]) === 0) fail("trusted proxies must be literal IP addresses or CIDRs");
  const bits = Number(cidr[2]);
  const ipv4 = isIP(cidr[1]) === 4;
  const maximum = ipv4 ? 32 : 128;
  const minimum = ipv4 ? 24 : 64;
  if (bits < minimum || bits > maximum) fail("trusted proxy CIDRs must be narrow and must not trust every address");
  return proxy;
}

function mount(source: RecordValue, target: string, shared = false) {
  const result: RecordValue = { source: source.path, target, readOnly: false, shared, owner: source.owner, ownership: source.ownership };
  if (shared) result.shareGroup = "nextcloud-html";
  return result;
}

function userEvidence(officialUrl: string, reason = "upstream-init-requires-default-user") {
  return { officialUrl, reason };
}

export function buildNextcloudManifest(rawInput: unknown): RecordValue {
  const input = object(rawInput, "input");
  exact(input, ["schemaVersion", "project", "observed", "network", "integrationNetwork", "images", "storage", "secrets", "adminUsername", "hostIp", "publishedPort", "approvedHttpsOrigin", "trustedProxies", "internalHomarrUrl"], [], "input");
  if (input.schemaVersion !== 1) fail("schemaVersion must be 1");
  const project = object(input.project, "project");
  const owner = text(project.owner, "project.owner", 64);
  const network = object(input.network, "network");
  exact(network, ["id", "name"], [], "network");
  const integration = object(input.integrationNetwork, "integrationNetwork");
  exact(integration, ["id", "name", "owner"], [], "integrationNetwork");
  const images = object(input.images, "images");
  exact(images, ["nextcloud", "database", "cache"], [], "images");
  const nextcloudImage = image(images.nextcloud, "images.nextcloud");
  const databaseImage = image(images.database, "images.database");
  const cacheImage = image(images.cache, "images.cache");
  requireImageRole(nextcloudImage, "nextcloud");
  requireImageRole(databaseImage, "database");
  requireImageRole(cacheImage, "cache");
  const stores = object(input.storage, "storage");
  exact(stores, ["html", "database"], [], "storage");
  const html = storage(stores.html, "storage.html");
  const databaseStorage = localStorage(stores.database, "storage.database");
  if (html.owner !== owner || databaseStorage.owner !== owner) fail("Nextcloud storage must be owned by the Compose project");
  const secrets = object(input.secrets, "secrets");
  exact(secrets, ["adminPassword", "databasePassword"], [], "secrets");
  const adminPassword = secret(secrets.adminPassword, "secrets.adminPassword");
  const databasePassword = secret(secrets.databasePassword, "secrets.databasePassword");
  const adminUsername = text(input.adminUsername, "adminUsername", 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9._@+-]{0,63}$/.test(adminUsername)) fail("adminUsername is invalid");
  const approvedOrigin = httpsUrl(input.approvedHttpsOrigin, "approvedHttpsOrigin");
  if (approvedOrigin.pathname !== "/") fail("approvedHttpsOrigin must not contain a path");
  const internalHomarrValue = text(input.internalHomarrUrl, "internalHomarrUrl");
  if (internalHomarrValue !== "http://nextcloud:80") fail("internalHomarrUrl must be http://nextcloud:80");
  const internalHomarrUrl = new URL(internalHomarrValue);
  if (!Array.isArray(input.trustedProxies) || input.trustedProxies.length === 0 || input.trustedProxies.length > 16) fail("trustedProxies must contain 1 to 16 exact proxy addresses");
  const trustedProxies = input.trustedProxies.map(trustedProxy);
  if (new Set(trustedProxies).size !== trustedProxies.length) fail("trustedProxies must be unique");
  const appNetworks = [network.id, integration.id];
  const privateNetwork = [network.id];
  const adminTarget = "nextcloud_admin_password";
  const databaseTarget = "nextcloud_database_password";
  const databaseEnvironment = [
    { name: "POSTGRES_DB", value: "nextcloud" },
    { name: "POSTGRES_PASSWORD_FILE", value: `/run/secrets/${databaseTarget}` },
    { name: "POSTGRES_USER", value: "nextcloud" }
  ];
  const appEnvironment = [
    { name: "NEXTCLOUD_ADMIN_PASSWORD_FILE", value: `/run/secrets/${adminTarget}` },
    { name: "NEXTCLOUD_ADMIN_USER", value: adminUsername },
    { name: "NEXTCLOUD_TRUSTED_DOMAINS", value: `${approvedOrigin.host} ${internalHomarrUrl.host}` },
    { name: "OVERWRITECLIURL", value: approvedOrigin.origin },
    { name: "OVERWRITEHOST", value: approvedOrigin.host },
    { name: "OVERWRITEPROTOCOL", value: "https" },
    { name: "POSTGRES_DB", value: "nextcloud" },
    { name: "POSTGRES_HOST", value: "database" },
    { name: "POSTGRES_PASSWORD_FILE", value: `/run/secrets/${databaseTarget}` },
    { name: "POSTGRES_USER", value: "nextcloud" },
    { name: "REDIS_HOST", value: "redis" },
    { name: "TRUSTED_PROXIES", value: trustedProxies.join(" ") }
  ];
  const appSecrets = [
    { name: "admin-password", ref: adminPassword.ref, target: adminTarget, filePath: adminPassword.filePath },
    { name: "database-password", ref: databasePassword.ref, target: databaseTarget, filePath: databasePassword.filePath }
  ];
  const services = [
    {
      id: "database", image: databaseImage.pinnedRef, restart: "unless-stopped", readOnly: false, user: "image-default", imageUserEvidence: userEvidence(databaseImage.officialUrl),
      environment: databaseEnvironment, ports: [], mounts: [mount(databaseStorage, "/var/lib/postgresql/data")], networks: privateNetwork,
      healthcheck: { test: ["CMD", "pg_isready", "-U", "nextcloud", "-d", "nextcloud"], intervalSeconds: 10, timeoutSeconds: 5, startPeriodSeconds: 10, retries: 5 },
      secretRefs: [{ name: "database-password", ref: databasePassword.ref, target: databaseTarget, filePath: databasePassword.filePath }]
    },
    {
      id: "nextcloud", image: nextcloudImage.pinnedRef, restart: "unless-stopped", readOnly: false, user: "image-default", imageUserEvidence: userEvidence(nextcloudImage.officialUrl),
      environment: appEnvironment, ports: [{ hostIp: privateHost(input.hostIp), published: port(input.publishedPort), target: 80, protocol: "tcp", purpose: "application", publicApproved: false }],
      mounts: [mount(html, "/var/www/html", true)], networks: appNetworks,
      dependsOn: [{ service: "database", condition: "service_healthy" }, { service: "redis", condition: "service_healthy" }], secretRefs: appSecrets
    },
    {
      id: "nextcloud-cron", image: nextcloudImage.pinnedRef, restart: "unless-stopped", readOnly: false, user: "image-default", imageUserEvidence: userEvidence(nextcloudImage.officialUrl),
      entrypoint: ["/cron.sh"], environment: [{ name: "REDIS_HOST", value: "redis" }], ports: [], mounts: [mount(html, "/var/www/html", true)], networks: privateNetwork,
      dependsOn: [{ service: "nextcloud", condition: "service_started" }], secretRefs: []
    },
    {
      id: "redis", image: cacheImage.pinnedRef, restart: "unless-stopped", readOnly: false, user: "image-default", imageUserEvidence: userEvidence(cacheImage.officialUrl, "official-image-runtime-contract"),
      environment: [], ports: [], mounts: [], networks: privateNetwork,
      healthcheck: { test: ["CMD", "redis-cli", "ping"], intervalSeconds: 10, timeoutSeconds: 5, startPeriodSeconds: 5, retries: 5 }, secretRefs: []
    }
  ];
  return {
    schemaVersion: 1,
    project: input.project,
    services,
    networks: [
      { id: network.id, name: network.name, driver: "bridge", internal: true, owner, ownership: "new" },
      { id: integration.id, name: integration.name, driver: "bridge", internal: false, owner: integration.owner, ownership: "verified-existing" }
    ],
    observed: input.observed
  };
}

export function validateWithComposeOwner(manifest: unknown): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nextcloud-plan-"));
  const input = path.join(directory, "manifest.json");
  try {
    fs.writeFileSync(input, `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
    const owner = path.resolve(import.meta.dir, "../../selfhost-compose/scripts/compose-project.ts");
    const result = Bun.spawnSync([process.execPath, owner, "validate", "--input", input], { stdout: "ignore", stderr: "ignore" });
    if (result.exitCode !== 0) fail("selfhost-compose rejected the Nextcloud manifest");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function main(): void {
  const argv = Bun.argv.slice(2);
  if (argv.length !== 2 || argv[0] !== "--input" || !path.isAbsolute(argv[1])) fail("usage: nextcloud-plan.ts --input ABSOLUTE_JSON_FILE");
  const manifest = buildNextcloudManifest(JSON.parse(fs.readFileSync(argv[1], "utf8")));
  validateWithComposeOwner(manifest);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (import.meta.main) {
  try {
    main();
  } catch {
    process.stderr.write("nextcloud-plan.ts: manifest generation failed\n");
    process.exit(2);
  }
}
