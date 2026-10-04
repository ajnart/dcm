import type { SharedDerivedRecipeAdapter } from "../../types/derived-recipe.ts";
import { compileWarriorRecipe } from "./configuration.ts";

const adapter: SharedDerivedRecipeAdapter = {
  appId: "archive-team-warrior",
  sourceFiles: ["derived-recipe.ts", "configuration.ts", "mutable-config.ts", "idle-config.ts", "idle-readback.ts", "setup.ts", "pre-start.ts", "pre-start-adapter.json", "runtime-provenance.json", "manifest.json"],
  inputDefinitions: {
    downloader: { description: "Public HQ contribution nickname, 3-30 letters, digits, underscore or hyphen", maxLength: 30 },
    "selected-project": { description: "none only; archival execution is not supported by this idle recipe", maxLength: 4 },
    concurrency: { description: "1 only; no archival workers are started", maxLength: 1 },
    "outbound-policy": { description: "hq-registration-and-updates-only; startup registers identity and sends nickname/project/version to HQ, then updates every ten minutes", maxLength: 40 },
    "resource-policy": { description: "idle-no-archival-transfers; runner/UI and HQ metadata only, no bandwidth cap is implemented", maxLength: 40 },
  },
  derive(_state, inputs) {
    return { ...compileWarriorRecipe(inputs), peerAppIds: [] };
  },
};
export default adapter;
