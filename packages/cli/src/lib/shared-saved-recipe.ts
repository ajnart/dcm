import { createHash } from "node:crypto";
import { join } from "node:path";
import type { SharedAppSelection } from "./shared-compose-project.ts";
import type { SharedProjectState } from "./shared-project-state.ts";
import { checkedManualJobRecipe, isManualJobService } from "./manual-job.ts";
import { checkedConnectorRecipe, checkedPrivateDaemonRecipe } from "./multi-service-recipe.ts";
import { sharedRecipeEligible } from "./shared-app-eligibility.ts";
import { loadSharedPrivateHttpsBindingSync, restoreSharedPrivateHttpsSelection } from "./shared-private-https-state.ts";
import { sharedDerivedRecipeAdapter, restoreSharedDerivedRecipeSelection } from "./shared-derived-recipe.ts";
import { loadSharedDerivedRecipeBindingSync } from "./shared-derived-recipe-state.ts";

type Entry = Record<string, any>;
export type SharedSavedRecipeFor = (appId: string) => { recipe: Entry; boundedApply: boolean; previousRecipes?: Entry[] };

function fail(appId: string): never {
  throw new Error(`Shared saved recipe: ${appId} differs from its exact saved selection; inspect before continuing`);
}

function fingerprint(selection: SharedAppSelection): string {
  return createHash("sha256").update(JSON.stringify(selection)).digest("hex");
}

/** The saved fingerprint, not app ID, chooses canonical versus bound generated Caddy. */
export function restoreSavedSharedSelection(state: SharedProjectState, appId: string,
  recipeFor: SharedSavedRecipeFor): SharedAppSelection {
  if (sharedDerivedRecipeAdapter(appId)) return restoreSelection(state, appId, recipeFor);
  const info = recipeFor(appId);
  const history = info.previousRecipes ?? [];
  if (!Array.isArray(history) || history.length > 16) fail(appId);
  for (const recipe of [info.recipe, ...history]) {
    try {
      return restoreSelection(state, appId, () => ({ ...info, recipe }));
    } catch {
      // Only an exact saved fingerprint can select a source-owned historical recipe.
    }
  }
  fail(appId);
}

