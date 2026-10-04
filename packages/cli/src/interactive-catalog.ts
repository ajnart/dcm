const MEDIA_APPS = ["homarr", "jellyfin", "seerr", "sonarr", "radarr", "prowlarr", "qbittorrent"];

export type RecipeChoice = {
  appId: string;
  name: string;
  purpose: string;
  kind: "single-service-compose" | "multi-service-compose" | "shared-derived-compose";
  defaultPort: number | null;
  manualJob?: true;
  connector?: true;
  serviceCount: number | null;
  maturity: "preview" | "experimental";
  recipeSha256: string | null;
  installInputDefinitions?: readonly InstallInputDefinition[];
  bundledDependencies?: Array<{ appId: string; serviceId: string; officialUrl: string }>;
};

function recipeChoices(data: Record<string, unknown>, shared: boolean): RecipeChoice[] {
  const source = data.catalogSource as Record<string, unknown> | undefined;
  if (source?.kind !== "bundled" || source.executionAuthority !== "packaged") return [];
  if (!Array.isArray(data.recipes)) throw new Error("The recipe catalog did not return a reviewable list");
  const choices: RecipeChoice[] = [];
  const seen = new Set<string>();
  for (const item of data.recipes) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid recipe catalog entry");
    const capability = item.recipeCapability;
    if (!capability || typeof capability !== "object" || Array.isArray(capability)) {
      throw new Error("Recipe capability is unavailable");
    }
    if (!shared && capability.boundedApply !== true) continue;
    if (shared && (item.schemaVersion !== 2 || item.kind !== "multi-service-compose")) continue;
    const manualJob = item.execution?.kind === "manual-job";
    const connector = item.execution?.kind === "private-connector";
    const daemon = item.execution?.kind === "private-daemon";
    if ((manualJob || connector || daemon) && !shared) continue;
    let validPort = item.defaultPort === null;
    if (!manualJob && !connector && !daemon) validPort = Number.isInteger(item.defaultPort) && item.defaultPort >= 1024 && item.defaultPort <= 65535;
    if (typeof item.appId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.appId)
      || seen.has(item.appId) || typeof item.name !== "string" || !item.name
      || typeof item.purpose !== "string" || !item.purpose
      || !validPort
      || !Number.isInteger(item.serviceCount) || item.serviceCount < 1 || item.serviceCount > 8
      || typeof item.recipeSha256 !== "string" || !/^[0-9a-f]{64}$/.test(item.recipeSha256)
      || !["preview", "experimental"].includes(capability.maturity)
      || !((item.kind === "single-service-compose" && item.schemaVersion === 1 && item.serviceCount === 1)
        || (item.kind === "multi-service-compose" && item.schemaVersion === 2 && item.serviceCount >= 1))) {
      throw new Error("Recipe catalog entry is not a bounded CLI apply choice");
    }
    seen.add(item.appId);
    const bundled = item.bundledDependencies ?? [];
    if (!Array.isArray(bundled) || bundled.length > 8 || bundled.some((entry) => !entry
      || typeof entry.appId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.appId)
      || typeof entry.serviceId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.serviceId)
      || typeof entry.officialUrl !== "string" || !entry.officialUrl.startsWith("https://"))
      || new Set(bundled.map((entry) => entry.appId)).size !== bundled.length) {
      throw new Error("Recipe catalog has invalid bundled dependency coverage");
    }
    choices.push({ appId: item.appId, name: item.name, purpose: item.purpose,
      kind: item.kind, defaultPort: item.defaultPort, serviceCount: item.serviceCount,
      maturity: capability.maturity, recipeSha256: item.recipeSha256,
      ...(bundled.length > 0 ? { bundledDependencies: bundled } : {}),
      ...(manualJob ? { manualJob: true as const } : {}) });
    if (connector) choices.at(-1)!.connector = true;
  }
  return choices.sort((left, right) => left.name.localeCompare(right.name));
}

export function bundledRecipeChoices(data: Record<string, unknown>): RecipeChoice[] {
  return recipeChoices(data, false);
}

export function bundledSharedRecipeChoices(data: Record<string, unknown>, catalogApps?: unknown): RecipeChoice[] {
  const choices = recipeChoices(data, true);
  const source = data.catalogSource as Record<string, unknown> | undefined;
  if (source?.kind !== "bundled" || source.executionAuthority !== "packaged" || catalogApps === undefined) return choices;
  if (!Array.isArray(catalogApps) || catalogApps.length > 200) throw new Error("The bundled app metadata is not reviewable");
  for (const adapter of sharedDerivedRecipeAdapters()) {
    if (choices.some((choice) => choice.appId === adapter.appId)) {
      throw new Error("An app cannot expose both a static and derived installation choice");
    }
    const app = catalogApps.find((item) => item?.id === adapter.appId);
    if (!app) continue;
    if (typeof app.name !== "string" || app.name.length < 1 || app.name.length > 120) {
      throw new Error("Derived installation choice has invalid catalog identity");
    }
    const installInputDefinitions = Object.entries(adapter.inputDefinitions).map(([key, field]) => ({
      key, label: field.description, maxLength: field.maxLength,
    }));
    choices.push({ appId: adapter.appId, name: app.name,
      purpose: `${app.name}: generate a reviewed configuration from your installation choices.`,
      kind: "shared-derived-compose", defaultPort: null, serviceCount: null, recipeSha256: null,
      maturity: "experimental", installInputDefinitions });
  }
  return choices.sort((left, right) => left.name.localeCompare(right.name));
}

