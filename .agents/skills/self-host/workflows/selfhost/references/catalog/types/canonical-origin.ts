/** Source-owned non-secret settings, never caller-provided environment names or values. */
export type CanonicalOriginDefinition = {
  appId: string;
  serviceId: string;
  officialUrl: string;
  environmentNames: readonly string[];
  derive(origin: string): Array<{ name: string; value: string }>;
};

export function exactHttpsOrigin(origin: string): string {
  let url: URL;
  try { url = new URL(origin); }
  catch { throw new Error("Canonical settings require an exact HTTPS origin"); }
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash || origin.length > 256) {
    throw new Error("Canonical settings require an exact HTTPS origin without credentials or path");
  }
  return origin;
}
