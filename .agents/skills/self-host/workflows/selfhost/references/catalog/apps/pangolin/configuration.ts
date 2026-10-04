import { createHash } from "node:crypto";
import { exactHttpsOrigin } from "../../types/canonical-origin";

export const PANGOLIN_CONFIG_SOURCE = "https://raw.githubusercontent.com/fosrl/pangolin/1.24.0/install/config/config.yml";
export const PANGOLIN_COMPOSE_SOURCE = "https://raw.githubusercontent.com/fosrl/pangolin/1.24.0/install/config/docker-compose.yml";
export type PangolinConfigurationInput = { canonicalOrigin: string; baseDomain: string; mode: "local-only" };
const domain = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** App-owned configuration candidate; never installs an edge or registers a recipe. */
export function compilePangolinConfiguration(input: PangolinConfigurationInput) {
  if (!input || Object.keys(input).sort().join(",") !== "baseDomain,canonicalOrigin,mode" || input.mode !== "local-only") {
    throw new Error("Pangolin needs exactly the declared local-only configuration inputs");
  }
  const origin = new URL(exactHttpsOrigin(input.canonicalOrigin));
  if ((origin.port && Number(origin.port) < 1024) || !domain.test(origin.hostname) || origin.hostname.endsWith(".localhost")
    || typeof input.baseDomain !== "string" || !domain.test(input.baseDomain)
    || input.baseDomain.endsWith(".localhost")) {
    throw new Error("Pangolin needs a canonical HTTPS FQDN and explicit resource base domain");
  }
  const privateConfig = { id: "pangolin-config", officialUrl: PANGOLIN_CONFIG_SOURCE, parts: [
    { literal: `gerbil:\n  start_port: 51820\n  base_endpoint: ${JSON.stringify(origin.hostname)}\napp:\n  dashboard_url: ${JSON.stringify(input.canonicalOrigin)}\n  log_level: "info"\n  telemetry:\n    anonymous_usage: false\ndomains:\n  domain1:\n    base_domain: ${JSON.stringify(input.baseDomain)}\nserver:\n  secret: "` },
    { fileId: "server-secret" },
    { literal: `"\n  cors:\n    origins: [${JSON.stringify(input.canonicalOrigin)}]\n    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"]\n    allowed_headers: ["X-CSRF-Token", "Content-Type"]\n    credentials: false\ntraefik:\n  site_types: ["local"]\n  allow_raw_resources: false\nflags:\n  require_email_verification: false\n  disable_signup_without_invite: true\n  disable_user_create_org: false\n  disable_basic_wireguard_sites: true\n  allow_raw_resources: false\n` },
  ] };
  const candidate = {
    appId: "pangolin", version: "1.24.0", source: PANGOLIN_COMPOSE_SOURCE,
    imageTag: "docker.io/fosrl/pangolin:1.24.0", input: { ...input },
    privateFiles: [{ id: "server-secret", bytes: 32, format: "alphanumeric" }],
    privateConfig,
    requirements: {
      configTarget: "/app/config/config.yml", stateTarget: "/app/config",
      edgeOwner: "unimplemented", frontends: { dashboard: 3002, externalApi: 3000, internalApi: 3001 },
      bootstrapOwner: "unimplemented", enrollment: "not-applicable-local-only",
      bootstrap: {
        inspect: "GET /api/v1/auth/initial-setup-complete",
        validatePrivateToken: "POST /api/v1/auth/validate-setup-token",
        create: "PUT /api/v1/auth/set-server-admin",
        passwordLogin: "POST /api/v1/auth/login",
        rootApiKey: "PUT /api/v1/api-key",
        organizationApiKey: "PUT /api/v1/org/:orgId/api-key",
        lostResponse: "inspect-and-login-without-replaying",
      },
      blockers: ["pinned-image-digest", "approved-domain-dns-tls-edge", "private-config-image-readability-and-state-mount",
        "fresh-start-private-token-capture", "first-admin-login-organization-and-key-readback",
        "proxy-resource-acceptance-and-restart"],
      runnable: false, readiness: "configuration-candidate-only",
    },
  };
  return { ...candidate, selectionFingerprint: createHash("sha256").update(JSON.stringify(candidate)).digest("hex") };
}
