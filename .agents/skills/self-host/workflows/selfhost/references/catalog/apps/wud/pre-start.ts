import type { SharedPrestartAdapter, SharedPrestartContext } from "../../types/pre-start.ts";
import type { DockerApiAuthorityInput } from "../../../../../../../../../packages/cli/src/lib/docker-api-authority.ts";
import { checkedWudInputs } from "./authority.ts";
import { compileWudRecipe } from "./configuration.ts";

function expected(context: SharedPrestartContext) {
  const binding = context.derived;
  if (context.appId !== "wud" || !binding || binding.derived.input.appId !== "wud"
    || binding.selection.appId !== "wud") throw new Error("WUD retained pre-start recipe is missing");
  const inputs = checkedWudInputs(binding.derived.input.inputs);
  const compiled = compileWudRecipe(inputs["docker-server-name"]!, inputs["docker-port"]!,
    inputs["watched-container-id"]!, inputs["docker-authority-mode"]);
  if (JSON.stringify(binding.derived.recipe) !== JSON.stringify(compiled.recipe)
    || JSON.stringify(binding.derived.configuration) !== JSON.stringify(compiled.configuration)) {
    throw new Error("WUD retained pre-start recipe differs");
  }
  return { inputs, configuration: compiled.configuration };
}

/** Owner state/source/image replay and trusted probe freshness belong to the
 * producer. This app contract binds its precise watcher and imported file IDs. */
function assertAuthority(context: SharedPrestartContext, input: DockerApiAuthorityInput): void {
  const { inputs, configuration } = expected(context);
  if (input.consumer.appId !== "wud" || input.mode !== inputs["docker-authority-mode"]
    || input.endpoint.serverName !== configuration.serverName || input.endpoint.port !== configuration.port
    || input.credentialRefs.ca !== "docker-ca" || input.credentialRefs.clientCertificate !== "docker-certificate"
    || input.credentialRefs.clientKey !== "docker-key") {
    throw new Error("WUD Docker authority differs from its retained watcher");
  }
}

const adapter: SharedPrestartAdapter = {
  appId: "wud",
  assertAuthority,
  async verify(context) {
    expected(context);
    if (!context.requireDockerAuthority) throw new Error("WUD owner Docker authority gate is unavailable");
    await context.requireDockerAuthority();
  },
};
export default adapter;
