import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { decodeHomarrReadVerification, type HomarrReadVerification } from "./homarr-read-contract.ts";
import { ownedHomarrTransportMatches, type OwnedHomarrTransport } from "./shared-homarr-transport.ts";

export type HomarrStackWidget = {
  kind: string;
  options: Record<string, unknown>;
  metrics?: string[];
  prerequisite?: "immich-album" | "beszel-system" | "umami-website"
    | "home-assistant-entity" | "home-assistant-automation";
};

export type HomarrStackMapping = {
  integrationKind: string | null;
  requiredSecrets: string[];
  alternativeSecrets?: string[][];
  credentialSource?: { format: "api-key-json"; fields: Record<string, string> };
  nativeRecipeSha256?: string;
  nativeTransportRequirement?: "owned-private-https";
  nativeEligibility?: { state: "blocked"; recipeSha256: string;
    reasonCode: "native-auth-contract-unsupported" | "native-admin-api-disabled"; reason: string };
  widgets: HomarrStackWidget[];
  verification?: HomarrReadVerification;
  tileOnly?: true;
};

function invalid(): never {
  throw new Error("Catalog Homarr mapping is malformed");
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactFields(value: Record<string, unknown>, fields: string[]): void {
  if (Object.keys(value).some((key) => !fields.includes(key))) invalid();
}

function secretNames(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 8
    && value.every((name) => typeof name === "string"
      && ["username", "password", "apiKey", "topic", "slug", "patchmonApiKey", "patchmonApiSecret"].includes(name))
    && new Set(value).size === value.length;
}

function decode(value: unknown): HomarrStackMapping {
  if (!record(value)) invalid();
  exactFields(value, ["schemaVersion", "source", "integrationKind", "requiredSecrets",
    "alternativeSecrets", "credentialSource", "nativeEligibility", "nativeRecipeSha256", "nativeTransportRequirement", "widgets", "tileOnly", "verification"]);
  if (value.schemaVersion !== 1 || typeof value.source !== "string") invalid();
  let source: URL;
  try { source = new URL(value.source); } catch { invalid(); }
  const officialDocs = source.hostname === "homarr.dev" && source.pathname.startsWith("/docs/");
  const officialCommit = source.hostname === "github.com"
    && /^\/homarr-labs\/homarr\/(?:tree|blob)\/[a-f0-9]{40}\//.test(source.pathname);
  if (source.protocol !== "https:" || source.username || source.password
    || source.search || source.hash || (!officialDocs && !officialCommit)) invalid();
  if (value.integrationKind !== null && (typeof value.integrationKind !== "string"
    || !/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(value.integrationKind))) invalid();
  if (!secretNames(value.requiredSecrets)) invalid();
  if (value.alternativeSecrets !== undefined && (!Array.isArray(value.alternativeSecrets)
    || value.alternativeSecrets.length > 8 || !value.alternativeSecrets.every(secretNames))) invalid();
  if (value.tileOnly !== undefined && value.tileOnly !== true) invalid();
  if (value.nativeRecipeSha256 !== undefined && (value.integrationKind === null
    || typeof value.nativeRecipeSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.nativeRecipeSha256))) invalid();
  if (value.nativeTransportRequirement !== undefined && (value.nativeTransportRequirement !== "owned-private-https"
    || value.nativeRecipeSha256 === undefined || value.integrationKind === null || value.nativeEligibility !== undefined)) invalid();
  if (value.nativeEligibility !== undefined) {
    const eligibility = value.nativeEligibility;
    if (!record(eligibility)) invalid();
    exactFields(eligibility, ["state", "recipeSha256", "reasonCode", "reason"]);
    if (value.integrationKind === null || eligibility.state !== "blocked"
      || typeof eligibility.recipeSha256 !== "string" || !/^[a-f0-9]{64}$/.test(eligibility.recipeSha256)
      || !["native-auth-contract-unsupported", "native-admin-api-disabled"].includes(String(eligibility.reasonCode))
      || typeof eligibility.reason !== "string" || eligibility.reason.length < 1 || eligibility.reason.length > 400
      || /[\u0000-\u001f\u007f<>]/.test(eligibility.reason)) invalid();
  }
  if (value.credentialSource !== undefined) {
    if (!record(value.credentialSource)) invalid();
    exactFields(value.credentialSource, ["format", "fields"]);
    const fields = value.credentialSource.fields;
    const allowed = [...value.requiredSecrets, ...(value.alternativeSecrets as string[][] ?? []).flat()];
    if (value.credentialSource.format !== "api-key-json" || !record(fields)
      || Object.keys(fields).length < 1 || Object.keys(fields).length > 8
      || Object.entries(fields).some(([kind, field]) => !allowed.includes(kind)
        || ["topic", "slug"].includes(kind) || typeof field !== "string"
        || !/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(field))) invalid();
  }
  if (!Array.isArray(value.widgets) || value.widgets.length > 16) invalid();
  for (const widget of value.widgets) {
    if (!record(widget)) invalid();
    exactFields(widget, ["kind", "options", "prerequisite", "metrics"]);
    if (typeof widget.kind !== "string" || !/^[a-zA-Z][a-zA-Z0-9-]{0,79}$/.test(widget.kind)
      || !record(widget.options) || Object.keys(widget.options).length !== 0) invalid();
    if (widget.kind === "stats") {
      if (value.integrationKind === null || widget.prerequisite !== undefined
        || !Array.isArray(widget.metrics) || widget.metrics.length < 1 || widget.metrics.length > 16
        || widget.metrics.some((key) => typeof key !== "string" || !/^[a-zA-Z][a-zA-Z0-9]{0,127}$/.test(key))
        || new Set(widget.metrics).size !== widget.metrics.length) invalid();
    } else if (widget.metrics !== undefined) invalid();
    if (widget.prerequisite !== undefined
      && !["immich-album", "beszel-system", "umami-website", "home-assistant-entity",
        "home-assistant-automation"].includes(String(widget.prerequisite))) invalid();
  }
  if (new Set(value.widgets.map((widget) => (widget as HomarrStackWidget).kind)).size !== value.widgets.length) invalid();
  if (value.integrationKind === null && (value.tileOnly !== true
    || value.widgets.length !== 0 || value.requiredSecrets.length !== 0
    || value.alternativeSecrets !== undefined || value.credentialSource !== undefined)) invalid();
  const mapping: HomarrStackMapping = {
    integrationKind: value.integrationKind as string | null,
    requiredSecrets: value.requiredSecrets,
    widgets: value.widgets as HomarrStackWidget[],
  };
  if (value.alternativeSecrets !== undefined) mapping.alternativeSecrets = value.alternativeSecrets as string[][];
  if (value.credentialSource !== undefined) mapping.credentialSource = value.credentialSource as HomarrStackMapping["credentialSource"];
  if (value.nativeRecipeSha256 !== undefined) mapping.nativeRecipeSha256 = value.nativeRecipeSha256 as string;
  if (value.nativeTransportRequirement !== undefined) mapping.nativeTransportRequirement = "owned-private-https";
  if (value.nativeEligibility !== undefined) mapping.nativeEligibility = value.nativeEligibility as HomarrStackMapping["nativeEligibility"];
  if (value.tileOnly === true) mapping.tileOnly = true;
  if (value.verification !== undefined) {
    if (value.integrationKind === null) invalid();
    mapping.verification = decodeHomarrReadVerification(value.verification, mapping.widgets.map((widget) => widget.kind));
  }
  return mapping;
}

