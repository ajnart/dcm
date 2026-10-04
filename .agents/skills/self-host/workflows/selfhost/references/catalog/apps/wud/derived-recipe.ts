import type { SharedDerivedRecipeAdapter } from "../../types/derived-recipe.ts";
import { compileWudRecipe } from "./configuration.ts";

const adapter: SharedDerivedRecipeAdapter = {
  appId: "wud",
  sourceFiles: ["derived-recipe.ts", "configuration.ts", "remote-watcher.ts", "authority.ts", "pre-start.ts", "pre-start-adapter.json", "manifest.json"],
  inputDefinitions: {
    "docker-authority-mode": { description: "docker-inventory-mtls (verified deny-write required) or separately approved docker-management-mtls (host-wide Engine control, not read-only)", maxLength: 22 },
    "docker-server-name": { description: "Exact separately approved remote Docker TLS DNS identity", maxLength: 253 },
    "docker-port": { description: "Exact remote Docker TLS port; not public-exposure authority", maxLength: 5 },
    "watched-container-id": { description: "Full authorized container ID already labelled wud.watch=true by its owner", maxLength: 64 },
  },
  derive(_state, inputs) {
    return { ...compileWudRecipe(inputs["docker-server-name"]!, inputs["docker-port"]!, inputs["watched-container-id"]!, inputs["docker-authority-mode"]), peerAppIds: [] };
  },
};
export default adapter;
