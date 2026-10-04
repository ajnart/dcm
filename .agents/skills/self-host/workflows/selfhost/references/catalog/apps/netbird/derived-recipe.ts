import type { SharedDerivedRecipeAdapter } from "../../types/derived-recipe.ts";
import { compileNetbirdConfiguration } from "./configuration.ts";

const adapter: SharedDerivedRecipeAdapter = {
  appId: "netbird",
  sourceFiles: ["derived-recipe.ts", "configuration.ts", "bootstrap.ts", "login-contract.ts", "setup.ts", "https-proxy.json", "manifest.json"],
  inputDefinitions: {
    "canonical-origin": { description: "Exact HTTPS FQDN origin; requires a separately approved protocol-aware shared route", maxLength: 512 },
    "trusted-proxy-address": { description: "Exact private IPv4 address the approved shared edge uses", maxLength: 15 },
    "owner-email": { description: "Local first owner email; no external SSO is configured", maxLength: 254 },
  },
  derive(_state, inputs) {
    const compiled = compileNetbirdConfiguration({ canonicalOrigin: inputs["canonical-origin"]!,
      trustedProxyAddress: inputs["trusted-proxy-address"]!, ownerEmail: inputs["owner-email"]! });
    return { recipe: compiled.recipe, configuration: { ...compiled.requirements,
      ownerEmail: inputs["owner-email"], selectionFingerprint: compiled.selectionFingerprint }, peerAppIds: [] };
  },
};
export default adapter;
