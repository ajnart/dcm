/** Claude Code catalog for the verified plugin tree on the generated Git ref. */

export interface ClaudeMarketplaceInput {
  version: string;
}

export interface ClaudeMarketplace {
  name: "selfhost-skills-claude";
  description: string;
  owner: {
    name: "ajnart";
    url: "https://github.com/ajnart";
  };
  version: string;
  plugins: [{
    name: "selfhost-skills";
    description: string;
    source: "./plugins/selfhost-skills";
  }];
}

const MARKETPLACE_NAME = "selfhost-skills-claude";
const PLUGIN_NAME = "selfhost-skills";
const PLUGIN_SOURCE = "./plugins/selfhost-skills";
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate the exact single-plugin catalog emitted by this repository. */
export function validateClaudeMarketplace(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return ["marketplace must be a JSON object"];
  }
  if (value.name !== MARKETPLACE_NAME) {
    errors.push(`marketplace name must be ${MARKETPLACE_NAME}`);
  }
  if (!isRecord(value.owner) || value.owner.name !== "ajnart" || value.owner.url !== "https://github.com/ajnart") {
    errors.push("marketplace owner must identify ajnart");
  }
  if (typeof value.description !== "string" || !value.description) {
    errors.push("marketplace description is required");
  }
  if (typeof value.version !== "string" || !SEMVER_PATTERN.test(value.version)) {
    errors.push("marketplace version must be semantic");
  }
  if (!Array.isArray(value.plugins) || value.plugins.length !== 1) {
    errors.push("marketplace must contain exactly one plugin");
    return errors;
  }
  const plugin = value.plugins[0];
  if (!isRecord(plugin)) {
    errors.push("plugin entry must be an object");
    return errors;
  }
  if (plugin.name !== PLUGIN_NAME || typeof plugin.description !== "string" || !plugin.description) {
    errors.push("plugin entry must identify selfhost-skills with a description");
  }
  if (plugin.source !== PLUGIN_SOURCE) {
    errors.push(`plugin source must be ${PLUGIN_SOURCE}`);
  }
  if ("version" in plugin) {
    errors.push("plugin entry must omit version; the plugin manifest owns it");
  }
  return errors;
}

export function createClaudeMarketplace(input: ClaudeMarketplaceInput): ClaudeMarketplace {
  const marketplace: ClaudeMarketplace = {
    name: MARKETPLACE_NAME,
    description: "Claude Code plugins for private, approval-gated self-hosting workflows.",
    owner: { name: "ajnart", url: "https://github.com/ajnart" },
    version: input.version,
    plugins: [{
      name: PLUGIN_NAME,
      description: "Plan, install, and maintain private services from one self-host entry point.",
      source: PLUGIN_SOURCE
    }]
  };
  const errors = validateClaudeMarketplace(marketplace);
  if (errors.length > 0) {
    throw new Error(`Invalid Claude marketplace input: ${errors.join("; ")}`);
  }
  return marketplace;
}
