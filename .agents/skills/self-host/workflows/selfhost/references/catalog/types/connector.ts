type Entry = Record<string, any>;

/** Execution shape only: no enrollment, route, network or privilege authority. */
export function checkedConnectorRecipe(recipe: Entry): boolean {
  if (recipe.execution === undefined || ["manual-job", "private-daemon"].includes(recipe.execution?.kind)) return false;
  const execution = recipe.execution;
  if (!execution || Object.keys(execution).sort().join(",") !== "frontendSharing,kind,officialUrl"
    || execution.kind !== "private-connector"
    || !["none", "owner-front"].includes(execution.frontendSharing)
    || typeof execution.officialUrl !== "string" || !execution.officialUrl.startsWith("https://")
    || recipe.schemaVersion !== 2 || recipe.kind !== "multi-service-compose"
    || recipe.defaults?.publishedPort !== null
    || recipe.onboarding?.kind !== "connector-enrollment"
    || Object.keys(recipe.onboarding).sort().join(",") !== "kind,officialUrl"
    || !Array.isArray(recipe.services) || recipe.services.length !== 1
    || recipe.services[0].id !== recipe.appId || recipe.postFirstAccountEnvironment !== undefined) {
    throw new Error("Private connectors require one portless running service and explicit connector enrollment");
  }
  const service = recipe.services[0];
  if (!["unless-stopped", "always"].includes(service.restart)
    || service.publishTargetPort !== null || (service.additionalPorts?.length ?? 0) > 0
    || (service.derivedEnvironment?.length ?? 0) > 0
    || service.publishTargetPortSource !== undefined || service.publishedPortMustMatchTarget !== undefined
    || service.healthcheck !== undefined || service.hostname !== undefined
    || !Array.isArray(service.dependsOn) || service.dependsOn.length !== 0
    || !Array.isArray(recipe.privateFiles) || recipe.privateFiles.some((file: Entry) => file.source !== "owner")
    || !Array.isArray(recipe.acceptance) || recipe.acceptance.length === 0
    || recipe.acceptance.some((check: Entry) => !["connector", "persisted"].includes(check.method))) {
    throw new Error("Private connectors cannot invent frontend health, generated credentials, or automatic dependencies");
  }
  return true;
}
