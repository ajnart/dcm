#!/usr/bin/env node

import {
  buildPlan,
  catalogMenu,
  findApp,
  listApps,
  loadCatalog,
  resolveStack,
  searchApps,
  validateCatalog
} from "./catalog.mjs";
import {
  DEFAULT_PREFERENCES_PATH,
  PreferenceError,
  initPreferences,
  loadPreferences,
  publicPreferences,
  setPreference,
  validatePreferencesDocument
} from "./preferences.mjs";

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
  catalog validate [--json]

Stacks:
  stack resolve <goal...> [--json]
  stack plan <goal...> [--select role=app] [--preferences PATH] [--json]

Non-secret preferences:
  preferences init [--path PATH] [--json]
  preferences show [--path PATH] [--json]
  preferences set <field> <value> [--path PATH] [--json]
  preferences validate [--path PATH] [--json]`;
}

function parseArguments(input) {
  const flags = { json: false, selections: [] };
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
    const supported = new Set(["--path", "--preferences", "--category", "--support", "--tier", "--select"]);
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

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printMenu(menu) {
  process.stdout.write(`Selfhost goals (catalog checked ${menu.checkedAt})\n`);
  for (const goal of menu.goals) {
    process.stdout.write(`  ${goal.id.padEnd(18)} ${goal.summary}\n`);
  }
  process.stdout.write("\nCategories\n");
  for (const category of menu.categories) {
    process.stdout.write(`  ${category.id.padEnd(18)} ${String(category.apps).padStart(2)} apps\n`);
  }
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

function printApp(app) {
  process.stdout.write(`${app.name} (${app.id})\n`);
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

function printResolution(result) {
  if (!result.resolved) {
    if (result.ambiguous) {
      process.stdout.write("Goal is ambiguous. Choose one:\n");
      for (const candidate of result.candidates) {
        process.stdout.write(`  ${candidate.id} — ${candidate.name}\n`);
      }
      return;
    }
    process.stdout.write("No goal matched. Run catalog menu or search the app catalog.\n");
    return;
  }
  process.stdout.write(`Resolved ${result.stack.id} via "${result.matched}".\n`);
  process.stdout.write(`${result.stack.summary}\n`);
}

function printPlan(plan) {
  process.stdout.write(`Read-only plan ${plan.planId}: ${plan.goal.name}\n`);
  process.stdout.write(`${plan.goal.summary}\n\nRoles\n`);
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
  process.stdout.write("\nNo host changes were made.\n");
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
    if (parsed.flags.json) {
      printJson(loaded.validation);
      return;
    }
    const counts = loaded.validation.counts;
    process.stdout.write(`Catalog valid: ${counts.apps} apps, ${counts.stacks} stacks, ${counts.categories} categories, ${counts.affiliates} affiliates.\n`);
    for (const warning of loaded.validation.warnings) {
      process.stdout.write(`Warning: ${warning}\n`);
    }
    return;
  }
  if (action === "menu") {
    const menu = catalogMenu(loaded.catalog);
    if (parsed.flags.json) {
      printJson(menu);
      return;
    }
    printMenu(menu);
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
    if (parsed.flags.json) {
      printJson(apps);
      return;
    }
    printAppList(apps);
    return;
  }
  if (action === "search") {
    const query = parsed.positional.join(" ");
    if (!query) {
      throw new Error("catalog search requires words to search.");
    }
    const results = searchApps(loaded.catalog, query);
    if (parsed.flags.json) {
      printJson(results);
      return;
    }
    printAppList(results, true);
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
    if (parsed.flags.json) {
      printJson(app);
      return;
    }
    printApp(app);
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
    if (parsed.flags.json) {
      printJson(resolution);
      return;
    }
    printResolution(resolution);
    if (!resolution.resolved) {
      process.exitCode = 2;
    }
    return;
  }
  if (action !== "plan") {
    throw new Error("Unknown stack action.");
  }
  if (!resolution.resolved) {
    if (parsed.flags.json) {
      printJson(resolution);
    } else {
      printResolution(resolution);
    }
    process.exitCode = 2;
    return;
  }
  const selections = parseSelections(parsed.flags.selections);
  const preferencePath = parsed.flags.preferences || DEFAULT_PREFERENCES_PATH;
  const preferences = await loadPreferences(preferencePath, { allowMissing: true });
  const plan = buildPlan(loaded.catalog, resolution.stack, selections, preferences.document);
  if (parsed.flags.json) {
    printJson(plan);
    return;
  }
  printPlan(plan);
}

async function handlePreferences(action, args) {
  const parsed = parseArguments(args);
  const path = parsed.flags.path || DEFAULT_PREFERENCES_PATH;
  if (action === "init") {
    const result = await initPreferences(path);
    const output = { path: result.path, created: result.created, mode: "0600", directoryMode: "0700" };
    if (parsed.flags.json) {
      printJson(output);
      return;
    }
    process.stdout.write(`${result.created ? "Created" : "Validated"} non-secret preferences at ${result.path}.\n`);
    return;
  }
  if (action === "show") {
    const loaded = await loadPreferences(path, { allowMissing: true });
    const output = { path: loaded.path, exists: loaded.exists, ...publicPreferences(loaded.document) };
    if (parsed.flags.json) {
      printJson(output);
      return;
    }
    process.stdout.write(`Preferences: ${loaded.path}${loaded.exists ? "" : " (not created)"}\n`);
    const entries = Object.entries(output.choices);
    if (entries.length === 0) {
      process.stdout.write("  No confirmed choices.\n");
      return;
    }
    for (const [field, record] of entries) {
      process.stdout.write(`  ${field}: ${JSON.stringify(record.value)} [${record.source}]\n`);
    }
    return;
  }
  if (action === "set") {
    if (parsed.positional.length !== 2) {
      throw new Error("preferences set requires exactly a field and value.");
    }
    const result = await setPreference(parsed.positional[0], parsed.positional[1], path);
    const output = { path: result.path, field: result.field, updated: result.updated };
    if (parsed.flags.json) {
      printJson(output);
      return;
    }
    process.stdout.write(`Updated ${result.field} in ${result.path}.\n`);
    return;
  }
  if (action === "validate") {
    const loaded = await loadPreferences(path, { allowMissing: true });
    const validation = validatePreferencesDocument(loaded.document);
    const output = { path: loaded.path, exists: loaded.exists, ...validation };
    if (parsed.flags.json) {
      printJson(output);
      return;
    }
    if (validation.valid) {
      process.stdout.write(`Preferences valid: ${loaded.path}${loaded.exists ? "" : " (empty, not created)"}.\n`);
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
  throw new Error(`Unknown command group.\n\n${usage()}`);
}

main().catch((error) => {
  let message = "Selfhost command failed.";
  if (error instanceof PreferenceError || error instanceof Error) {
    message = error.message;
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
