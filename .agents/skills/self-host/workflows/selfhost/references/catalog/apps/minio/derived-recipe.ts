import type { SharedDerivedRecipeAdapter } from "../../types/derived-recipe.ts";
import { compileAistorConfiguration, type AistorConfigurationInput } from "./configuration.ts";

const adapter: SharedDerivedRecipeAdapter = {
  appId: "minio",
  sourceFiles: ["derived-recipe.ts", "configuration.ts", "manifest.json", "setup.ts", "s3-auth.ts"],
  inputDefinitions: {
    edition: { description: "Explicit aistor-licensed product choice; requires an owner-obtained AIStor license, including Free", maxLength: 32 },
    "root-username": { description: "Reviewed non-default S3 root access identifier (20–32 safe characters)", maxLength: 32 },
  },
  derive(_state, inputs) {
    const result = compileAistorConfiguration({ edition: inputs.edition,
      rootUsername: inputs["root-username"] } as AistorConfigurationInput);
    return { recipe: result.recipe, configuration: result.binding, peerAppIds: [] };
  },
};
export default adapter;
