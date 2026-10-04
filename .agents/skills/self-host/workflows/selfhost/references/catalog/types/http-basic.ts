import { checkedMutableConfigs } from "./mutable-config.ts";

type Entry = Record<string, any>;
/** Generated control-interface credentials are not a server administrator.
 * The source-bound mutable hook owns private serialization/readback. */
export function checkedHttpBasicOnboarding(recipe: Entry): Entry | null {
  const onboarding = recipe.onboarding;
  if (onboarding?.kind !== "http-basic-from-mutable-config") return null;
  const file = recipe.privateFiles?.find((entry: Entry) => entry.id === onboarding.fileId);
  const configs = checkedMutableConfigs(recipe);
  const config = configs.get(onboarding.configId);
  let source: URL;
  try { source = new URL(onboarding.officialUrl); }
  catch { throw new Error("HTTP Basic onboarding requires official HTTPS evidence"); }
  if (Object.keys(onboarding).sort().join(",") !== "configId,fileId,kind,officialUrl,username"
    || source.protocol !== "https:" || source.username || source.password
    || onboarding.officialUrl !== recipe.source
    || typeof onboarding.username !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(onboarding.username)
    || onboarding.fileId !== "admin-password" || !file || file.source !== undefined
    || ![undefined, "base64url", "alphanumeric", "hex"].includes(file.format)
    || !Number.isInteger(file.bytes) || file.bytes < 32 || file.bytes > 128
    || !config || config.officialUrl !== recipe.source
    || !recipe.services?.some((service: Entry) => service.mounts?.some((mount: Entry) =>
      mount.kind === "mutable-directory" && mount.fileId === config.id))) {
    throw new Error("HTTP Basic onboarding requires an exact generated password and publisher-bound mutable configuration");
  }
  return onboarding;
}
