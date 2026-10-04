import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { installedCliRoot } from "./installed-cli-root.ts";
import type { SharedProjectState } from "./shared-project-state.ts";

type Target = { service: string; port: number };
export type SharedHttpsProxyProfile = {
  schemaVersion: 1; appId: string;
  source: { url: string; revision: string };
  grpc: Target & { contentType: "application/grpc*" };
  http: Target & { paths: string[] };
  fallback: Target;
};
export type SharedHttpsProxyProfileBinding = { profile: SharedHttpsProxyProfile; sourceSha256: string };
function fail(): never { throw new Error("Shared HTTPS proxy profile differs from its declared source or exact owned frontend services"); }
function exact(value: any, keys: string[]): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
function read(url: URL): Buffer {
  const path = fileURLToPath(url);
  if (realpathSync(path) !== path) fail();
  const file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(file);
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > 65536
      || (before.mode & 0o002) !== 0) fail();
    const bytes = readFileSync(file), after = fstatSync(file), named = statSync(path);
    if (bytes.length !== before.size || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || named.dev !== after.dev || named.ino !== after.ino || named.size !== after.size
      || named.mtimeMs !== after.mtimeMs || named.ctimeMs !== after.ctimeMs || realpathSync(path) !== path) fail();
    return bytes;
  } finally { closeSync(file); }
}

/** Bundled declarations only: callers cannot supply a path, Caddy text, or alternate profile. */
export function loadSharedHttpsProxyProfile(appId: string): SharedHttpsProxyProfileBinding | null {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId)) fail();
  const own = new URL(import.meta.url);
  let catalog = new URL("../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/", own);
  if (!own.pathname.endsWith(".ts")) catalog = new URL("workflows/selfhost/references/catalog/", installedCliRoot(import.meta.url));
  const app = new URL(`apps/${appId}/`, catalog), path = new URL("https-proxy.json", app);
  try { lstatSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const bytes = read(path), manifestBytes = read(new URL("manifest.json", app));
  let profile: SharedHttpsProxyProfile, manifest: any;
  try { profile = JSON.parse(bytes.toString("utf8")); manifest = JSON.parse(manifestBytes.toString("utf8")); }
  catch { fail(); }
  if (!exact(profile, ["schemaVersion", "appId", "source", "grpc", "http", "fallback"])
    || profile.schemaVersion !== 1 || profile.appId !== appId || manifest.id !== appId
    || !exact(profile.source, ["url", "revision"])
    || typeof profile.source.revision !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(profile.source.revision)
    || !Array.isArray(manifest.sources) || !manifest.sources.includes(profile.source.url)) fail();
  let source: URL;
  try { source = new URL(profile.source.url); } catch { fail(); }
  if (source.protocol !== "https:" || source.username || source.password || source.search || source.hash
    || !source.pathname.split("/").includes(profile.source.revision)) fail();
  for (const [target, keys] of [[profile.grpc, ["contentType", "service", "port"]],
    [profile.http, ["paths", "service", "port"]], [profile.fallback, ["service", "port"]]] as const) {
    if (!exact(target, [...keys]) || typeof target.service !== "string"
      || !(target.service === appId || target.service.startsWith(`${appId}-`))
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target.service)
      || !Number.isSafeInteger(target.port) || target.port < 1 || target.port > 65535) fail();
  }
  if (profile.fallback.service !== appId || profile.grpc.contentType !== "application/grpc*"
    || !Array.isArray(profile.http.paths) || profile.http.paths.length < 1 || profile.http.paths.length > 16
    || new Set(profile.http.paths).size !== profile.http.paths.length
    || profile.http.paths.some((path) => typeof path !== "string" || path.length > 128
      || !/^\/[a-z0-9][a-z0-9/-]*\*$/.test(path) || path.includes("//"))) fail();
  const sourceSha256 = createHash("sha256").update(bytes).update(manifestBytes).digest("hex");
  return { profile, sourceSha256 };
}

/** Actual shared service IDs; the compiler joins only these app-owned HTTP targets to front. */
export function sharedHttpsProxyProfileServices(appId: string): string[] {
  const loaded = loadSharedHttpsProxyProfile(appId);
  if (!loaded) return [];
  return [...new Set([loaded.profile.grpc.service, loaded.profile.http.service, loaded.profile.fallback.service])].sort();
}

/** Internal-only fixed ports come from the pinned declaration, never from user input. */
export function validateSharedHttpsProxyProfile(state: SharedProjectState, binding: SharedHttpsProxyProfileBinding): void {
  const current = loadSharedHttpsProxyProfile(binding.profile.appId);
  if (JSON.stringify(current) !== JSON.stringify(binding)) fail();
  const { profile } = binding;
  const front = state.manifest.networks.filter((network: any) => network.id === "front");
  if (front.length !== 1 || front[0].owner !== state.project.id
    || front[0].name !== `${state.project.id}-front`) fail();
  for (const target of [profile.grpc, profile.http, profile.fallback]) {
    if (!state.units[profile.appId]?.includes(target.service)) fail();
    const matches = state.manifest.services.filter((service: any) => service.id === target.service);
    if (matches.length !== 1 || !matches[0].networks.includes("front")) fail();
    const tcp = matches[0].ports.filter((port: any) => port.protocol === "tcp");
    if (tcp.length > 0 && !tcp.some((port: any) => port.target === target.port)) fail();
    if (matches[0].ports.some((port: any) => port.publicApproved !== false
      || (port.published !== null && port.hostIp !== "127.0.0.1"))) fail();
  }
}

export function renderSharedHttpsProxyProfile(binding: SharedHttpsProxyProfileBinding): string {
  if (JSON.stringify(loadSharedHttpsProxyProfile(binding?.profile?.appId)) !== JSON.stringify(binding)) fail();
  const { profile } = binding;
  return `\t@grpc header Content-Type ${profile.grpc.contentType}\n`
    + `\t@backend path ${profile.http.paths.join(" ")}\n`
    + `\troute {\n\t\treverse_proxy @grpc h2c://${profile.grpc.service}:${profile.grpc.port}\n`
    + `\t\treverse_proxy @backend ${profile.http.service}:${profile.http.port}\n`
    + `\t\treverse_proxy ${profile.fallback.service}:${profile.fallback.port}\n\t}\n`;
}
