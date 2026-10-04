import type { SharedDerivedRecipeAdapter } from "../../types/derived-recipe.ts";
import { compileDockgeRecipe } from "./configuration.ts";

const adapter: SharedDerivedRecipeAdapter = {
  appId: "dockge",
  sourceFiles: ["derived-recipe.ts", "configuration.ts", "manifest.json", "owner-directory.json", "docker-authority.json", "docker-cli-tls.json", "setup.ts", "socketio-intents.json", "pre-start.ts", "pre-start-adapter.json"],
  inputDefinitions: {
    "docker-server-name": { description: "Exact separately approved Docker management mutual-TLS DNS identity on the same local Engine; grants host-wide administration", maxLength: 253 },
    "docker-port": { description: "Exact Docker management TLS port on the same Engine; not public-exposure consent", maxLength: 5 },
    "docker-private-ipv4": { description: "Exact approved RFC1918 Docker daemon IPv4; source-bound DNS mapping pins the CLI to this address", maxLength: 15 },
  },
  derive(_source, inputs) { return compileDockgeRecipe(inputs); },
};
export default adapter;
