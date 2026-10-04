import type { CanonicalOriginDefinition } from "../../types/canonical-origin.ts";
import { deriveCanonicalEnvironment } from "./configuration.ts";

/** Reuses the one shared TLS/configuration transition owner when a source-backed
 * Passbolt recipe exists. It does not waive SMTP or private enrollment gates. */
export const canonicalOrigin: CanonicalOriginDefinition = {
  appId: "passbolt", serviceId: "passbolt",
  officialUrl: "https://www.passbolt.com/docs/hosting/configure/environment-reference/",
  environmentNames: ["APP_FULL_BASE_URL"],
  derive: deriveCanonicalEnvironment,
};
