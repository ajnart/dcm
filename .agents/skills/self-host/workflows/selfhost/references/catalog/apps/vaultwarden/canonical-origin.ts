import type { CanonicalOriginDefinition } from "../../types/canonical-origin.ts";
import { deriveCanonicalEnvironment } from "./setup.ts";

export const canonicalOrigin: CanonicalOriginDefinition = {
  appId: "vaultwarden", serviceId: "vaultwarden",
  officialUrl: "https://github.com/dani-garcia/vaultwarden/blob/1.37.3/.env.template",
  environmentNames: ["DOMAIN"], derive: deriveCanonicalEnvironment,
};
