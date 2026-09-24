/** Claude Code marketplace catalog generation for the release archive. */

export interface ClaudeMarketplaceInput {
  archiveUrl: string;
  digest: string;
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
  plugins: [
    {
      name: "selfhost-skills";
      description: string;
      source: {
        source: "archive";
        url: string;
        sha256: string;
      };
    }
  ];
}

const MARKETPLACE_NAME = "selfhost-skills-claude";
const PLUGIN_NAME = "selfhost-skills";
const PLUGIN_DESCRIPTION = "Plan, install, and maintain private services from one self-host entry point.";
const SHA256_PATTERN = /^[a-fA-F0-9]{64}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const RESERVED_MARKETPLACE_NAMES = new Set([
  "claude-code-marketplace",
  "claude-code-plugins",
  "claude-plugins-official",
  "claude-plugins-community",
  "claude-community",
  "anthropic-marketplace",
  "anthropic-plugins",
  "agent-skills",
  "anthropic-agent-skills",
  "knowledge-work-plugins",
  "life-sciences",
  "claude-for-legal",
  "claude-for-financial-services",
  "financial-services-plugins",
  "first-party-plugins",
  "claude-tag-plugins",
  "healthcare",
  "npm",
  "pip",
  "uv",
  "cargo",
  "github",
  "gh"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlaceholderText(value: string): boolean {
  return /(?:placeholder|replace[-_ ]?me|your[-_ ]?(?:url|sha|version)|example\.(?:com|net|org)|TODO|FIXME|<[^>]+>|\$\{[^}]+\})/i.test(value);
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  if (host === "metadata.google.internal" || host === "metadata.azure.internal" || host.endsWith(".invalid") || host.endsWith(".test")) {
    return true;
  }
  if (host.includes(":")) {
    if (host === "::" || host === "::1" || host.startsWith("::ffff:") || host.startsWith("::")) {
      return true;
    }
    return /^(?:fe|fc|fd|ff)/.test(host);
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) {
    return false;
  }
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) {
    return true;
  }
  const [first, second] = octets;
  if (first === 0 || first === 10 || first === 127 || first >= 224) {
    return true;
  }
  if (first === 100 && second >= 64 && second <= 127) {
    return true;
  }
  if (first === 169 && second === 254) {
    return true;
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }
  if (first === 192 && second === 168) {
    return true;
  }
  if (first === 192 && second === 0) {
    return true;
  }
  return false;
}

function validateArchiveUrl(value: unknown, errors: string[]): value is string {
  if (typeof value !== "string" || value.length === 0) {
    errors.push("archive URL must be a non-empty string");
    return false;
  }
  if (value !== value.trim()) {
    errors.push("archive URL must not have leading or trailing whitespace");
  }
  if (isPlaceholderText(value)) {
    errors.push("archive URL contains placeholder text");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    errors.push("archive URL must be an absolute HTTPS URL");
    return false;
  }

  if (parsed.protocol !== "https:") {
    errors.push("archive URL must use HTTPS");
  }
  if (!parsed.hostname) {
    errors.push("archive URL must include a hostname");
  }
  if (parsed.username || parsed.password) {
    errors.push("archive URL must not embed credentials");
  }
  if (parsed.search) {
    errors.push("archive URL must not include a query string or embedded token");
  }
  if (parsed.hash) {
    errors.push("archive URL must not include a fragment");
  }
  if (isBlockedHost(parsed.hostname)) {
    errors.push("archive URL must not target a loopback, local, private, or metadata host");
  }
  if (!parsed.pathname.toLowerCase().endsWith(".zip")) {
    errors.push("archive URL must point to a .zip file");
  }
  return true;
}

/**
 * Validate the narrow marketplace shape emitted for this package.
 *
 * This mirrors the Claude Code marketplace schema fields used here: a
 * kebab-case catalog name, owner, catalog version, and an archive plugin source
 * with an HTTPS URL and optional SHA-256 pin.
 */
export function validateClaudeMarketplace(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return ["marketplace must be a JSON object"];
  }

  if (value.name !== MARKETPLACE_NAME) {
    errors.push(`marketplace name must be ${MARKETPLACE_NAME}`);
  }
  if (RESERVED_MARKETPLACE_NAMES.has(String(value.name).toLowerCase())) {
    errors.push("marketplace name is reserved by Claude Code");
  }
  if (!isRecord(value.owner) || typeof value.owner.name !== "string" || value.owner.name.length === 0) {
    errors.push("marketplace owner.name is required");
  }
  if (isRecord(value.owner) && value.owner.url !== "https://github.com/ajnart") {
    errors.push("marketplace owner.url must be https://github.com/ajnart");
  }
  if (typeof value.description !== "string" || value.description.length === 0) {
    errors.push("marketplace description is required");
  }
  if (typeof value.version !== "string" || !SEMVER_PATTERN.test(value.version)) {
    errors.push("marketplace version must be a semantic version");
  }

  if (!Array.isArray(value.plugins) || value.plugins.length !== 1) {
    errors.push("marketplace must contain exactly one plugin entry");
    return errors;
  }
  const plugin = value.plugins[0];
  if (!isRecord(plugin)) {
    errors.push("plugin entry must be a JSON object");
    return errors;
  }
  if (plugin.name !== PLUGIN_NAME) {
    errors.push(`plugin name must be ${PLUGIN_NAME}`);
  }
  if (typeof plugin.description !== "string" || plugin.description.length === 0) {
    errors.push("plugin description is required");
  }
  if ("version" in plugin) {
    errors.push("plugin entry must omit version because the archive manifest owns the plugin version");
  }
  if (!isRecord(plugin.source) || plugin.source.source !== "archive") {
    errors.push('plugin source must use the "archive" source type');
    return errors;
  }
  const validUrl = validateArchiveUrl(plugin.source.url, errors);
  if (validUrl && typeof value.version === "string") {
    const parsed = new URL(plugin.source.url as string);
    if (parsed.hostname.toLowerCase() === "github.com") {
      const expectedPath = `/ajnart/selfhost-skills/releases/download/v${value.version}/selfhost-skills-${value.version}.zip`;
      if (parsed.pathname !== expectedPath) {
        errors.push("GitHub release URL must match this version's selfhost-skills release archive");
      }
    }
  }
  if (typeof plugin.source.sha256 !== "string" || !SHA256_PATTERN.test(plugin.source.sha256)) {
    errors.push("archive SHA-256 must contain exactly 64 hexadecimal characters");
  }
  if (typeof plugin.source.sha256 === "string" && /^0{64}$/i.test(plugin.source.sha256)) {
    errors.push("archive SHA-256 must not be an all-zero placeholder");
  }
  return errors;
}

/** Build the Claude Code marketplace JSON for one versioned release archive. */
export function createClaudeMarketplace(input: ClaudeMarketplaceInput): ClaudeMarketplace {
  const marketplace: ClaudeMarketplace = {
    name: MARKETPLACE_NAME,
    description: "Claude Code plugins for private, approval-gated self-hosting workflows.",
    owner: {
      name: "ajnart",
      url: "https://github.com/ajnart"
    },
    version: input.version,
    plugins: [
      {
        name: PLUGIN_NAME,
        description: PLUGIN_DESCRIPTION,
        source: {
          source: "archive",
          url: input.archiveUrl,
          sha256: input.digest.toLowerCase()
        }
      }
    ]
  };
  const errors = validateClaudeMarketplace(marketplace);
  if (errors.length > 0) {
    throw new Error(`Invalid Claude marketplace input: ${errors.join("; ")}`);
  }
  return marketplace;
}
