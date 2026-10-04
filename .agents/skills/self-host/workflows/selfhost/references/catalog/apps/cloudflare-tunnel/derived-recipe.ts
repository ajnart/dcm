import type { SharedDerivedRecipeAdapter } from "../../types/derived-recipe.ts";
import { compileCloudflareRecipe } from "./configuration.ts";

const adapter: SharedDerivedRecipeAdapter = {
  appId: "cloudflare-tunnel",
  sourceFiles: ["derived-recipe.ts", "configuration.ts", "connector.ts", "pre-start.ts", "pre-start-adapter.json", "manifest.json"],
  inputDefinitions: {
    "target-app-id": { description: "Exact selected same-owner public-capable HTTP frontend; not public consent", maxLength: 47 },
    "hostname": { description: "One exact existing Cloudflare Access protected DNS hostname", maxLength: 253 },
    "tunnel-id": { description: "Existing locally managed Cloudflare tunnel UUID", maxLength: 36 },
  },
  derive(state, inputs) { return compileCloudflareRecipe(state, inputs); },
};
export default adapter;
