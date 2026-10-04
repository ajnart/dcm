import { join } from "node:path";
import { createStalwartApiKey, type StalwartApiKeyContext, type StalwartIntent } from "./headless.ts";
import type { SetupContext } from "../../types/setup.ts";

export const imageTag = "stalwartlabs/stalwart:v0.16.24";
export const imageSource = "https://github.com/stalwartlabs/stalwart/blob/v0.16.24/Dockerfile";

/** Staged, app-local selection only. No catalog recipe/setup discovery or lifecycle authority. */
export type StalwartRecipeInput = {
  projectDirectory: string;
  image: string;
  managementPort: number;
  privateNetwork: string;
  intent: StalwartIntent;
};

function path(value: string): void {
  if (!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(value)
    || value.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("Stalwart requires an exact normalized project directory");
  }
}

/** No credentials, config.json contents, SMTP ports or new TLS/DNS owner enter this compiler. */
export function compileStalwartRecipe(input: StalwartRecipeInput) {
  path(input.projectDirectory);
  if (!input.image.startsWith(`${imageTag}@sha256:`)
    || !/^[0-9a-f]{64}$/.test(input.image.slice(imageTag.length + 8))) {
    throw new Error("Stalwart requires the reviewed v0.16.24 immutable image");
  }
  if (!Number.isInteger(input.managementPort) || input.managementPort < 1024 || input.managementPort > 65535
    || !/^[a-z][a-z0-9-]{0,62}$/.test(input.privateNetwork)) {
    throw new Error("Stalwart requires one exact private management port and network");
  }
  const intent = input.intent;
  const fqdn = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  let origin: URL;
  try { origin = new URL(intent.httpsOrigin); }
  catch { throw new Error("Stalwart requires a canonical HTTPS origin"); }
  if (!fqdn.test(intent.hostname) || !fqdn.test(intent.domain) || origin.protocol !== "https:"
    || origin.hostname !== intent.hostname || origin.origin !== intent.httpsOrigin
    || origin.username || origin.password || intent.dataPath !== "/var/lib/stalwart/"
    || intent.logPath !== "/var/lib/stalwart/logs/") {
    throw new Error("Stalwart identity or owned storage does not match its private recipe");
  }
  const privateDirectory = join(input.projectDirectory, "secrets", "stalwart-mail");
  const recoveryEnvFile = join(privateDirectory, "recovery.env");
  return {
    appId: "stalwart-mail" as const,
    status: "staged-owner-facilities-required" as const,
    intent: structuredClone(intent), privateDirectory, recoveryEnvFile,
    service: {
      id: "stalwart-mail", image: input.image, imageSource, user: "image-default",
      imageUserEvidence: { officialUrl: imageSource, reason: "official-image-runtime-contract" },
      restart: "unless-stopped", readOnly: false,
      environment: [{ name: "STALWART_PUBLIC_URL", value: intent.httpsOrigin }], envFilePath: recoveryEnvFile,
      ports: [{ hostIp: "127.0.0.1", published: input.managementPort, target: 8080,
        protocol: "tcp", purpose: "application", publicApproved: false }],
      mounts: [{ name: "configuration", target: "/etc/stalwart", kind: "volume" },
        { name: "data", target: "/var/lib/stalwart", kind: "volume" }],
      networks: [input.privateNetwork], secretRefs: [],
    },
    config: { mustBeAbsentAtFreshStart: "/etc/stalwart/config.json", writer: "x:Bootstrap/set",
      directory: "Internal", dataStore: "RocksDb", dns: "Manual", acme: false, dkim: false },
    recoveryClosure: {
      serviceId: "stalwart-mail", after: "first-admin-created", operation: "remove-environment",
      names: ["STALWART_RECOVERY_MODE", "STALWART_RECOVERY_ADMIN"], envFile: recoveryEnvFile,
      preserveFiles: ["recovery-password", "permanent-admin-password"],
      requireSavedAndLiveAbsence: true,
    },
  };
}

export type StalwartRecipe = ReturnType<typeof compileStalwartRecipe>;

/** Facilities belong to the shared Compose/setup owners, not this app.
 * Their approval/checkpoint/CAS checks cannot be substituted by assertions on argv.
 */
export type StalwartOwnerBridge = {
  withExclusiveSetupLease<T>(recipe: StalwartRecipe, run: () => Promise<T>): Promise<T>;
  /** Revalidate saved owner/revision/digest, private file metadata, volumes, route and network isolation.
   * Before recovery removal, inspect native listeners: unpublished does not mean disabled.
   */
  inspect(recipe: StalwartRecipe): Promise<void>;
  context: Pick<StalwartApiKeyContext, "registerSecret" | "journal" | "apiKeyJournal">;
  /** Consumes the common saved-owner HTTP/CAS/HTTPS transport, not a caller URL fetch. */
  transport: Pick<SetupContext, "jmap">;
  startFreshRecovery(recipe: StalwartRecipe, input: { envFile: string; configMustBeAbsent: true }): Promise<void>;
  waitForRecovery(recipe: StalwartRecipe): Promise<void>;
  /** Existing source-declared transition owner: exact saved revision approval, beforeSend checkpoint,
   * private saved env removal, scoped recreate, saved AND live key-absence inspection.
   * No raw Docker editing, stale env-file re-preparation, new proxy or mail exposure.
   */
  applyRecoveryTransition(recipe: StalwartRecipe, beforeSend: () => Promise<void>): Promise<void>;
};

/** Callable integration bridge; deliberately not setup.ts or a normal install route. */
export async function setupStalwartPrivateAdministration(input: StalwartRecipeInput, owner: StalwartOwnerBridge) {
  const recipe = compileStalwartRecipe(input);
  return owner.withExclusiveSetupLease(recipe, async () => {
    const context: StalwartApiKeyContext = {
      ...owner.context, privateDirectory: recipe.privateDirectory,
      request: (request) => owner.transport.jmap.request(request),
      inspectPrerequisites: async () => owner.inspect(recipe),
      startFreshRecovery: async (start) => owner.startFreshRecovery(recipe, start),
      waitForRecovery: async () => owner.waitForRecovery(recipe),
      removeRecoveryAndRestart: async (beforeSend) => {
        await owner.inspect(recipe);
        await owner.applyRecoveryTransition(recipe, beforeSend);
        await owner.inspect(recipe);
      },
    };
    return createStalwartApiKey(context, recipe.intent);
  });
}
