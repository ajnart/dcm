import type { SharedDerivedRecipeAdapter } from "../../types/derived-recipe.ts";
import { isPublicOrSpecialSuffix } from "../../types/domain-policy.ts";
import { AUTHELIA_IMAGE, AUTHELIA_USER_DATABASE_SOURCE, compileAutheliaConfiguration } from "./configuration.ts";

const ENTRYPOINT = "https://github.com/authelia/authelia/blob/v4.39.25/entrypoint.sh";
const DOCKERFILE = "https://github.com/authelia/authelia/blob/v4.39.25/Dockerfile";
const adapter: SharedDerivedRecipeAdapter = {
  appId: "authelia",
  sourceFiles: ["derived-recipe.ts", "configuration.ts", "bootstrap.ts", "mutable-config.ts", "login-contract.ts", "setup.ts", "manifest.json"],
  inputDefinitions: {
    "canonical-origin": { description: "Approved exact private HTTPS portal origin on a standard domain", maxLength: 2048 },
    "cookie-domain": { description: "Explicit eligible cookie domain, not a public or special-use suffix", maxLength: 253 },
    "protected-origin": { description: "Distinct approved HTTPS target under the cookie domain; wiring is not installed by this recipe", maxLength: 2048 },
    username: { description: "Selected first user name", maxLength: 64 },
    "display-name": { description: "Selected display name", maxLength: 200 },
    email: { description: "Selected owner email", maxLength: 254 },
    notifier: { description: "filesystem only; notification output remains private", maxLength: 10 },
  },
  derive(state, inputs) {
    if (inputs.notifier !== "filesystem") throw new Error("Authelia requires explicit filesystem notifier selection");
    let uid: number;
    if ("kind" in state) uid = state.input.uid;
    else uid = state.settings.uid;
    if (!Number.isSafeInteger(uid) || uid <= 0) throw new Error("Authelia requires a non-root observed numeric host owner");
    const identity = { username: inputs.username!, displayName: inputs["display-name"]!, email: inputs.email! };
    const configuration = compileAutheliaConfiguration({ ...identity, canonicalOrigin: inputs["canonical-origin"]!,
      cookieDomain: inputs["cookie-domain"]!, protectedOrigin: inputs["protected-origin"]!, notifier: "filesystem" }, isPublicOrSpecialSuffix);
    const recipe = {
      schemaVersion: 2, kind: "multi-service-compose", appId: "authelia", source: AUTHELIA_USER_DATABASE_SOURCE,
      imageSources: [ENTRYPOINT, DOCKERFILE],
      services: [{ id: "authelia", purpose: "Private deny-first authentication portal; target forward-auth wiring remains separate.",
        imageTag: AUTHELIA_IMAGE, imageSource: DOCKERFILE, user: "host-selected",
        imageUserEvidence: { officialUrl: ENTRYPOINT, reason: "official-image-runtime-contract" },
        command: ["--config", "/etc/authelia/configuration.yml"],
        restart: "unless-stopped", readOnly: false, environment: [], hostEnvironment: [],
        fileEnvironment: configuration.fileEnvironment,
        mounts: [{ kind: "generated-file", fileId: "configuration", name: "configuration", target: "/etc/authelia/configuration.yml" },
          { kind: "mutable-directory", fileId: "users", name: "users", target: "/var/lib/authelia-users" },
          { kind: "bind", name: "state", target: "/var/lib/authelia" }],
        dependsOn: [], publishTargetPort: 9091 }],
      configFiles: [{ id: "configuration", content: configuration.content }],
      privateFiles: ["admin-password", "session-secret", "storage-key", "reset-secret"].map((id) => ({ id, bytes: 48, format: "alphanumeric" })),
      mutableConfigs: [{ id: "users", filename: "users_database.yml", officialUrl: AUTHELIA_USER_DATABASE_SOURCE,
        hook: "./mutable-config.ts", containerUid: uid,
        containerUidEvidence: { image: AUTHELIA_IMAGE, uid, officialUrl: ENTRYPOINT },
        sourceFiles: ["mutable-config.ts", "bootstrap.ts", "configuration.ts"], inputs: identity }],
      onboarding: { kind: "initial-admin-from-mutable-config", officialUrl: AUTHELIA_USER_DATABASE_SOURCE,
        ...identity, fileId: "admin-password", configId: "users" },
      defaults: { hostIp: "127.0.0.1", publishedPort: 9091, dataDirectoryName: "authelia" },
      storage: { filesystem: "local-posix-locks", minimumFreeBytes: 1073741824 },
      acceptance: [{ id: "portal-identity", method: "api", description: "Exact one-factor login identity over the owner-bound HTTPS route; not protected-target SSO acceptance." },
        { id: "protected-target", method: "browser", description: "Separately verify target anonymous denial and authenticated allowance after approved forward-auth wiring." },
        { id: "restart-persistence", method: "persisted", description: "Recheck private user database and login after separately approved scoped restart." }],
    };
    return { recipe, configuration, peerAppIds: [] };
  },
};
export default adapter;
