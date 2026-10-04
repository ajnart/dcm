import { runtimeResourceClaim, verifyRuntimeResourceDevice } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/runtime-resources.ts";
import { installedCliRoot } from "./installed-cli-root.ts";
type Entry = Record<string, any>;
export function compileSharedRuntimeResources(recipe: Entry, service: Entry, image: string) {
  const own = new URL(import.meta.url);
  let catalog = new URL("../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/", own);
  if (!own.pathname.endsWith(".ts")) catalog = new URL("workflows/selfhost/references/catalog/", installedCliRoot(import.meta.url));
  return runtimeResourceClaim(new URL(`apps/${recipe.appId}/`, catalog), recipe.appId, service.id, image, service.runtimeResources);
}
export function verifySharedRuntimeResourceDevices(manifest: Entry, serviceIds?: string[]): void {
  const selected = new Set(serviceIds ?? manifest.services.map((service: Entry) => service.id));
  if (manifest.services.some((service: Entry) => selected.has(service.id) && service.runtimeResources)) verifyRuntimeResourceDevice();
}
