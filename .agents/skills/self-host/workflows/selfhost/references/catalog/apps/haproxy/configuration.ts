import { createHash } from "node:crypto";
import type { SharedProjectState } from "../../../../../../../../../packages/cli/src/lib/shared-project-state.ts";
import type { SharedDerivedRecipeSource } from "../../types/derived-recipe.ts";
import { resolveSharedServiceTarget, resolvePlannedSharedServiceTarget, type SharedServiceTarget } from "../../../../../../../../../packages/cli/src/lib/shared-service-target.ts";

export const HAPROXY_SOURCE = "https://docs.haproxy.org/3.2/configuration.html";
export const HAPROXY_IMAGE_SOURCE = "https://raw.githubusercontent.com/docker-library/haproxy/60e87b92f7a36f502cd71911c9a6c39220ba1424/3.2/Dockerfile";
export const HAPROXY_CONFIG_PATH = "/usr/local/etc/haproxy/haproxy.cfg";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export type HaproxyConfigurationBinding = {
  targetAppId: string;
  targetPort: number;
  targetFingerprint: string;
  ownerFingerprint: string;
  configurationFingerprint: string;
  configSha256: string;
  statsBackendName: string;
};

/** No I/O, default backend, arbitrary hostname, public listener, or secret value.
 * The shared owner must bind the returned recipe AND binding into add approval,
 * persist them, and re-resolve the target immediately before approved apply.
 */
export function compileHaproxyConfiguration(state: SharedDerivedRecipeSource, targetAppId: string) {
  if (targetAppId === "haproxy") throw new Error("HAProxy cannot proxy itself");
  let target: SharedServiceTarget;
  if ("kind" in state && state.kind === "new-shared-project") {
    target = resolvePlannedSharedServiceTarget(state.input, targetAppId);
  } else {
    target = resolveSharedServiceTarget(state as SharedProjectState, targetAppId);
  }
  const statsBackendName = `selected-${target.targetFingerprint.slice(0, 24)}`;
  const content = [
    "global",
    "  maxconn 256",
    "",
    "defaults",
    "  mode http",
    "  timeout connect 5s",
    "  timeout client 30s",
    "  timeout server 30s",
    "",
    "resolvers docker",
    "  nameserver embedded 127.0.0.11:53",
    "  resolve_retries 3",
    "  timeout resolve 1s",
    "  timeout retry 1s",
    "  hold valid 10s",
    "",
    "userlist owner-stats",
    '  user admin password "$HAPROXY_ADMIN_AUTH_HASH"',
    "",
    "frontend private-http",
    "  bind :8080",
    "  acl owner_stats path -i /_auto-stack/stats /_auto-stack/stats;csv",
    "  use_backend owner-stats if owner_stats",
    `  default_backend ${statsBackendName}`,
    "",
    "backend owner-stats",
    "  stats enable",
    "  stats uri /_auto-stack/stats",
    "  stats hide-version",
    "  stats http-request auth realm owner-stats unless { http_auth(owner-stats) }",
    "",
    `backend ${statsBackendName}`,
    `  server ${target.serviceId} ${target.hostname}:${target.targetPort} check resolvers docker resolve-prefer ipv4 init-addr none`,
    "",
  ].join("\n");
  const recipe = {
    schemaVersion: 2, kind: "multi-service-compose", appId: "haproxy", source: HAPROXY_SOURCE,
    services: [{ id: "haproxy", purpose: `Proxies private HTTP to the explicitly selected ${target.appId} frontend; authenticated read-only statistics.`,
      imageTag: "haproxy:3.2.25", imageSource: "https://hub.docker.com/_/haproxy",
      user: "image-default", imageUserEvidence: { officialUrl: HAPROXY_IMAGE_SOURCE, reason: "image-declares-nonroot-user" },
      restart: "unless-stopped", readOnly: true, environment: [], hostEnvironment: [], fileEnvironment: [],
      secretEnvironment: [{ name: "HAPROXY_ADMIN_AUTH_HASH", fileId: "admin-password", format: "bcrypt-hash" }],
      mounts: [{ name: "haproxy-config", target: HAPROXY_CONFIG_PATH, kind: "generated-file", fileId: "haproxy-config" }],
      dependsOn: [], publishTargetPort: 8080 }],
    privateFiles: [{ id: "admin-password", bytes: 48, format: "alphanumeric" }],
    configFiles: [{ id: "haproxy-config", content, readability: "container", officialUrl: HAPROXY_IMAGE_SOURCE }],
    onboarding: { kind: "initial-admin-from-secret-env", officialUrl: HAPROXY_SOURCE,
      username: "admin", fixedUsername: true, secretEnvironment: "HAPROXY_ADMIN_AUTH_HASH", fileId: "admin-password" },
    defaults: { hostIp: "127.0.0.1", publishedPort: 18081, dataDirectoryName: "haproxy" },
    storage: { filesystem: "local-posix-locks", minimumFreeBytes: 1073741824 },
    acceptance: [
      { id: "syntax-and-private-stats", method: "api", description: "Validate exact config, deny anonymous stats and verify saved administrator plus selected backend TCP healthcheck; not forwarded traffic acceptance." },
      { id: "selected-backend-route", method: "api", description: "Compare an authorized application-specific response through the selected proxy route; HTTP 200 or TCP UP alone is insufficient." },
      { id: "restart-persistence", method: "persisted", description: "After exact-owner restart, repeat authenticated stats and application-specific routed readback." },
    ],
  };
  const configSha256 = hash(content);
  const configurationFingerprint = hash(JSON.stringify({ target, recipe, configSha256 }));
  const binding: HaproxyConfigurationBinding = { targetAppId, targetPort: target.targetPort,
    targetFingerprint: target.targetFingerprint, ownerFingerprint: target.ownerFingerprint,
    configurationFingerprint, configSha256, statsBackendName };
  return { recipe, target, binding };
}

export function assertHaproxyTargetUnchanged(state: SharedProjectState, selection: {
  target: SharedServiceTarget; binding: HaproxyConfigurationBinding;
}): void {
  const next = compileHaproxyConfiguration(state, selection.binding.targetAppId);
  if (JSON.stringify(next.target) !== JSON.stringify(selection.target)
    || JSON.stringify(next.binding) !== JSON.stringify(selection.binding)) {
    throw new Error("HAProxy owner, target or configuration changed; require a new reviewed selection");
  }
}
