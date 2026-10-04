import type { SharedDerivedRecipeAdapter } from "../../types/derived-recipe.ts";
import { compileHaproxyConfiguration } from "./configuration.ts";

const adapter: SharedDerivedRecipeAdapter = {
  appId: "haproxy",
  sourceFiles: ["derived-recipe.ts", "configuration.ts", "manifest.json"],
  inputDefinitions: { "target-app-id": { description: "Exact same-owner selected application frontend", maxLength: 47 } },
  derive(state, inputs) {
    const compiled = compileHaproxyConfiguration(state, inputs["target-app-id"]!);
    return { recipe: compiled.recipe, configuration: compiled.binding, peerAppIds: [inputs["target-app-id"]!] };
  },
};
export default adapter;
