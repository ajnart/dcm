import type { SharedDerivedRecipeAdapter } from "../../types/derived-recipe.ts";
import { compilePassboltRecipe } from "./recipe.ts";

const adapter: SharedDerivedRecipeAdapter = {
  appId: "passbolt",
  sourceFiles: ["derived-recipe.ts", "recipe.ts", "configuration.ts", "manifest.json"],
  inputDefinitions: {
    "canonical-origin": { description: "Stable private HTTPS origin; requires separate TLS/client trust approval", maxLength: 300 },
    "smtp-host": { description: "Owner-selected SMTP relay hostname", maxLength: 253 },
    "smtp-port": { description: "STARTTLS SMTP relay port", maxLength: 5 },
    "smtp-auth": { description: "Explicit none for an owner-approved relay; authenticated SMTP is not supported here", maxLength: 4 },
    "from-email": { description: "SMTP sender email", maxLength: 254 },
    "from-name": { description: "SMTP sender display name", maxLength: 200 },
    "server-key-email": { description: "Initial server OpenPGP key email", maxLength: 254 },
    "server-key-name": { description: "Initial server OpenPGP key name", maxLength: 200 },
  },
  derive(_state, inputs) {
    return { ...compilePassboltRecipe(inputs), peerAppIds: [] };
  },
};
export default adapter;
