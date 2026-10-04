import type { SharedDerivedRecipeAdapter } from "../../types/derived-recipe.ts";
import { compileHeadscaleRecipe } from "./config.ts";

const adapter: SharedDerivedRecipeAdapter = {
  appId: "headscale",
  sourceFiles: ["derived-recipe.ts", "config.ts", "manifest.json"],
  inputDefinitions: {
    "canonical-origin": { description: "Exact canonical HTTPS origin; does not authorize ingress", maxLength: 512 },
    "magic-dns-domain": { description: "Distinct owner-selected MagicDNS FQDN", maxLength: 253 },
  },
  derive(_state, inputs) {
    return { ...compileHeadscaleRecipe(inputs["canonical-origin"]!, inputs["magic-dns-domain"]!), peerAppIds: [] };
  },
};
export default adapter;
