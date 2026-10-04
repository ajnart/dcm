import type { SharedDerivedRecipeAdapter } from "../../types/derived-recipe.ts";
import { stalwartRecoveryTransition } from "./closure-contract.ts";

const SOURCE = "https://github.com/stalwartlabs/stalwart/blob/v0.16.24/Dockerfile";
const BOOTSTRAP = "https://github.com/stalwartlabs/stalwart/blob/v0.16.24/crates/jmap/src/registry/mapping/bootstrap.rs";
const adapter: SharedDerivedRecipeAdapter = {
  appId: "stalwart-mail",
  sourceFiles: ["derived-recipe.ts", "setup.ts", "headless.ts", "closure-contract.ts", "bootstrap-password.json", "manifest.json"],
  inputDefinitions: {
    hostname: { description: "Explicit first-run server FQDN; no DNS changes are applied", maxLength: 253 },
    domain: { description: "Explicit first-run administrative account domain; mail delivery remains pending", maxLength: 253 },
    scope: { description: "administration-only; native SMTP/client listeners, TLS and DNS require separate setup", maxLength: 32 },
  },
  derive(_state, inputs) {
    const fqdn = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
    if (!fqdn.test(inputs.hostname ?? "") || !fqdn.test(inputs.domain ?? "") || inputs.scope !== "administration-only") {
      throw new Error("Stalwart requires an explicit hostname/domain and administration-only scope; this route does not configure mail delivery");
    }
    const configuration = { hostname: inputs.hostname, domain: inputs.domain, scope: inputs.scope,
      mailDelivery: "pending", recoveryClosure: "pending-native-listener-policy" };
    return { configuration, peerAppIds: [], recipe: {
      schemaVersion: 2, kind: "multi-service-compose", appId: "stalwart-mail", source: SOURCE,
      postFirstAccountEnvironment: stalwartRecoveryTransition,
      services: [{ id: "stalwart-mail", purpose: "Private administration only; recovery closure requires verified HTTPS and a separate approved transition. Mail delivery remains pending.",
        imageTag: "stalwartlabs/stalwart:v0.16.24", imageSource: SOURCE, user: "image-default",
        imageUserEvidence: { officialUrl: SOURCE, reason: "official-image-runtime-contract" },
        restart: "unless-stopped", readOnly: false,
        environment: [{ name: "STALWART_RECOVERY_MODE", value: "1" }, { name: "STALWART_HOSTNAME", value: inputs.hostname }],
        hostEnvironment: [], fileEnvironment: [],
        mounts: [{ name: "configuration", target: "/etc/stalwart", kind: "volume" },
          { name: "data", target: "/var/lib/stalwart", kind: "volume" }],
        dependsOn: [], publishTargetPort: 8080 }],
      privateFiles: [{ id: "admin-password", bytes: 48, format: "alphanumeric" }],
      onboarding: { kind: "manual-first-email", officialUrl: BOOTSTRAP, email: `admin@${inputs.domain}`, fileId: "admin-password" },
      defaults: { hostIp: "127.0.0.1", publishedPort: 8080, dataDirectoryName: "stalwart-mail" },
      storage: { filesystem: "local-posix-locks", minimumFreeBytes: 1073741824 },
      acceptance: [{ id: "administrator", method: "api", description: "Verify the exact generated administrator and management API key; no mail-delivery acceptance." },
        { id: "mail-delivery", method: "manual", description: "Pending separate SMTP/client listeners, DNS, native TLS, anti-abuse and delivery checks." }],
    } };
  },
};
export default adapter;