export function reviewedRecipePlan(choice: RecipeChoice, plan: Record<string, unknown>,
  root: string, port: string): { approval: string; images: string[]; compose: Record<string, unknown>; servicePurposes: Array<{ id: string; purpose: string }> } {
  if (!/^\d{4,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
    throw new Error("The selected app port must be a private TCP port from 1024 through 65535");
  }
  const host = plan.host as Record<string, unknown> | undefined;
  const compose = plan.compose as Record<string, unknown> | undefined;
  if (plan.command !== "app plan" || plan.appId !== choice.appId || plan.status !== "candidate"
    || plan.mutation !== false || plan.acceptanceVerified !== false
    || plan.recipeSha256 !== choice.recipeSha256
    || host?.projectRoot !== root || typeof compose?.projectId !== "string"
    || typeof compose.renderTarget !== "string" || typeof compose.dataDirectory !== "string"
    || typeof compose.publishedPort !== "string"
    || !new RegExp(`^127\\.0\\.0\\.1:${port}:[1-9][0-9]{0,4}/tcp$`).test(compose.publishedPort)
    || (choice.kind === "multi-service-compose" && compose.serviceCount !== choice.serviceCount)
    || typeof plan.approval !== "string"
    || !new RegExp(`^APP-APPLY:${choice.appId}:[0-9a-f]{64}$`).test(plan.approval)) {
    throw new Error("The app plan did not preserve the selected recipe, project and private port");
  }
  const images: string[] = [];
  const servicePurposes: Array<{ id: string; purpose: string }> = [];
  if (choice.kind === "single-service-compose") {
    if (typeof plan.image !== "string" || !/@sha256:[0-9a-f]{64}$/.test(plan.image)) {
      throw new Error("The single-service plan did not pin one image");
    }
    images.push(plan.image);
  } else {
    if (!plan.images || typeof plan.images !== "object" || Array.isArray(plan.images)
      || Object.keys(plan.images).length !== choice.serviceCount) {
      throw new Error("The multi-service plan did not pin every image");
    }
    for (const [service, image] of Object.entries(plan.images)) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(service)
        || typeof image !== "string" || !/@sha256:[0-9a-f]{64}$/.test(image)) {
        throw new Error("The multi-service plan contains an invalid pinned image");
      }
      images.push(`${service}=${image}`);
    }
    if (!Array.isArray(plan.servicePurposes) || plan.servicePurposes.length !== choice.serviceCount) {
      throw new Error("The multi-service plan did not explain every service");
    }
    for (const item of plan.servicePurposes) {
      if (!item || typeof item !== "object" || Array.isArray(item)
        || typeof item.id !== "string" || !Object.hasOwn(plan.images, item.id)
        || typeof item.purpose !== "string" || item.purpose.length < 12 || item.purpose.length > 140
        || /[\r\n\u0000-\u001f\u007f]/.test(item.purpose)
        || servicePurposes.some((existing) => existing.id === item.id)) {
        throw new Error("The multi-service plan contains an invalid service explanation");
      }
      servicePurposes.push({ id: item.id, purpose: item.purpose });
    }
  }
  return { approval: plan.approval, images, compose, servicePurposes };
}

export function bundledCatalogPlan(plan: Record<string, unknown>): boolean {
  const source = plan.catalogSource;
  if (!source || typeof source !== "object" || Array.isArray(source)) return false;
  if (source.kind !== "bundled" || source.executionAuthority !== "packaged") return false;
  const context = plan.projectContext;
  if (context && typeof context === "object" && !Array.isArray(context)
    && (context.catalogChanged === true || context.planChanged === true)) return false;
  return true;
}

export function installActions(supported: { media: boolean; household: boolean }) {
  const actions = [];
  if (supported.household) {
    actions.push({ value: "install-household", label: "Set up a household bundle",
      hint: "Media, Photos, Docs and Vault with separate approvals" });
  }
  if (supported.media) {
    actions.push({ value: "install-media", label: "Install personal media",
      hint: "Guided, approved seven-service Linux setup" });
  }
  return actions;
}

export function plannedAppCommand(plan: Record<string, unknown>, appId: string): string | null {
  if (!bundledCatalogPlan(plan)) return null;
  const apps = plan.selectedApps;
  if (!Array.isArray(apps)) return null;
  const app = apps.find((candidate) => candidate && typeof candidate === "object" && candidate.id === appId);
  if (!app || !app.cliSetup || typeof app.cliSetup !== "object") return null;
  if (app.cliSetup.command !== appId || !["immich", "docmost", "vaultwarden"].includes(appId)) return null;
  return appId;
}

export function plannedAppCommands(plan: Record<string, unknown>): string[] {
  const apps = plan.selectedApps;
  if (!Array.isArray(apps)) return [];
  return apps.flatMap((app) => {
    if (!app || typeof app !== "object" || typeof app.id !== "string") return [];
    const command = plannedAppCommand(plan, app.id);
    return command ? [command] : [];
  });
}

export function mediaCatalogSupported(plan: Record<string, unknown>): boolean {
  if (!bundledCatalogPlan(plan)) return false;
  const selected = plan.selectedApps;
  if (!Array.isArray(selected) || selected.length !== MEDIA_APPS.length
    || selected.some((app, index) => !app || typeof app !== "object" || app.id !== MEDIA_APPS[index])) return false;
  const stages = plan.setupStages;
  if (!Array.isArray(stages)) return false;
  const media = stages.find((stage) => stage && typeof stage === "object" && stage.id === "media");
  if (!media || media.owner !== "selfhost-media" || !Array.isArray(media.apps)) return false;
  return MEDIA_APPS.length === media.apps.length && MEDIA_APPS.every((id) => media.apps.includes(id));
}
import { sharedDerivedRecipeAdapters } from "./lib/shared-derived-recipe.ts";
import type { InstallInputDefinition } from "./control-panel/shared-install-inputs.ts";
