type Entry = Record<string, any>;

/** Container-local management only; never enrollment, host networking, or privilege approval. */
export function checkedPrivateDaemonRecipe(recipe: Entry): boolean {
  if (recipe.execution?.kind !== "private-daemon") return false;
  const execution = recipe.execution;
  if (Object.keys(execution).sort().join(",") !== "kind,officialUrl"
    || typeof execution.officialUrl !== "string" || !execution.officialUrl.startsWith("https://")
    || recipe.schemaVersion !== 2 || recipe.kind !== "multi-service-compose"
    || recipe.defaults?.publishedPort !== null
    || recipe.onboarding?.kind !== "generated-api-token"
    || Object.keys(recipe.onboarding).sort().join(",") !== "fileId,kind,officialUrl"
    || !Array.isArray(recipe.privateFiles) || recipe.privateFiles.length !== 1
    || recipe.privateFiles[0].id !== recipe.onboarding.fileId
    || recipe.privateFiles[0].source !== undefined
    || !Array.isArray(recipe.services) || recipe.services.length !== 1
    || recipe.services[0].id !== recipe.appId || recipe.postFirstAccountEnvironment !== undefined) {
    throw new Error("Private daemons require one portless service and an owned generated API token");
  }
  const service = recipe.services[0];
  if (!["unless-stopped", "always"].includes(service.restart)
    || service.publishTargetPort !== null || (service.additionalPorts?.length ?? 0) !== 0
    || (service.derivedEnvironment?.length ?? 0) !== 0
    || service.publishTargetPortSource !== undefined || service.publishedPortMustMatchTarget !== undefined
    || service.healthcheck !== undefined || service.hostname !== undefined
    || !Array.isArray(service.dependsOn) || service.dependsOn.length !== 0
    || !Array.isArray(recipe.acceptance) || recipe.acceptance.length === 0
    || recipe.acceptance.some((check: Entry) => !["api", "persisted"].includes(check.method))) {
    throw new Error("Private daemons cannot publish a frontend or infer network acceptance");
  }
  return true;
}
