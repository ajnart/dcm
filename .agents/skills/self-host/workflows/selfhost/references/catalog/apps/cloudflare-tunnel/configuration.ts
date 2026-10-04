import { createHash } from "node:crypto";
import type { SharedDerivedRecipeSource } from "../../types/derived-recipe.ts";
import type { SharedProjectState } from "../../../../../../../../../packages/cli/src/lib/shared-project-state.ts";
import { resolvePlannedSharedServiceTarget, resolveSharedServiceTarget } from "../../../../../../../../../packages/cli/src/lib/shared-service-target.ts";

export const CLOUDFLARE_CONFIG_SOURCE = "https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/";
export const CLOUDFLARE_USER_SOURCE = "https://github.com/cloudflare/cloudflared/blob/2026.9.1/cmd/cloudflared/tunnel/subcommand_context.go";
export function compileCloudflareRecipe(state: SharedDerivedRecipeSource, inputs: Readonly<Record<string, string>>) {
  const targetAppId = inputs["target-app-id"]!;
  // Administration, identity, downloader and native MCP surfaces stay private.
  if (!["jellyfin", "emby", "navidrome", "audiobookshelf", "immich", "seerr", "nextcloud", "docmost", "forgejo", "freshrss", "linkwarden", "photoprism", "paperless-ngx"].includes(targetAppId)) {
    throw new Error("Cloudflare public target needs a reviewed application frontend profile");
  }
  const hostname = inputs.hostname!;
  const tunnelId = inputs["tunnel-id"]!;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(tunnelId)
    || tunnelId === "00000000-0000-0000-0000-000000000000") throw new Error("Cloudflare route identity is invalid");
  let target;
  if ("kind" in state && state.kind === "new-shared-project") target = resolvePlannedSharedServiceTarget(state.input, targetAppId);
  else target = resolveSharedServiceTarget(state as SharedProjectState, targetAppId);
  const origin = `http://${target.hostname}:${target.targetPort}`;
  const content = `tunnel: ${tunnelId}\nmetrics: 127.0.0.1:2000\nwarp-routing:\n  enabled: false\ningress:\n  - hostname: ${hostname}\n    service: ${origin}\n  - service: http_status:404\n`;
  const recipe = {
    schemaVersion: 2, kind: "multi-service-compose", appId: "cloudflare-tunnel", source: CLOUDFLARE_CONFIG_SOURCE,
    execution: { kind: "private-connector", frontendSharing: "owner-front", officialUrl: CLOUDFLARE_CONFIG_SOURCE },
    services: [{ id: "cloudflare-tunnel", purpose: "Activates one separately approved Access-protected existing local tunnel route to a selected same-owner frontend.",
      imageTag: "cloudflare/cloudflared:2026.9.1", imageSource: "https://github.com/cloudflare/cloudflared/releases/tag/2026.9.1",
      user: "image-default", imageUserEvidence: { officialUrl: "https://github.com/cloudflare/cloudflared/blob/2026.9.1/Dockerfile", reason: "official-image-runtime-contract" },
      restart: "unless-stopped", readOnly: true, capDrop: ["ALL"], environment: [], hostEnvironment: [],
      fileEnvironment: [],
      secretEnvironment: [{ name: "TUNNEL_CRED_CONTENTS", fileId: "tunnel-credentials", format: "owner-json", officialUrl: CLOUDFLARE_USER_SOURCE,
        jsonFields: ["AccountTag", "TunnelSecret", "TunnelID", "Endpoint"] }],
      mounts: [{ name: "tunnel-config", target: "/etc/cloudflared/config.yml", kind: "generated-file", fileId: "tunnel-config" }],
      command: ["tunnel", "--config", "/etc/cloudflared/config.yml", "run", tunnelId], dependsOn: [], publishTargetPort: null }],
    privateFiles: [{ id: "tunnel-credentials", source: "owner", maxBytes: 4096 }, { id: "provider-api-token", source: "owner", maxBytes: 4096, consumer: "pre-start" }],
    configFiles: [{ id: "tunnel-config", content, readability: "container", officialUrl: CLOUDFLARE_CONFIG_SOURCE }],
    onboarding: { kind: "connector-enrollment", officialUrl: CLOUDFLARE_CONFIG_SOURCE },
    defaults: { hostIp: "127.0.0.1", publishedPort: null, dataDirectoryName: "cloudflare-tunnel" },
    storage: { filesystem: "local-posix-locks", minimumFreeBytes: 1073741824 },
    acceptance: [{ id: "edge-readiness", method: "connector", description: "Native private readiness proves an edge connection only; account identity and client allow/deny require separate evidence." },
      { id: "authorized-client-route", method: "connector", description: "Verify intended client DNS/TLS, Access allow/deny and application-specific selected-origin delivery; provider inventory alone is not acceptance." },
      { id: "restart-route", method: "persisted", description: "Scoped restart repeats fresh provider/public approval and client route evidence without creating provider resources." }],
  };
  const configuration = { targetAppId, hostname, tunnelId, origin, targetPort: target.targetPort,
    targetFingerprint: target.targetFingerprint, configSha256: createHash("sha256").update(content).digest("hex") };
  return { recipe, configuration, peerAppIds: [targetAppId] };
}
