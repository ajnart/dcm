import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scoreCatalogCompatibility, type CompatibilityAppInput, type CompatibilityCapability,
  type CompatibilityHomarrMode } from "./lib/catalog-compatibility.ts";
import type { CompatibilityProjectSelection } from "./lib/catalog-compatibility-project.ts";
import { declaredSharedDerivedRecipe } from "./lib/shared-derived-recipe-loader.ts";

type CatalogRecord = Record<string, any>;
type CatalogRuntime = {
  loadCatalog(directory: string): Promise<{ apps: CatalogRecord[] }>;
  validateCatalog(catalog: unknown, options: { runtime: boolean }): { valid: boolean; errors: string[] };
  validateCatalogRecipes(catalog: unknown, directory: string): Promise<{
    errors: string[]; loadedRecipes: Map<string, { recipe: CatalogRecord; sha256: string }>;
  }>;
};

const ROOTS = [
  new URL("./workflows/selfhost/", import.meta.url),
  new URL("../../../.agents/skills/self-host/workflows/selfhost/", import.meta.url),
];
const HELP = "self-host catalog compatibility [APP] [--json] [--project-root ABS --project-id ID]\nRead-only evidence-based compatibility for the entire bundled catalog. An app filter never changes the aggregate denominator. No live receipt import is accepted.";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function source(path: string): Promise<string | null> {
  let metadata;
  try { metadata = await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.size > 512 * 1024) throw new Error("Compatibility source is unsafe.");
  return readFile(path, "utf8");
}

async function runtime(): Promise<{ module: CatalogRuntime; directory: string }> {
  for (const root of ROOTS) {
    const compiled = new URL("scripts/catalog.js", root);
    const original = new URL("scripts/catalog.ts", root);
    let selected = compiled;
    if (await source(fileURLToPath(compiled)) === null) {
      if (typeof Bun === "undefined" || await source(fileURLToPath(original)) === null) continue;
      selected = original;
    }
    const module = await import(selected.href) as CatalogRuntime;
    return { module, directory: resolve(fileURLToPath(new URL("references/catalog/", root))) };
  }
  throw new Error("Compatibility catalog runtime is missing. Rebuild or reinstall the CLI.");
}

function capability(state: CompatibilityCapability["state"], contents: string | null,
  reason: string): CompatibilityCapability {
  let subjectSha256: string | null = null;
  if (contents !== null) subjectSha256 = hash(contents);
  return { state, subjectSha256, reason };
}

