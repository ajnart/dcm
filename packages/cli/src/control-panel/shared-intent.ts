import type { RecipeChoice } from "../interactive-catalog.ts";

type RecordValue = Record<string, unknown>;
export type SharedIntentGap = { kind: "resolution" | "external-catalog" | "recipe" | "owner" | "conflict" | "capability"; detail: string; appId?: string };
export type SharedIntentOptions = {
  existingAppIds?: readonly string[];
  existingRecipeSha256?: Readonly<Record<string, string | null>>;
  ownerKind?: "shared" | "app" | "batch" | "bundle" | "stack" | "media";
  conflicts?: readonly string[];
};
export type SharedIntentSelection = {
  status: "ready" | "blocked";
  mutation: false;
  selected: string[];
  composeApps: string[];
  coveredDependencies: Array<{ appId: string; requiredBy: string; serviceId: string }>;
  requested: string[];
  retained: string[];
  missing: string[];
  dependencies: Array<{ app: string; requiredBy: string }>;
  gaps: SharedIntentGap[];
  gates: string[];
  acceptance: string[];
  unresolved: string[];
};

function record(value: unknown): RecordValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as RecordValue;
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Catalog plan has invalid ${label}`);
  }
  return [...value];
}

function appIds(value: unknown, label: string): string[] {
  const result = strings(value, label);
  if (result.some((id) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) || new Set(result).size !== result.length) {
    throw new Error(`Catalog plan has invalid ${label}`);
  }
  return result.sort();
}

/** Project the canonical read-only plan, never resolve intent or grant apply authority. */
export function sharedIntentSelection(value: unknown, recipes: readonly RecipeChoice[],
  options: SharedIntentOptions = {}): SharedIntentSelection {
  const retained = appIds(options.existingAppIds ?? [], "existing app IDs");
  const result: SharedIntentSelection = { status: "blocked", mutation: false,
    selected: [], composeApps: [], coveredDependencies: [], requested: [], retained, missing: [], dependencies: [], gaps: [],
    gates: [], acceptance: [], unresolved: [] };
  let plan = record(value);
  if (plan && Object.hasOwn(plan, "data")) {
    if (plan.command !== "plan" || plan.status !== "pass" || plan.mutation !== false) {
      result.gaps.push({ kind: "resolution", detail: "Resolve every goal, composition, or ambiguous intent through the catalog planner first." });
      return result;
    }
    plan = record(plan.data);
  }
  if (!plan || plan.mode !== "read-only" || plan.status !== "planned"
    || plan.needsClarification === true || plan.ambiguous === true
    || plan.needsComposition === true) {
    result.gaps.push({ kind: "resolution", detail: "A complete canonical read-only plan is required; unresolved composition and ambiguous VPN are not app selections." });
    return result;
  }
  const source = record(plan.catalogSource);
  if (source?.kind !== "bundled" || source.executionAuthority !== "packaged") {
    result.gaps.push({ kind: "external-catalog", detail: "External or unidentified catalog data cannot authorize packaged shared recipes." });
  }
  if (!Array.isArray(plan.selectedApps)) throw new Error("Catalog plan has invalid selected apps");
  result.selected = appIds(plan.selectedApps.map((app) => record(app)?.id), "selected app IDs");
  if (!Array.isArray(plan.roles)) throw new Error("Catalog plan has invalid roles");
  const roles = plan.roles.map((role) => {
    const item = record(role);
    if (!item || typeof item.id !== "string" || (item.selected !== null && typeof item.selected !== "string")
      || (item.required === true && item.selected === null)) throw new Error("Catalog plan has invalid role selection");
    return item;
  });
  result.requested = appIds([...new Set(roles.filter((role) => role.selected !== null)
    .map((role) => role.selected))], "requested app IDs");
  if (!Array.isArray(plan.impliedApps)) throw new Error("Catalog plan has invalid dependencies");
  for (const entry of plan.impliedApps) {
    const dependency = record(entry);
    if (!dependency || typeof dependency.app !== "string" || typeof dependency.requiredBy !== "string"
      || !result.selected.includes(dependency.app) || !result.selected.includes(dependency.requiredBy)
      || result.dependencies.some((item) => item.app === dependency.app)) {
      throw new Error("Catalog plan has invalid dependency coverage");
    }
    result.dependencies.push({ app: dependency.app, requiredBy: dependency.requiredBy });
  }
  const represented = new Set([...result.requested, ...result.dependencies.map((entry) => entry.app)]);
  if (result.requested.some((id) => !result.selected.includes(id))
    || result.selected.some((id) => !represented.has(id))) throw new Error("Catalog plan silently changed selected app coverage");
  result.gates = strings(plan.gates, "gates");
  result.acceptance = strings(plan.acceptance, "acceptance");
  result.unresolved = strings(plan.unresolved, "unresolved decisions");
  for (const dependency of result.dependencies) {
    if (result.requested.includes(dependency.app)) continue;
    const provider = recipes.find((recipe) => recipe.appId === dependency.requiredBy);
    const coverage = provider?.bundledDependencies?.find((entry) => entry.appId === dependency.app);
    if (!coverage) continue;
    if (retained.includes(dependency.requiredBy)
      && options.existingRecipeSha256?.[dependency.requiredBy] !== provider!.recipeSha256) {
      result.gaps.push({ kind: "conflict", appId: dependency.requiredBy,
        detail: `${dependency.requiredBy}'s saved recipe must match before reusing its bundled ${dependency.app} service.` });
    }
    result.coveredDependencies.push({ appId: dependency.app,
      requiredBy: dependency.requiredBy, serviceId: coverage.serviceId });
  }
  const covered = new Set(result.coveredDependencies.map((entry) => entry.appId));
  result.composeApps = result.selected.filter((id) => !covered.has(id));
  result.missing = result.composeApps.filter((id) => !retained.includes(id));
  const recipeIds = new Set(recipes.map((recipe) => recipe.appId));
  for (const id of result.missing) {
    if (!recipeIds.has(id)) result.gaps.push({ kind: "recipe", appId: id,
      detail: `${id} has no validated shared Compose recipe; it remains part of the goal, not silently omitted.` });
  }
  if (result.selected.length === 0) result.gaps.push({ kind: "resolution", detail: "The catalog plan selects no apps." });
  if (options.ownerKind && options.ownerKind !== "shared") {
    result.gaps.push({ kind: "owner", detail: `Retain the existing ${options.ownerKind} owner and use its upkeep flow; do not convert it into shared Compose.` });
  }
  const context = record(plan.projectContext);
  if (context?.planChanged === true || context?.catalogChanged === true || context?.status === "conflict") {
    result.gaps.push({ kind: "conflict", detail: "Saved goal or catalog choices conflict with this plan; review the existing owner first." });
  }
  for (const detail of options.conflicts ?? []) result.gaps.push({ kind: "conflict", detail });
  const skills = strings(plan.requiredSkills, "required skills");
  const separateOwners = skills.filter((skill) => ["selfhost-ingress", "selfhost-vpn"].includes(skill));
  for (const skill of separateOwners) result.gaps.push({ kind: "capability",
    detail: `${skill} needs a separately reviewed capability plan and approval; selecting an app does not implement access or VPN routing.` });
  for (const gate of result.gates.filter((gate) => ["public-exposure", "privilege", "vpn"].includes(gate))) {
    result.gaps.push({ kind: "capability", detail: `${gate} requires its owning workflow and exact separate approval, not implicit shared app selection.` });
  }
  if (result.gaps.length === 0) result.status = "ready";
  return result;
}
