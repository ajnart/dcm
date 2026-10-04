import { canonicalOrigin as vaultwarden } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/vaultwarden/canonical-origin.ts";
import { canonicalOrigin as docmost } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/docmost/canonical-origin.ts";
import { exactHttpsOrigin } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/canonical-origin.ts";

type Entry = Record<string, any>;
const definitions = new Map([vaultwarden, docmost].map((definition) => [definition.appId, definition]));

export type SharedCanonicalOriginEvidence = {
  origin: string;
  bindingHash: string;
  ownerRecordHash: string;
  transportHash: string;
};

export function bundledCanonicalOrigin(appId: string) { return definitions.get(appId); }

/** Only bundled app-owned exact HTTPS settings can modify a cloned runtime service. */
export function canonicalOriginService(source: Entry, appId: string, origin: string): Entry {
  const definition = bundledCanonicalOrigin(appId);
  if (!definition) throw new Error("App has no bundled canonical origin settings");
  exactHttpsOrigin(origin);
  let serviceId = `${appId}-${definition.serviceId}`;
  if (definition.serviceId === appId) serviceId = appId;
  if (source?.id !== serviceId || !Array.isArray(source.environment)) {
    throw new Error("Canonical settings require the exact source-owned app service");
  }
  const derived = definition.derive(origin);
  if (derived.length !== definition.environmentNames.length
    || JSON.stringify(derived.map((entry) => entry.name).sort())
      !== JSON.stringify([...definition.environmentNames].sort())) {
    throw new Error("Bundled canonical environment declaration differs");
  }
  const result = structuredClone(source);
  for (const entry of derived) {
    if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(entry.name) || entry.value !== origin) {
      throw new Error("Canonical settings are not exact non-secret origin values");
    }
    const matches = result.environment.filter((item: Entry) => item.name === entry.name);
    if (matches.length > 1) throw new Error("Canonical environment is ambiguous");
    if (matches.length === 1) matches[0].value = entry.value;
    else result.environment.push(structuredClone(entry));
  }
  return result;
}
