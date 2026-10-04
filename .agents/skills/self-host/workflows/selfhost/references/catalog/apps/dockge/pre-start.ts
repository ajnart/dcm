import type { SharedPrestartAdapter, SharedPrestartContext } from "../../types/pre-start.ts";
import type { DockerApiAuthorityInput } from "../../../../../../../../../packages/cli/src/lib/docker-api-authority.ts";
import { compileDockgeRecipe } from "./configuration.ts";

function expected(context: SharedPrestartContext) {
  const binding = context.derived;
  if (context.appId !== "dockge" || !binding || binding.derived.input.appId !== "dockge"
    || binding.selection.appId !== "dockge") throw new Error("Dockge exact retained derived owner is missing");
  const compiled = compileDockgeRecipe(binding.derived.input.inputs);
  if (JSON.stringify(binding.derived.recipe) !== JSON.stringify(compiled.recipe)
    || JSON.stringify(binding.derived.configuration) !== JSON.stringify(compiled.configuration)) {
    throw new Error("Dockge retained recipe or Docker endpoint differs");
  }
  return compiled.configuration;
}

const adapter: SharedPrestartAdapter = {
  appId: "dockge",
  assertAuthority(context, input: DockerApiAuthorityInput) {
    const configuration = expected(context);
    if (input.consumer.appId !== "dockge" || input.mode !== "docker-management-mtls"
      || input.endpoint.serverName !== configuration.serverName || input.endpoint.privateIpv4 !== configuration.privateIpv4
      || input.endpoint.port !== configuration.port
      || input.credentialRefs.ca !== "docker-ca" || input.credentialRefs.clientCertificate !== "docker-certificate"
      || input.credentialRefs.clientKey !== "docker-key") {
      throw new Error("Dockge remote Docker management authority differs from its retained recipe");
    }
  },
  async verify(context) {
    expected(context);
    if (!context.requireDockerAuthority || !context.requireSameDaemonDirectory) {
      throw new Error("Dockge startup requires owner-produced management and same-daemon directory gates");
    }
    await context.requireDockerAuthority();
    await context.requireSameDaemonDirectory();
  },
};
export default adapter;
