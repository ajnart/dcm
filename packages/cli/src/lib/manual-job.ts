import { manualJobProbeAllowed } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/manual-job.ts";
type Entry = Record<string, any>;

/** Jobs have no frontend; preparing their configuration never executes them. */
export function isManualJobRecipe(recipe: Entry): boolean {
  return recipe?.execution?.kind === "manual-job";
}

export function isManualJobService(service: Entry): boolean {
  return service?.restart === "no" && Array.isArray(service.profiles)
    && service.profiles.length === 1 && service.profiles[0] === "self-host-manual";
}

export function checkedManualJobRecipe(recipe: Entry): boolean {
  if (!isManualJobRecipe(recipe)) return false;
  const execution = recipe.execution;
  if (Object.keys(execution).sort().join(",") !== "kind,officialUrl,probe"
    || !manualJobProbeAllowed(execution.probe)
    || typeof execution.officialUrl !== "string" || !execution.officialUrl.startsWith("https://")
    || recipe.schemaVersion !== 2 || recipe.kind !== "multi-service-compose"
    || !Array.isArray(recipe.services) || recipe.services.length !== 1
    || recipe.services[0].id !== recipe.appId
    || recipe.defaults?.publishedPort !== null
    || recipe.onboarding?.kind !== "job-credentials"
    || Object.keys(recipe.onboarding).sort().join(",") !== "kind,officialUrl"
    || recipe.postFirstAccountEnvironment !== undefined) {
    throw new Error("Manual jobs require one portless service and explicit job-credential onboarding");
  }
  const service = recipe.services[0];
  if (service.restart !== "no" || service.publishTargetPort !== null
    || (service.additionalPorts?.length ?? 0) > 0
    || (service.derivedEnvironment?.length ?? 0) > 0
    || service.publishTargetPortSource !== undefined
    || service.publishedPortMustMatchTarget !== undefined
    || !Array.isArray(service.dependsOn) || service.dependsOn.length !== 0
    || !Array.isArray(service.command) || service.command.length === 0
    || service.healthcheck !== undefined) {
    throw new Error("Manual jobs cannot publish ports, depend on services, or claim HTTP health");
  }
  if (service.hostname !== undefined && (typeof service.hostname !== "string"
    || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(service.hostname))) {
    throw new Error("Manual job hostname must be one bounded DNS label");
  }
  return true;
}
