import type { SharedDerivedRecipeAdapter } from "../../types/derived-recipe.ts";
import { compilePangolinConfiguration, PANGOLIN_CONFIG_SOURCE, PANGOLIN_COMPOSE_SOURCE } from "./configuration.ts";

export const CAPABILITY_SOURCE = "https://github.com/fosrl/pangolin/blob/1.24.0/server/setup/ensureSetupToken.ts";
const SECRET_SOURCE = "https://github.com/fosrl/pangolin/blob/1.24.0/server/lib/getEnvOrYaml.ts";
const IMAGE_SOURCE = "https://github.com/fosrl/pangolin/blob/1.24.0/Dockerfile";
const PROXY_SOURCE = "https://github.com/fosrl/pangolin/blob/1.24.0/install/config/traefik/dynamic_config.yml";
const adapter: SharedDerivedRecipeAdapter = {
  appId: "pangolin",
  sourceFiles: ["derived-recipe.ts", "configuration.ts", "bootstrap.ts", "setup.ts", "manifest.json"],
  inputDefinitions: {
    "canonical-origin": { description: "Approved private HTTPS administrative origin; DNS and trust remain separate", maxLength: 256 },
    "base-domain": { description: "Reviewed resource base domain; no resource is provisioned", maxLength: 253 },
    email: { description: "Lowercase first administrator email", maxLength: 254 },
    scope: { description: "administration-only; no public edge, tunnel or resource enrollment", maxLength: 32 },
  },
  derive(_state, inputs) {
    if (inputs.scope !== "administration-only" || !/^[a-z0-9][a-z0-9._+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(inputs.email ?? "")) {
      throw new Error("Pangolin requires a lowercase administrator email and administration-only scope");
    }
    const candidate = compilePangolinConfiguration({ canonicalOrigin: inputs["canonical-origin"]!, baseDomain: inputs["base-domain"]!, mode: "local-only" });
    // The publisher honors SERVER_SECRET_FILE. Keep the generated secret out of YAML.
    const parts = candidate.privateConfig.parts;
    const content = parts[0]!.literal!.replace('  secret: "', '  internal_hostname: "server"\n') + parts[2]!.literal!.replace(/^"\n/, "");
    const dynamic = `http:\n  routers:\n    dashboard:\n      rule: "PathPrefix(\u0060/\u0060)"\n      entryPoints: [web]\n      service: dashboard\n      priority: 1\n    api:\n      rule: "PathPrefix(\u0060/api/v1\u0060)"\n      entryPoints: [web]\n      service: api\n      priority: 10\n  services:\n    dashboard:\n      loadBalancer:\n        servers:\n          - url: "http://server:3002"\n    api:\n      loadBalancer:\n        servers:\n          - url: "http://server:3000"\n`;
    const common = { user: "image-default", restart: "unless-stopped", readOnly: false, environment: [], hostEnvironment: [], dependsOn: [] };
    return { configuration: { canonicalOrigin: inputs["canonical-origin"], baseDomain: inputs["base-domain"], email: inputs.email,
      scope: inputs.scope, tunnelEnrollment: "not-provided", publicEdge: "not-provided" }, peerAppIds: [], recipe: {
      schemaVersion: 2, kind: "multi-service-compose", appId: "pangolin", source: PANGOLIN_COMPOSE_SOURCE,
      imageSources: [IMAGE_SOURCE, PROXY_SOURCE, SECRET_SOURCE, CAPABILITY_SOURCE, PANGOLIN_CONFIG_SOURCE],
      services: [
        { ...common, id: "pangolin", purpose: "Private administrative API/dashboard routing only; no public edge or resources.",
          imageTag: "docker.io/traefik:v3.7", imageSource: PANGOLIN_COMPOSE_SOURCE,
          imageUserEvidence: { officialUrl: PANGOLIN_COMPOSE_SOURCE, reason: "official-image-runtime-contract" },
          command: ["--entryPoints.web.address=:8080", "--entryPoints.web.forwardedHeaders.insecure=true",
            "--providers.file.filename=/etc/traefik/dynamic.yml", "--api=false"],
          fileEnvironment: [], mounts: [{ name: "router", kind: "generated-file", fileId: "router", target: "/etc/traefik/dynamic.yml" }],
          dependsOn: [{ service: "server", condition: "service_started" }], publishTargetPort: 8080 },
        { ...common, id: "server", purpose: "Pinned OSS SQLite Pangolin server with private first-admin setup capability.",
          imageTag: "docker.io/fosrl/pangolin:1.24.0", imageSource: IMAGE_SOURCE,
          imageUserEvidence: { officialUrl: IMAGE_SOURCE, reason: "official-image-runtime-contract" },
          fileEnvironment: [{ name: "SERVER_SECRET_FILE", fileId: "server-secret" }],
          secretEnvironment: [{ name: "PANGOLIN_SETUP_TOKEN", fileId: "setup-capability" }],
          mounts: [{ name: "state", kind: "volume", target: "/app/config" },
            { name: "configuration", kind: "generated-file", fileId: "configuration", target: "/app/config/config.yml" }], publishTargetPort: null },
      ],
      configFiles: [{ id: "configuration", content }, { id: "router", content: dynamic }],
      privateFiles: [{ id: "server-secret", bytes: 32, format: "alphanumeric" },
        { id: "admin-password", bytes: 48, format: "base64-prefixed" },
        { id: "setup-capability", bytes: 16, format: "hex", purpose: "bootstrap-capability", officialUrl: CAPABILITY_SOURCE }],
      onboarding: { kind: "manual-first-email", officialUrl: CAPABILITY_SOURCE, email: inputs.email, fileId: "admin-password" },
      defaults: { hostIp: "127.0.0.1", publishedPort: 18086, dataDirectoryName: "pangolin" },
      storage: { filesystem: "local-posix-locks", minimumFreeBytes: 1073741824 },
      acceptance: [{ id: "administrator", method: "api", description: "Verify saved first-admin identity and root-key metadata over approved private HTTPS." },
        { id: "resource", method: "browser", description: "Separate organization, key action grants, resource routing and intended-client acceptance remain pending." }],
    } };
  },
};
export default adapter;