/** A catalog capability is not permission to connect an incompatible recipe.
 * Unknown/changed recipe contracts remain blocked until separately reviewed. */
export function homarrNativeEligibility(mapping: HomarrStackMapping | null, recipe: unknown, transport?: OwnedHomarrTransport) {
  const requirement = mapping?.nativeEligibility;
  if (!requirement && !mapping?.nativeRecipeSha256) return { eligible: true, reasonCode: null, requirement: null };
  const recipeHash = createHash("sha256").update(JSON.stringify(recipe) ?? "null").digest("hex");
  if (mapping?.nativeRecipeSha256 && recipeHash !== mapping.nativeRecipeSha256) return { eligible: false,
    reasonCode: "native-recipe-contract-changed", requirement: "Native API eligibility needs the exact source-reviewed saved recipe." };
  if (!requirement) {
    if (mapping?.nativeTransportRequirement && !ownedHomarrTransportMatches(transport, recipe, mapping.nativeRecipeSha256!)) {
      return { eligible: false, reasonCode: "native-owned-https-unverified",
        requirement: "Native integration requires the exact same-owner HTTPS route, current transport proof, container route binding and Homarr CA readback. Connectivity remains separately unverified." };
    }
    return { eligible: true, reasonCode: null, requirement: null };
  }
  if (recipeHash !== requirement.recipeSha256) return { eligible: false,
    reasonCode: "native-recipe-contract-changed", requirement: "Native API eligibility needs source review for the changed recipe." };
  return { eligible: false, reasonCode: requirement.reasonCode, requirement: requirement.reason };
}

