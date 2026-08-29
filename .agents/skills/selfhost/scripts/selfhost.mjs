#!/usr/bin/env node

import {
  buildPlan,
  catalogMenu,
  findApp,
  homarrCoverage,
  listApps,
  loadCatalog,
  resolveStack,
  searchApps,
  validateCatalog
} from "./catalog.mjs";
import {
  PreferenceError,
  initPreferences,
  loadPreferences,
  preferencesPathForProjectRoot,
  publicPreferences,
  resolvePreferencesPath,
  setPreference,
  validatePreferencesDocument
} from "./preferences.mjs";
import {
  ProjectStateError,
  checkpointProjectState,
  initProjectState,
  loadProjectState,
  projectFreshness,
  projectStatePathForProjectRoot,
  publicProjectState,
  reviseProjectState
} from "./project-state.mjs";

process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") {
    process.exit(0);
  }
  throw error;
});

function usage() {
  return `Selfhost read-only router

Catalog:
  catalog menu [--json]
  catalog list [--category NAME] [--support LEVEL] [--tier T0|T1|T2] [--json]
  catalog search <words...> [--json]
  catalog show <app-id> [--json]
  catalog homarr [--status supported|gap] [--json]
  catalog validate [--json]

Stacks:
  stack resolve <goal...> [--json]
  stack plan <goal...> [--select role=app] [--project-root ABSOLUTE | --preferences ABSOLUTE] [--json]

Returning projects:
  project init <goal...> --project-root ABSOLUTE [--select role=app] [--json]
  project revise <same-goal...> --project-root ABSOLUTE [--select role=app] [--json]
  project status --project-root ABSOLUTE [--json]
  project resume --project-root ABSOLUTE [--json]
  project checkpoint <inspected|planned|applied|verified> --project-root ABSOLUTE [--evidence TYPE:ID] [--json]

Non-secret preferences:
  preferences init (--project-root ABSOLUTE | --path ABSOLUTE) [--json]
  preferences show (--project-root ABSOLUTE | --path ABSOLUTE) [--json]
  preferences set <field> <value> (--project-root ABSOLUTE | --path ABSOLUTE) [--json]
  preferences validate (--project-root ABSOLUTE | --path ABSOLUTE) [--json]`;
}

function parseArguments(input) {
  const flags = { json: false, selections: [], evidence: [] };
  const positional = [];
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    if (value === "--json") {
      flags.json = true;
      continue;
    }
    const supported = new Set(["--path", "--preferences", "--project-root", "--category", "--support", "--status", "--tier", "--select", "--evidence"]);
    if (!supported.has(value)) {
      throw new Error("Unknown option. Run --help for supported flags.");
    }
    index += 1;
    if (index >= input.length) {
      throw new Error(`Option ${value} requires a value.`);
    }
    const optionValue = input[index];
    if (value === "--select") {
      flags.selections.push(optionValue);
      continue;
    }
    if (value === "--evidence") {
      flags.evidence.push(optionValue);
      continue;
    }
    flags[value.slice(2)] = optionValue;
  }
  return { flags, positional };
}

function parseSelections(values) {
  const selections = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator < 1 || separator === value.length - 1) {
      throw new Error("Selections must use role=app or role=off.");
    }
    const role = value.slice(0, separator);
    const app = value.slice(separator + 1);
    if (Object.hasOwn(selections, role)) {
      throw new Error(`Role ${role} was selected more than once.`);
    }
    selections[role] = app;
  }
  return selections;
}

