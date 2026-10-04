import { checkedMutableConfigs } from "./mutable-config.ts";

type Entry = Record<string, any>;
/** First file-backed identity. Privilege and login acceptance belong to the app. */
export function checkedMutableAdminOnboarding(recipe: Entry): Entry | null {
  const value = recipe.onboarding;
  if (value?.kind !== "initial-admin-from-mutable-config") return null;
  const config = checkedMutableConfigs(recipe).get(value.configId);
  const file = recipe.privateFiles?.find((item: Entry) => item.id === value.fileId);
  if (Object.keys(value).sort().join(",") !== "configId,displayName,email,fileId,kind,officialUrl,username"
    || value.officialUrl !== recipe.source || !String(value.officialUrl).startsWith("https://")
    || typeof value.username !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.username)
    || typeof value.displayName !== "string" || value.displayName !== value.displayName.trim()
    || !value.displayName || value.displayName.length > 200 || /[\x00-\x1f\x7f]/.test(value.displayName)
    || typeof value.email !== "string" || value.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)
    || value.fileId !== "admin-password" || !file || file.source !== undefined
    || !["base64url", "alphanumeric", "hex"].includes(file.format ?? "base64url")
    || !Number.isInteger(file.bytes) || file.bytes < 32 || file.bytes > 128
    || !config || config.officialUrl !== value.officialUrl
    || ["username", "displayName", "email"].some((key) => config.inputs?.[key] !== value[key])) {
    throw new Error("File-backed identity needs exact private password, user metadata and mutable configuration");
  }
  return value;
}
