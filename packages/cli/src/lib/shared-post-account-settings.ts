import linkwarden from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/linkwarden/recipe.json";
import { stalwartRecoveryTransition } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/stalwart-mail/closure-contract.ts";
import type { SharedEnvironmentTransition } from "./shared-env-transition.ts";

type Entry = Record<string, any>;
// Source-owned documented switches only. Callers cannot supply a new declaration.
const transitions = new Map<string, SharedEnvironmentTransition>([
  [linkwarden.appId, linkwarden.postFirstAccountEnvironment as SharedEnvironmentTransition],
  ["stalwart-mail", stalwartRecoveryTransition],
]);

export function bundledPostAccountTransition(appId: string) { return transitions.get(appId); }

export function postAccountTransitionService(source: Entry, appId: string): Entry {
  const transition = bundledPostAccountTransition(appId);
  let serviceId = transition?.serviceId;
  if (serviceId && serviceId !== appId) serviceId = `${appId}-${serviceId}`;
  if (!transition || source?.id !== serviceId || !Array.isArray(source.environment)) {
    throw new Error("Post-account settings require an exact source-owned service");
  }
  const entries = source.environment.filter((entry: Entry) => entry.name === transition.name);
  if (entries.length !== 1 || entries[0].value !== transition.from) {
    throw new Error("Post-account source environment differs from bundled initial value");
  }
  const result = structuredClone(source);
  if (transition.to === null) result.environment = result.environment.filter((entry: Entry) => entry.name !== transition.name);
  else result.environment.find((entry: Entry) => entry.name === transition.name).value = transition.to;
  return result;
}
