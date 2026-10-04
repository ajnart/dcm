import { exactHttpsOrigin, type CanonicalOriginDefinition } from "../../types/canonical-origin.ts";

/** APP_URL already belongs to this app's source-pinned local-origin recipe binding. */
export const canonicalOrigin: CanonicalOriginDefinition = {
  appId: "docmost", serviceId: "docmost",
  officialUrl: "https://github.com/docmost/docmost/blob/v0.96.0/docker-compose.yml",
  environmentNames: ["APP_URL"],
  derive(origin) { return [{ name: "APP_URL", value: exactHttpsOrigin(origin) }]; },
};