function restoreSelection(state: SharedProjectState, appId: string,
  recipeFor: SharedSavedRecipeFor): SharedAppSelection {
  if (!Object.hasOwn(state.units, appId) || !Object.hasOwn(state.selectionFingerprints, appId)) fail(appId);
  if (sharedDerivedRecipeAdapter(appId)) {
    const binding = loadSharedDerivedRecipeBindingSync(state.project.directory, appId, state);
    return restoreSharedDerivedRecipeSelection(state, binding);
  }
  const info = recipeFor(appId);
  const recipe = info.recipe;
  if (!sharedRecipeEligible(appId, info.boundedApply) || recipe?.schemaVersion !== 2
    || recipe.kind !== "multi-service-compose" || recipe.appId !== appId) fail(appId);
  const front = state.manifest.services.find((service: Entry) => service.id === appId);
  let port: number | null = null;
  let publishedPorts: Record<string, number> | undefined;
  if (checkedManualJobRecipe(recipe)) {
    if (!isManualJobService(front) || front.ports?.length !== 0) fail(appId);
  } else if (checkedConnectorRecipe(recipe) || checkedPrivateDaemonRecipe(recipe)) {
    if (!front || isManualJobService(front) || front.ports?.length !== 0) fail(appId);
    const expectedNetworks = [`${appId}-private`];
    if (recipe.execution.frontendSharing === "owner-front") expectedNetworks.unshift("front");
    if (JSON.stringify(front.networks) !== JSON.stringify(expectedNetworks)) fail(appId);
  } else {
    let primary = front?.ports?.filter((item: Entry) => item.target === recipe.services
      .find((service: Entry) => service.id === appId)?.publishTargetPort && item.protocol === "tcp");
    // Generated Caddy uses its bound HTTPS port, not the canonical readiness port.
    // The exact fingerprint and immutable route binding are checked below.
    if (appId === "caddy" && primary?.length === 0 && front.ports?.length === 1
      && front.ports[0].protocol === "tcp") primary = front.ports;
    if (primary?.length !== 1 || !Number.isInteger(primary[0].published)) fail(appId);
    port = primary[0].published;
    const descriptors = recipe.services.flatMap((service: Entry) => service.additionalPorts ?? []);
    const extras = front.ports.filter((item: Entry) => item !== primary[0]);
    if (extras.length > 0) {
      publishedPorts = {};
      for (const extra of extras) {
        const matching = descriptors.filter((descriptor: Entry) => descriptor.targetPort === extra.target
          && descriptor.protocol === extra.protocol && descriptor.purpose === extra.purpose);
        if (matching.length !== 1 || Object.hasOwn(publishedPorts, matching[0].id)
          || !Number.isInteger(extra.published)) fail(appId);
        publishedPorts[matching[0].id] = extra.published;
      }
    }
    if (descriptors.some((descriptor: Entry) => descriptor.required && !Object.hasOwn(publishedPorts ?? {}, descriptor.id))) fail(appId);
  }
  const images: Record<string, string> = {};
  for (const service of recipe.services) {
    let id = `${appId}-${service.id}`;
    if (service.id === appId) id = appId;
    const saved = state.manifest.services.find((entry: Entry) => entry.id === id);
    if (!saved || typeof saved.image !== "string") fail(appId);
    images[service.id] = saved.image;
  }
  const mounts = recipe.services.flatMap((service: Entry) =>
    service.mounts.filter((mount: Entry) => mount.hostPath === true));
  let hostPaths: Record<string, string> | undefined;
  if (mounts.length > 0) hostPaths = Object.fromEntries(mounts.map((mount: Entry) =>
    [mount.name, join(state.project.directory, "data", "shared")]));
  let selection: SharedAppSelection = { appId, recipe, images, port, hostPaths };
  if (publishedPorts) selection.publishedPorts = publishedPorts;
  if (fingerprint(selection) !== state.selectionFingerprints[appId]) {
    if (appId !== "caddy") fail(appId);
    const binding = loadSharedPrivateHttpsBindingSync(state.project.directory, recipe);
    // Preserve the returned shape verbatim: even hostPaths: {} changes its identity.
    selection = restoreSharedPrivateHttpsSelection(state, recipe, binding);
    if (fingerprint(selection) !== state.selectionFingerprints[appId]) fail(appId);
  }
  const expectedIds = selection.recipe.services.map((service: Entry) => {
    if (service.id === appId) return appId;
    return `${appId}-${service.id}`;
  });
  if (JSON.stringify(expectedIds) !== JSON.stringify(state.units[appId])) fail(appId);
  return selection;
}

/** Retained ordinary units remain catalog-independent; unknown Caddy never flattens to readiness. */
export function requireSavedSharedGeneratedRecipes(state: SharedProjectState,
  recipeFor: SharedSavedRecipeFor): void {
  for (const appId of Object.keys(state.units)) {
    if (sharedDerivedRecipeAdapter(appId)) restoreSavedSharedSelection(state, appId, recipeFor);
  }
  if (Object.hasOwn(state.units, "caddy")) restoreSavedSharedSelection(state, "caddy", recipeFor);
}

/** Generated Caddy has SNI routes, not the catalog's HTTP readiness frontend. */
export function savedSharedPrivateHttpsRoutes(state: SharedProjectState, recipeFor: SharedSavedRecipeFor) {
  if (!Object.hasOwn(state.units, "caddy")) return null;
  const selection = restoreSavedSharedSelection(state, "caddy", recipeFor);
  const info = recipeFor("caddy");
  const canonical = info.recipe;
  // An exact source-owned historical ordinary recipe is not generated HTTPS.
  // Restoration above still requires its saved selection fingerprint.
  if ([canonical, ...(info.previousRecipes ?? [])]
    .some((recipe) => JSON.stringify(selection.recipe) === JSON.stringify(recipe))) return null;
  const binding = loadSharedPrivateHttpsBindingSync(state.project.directory, canonical);
  return binding.routes.map((route) => ({ appId: route.appId,
    url: `https://${route.hostname}:${binding.port}` }));
}