async function preferencePathFromFlags(flags, explicitFlag) {
  const explicitPath = flags[explicitFlag];
  const projectRoot = flags["project-root"];
  if (projectRoot && explicitPath) {
    throw new Error(`Use either --project-root or --${explicitFlag}, not both.`);
  }
  if (projectRoot) {
    return preferencesPathForProjectRoot(projectRoot);
  }
  if (explicitPath) {
    return resolvePreferencesPath(explicitPath);
  }
  return null;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function buildSimpleSummary(options) {
  const summary = {
    goal: { id: null, name: options.goal },
    outcome: options.outcome,
    services: [],
    rememberedChoices: 0,
    currentHost: "not-inspected-by-router",
    changed: [],
    unchanged: ["No host services or files were changed."],
    blockers: [],
    verification: "not-run-by-router",
    next: options.next
  };
  if (options.goalId) {
    summary.goal.id = options.goalId;
  }
  if (options.services) {
    summary.services = options.services;
  }
  if (Number.isInteger(options.rememberedChoices)) {
    summary.rememberedChoices = options.rememberedChoices;
  }
  if (options.changed) {
    summary.changed = options.changed;
  }
  if (options.unchanged) {
    summary.unchanged = options.unchanged;
  }
  if (options.blockers) {
    summary.blockers = options.blockers;
  }
  if (options.verification) {
    summary.verification = options.verification;
  }
  return summary;
}

function printSimpleSummary(summary) {
  process.stdout.write("\nSummary\n");
  process.stdout.write(`  Goal: ${summary.goal.name}\n`);
  process.stdout.write(`  What happened: ${summary.outcome}\n`);
  if (summary.services.length === 0) {
    process.stdout.write("  Services: none were selected.\n");
  } else {
    process.stdout.write("  Services:\n");
    for (const service of summary.services) {
      let label = service.name;
      if (service.selection === "dependency") {
        label = `${service.name} (supporting service)`;
      }
      process.stdout.write(`    - ${label} — ${service.purpose}\n`);
    }
  }
  process.stdout.write("  Current setup: the host was not inspected.\n");
  if (summary.verification === "catalog-validated") {
    process.stdout.write("  Verification: the catalog structure and rules passed; no host checks were run.\n");
  } else if (summary.verification === "local-preferences-validated") {
    process.stdout.write("  Verification: the local preference document passed validation; no host checks were run.\n");
  } else {
    process.stdout.write("  Verification: no acceptance checks were run.\n");
  }
  if (summary.blockers.length > 0) {
    process.stdout.write("  Still needed:\n");
    for (const blocker of summary.blockers) {
      process.stdout.write(`    - ${blocker}\n`);
    }
  }
  let changed = summary.unchanged[0] || "No host services or files were changed.";
  if (summary.changed.length > 0) {
    changed = summary.changed.join(" ");
  }
  process.stdout.write(`  Changed: ${changed}\n`);
  process.stdout.write(`  Next: ${summary.next}\n`);
}

function buildCommandSummary(plan, options = {}) {
  const summary = structuredClone(plan.summary);
  if (options.outcome) {
    summary.outcome = options.outcome;
  }
  if (options.changed) {
    summary.changed = [options.changed];
    summary.unchanged = ["No host service or runtime configuration was changed by this state command."];
  } else {
    summary.changed = [];
  }
  if (options.next) {
    summary.next = options.next;
  }
  return summary;
}

function printMenu(menu, summary) {
  process.stdout.write(`Selfhost goals (catalog checked ${menu.checkedAt})\n`);
  for (const goal of menu.goals) {
    process.stdout.write(`  ${goal.id.padEnd(18)} ${goal.summary}\n`);
  }
  process.stdout.write("\nCategories\n");
  for (const category of menu.categories) {
    process.stdout.write(`  ${category.id.padEnd(18)} ${String(category.apps).padStart(2)} apps\n`);
  }
  printSimpleSummary(summary);
}

function buildMenuSummary() {
  return buildSimpleSummary({
    goal: "Browse self-hosting choices",
    outcome: "Listed common goals and catalog categories.",
    blockers: ["Choose a goal before services can be planned."],
    next: "Choose a goal or describe what you want to replace."
  });
}

function printAppList(apps, includeScore = false) {
  if (apps.length === 0) {
    process.stdout.write("No applications matched.\n");
    return;
  }
  for (const item of apps) {
    let app = item;
    let score = null;
    if (item.app) {
      app = item.app;
      score = item.score;
    }
    let prefix = "";
    if (includeScore && score !== null) {
      prefix = `${String(score).padStart(5)} `;
    }
    process.stdout.write(`${prefix}${app.id.padEnd(23)} ${app.support.automation}/${app.support.tier}  ${app.categories.join(", ")}\n`);
  }
}

function plainRoleList(roles) {
  const names = roles.map((role) => role.replaceAll("-", " "));
  if (names.length === 1) {
    return names[0];
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function catalogAppPurpose(catalog, app) {
  for (const stack of catalog.stacks) {
    for (const role of stack.roles) {
      if (role.choices.includes(app.id)) {
        return role.purpose;
      }
    }
  }
  if (app.roles.length > 0) {
    return `${app.name} provides self-hosted ${plainRoleList(app.roles)} features.`;
  }
  return `${app.name} is a self-hosted application in the ${plainRoleList(app.categories)} catalog.`;
}

function printApp(app, purpose) {
  process.stdout.write(`${app.name} (${app.id})\n`);
  process.stdout.write(`  purpose: ${purpose}\n`);
  process.stdout.write(`  lifecycle: ${app.lifecycle.status}, checked ${app.lifecycle.checkedAt}\n`);
  process.stdout.write(`  automation: ${app.support.automation}/${app.support.tier}\n`);
  process.stdout.write(`  upstream: ${app.upstream.url}\n`);
  process.stdout.write(`  image: ${app.image.reference || "unknown"} (${app.image.source}/${app.image.status})\n`);
  process.stdout.write(`  Homarr: ${app.homarr.support}${app.homarr.integration ? ` (${app.homarr.integration})` : ""}\n`);
  process.stdout.write(`  roles: ${app.roles.join(", ")}\n`);
  process.stdout.write(`  dependencies: ${app.dependencies.length > 0 ? app.dependencies.join(", ") : "none"}\n`);
  process.stdout.write(`  alternatives: ${app.alternatives.join(", ")}\n`);
  for (const note of app.security) {
    process.stdout.write(`  security: ${note}\n`);
  }
  for (const note of app.pitfalls) {
    process.stdout.write(`  pitfall: ${note}\n`);
  }
  for (const source of app.sources) {
    process.stdout.write(`  source: ${source}\n`);
  }
}

function printHomarrCoverage(coverage) {
  const standard = coverage.counts.standard;
  const special = coverage.counts.special;
  process.stdout.write(`Homarr coverage (checked ${coverage.checkedAt}): ${standard.covered}/${standard.total} standard, ${special.covered}/${special.total} special, ${coverage.counts.gaps} gaps.\n`);
  for (const entry of coverage.entries) {
    if (entry.status === "supported") {
      process.stdout.write(`  supported ${entry.surface.padEnd(8)} ${entry.identifier.padEnd(20)} ${entry.displayName} [${entry.appId}; ${entry.lifecycle}/${entry.automation}]\n`);
      continue;
    }
    process.stdout.write(`  gap       ${entry.appId.padEnd(23)} ${entry.appName} [${entry.lifecycle}/${entry.automation}]\n`);
  }
}

function looksLikeItemSearch(query, catalog) {
  const original = String(query || "");
  const normalized = original.toLowerCase();
  const actionMatch = /\b(add|find|request|search)\b/.exec(normalized);
  if (!actionMatch) {
    return false;
  }
  const hasCatalogWord = /\b(?:app|application|alternative|alternatives|category|deploy|feature|host|hosting|install|integration|self-hosted|self-hosting|self\s+hosting|selfhost|server|service|software|stack|support|tool)\b/.test(normalized);
  if (hasCatalogWord) {
    return false;
  }
  let candidate = normalized.slice(actionMatch.index + actionMatch[0].length).trim();
  candidate = candidate.replace(/^(?:for\s+)?(?:a\s+|an\s+|the\s+)?/, "").trim();
  if (!candidate) {
    return false;
  }
  if (catalog && findApp(catalog, candidate)) {
    return false;
  }
  if (/\b(?:anime|documentary|episode|film|movie|season|series|show|tv)\b/.test(candidate)) {
    return true;
  }
  if (actionMatch[1] === "add" || actionMatch[1] === "request") {
    return true;
  }
  return candidate.split(/\s+/).length >= 2;
}

function printResolution(result, query = "", catalog = null) {
  if (!result.resolved) {
    if (result.needsComposition) {
      process.stdout.write("This request needs composition across these goals:\n");
      for (const component of result.components) {
        process.stdout.write(`  ${component.id} — ${component.name} (matched "${component.matched}")\n`);
      }
      if (result.needsClarification) {
        process.stdout.write("Clarification is required before planning:\n");
        for (const intent of result.unresolvedIntents) {
          process.stdout.write(`  ${intent.intent}: choose one of ${intent.candidates.map((candidate) => candidate.id).join(", ")}\n`);
        }
        process.stdout.write("Choose every unresolved intent before composing or planning the goals.\n");
        return;
      }
      process.stdout.write("Confirm the combined scope, then plan each component with shared host facts.\n");
      return;
    }
    if (result.ambiguous) {
      process.stdout.write("Goal is ambiguous. Choose one:\n");
      for (const candidate of result.candidates) {
        process.stdout.write(`  ${candidate.id} — ${candidate.name}\n`);
      }
      return;
    }
    if (looksLikeItemSearch(query, catalog)) {
      process.stdout.write("No deployment goal matched. This may be a title search for the read-only Homarr and Seerr workflow.\n");
      return;
    }
    process.stdout.write("No goal matched. Run catalog menu or search the app catalog.\n");
    return;
  }
  process.stdout.write(`Resolved ${result.stack.id} via "${result.matched}".\n`);
  process.stdout.write(`${result.stack.summary}\n`);
}

function buildResolutionSummary(result, query = "", catalog = null) {
  let goalId = null;
  let goalName = "Not resolved";
  if (result.resolved && result.stack) {
    goalId = result.stack.id;
    goalName = result.stack.name;
  } else if (result.components && result.components.length > 0) {
    goalName = result.components.map((component) => component.name).join(" and ");
  } else if (result.candidates && result.candidates.length > 0) {
    goalName = result.candidates.map((candidate) => candidate.name).join(" or ");
  }
  let outcome = "No self-hosting goal matched this request.";
  let blocker = "Choose a goal from the catalog menu or search the application catalog.";
  let next = "Run catalog menu, then choose the closest goal.";
  if (result.resolved) {
    outcome = `Matched the request to ${result.stack.name}.`;
    blocker = "A service plan has not been created yet.";
    next = "Create the read-only stack plan for this goal.";
  } else if (result.needsComposition && result.needsClarification) {
    outcome = "The request combines goals but one part is still ambiguous.";
    blocker = "Choose every unresolved intent before planning the combined setup.";
    next = blocker;
  } else if (result.needsComposition) {
    outcome = "The request combines more than one self-hosting goal.";
    blocker = "Confirm that the listed goals should share one host inspection and project plan.";
    next = blocker;
  } else if (result.ambiguous) {
    outcome = "More than one self-hosting goal matches this request.";
    blocker = "Choose one of the listed goals before planning services.";
    next = blocker;
  } else if (looksLikeItemSearch(query, catalog)) {
    outcome = "No deployment goal matched; this looks like a possible media-title search.";
    blocker = "A title must be searched and selected before any separate request could be considered.";
    next = "Use the selfhost-homarr read-only Seerr search to show exact matches; do not submit a request.";
  }
  return {
    goal: { id: goalId, name: goalName },
    outcome,
    services: [],
    rememberedChoices: 0,
    currentHost: "not-inspected-by-router",
    changed: [],
    unchanged: ["No host services or files were changed."],
    blockers: [blocker],
    verification: "not-run-by-router",
    next
  };
}

function printResolutionEndSummary(summary) {
  printSimpleSummary(summary);
}

function printPlainSummary(plan, projectContext = null, options = {}) {
  let result = plan.summary.outcome;
  if (options.result) {
    result = options.result;
  }
  let changed = "No host services or files were changed.";
  if (options.changed) {
    changed = options.changed;
  }
  let next = plan.summary.next;
  if (options.next) {
    next = options.next;
  }
  process.stdout.write("\nSummary\n");
  process.stdout.write(`  Goal: ${plan.goal.name}\n`);
  process.stdout.write(`  What happened: ${result}\n`);
  process.stdout.write("  Services:\n");
  for (const service of plan.summary.services) {
    let label = service.name;
    if (service.selection === "dependency") {
      label = `${service.name} (supporting service)`;
    }
    process.stdout.write(`    - ${label} — ${service.purpose}\n`);
  }
  if (plan.summary.services.length === 0) {
    process.stdout.write("    - No services were selected.\n");
  }
  if (projectContext) {
    process.stdout.write(`  Previous work: saved progress is "${projectContext.savedCheckpoint}" and is treated as stale until checked again.\n`);
    if (projectContext.planChanged || projectContext.catalogChanged) {
      process.stdout.write("  Plan update: the saved plan differs from the current catalog or confirmed choices. Review it again before applying.\n");
    }
  } else if (plan.summary.rememberedChoices > 0) {
    process.stdout.write(`  Remembered choices: ${plan.summary.rememberedChoices} confirmed project choice(s) were used.\n`);
  } else {
    process.stdout.write("  Remembered choices: none were supplied to this command.\n");
  }
  process.stdout.write("  Current setup: this router command did not inspect the host. The full workflow must check it before anything is reused.\n");
  process.stdout.write("  Verification: this router did not run acceptance checks; saved evidence remains untrusted until its owner rechecks it.\n");
  if (plan.summary.blockers.length > 0) {
    process.stdout.write(`  Still needed: ${plan.summary.blockers.length} item(s).\n`);
    for (const blocker of plan.summary.blockers.slice(0, 3)) {
      process.stdout.write(`    - ${blocker}\n`);
    }
    if (plan.summary.blockers.length > 3) {
      process.stdout.write(`    - ${plan.summary.blockers.length - 3} more item(s) are listed in the plan.\n`);
    }
  } else {
    process.stdout.write("  Still needed: no unresolved planning decisions.\n");
  }
  process.stdout.write(`  Changed: ${changed}\n`);
  process.stdout.write(`  Next: ${next}\n`);
}

function printPlan(plan, projectContext = null) {
  process.stdout.write(`Read-only plan ${plan.planId}: ${plan.goal.name}\n`);
  process.stdout.write(`${plan.goal.summary}\n`);
  process.stdout.write(`Stack capability: ${plan.goal.automation}; effective automation: ${plan.effectiveAutomation}.\n\nRoles\n`);
  for (const role of plan.roles) {
    const selected = role.selected || "off";
    process.stdout.write(`  ${role.name}: ${selected}\n`);
    process.stdout.write(`    why: ${role.reason}\n`);
    if (role.alternatives.length > 0) {
      process.stdout.write(`    alternatives: ${role.alternatives.join(", ")}\n`);
    }
  }
  if (plan.impliedApps.length > 0) {
    process.stdout.write("\nImplied application dependencies\n");
    for (const dependency of plan.impliedApps) {
      process.stdout.write(`  ${dependency.app} (required by ${dependency.requiredBy})\n`);
    }
  }
  process.stdout.write(`\nRequired skills\n  ${plan.requiredSkills.join("\n  ")}\n`);
  process.stdout.write(`\nApproval gates\n  ${plan.gates.join("\n  ")}\n`);
  process.stdout.write("\nAcceptance\n");
  for (const check of plan.acceptance) {
    process.stdout.write(`  - ${check}\n`);
  }
  process.stdout.write("\nUnresolved before apply\n");
  for (const decision of plan.unresolved) {
    process.stdout.write(`  - ${decision}\n`);
  }
  printPlainSummary(plan, projectContext);
}

async function ensureCatalog() {
  const catalog = await loadCatalog();
  const validation = validateCatalog(catalog);
  if (!validation.valid) {
    throw new Error(`Catalog validation failed: ${validation.errors.join(" ")}`);
  }
  return { catalog, validation };
}

async function handleCatalog(action, args) {
  const parsed = parseArguments(args);
  const loaded = await ensureCatalog();
  if (action === "validate") {
    const counts = loaded.validation.counts;
    const summary = buildSimpleSummary({
      goal: "Validate the self-hosting catalog",
      outcome: `Validated ${counts.apps} applications and ${counts.stacks} goal stacks.`,
      verification: "catalog-validated",
      next: "Choose a goal or run the repository validator before publishing catalog changes."
    });
    if (parsed.flags.json) {
      printJson({ ...loaded.validation, summary });
      return;
    }
    process.stdout.write(`Catalog valid: ${counts.apps} apps, ${counts.stacks} stacks, ${counts.categories} categories, ${counts.skills} skills (${counts.adapters} adapters), ${counts.affiliates} affiliates.\n`);
    process.stdout.write(`Homarr coverage: ${counts.homarrStandardCovered}/${counts.homarrStandard} standard, ${counts.homarrSpecialCovered}/${counts.homarrSpecial} special, ${counts.homarrGaps} gaps.\n`);
    for (const warning of loaded.validation.warnings) {
      process.stdout.write(`Warning: ${warning}\n`);
    }
    printSimpleSummary(summary);
    return;
  }
  if (action === "menu") {
    const menu = catalogMenu(loaded.catalog);
    const summary = buildMenuSummary();
    if (parsed.flags.json) {
      printJson({ ...menu, summary });
      return;
    }
    printMenu(menu, summary);
    return;
  }
  if (action === "list") {
    if (parsed.flags.category) {
      const categoryExists = loaded.catalog.taxonomy.categories.some((category) => category.id === parsed.flags.category);
      if (!categoryExists) {
        throw new Error("Unknown category. Run catalog menu to list category IDs.");
      }
    }
    if (parsed.flags.support && !["managed", "guided", "discovery", "retired"].includes(parsed.flags.support)) {
      throw new Error("Support must be managed, guided, discovery, or retired.");
    }
    if (parsed.flags.tier && !["T0", "T1", "T2"].includes(parsed.flags.tier)) {
      throw new Error("Tier must be T0, T1, or T2.");
    }
    const apps = listApps(loaded.catalog, parsed.flags);
    const summaryOptions = {
      goal: "Browse self-hosted applications",
      outcome: `Listed ${apps.length} catalog application(s) matching the selected filters.`,
      next: "Review an application or choose a goal to build a read-only plan."
    };
    if (apps.length === 0) {
      summaryOptions.blockers = ["No applications matched the selected filters."];
      summaryOptions.next = "Change the filters or browse the goal menu.";
    }
    const summary = buildSimpleSummary(summaryOptions);
    if (parsed.flags.json) {
      printJson({ apps, summary });
      return;
    }
    printAppList(apps);
    printSimpleSummary(summary);
    return;
  }
  if (action === "search") {
    const query = parsed.positional.join(" ");
    if (!query) {
      throw new Error("catalog search requires words to search.");
    }
    const results = searchApps(loaded.catalog, query);
    const summaryOptions = {
      goal: "Search the self-hosting catalog",
      outcome: `Found ${results.length} catalog application match(es).`,
      next: "Review a matching application or choose a goal to build a read-only plan."
    };
    if (results.length === 0) {
      summaryOptions.blockers = ["No catalog applications matched the search words."];
      summaryOptions.next = "Try broader words or browse the goal menu.";
    }
    const summary = buildSimpleSummary(summaryOptions);
    if (parsed.flags.json) {
      printJson({ results, summary });
      return;
    }
    printAppList(results, true);
    printSimpleSummary(summary);
    return;
  }
  if (action === "show") {
    const query = parsed.positional.join(" ");
    if (!query) {
      throw new Error("catalog show requires an application ID or exact alias.");
    }
    const app = findApp(loaded.catalog, query);
    if (!app) {
      throw new Error("Application not found. Use catalog search first.");
    }
    const purpose = catalogAppPurpose(loaded.catalog, app);
    const publicApp = { ...app, purpose };
    const summary = buildSimpleSummary({
      goal: `Review ${app.name}`,
      outcome: `Displayed the catalog facts, support level, alternatives, and cautions for ${app.name}.`,
      services: [{ id: app.id, name: app.name, role: "Catalog application", purpose, selection: "catalog" }],
      next: "Compare alternatives or choose a goal before planning host changes."
    });
    if (parsed.flags.json) {
      printJson({ app: publicApp, summary });
      return;
    }
    printApp(app, purpose);
    printSimpleSummary(summary);
    return;
  }
  if (action === "homarr") {
    if (parsed.positional.length > 0) {
      throw new Error("catalog homarr does not accept positional arguments.");
    }
    if (parsed.flags.status && !["supported", "gap"].includes(parsed.flags.status)) {
      throw new Error("Homarr status must be supported or gap.");
    }
    const coverage = homarrCoverage(loaded.catalog, parsed.flags.status || null);
    const summary = buildSimpleSummary({
      goal: "Review Homarr integration coverage",
      outcome: `Displayed ${coverage.entries.length} Homarr coverage record(s).`,
      next: "Use a supported integration or research a listed gap before planning it."
    });
    if (parsed.flags.json) {
      printJson({ ...coverage, summary });
      return;
    }
    printHomarrCoverage(coverage);
    printSimpleSummary(summary);
    return;
  }
  throw new Error("Unknown catalog action.");
}

async function handleStack(action, args) {
  const parsed = parseArguments(args);
  const loaded = await ensureCatalog();
  const query = parsed.positional.join(" ");
  if (!query) {
    throw new Error("stack command requires a goal or natural-language request.");
  }
  const resolution = resolveStack(loaded.catalog, query);
  if (action === "resolve") {
    const summary = buildResolutionSummary(resolution, query, loaded.catalog);
    if (parsed.flags.json) {
      printJson({ ...resolution, summary });
    } else {
      printResolution(resolution, query, loaded.catalog);
      printResolutionEndSummary(summary);
    }
    if (!resolution.resolved) {
      process.exitCode = 2;
    }
    return;
  }
  if (action !== "plan") {
    throw new Error("Unknown stack action.");
  }
  if (!resolution.resolved) {
    const summary = buildResolutionSummary(resolution, query, loaded.catalog);
    if (parsed.flags.json) {
      printJson({ ...resolution, summary });
    } else {
      printResolution(resolution, query, loaded.catalog);
      printResolutionEndSummary(summary);
    }
    process.exitCode = 2;
    return;
  }
  const selections = parseSelections(parsed.flags.selections);
  const preferencePath = await preferencePathFromFlags(parsed.flags, "preferences");
  let preferences = null;
  if (preferencePath !== null) {
    const loadedPreferences = await loadPreferences(preferencePath, { allowMissing: true });
    preferences = loadedPreferences.document;
  }
  let effectiveSelections = selections;
  let projectContext = null;
  if (parsed.flags["project-root"]) {
    const statePath = await projectStatePathForProjectRoot(parsed.flags["project-root"]);
    const saved = await loadProjectState(statePath, { allowMissing: true });
    if (saved.exists) {
      if (saved.document.goalId !== resolution.stack.id) {
        throw new Error("This project root already records a different goal. Use project resume or choose another project root.");
      }
      effectiveSelections = { ...saved.document.selections, ...selections };
      const currentPlan = buildPlan(loaded.catalog, resolution.stack, effectiveSelections, preferences);
      projectContext = projectFreshness(saved.document, currentPlan);
    }
  }
  const plan = buildPlan(loaded.catalog, resolution.stack, effectiveSelections, preferences);
  if (projectContext) {
    plan.projectContext = projectContext;
  }
  if (parsed.flags.json) {
    printJson(plan);
    return;
  }
  printPlan(plan, projectContext);
}

function requireProjectRoot(flags) {
  if (!flags["project-root"]) {
    throw new Error("Project commands require --project-root ABSOLUTE.");
  }
  if (flags.path || flags.preferences) {
    throw new Error("Project commands use only --project-root, not --path or --preferences.");
  }
  return flags["project-root"];
}

async function loadRecordedProject(catalog, projectRoot) {
  const statePath = await projectStatePathForProjectRoot(projectRoot);
  const saved = await loadProjectState(statePath);
  const stack = catalog.stacks.find((candidate) => candidate.id === saved.document.goalId);
  if (!stack) {
    throw new Error("The recorded project goal is no longer available in the current catalog.");
  }
  const preferencePath = await preferencesPathForProjectRoot(projectRoot);
  const loadedPreferences = await loadPreferences(preferencePath, { allowMissing: true });
  const plan = buildPlan(catalog, stack, saved.document.selections, loadedPreferences.document);
  plan.summary.outcome = `Rebuilt the read-only plan for ${stack.name} from saved service choices.`;
  const projectContext = projectFreshness(saved.document, plan);
  plan.projectContext = projectContext;
  return { statePath, saved, plan, projectContext };
}

function checkpointNextStep(stage) {
  if (stage === "inspected") {
    return "Review the refreshed plan and record the planned checkpoint only after its choices and ownership are clear.";
  }
  if (stage === "planned") {
    return "Get approval for the exact project, then apply only through the capability that owns the change.";
  }
  if (stage === "applied") {
    return "Run independent acceptance checks, then record verified only with a verification evidence ID.";
  }
  return "On the next visit, resume from this project root and re-inspect the host before trusting the saved result.";
}

async function handleProject(action, args) {
  const parsed = parseArguments(args);
  const projectRoot = requireProjectRoot(parsed.flags);
  const loaded = await ensureCatalog();
  if (action === "init" || action === "revise") {
    const query = parsed.positional.join(" ");
    if (!query) {
      throw new Error(`project ${action} requires a goal or natural-language request.`);
    }
    if (parsed.flags.evidence.length > 0) {
      throw new Error(`project ${action} does not accept evidence IDs.`);
    }
    const resolution = resolveStack(loaded.catalog, query);
    if (!resolution.resolved) {
      const summary = buildResolutionSummary(resolution, query, loaded.catalog);
      if (parsed.flags.json) {
        printJson({ ...resolution, summary });
      } else {
        printResolution(resolution, query, loaded.catalog);
        printResolutionEndSummary(summary);
      }
      process.exitCode = 2;
      return;
    }
    let selections = parseSelections(parsed.flags.selections);
    const statePath = await projectStatePathForProjectRoot(projectRoot);
    let expectedRevision = null;
    if (action === "revise") {
      const existing = await loadProjectState(statePath);
      if (existing.document.goalId !== resolution.stack.id) {
        throw new Error("A project record cannot be reassigned to a different goal. Use a different project root.");
      }
      expectedRevision = existing.document.revision;
      selections = { ...existing.document.selections, ...selections };
    }
    const preferencePath = await preferencesPathForProjectRoot(projectRoot);
    const loadedPreferences = await loadPreferences(preferencePath, { allowMissing: true });
    const plan = buildPlan(loaded.catalog, resolution.stack, selections, loadedPreferences.document);
    let saved;
    if (action === "init") {
      saved = await initProjectState(statePath, plan);
    } else {
      saved = await reviseProjectState(statePath, plan, expectedRevision);
    }
    const projectContext = projectFreshness(saved.document, plan);
    plan.projectContext = projectContext;
    let status = "saved";
    let result = "Recorded the chosen goal and services so a later run can resume them.";
    let changed = "Only .selfhost/project.json was created; the host and its services were not changed.";
    if (saved.ignoreCreated) {
      changed = "Only .selfhost/project.json and its local .gitignore were created; the host and its services were not changed.";
    }
    if (action === "revise") {
      if (saved.updated) {
        result = "Updated the saved service choices and reset old progress so it cannot be mistaken for current proof.";
        changed = "Only .selfhost/project.json was updated; the host and its services were not changed.";
        if (saved.ignoreCreated) {
          changed = "Updated .selfhost/project.json and created its local .gitignore; the host and its services were not changed.";
        }
      } else if (saved.ignoreCreated) {
        status = "local-ignore-added";
        result = "The saved goal and services already matched, so prior progress was kept; the missing local ignore rule was added.";
        changed = "Only .selfhost/.gitignore was created; the host and its services were not changed.";
      } else {
        status = "unchanged";
        result = "The saved goal and service choices already matched, so prior progress was kept.";
        changed = "Nothing was changed.";
      }
    }
    const next = "Inspect the current host and prove ownership before reusing or changing anything.";
    let structuredChange = changed;
    if (status === "unchanged") {
      structuredChange = null;
    }
    const commandSummary = buildCommandSummary(plan, { outcome: result, changed: structuredChange, next });
    if (parsed.flags.json) {
      printJson({ status, localIgnoreCreated: saved.ignoreCreated, state: publicProjectState(saved.document), plan, projectContext, commandSummary });
      return;
    }
    if (status === "saved") {
      process.stdout.write("Saved secret-free project context.\n");
    } else if (status === "local-ignore-added") {
      process.stdout.write("Saved the missing local ignore rule.\n");
    } else {
      process.stdout.write("Project context already matched.\n");
    }
    printPlainSummary(plan, projectContext, {
      result,
      changed,
      next
    });
    return;
  }

  if (parsed.flags.selections.length > 0) {
    throw new Error("Only project init and project revise accept role selections.");
  }
  const recorded = await loadRecordedProject(loaded.catalog, projectRoot);
  if (action === "status") {
    if (parsed.positional.length > 0 || parsed.flags.evidence.length > 0) {
      throw new Error("project status accepts no goal, checkpoint, or evidence IDs.");
    }
    if (parsed.flags.json) {
      const commandSummary = buildCommandSummary(recorded.plan, {
        outcome: "Loaded the saved goal, services, and progress record.",
        next: "Resume the project, then inspect the current host before deciding what can be reused."
      });
      printJson({
        status: "saved-context-only",
        state: publicProjectState(recorded.saved.document),
        summary: commandSummary,
        projectContext: recorded.projectContext
      });
      return;
    }
    printPlainSummary(recorded.plan, recorded.projectContext, {
      result: "Loaded the saved goal, services, and progress record.",
      next: "Resume the project, then inspect the current host before deciding what can be reused."
    });
    return;
  }
  if (action === "resume") {
    if (parsed.positional.length > 0 || parsed.flags.evidence.length > 0) {
      throw new Error("project resume accepts no goal, checkpoint, or evidence IDs.");
    }
    if (parsed.flags.json) {
      printJson(recorded.plan);
      return;
    }
    printPlan(recorded.plan, recorded.projectContext);
    return;
  }
  if (action === "checkpoint") {
    if (parsed.positional.length !== 1) {
      throw new Error("project checkpoint requires exactly one stage.");
    }
    const stage = parsed.positional[0];
    const updated = await checkpointProjectState(
      recorded.statePath,
      stage,
      parsed.flags.evidence,
      recorded.plan,
      recorded.saved.document.revision
    );
    const projectContext = projectFreshness(updated.document, recorded.plan);
    let result = `Recorded the ${stage} checkpoint; this command did not perform that work.`;
    if (parsed.flags.evidence.length > 0) {
      result = `Recorded the ${stage} checkpoint from the supplied evidence IDs; this command did not perform that work.`;
    }
    let changed = "Only .selfhost/project.json was updated; no host service was changed.";
    if (updated.ignoreCreated) {
      changed = "Updated .selfhost/project.json and created its local .gitignore; no host service was changed.";
    }
    const next = checkpointNextStep(stage);
    if (parsed.flags.json) {
      const commandSummary = buildCommandSummary(recorded.plan, { outcome: result, changed, next });
      printJson({
        status: "checkpoint-recorded",
        localIgnoreCreated: updated.ignoreCreated,
        state: publicProjectState(updated.document),
        summary: commandSummary,
        projectContext
      });
      return;
    }
    printPlainSummary(recorded.plan, projectContext, {
      result,
      changed,
      next
    });
    return;
  }
  throw new Error("Unknown project action.");
}

async function handlePreferences(action, args) {
  const parsed = parseArguments(args);
  const path = await preferencePathFromFlags(parsed.flags, "path");
  if (path === null) {
    throw new Error("Preferences commands require --project-root ABSOLUTE or --path ABSOLUTE.");
  }
  if (action === "init") {
    const result = await initPreferences(path);
    const output = { path: result.path, created: result.created, mode: "0600" };
    if (parsed.flags["project-root"]) {
      output.directoryMode = "0700";
    } else {
      output.directoryMode = "not-managed-for-explicit-path";
    }
    const changed = [];
    let outcome = "Validated the existing non-secret preference file.";
    if (result.created) {
      changed.push("Created the local non-secret preference file.");
      outcome = "Created an empty non-secret preference file.";
    }
    if (result.ignoreCreated) {
      changed.push("Created the local .selfhost ignore rule.");
    }
    const summary = buildSimpleSummary({
      goal: "Remember non-secret project choices",
      outcome,
      changed,
      verification: "local-preferences-validated",
      next: "Record only confirmed non-secret choices, or continue to the read-only plan."
    });
    if (parsed.flags.json) {
      printJson({ ...output, summary });
      return;
    }
    process.stdout.write(`${result.created ? "Created" : "Validated"} non-secret preferences at ${result.path}.\n`);
    printSimpleSummary(summary);
    return;
  }
  if (action === "show") {
    const loaded = await loadPreferences(path, { allowMissing: true });
    const output = { path: loaded.path, exists: loaded.exists, ...publicPreferences(loaded.document) };
    const choiceCount = Object.keys(output.choices).length;
    let outcome = "No preference file exists; this project has no confirmed remembered choices.";
    let verification = "not-run-by-router";
    if (loaded.exists) {
      outcome = `Loaded ${choiceCount} confirmed non-secret project choice(s).`;
      verification = "local-preferences-validated";
    }
    const summary = buildSimpleSummary({
      goal: "Review remembered project choices",
      outcome,
      rememberedChoices: choiceCount,
      verification,
      next: "Confirm or change these choices before building the current plan."
    });
    if (parsed.flags.json) {
      printJson({ ...output, summary });
      return;
    }
    process.stdout.write(`Preferences: ${loaded.path}${loaded.exists ? "" : " (not created)"}\n`);
    const entries = Object.entries(output.choices);
    if (entries.length === 0) {
      process.stdout.write("  No confirmed choices.\n");
      printSimpleSummary(summary);
      return;
    }
    for (const [field, record] of entries) {
      process.stdout.write(`  ${field}: ${JSON.stringify(record.value)} [${record.source}]\n`);
    }
    printSimpleSummary(summary);
    return;
  }
  if (action === "set") {
    if (parsed.positional.length !== 2) {
      throw new Error("preferences set requires exactly a field and value.");
    }
    const result = await setPreference(parsed.positional[0], parsed.positional[1], path);
    const output = { path: result.path, field: result.field, updated: result.updated };
    const changed = [`Updated ${result.field} in the local non-secret preference file.`];
    if (result.ignoreCreated) {
      changed.push("Created the local .selfhost ignore rule.");
    }
    const summary = buildSimpleSummary({
      goal: "Remember a non-secret project choice",
      outcome: `Saved the confirmed ${result.field} choice.`,
      changed,
      verification: "local-preferences-validated",
      next: "Rebuild the read-only plan so it uses the confirmed choice."
    });
    if (parsed.flags.json) {
      printJson({ ...output, summary });
      return;
    }
    process.stdout.write(`Updated ${result.field} in ${result.path}.\n`);
    printSimpleSummary(summary);
    return;
  }
  if (action === "validate") {
    const loaded = await loadPreferences(path, { allowMissing: true });
    const validation = validatePreferencesDocument(loaded.document);
    const output = { path: loaded.path, exists: loaded.exists, ...validation };
    const choiceCount = Object.keys(loaded.document.choices).length;
    let outcome = "The missing preference file is treated as an empty choice set.";
    let verification = "not-run-by-router";
    if (loaded.exists) {
      outcome = `Validated ${choiceCount} confirmed non-secret project choice(s).`;
      verification = "local-preferences-validated";
    }
    const summary = buildSimpleSummary({
      goal: "Validate remembered project choices",
      outcome,
      rememberedChoices: choiceCount,
      verification,
      next: "Build or resume the read-only plan with these choices."
    });
    if (parsed.flags.json) {
      printJson({ ...output, summary });
      return;
    }
    if (validation.valid) {
      process.stdout.write(`Preferences valid: ${loaded.path}${loaded.exists ? "" : " (empty, not created)"}.\n`);
      printSimpleSummary(summary);
      return;
    }
    throw new Error(`Preferences validation failed: ${validation.errors.join(" ")}`);
  }
  throw new Error("Unknown preferences action.");
}

async function main() {
  const [group, action, ...args] = process.argv.slice(2);
  if (!group || group === "help" || group === "--help" || group === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!action) {
    throw new Error(`${group} requires an action.\n\n${usage()}`);
  }
  if (group === "catalog") {
    await handleCatalog(action, args);
    return;
  }
  if (group === "stack") {
    await handleStack(action, args);
    return;
  }
  if (group === "preferences") {
    await handlePreferences(action, args);
    return;
  }
  if (group === "project") {
    await handleProject(action, args);
    return;
  }
  throw new Error(`Unknown command group.\n\n${usage()}`);
}

main().catch((error) => {
  let message = "Selfhost command failed.";
  if (error instanceof PreferenceError || error instanceof ProjectStateError || error instanceof Error) {
    message = error.message;
  }
  const shortMessage = message.split("\n", 1)[0];
  const summary = {
    goal: { id: null, name: "Not completed" },
    outcome: "The command stopped before it could finish.",
    services: [],
    rememberedChoices: 0,
    currentHost: "not-inspected-by-router",
    changed: [],
    changeStatus: "no-host-change-local-state-unknown",
    unchanged: ["The router did not attempt a host service change."],
    blockers: [shortMessage],
    verification: "not-run-by-router",
    next: "Correct the reported problem, inspect local project state if this was a state update, and retry."
  };
  if (process.argv.includes("--json")) {
    process.stderr.write(`${JSON.stringify({ status: "blocked", summary }, null, 2)}\n`);
  } else {
    process.stderr.write(`${message}\n\nSummary\n`);
    process.stderr.write("  Goal: not completed.\n");
    process.stderr.write("  What happened: the command stopped before it could finish.\n");
    process.stderr.write("  Services: none were selected by this failed command.\n");
    process.stderr.write("  Current setup: the host was not inspected.\n");
    process.stderr.write("  Verification: no acceptance checks were run.\n");
    process.stderr.write(`  Blocked: ${shortMessage}\n`);
    process.stderr.write("  Changed: no host service change was attempted; inspect local project state if this failed during a state update.\n");
    process.stderr.write(`  Next: ${summary.next}\n`);
  }
  process.exitCode = 1;
});