/** Resolve saved credentials privately; usable credentials win over an empty alternative. */
export function homarrIntegrationCredentials(mapping: HomarrStackMapping,
  handoff: Record<string, unknown>, choices: Record<string, string> = {}):
  { credentials: Record<string, string>; missing: string[] } {
  const values: Record<string, string> = {};
  for (const kind of ["username", "password", "apiKey"]) {
    if (typeof handoff[kind] === "string" && handoff[kind]) values[kind] = handoff[kind];
  }
  if (mapping.credentialSource) {
    delete values.apiKey;
    if (typeof handoff.apiKey === "string" && handoff.apiKey) {
      let decoded: unknown;
      try { decoded = JSON.parse(handoff.apiKey); }
      catch { throw new Error("Saved integration credential bundle is malformed"); }
      const fields = mapping.credentialSource.fields;
      if (!record(decoded) || Object.keys(decoded).length !== new Set(Object.values(fields)).size
        || Object.values(fields).some((field) => typeof decoded[field] !== "string"
          || (decoded[field] as string).length < 4 || (decoded[field] as string).length > 8192
          || /[\u0000-\u001f\u007f]/.test(decoded[field] as string))) {
        throw new Error("Saved integration credential bundle is malformed");
      }
      for (const [kind, field] of Object.entries(fields)) values[kind] = decoded[field] as string;
    }
  }
  for (const kind of ["topic", "slug"]) {
    if (choices[kind]) values[kind] = choices[kind];
  }
  const sets = [mapping.requiredSecrets, ...(mapping.alternativeSecrets ?? [])];
  const usable = sets.filter((set) => set.every((kind) => values[kind]))
    .sort((left, right) => {
      const preference = Number(right.includes("apiKey")) - Number(left.includes("apiKey"));
      if (preference !== 0) return preference;
      return right.length - left.length;
    });
  if (usable.length) return { credentials: Object.fromEntries(usable[0]!.map((kind) => [kind, values[kind]])), missing: [] };
  return { credentials: {}, missing: sets[0]!.filter((kind) => !values[kind]) };
}

/** Load one app-owned descriptor from the portable build or source checkout. */
export function homarrStackMapping(serviceId: string): HomarrStackMapping | null {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(serviceId) || serviceId.length > 47) return null;
  const roots = [
    new URL("./workflows/selfhost/references/catalog/apps/", import.meta.url),
    new URL("../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/", import.meta.url),
  ];
  for (const root of roots) {
    let raw: string;
    try { raw = readFileSync(new URL(`${serviceId}/homarr.json`, root), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error("Catalog Homarr mapping could not be read");
    }
    if (raw.length > 16_384) invalid();
    let descriptor: unknown;
    try { descriptor = JSON.parse(raw); } catch { invalid(); }
    return decode(descriptor);
  }
  return null;
}

/** Derived exclusively from validated bundled descriptors, never caller supplied paths. */
export function homarrCatalogReadProcedures(): string[] {
  const roots = [new URL("./workflows/selfhost/references/catalog/apps/", import.meta.url),
    new URL("../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/", import.meta.url)];
  const procedures = new Set<string>(["widget.app.ping"]);
  for (const root of roots) {
    let names: string[];
    try { names = readdirSync(root); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    for (const name of names) {
      const mapping = homarrStackMapping(name);
      for (const contract of mapping?.verification?.widgets ?? []) procedures.add(contract.procedure);
    }
    return [...procedures].sort();
  }
  return [...procedures];
}

const widgetPrerequisites = {
  "immich-album": { inputName: "immichAlbumId", optionName: "albumId" },
  "beszel-system": { inputName: "beszelSystemId", optionName: "systemId" },
  "umami-website": { inputName: "umamiWebsiteId", optionName: "websiteId" },
  "home-assistant-entity": { inputName: "homeAssistantEntityId", optionName: "entityId" },
  "home-assistant-automation": { inputName: "homeAssistantAutomationId", optionName: "automationId" },
} as const;
type WidgetPrerequisiteName = typeof widgetPrerequisites[keyof typeof widgetPrerequisites]["inputName"];

/** Configuration choices include widgets without a safe functional read contract. */
export function homarrStackWidgetChoices(mapping: HomarrStackMapping | null) {
  const names = new Set<WidgetPrerequisiteName>();
  for (const widget of mapping?.widgets ?? []) {
    if (widget.prerequisite) names.add(widgetPrerequisites[widget.prerequisite].inputName);
  }
  return [...names].map((name) => [name, name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)] as const);
}

export function homarrStackWidgets(serviceId: string, prerequisites: Partial<Record<WidgetPrerequisiteName, string>> = {}, integrationId?: string): HomarrStackWidget[] {
  const mapping = homarrStackMapping(serviceId);
  if (!mapping) return [];
  const selected: HomarrStackWidget[] = [];
  for (const candidate of mapping.widgets) {
    if (candidate.kind === "stats" && integrationId !== undefined) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(integrationId)) invalid();
      selected.push({ ...candidate, options: { entries: candidate.metrics!.map((metric) => ({
        id: `auto-stack-${createHash("sha256").update(metric).digest("hex").slice(0, 32)}`, integrationId, metric, label: "", hidden: false, compact: false,
      })) } });
      continue;
    }
    if (candidate.prerequisite) {
      const { inputName, optionName } = widgetPrerequisites[candidate.prerequisite];
      const value = prerequisites[inputName];
      if (!value) continue;
      selected.push({ ...candidate, options: { [optionName]: value } });
      continue;
    }
    selected.push({ ...candidate, options: { ...candidate.options } });
  }
  return selected;
}