/** Read source contracts only; never execute app adapters or inspect private projects. */
export async function loadCatalogCompatibility(checkedAt = new Date().toISOString(), appFilter?: string,
  projectSelection?: CompatibilityProjectSelection) {
  const loaded = await runtime();
  const catalog = await loaded.module.loadCatalog(loaded.directory);
  const validation = loaded.module.validateCatalog(catalog, { runtime: true });
  if (!validation.valid) throw new Error(`Catalog validation failed: ${validation.errors.join(" ")}`);
  const recipes = await loaded.module.validateCatalogRecipes(catalog, loaded.directory);
  if (recipes.errors.length) throw new Error(`Catalog recipe validation failed: ${recipes.errors.join(" ")}`);
  if (appFilter && !catalog.apps.some((app) => app.id === appFilter)) throw new Error("Unknown catalog app ID.");
  const implementation = { manifests: catalog.apps.length, recipes: 0, derivedRecipes: 0, setupAdapters: 0,
    homarrDescriptors: 0, linkAdapters: 0, recipesWithContainerHealthchecks: 0 };
  const sourceReports = new Map<string, CatalogRecord>();
  const inputs: CompatibilityAppInput[] = await Promise.all(catalog.apps.map(async (app) => {
    const base = join(loaded.directory, "apps", app.id);
    const [recipeSource, setup, homarr, links] = await Promise.all([
      source(join(base, "recipe.json")), source(join(base, "setup.ts")),
      source(join(base, "homarr.json")), source(join(base, "links.ts")),
    ]);
    const selected = recipes.loadedRecipes.get(app.id);
    const recipe = selected?.recipe;
    const derivedRecipe = declaredSharedDerivedRecipe(pathToFileURL(`${base}/`), app.id);
    let derivedDeclaration: string | null = null;
    if (derivedRecipe) {
      derivedDeclaration = await source(join(base, "derived-recipe-adapter.json"));
      implementation.derivedRecipes += 1;
    }
    const imageTags: Record<string, string> = {};
    if (recipe?.services) for (const service of recipe.services) imageTags[service.id] = service.imageTag;
    if (recipe?.service) imageTags[recipe.service.id] = recipe.service.imageTag;
    let homarrMode: CompatibilityHomarrMode = "tile-only";
    if (app.homarr.integration) homarrMode = "native";
    if (app.homarr.support === "not-applicable") homarrMode = "not-applicable";
    if (app.id === "homarr") homarrMode = "control-plane";
    if (recipe) implementation.recipes += 1;
    if (setup !== null) implementation.setupAdapters += 1;
    if (homarr !== null) implementation.homarrDescriptors += 1;
    if (links !== null) implementation.linkAdapters += 1;
    const healthchecks = recipe?.services?.filter((service: CatalogRecord) => service.healthcheck).length ?? 0;
    if (healthchecks > 0) implementation.recipesWithContainerHealthchecks += 1;
    const dimensions: NonNullable<CompatibilityAppInput["dimensions"]> = {
      compose: capability("unknown", recipeSource, "No shared Compose recipe is published."),
      setup: capability("unknown", setup, "No shared first-run adapter is published."),
      homarr: capability("unknown", homarr, "Homarr coverage is declared, but no matching live readback is recorded."),
      links: capability("unknown", links, "Selected links or application independence still need explicit acceptance."),
      liveRestart: capability("unknown", recipeSource, "App-specific core round trip and restart persistence remain unverified."),
    };
    if (recipe) dimensions.compose = capability("declared", recipeSource, "Validated Compose recipe exists; fresh apply/storage/private exposure are unverified.");
    if (!recipe && derivedRecipe) {
      dimensions.compose = capability("declared", derivedDeclaration,
        "Declared app-owned Compose adapter materializes a recipe from exact reviewed inputs; only a validated saved project binding supplies a materialized recipe identity. No live acceptance is claimed.");
    }
    if (setup !== null) dimensions.setup = capability("declared", setup, "First-run adapter source exists; fresh setup/login/resume are unverified.");
    if (recipe?.onboarding?.kind === "external-secret") {
      dimensions.setup = capability("external-required", setup, "A private owner-issued external credential is required; enrollment and remote scope remain unverified.");
    }
    if (!recipe && !derivedRecipe && app.lifecycle.note) {
      dimensions.compose = capability("unsupported", null, `No shared Compose recipe: ${app.lifecycle.note}`);
    }
    if (homarr !== null || homarrMode === "tile-only" || homarrMode === "not-applicable") {
      dimensions.homarr = capability("declared", homarr, `${homarrMode} coverage is declared, not live verified.`);
    }
    if (links !== null) dimensions.links = capability("declared", links, "App-owned link adapter exists; functional peer readback is unverified.");
    sourceReports.set(app.id, { recipeSha256: selected?.sha256 ?? null, imageTags,
      derivedRecipeDeclarationSha256: derivedDeclaration === null ? null : hash(derivedDeclaration),
      setupSha256: dimensions.setup.subjectSha256, homarrSha256: dimensions.homarr.subjectSha256,
      linksSha256: dimensions.links.subjectSha256, containerHealthchecks: healthchecks,
      acceptanceChecks: recipe?.acceptance?.map((check: CatalogRecord) => check.id) ?? [] });
    return { appId: app.id, name: app.name, recipeSha256: selected?.sha256 ?? null, imageTags, homarrMode, dimensions };
  }));
  let evidence;
  let project = null;
  if (projectSelection) {
    const { loadCatalogProjectCompatibility } = await import("./lib/catalog-compatibility-project.ts");
    const loadedProject = await loadCatalogProjectCompatibility(projectSelection, inputs, catalog.apps,
      recipes.loadedRecipes, checkedAt);
    evidence = loadedProject.receipts;
    project = loadedProject.project;
  }
  const scored = scoreCatalogCompatibility(inputs, { checkedAt, evidence,
    expectedAppIds: catalog.apps.map((app) => app.id) });
  let apps = scored.apps;
  if (appFilter) apps = apps.filter((app) => app.appId === appFilter);
  let status = "unverified";
  if (scored.earnedPoints > 0) status = "partial";
  if (scored.apps.some((app) => app.rating === "broken")) status = "broken";
  return { ...scored, command: "catalog compatibility", status, mutation: false, project,
    catalogSource: { kind: "bundled", executionAuthority: "packaged" },
    implementationCoverage: implementation, shownAppCount: apps.length,
    apps: apps.map((app) => ({ ...app, label: app.rating, source: sourceReports.get(app.appId) })),
    next: "Close explicit source gaps, then perform separately approved isolated live acceptance and retain exact version-bound sanitized receipts. Arbitrary receipt imports are not supported." };
}

export function formatCatalogCompatibility(report: Awaited<ReturnType<typeof loadCatalogCompatibility>>): string {
  const lines = [`Verified compatibility: ${report.aggregate}/100 across all ${report.appCount} apps (goal >75).`,
    "Unverified is not failed. Source declarations, fixtures, running containers, and HTTP 200 do not earn live acceptance points.",
    `Implementation only: ${report.implementationCoverage.recipes} static recipes, ${report.implementationCoverage.derivedRecipes} declared derived recipes, ${report.implementationCoverage.setupAdapters} setup adapters, ${report.implementationCoverage.homarrDescriptors} Homarr descriptors, ${report.implementationCoverage.linkAdapters} link adapters.`];
  for (const app of report.apps) {
    lines.push(`${app.name} (${app.appId}): ${app.score}/100 ${app.label}; Homarr ${app.homarrMode}`);
    lines.push(`  ${app.dimensions.map((item) => `${item.dimension}=${item.level}`).join("; ")}`);
    for (const item of app.dimensions) lines.push(`  Next ${item.dimension}: ${item.requiredChecks.join(", ")}. ${item.reason}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function catalogCompatibilityCommand(args: string[], write = (value: string) => process.stdout.write(value)) {
  if (args.length === 1 && ["help", "--help"].includes(args[0])) {
    write(`${HELP}\n`);
    return;
  }
  const positional: string[] = [];
  const flags = new Map<string, string>();
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") { if (json) throw new Error(HELP); json = true; continue; }
    if (["--project-root", "--project-id"].includes(arg)) {
      const value = args[++index];
      if (flags.has(arg) || !value || value.startsWith("--")) throw new Error(HELP);
      flags.set(arg, value); continue;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(arg)) throw new Error(HELP);
    positional.push(arg);
  }
  if (positional.length > 1 || flags.size === 1) throw new Error(HELP);
  let selection;
  if (flags.size === 2) selection = { projectRoot: flags.get("--project-root")!, projectId: flags.get("--project-id")! };
  const report = await loadCatalogCompatibility(new Date().toISOString(), positional[0], selection);
  if (json) write(`${JSON.stringify(report, null, 2)}\n`);
  else write(formatCatalogCompatibility(report));
}
