import { confirm, note, outro, text } from "@clack/prompts";
import { isAbsolute, resolve } from "node:path";
import { bundledSharedRecipeChoices } from "../interactive-catalog.ts";
import { pickCatalogApps, type CatalogPickerItem } from "./catalog-picker.ts";
import { collectSharedSetupInputArgs, setupInputValueError, sharedSetupStepBatch,
  sharedSetupOutcomeRecap } from "./shared-setup-inputs.ts";
import { dashboardRecap } from "./dashboard-recap.ts";
import { collectSharedInstallInputArgs, installInputError } from "./shared-install-inputs.ts";
import { runSharedConnections, sharedConnectionPairs } from "./shared-connections.ts";

type CliReport = Record<string, unknown>;
type Dependencies = {
  invoke: (args: string[]) => { data?: Record<string, unknown> };
  runJsonCli: (args: string[], progress: string) => Promise<CliReport>;
  stopIfCancelled: <T>(value: T | symbol) => T;
  offerHomarrMcp?: (root: string, url: string, projectId?: string) => Promise<void>;
};
type SetupDependencies = Pick<Dependencies, "runJsonCli" | "stopIfCancelled" | "offerHomarrMcp">;

function report(value: unknown, command: string, status: string, pendingStatus?: string): CliReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${command} returned an invalid result`);
  }
  const result = value as CliReport;
  if (result.command !== command || (result.status !== status
    && (pendingStatus === undefined || result.status !== pendingStatus))) {
    throw new Error(`${command} did not reach ${status}; inspect the saved project before retrying`);
  }
  return result;
}

function prestartPending(value: CliReport, root: string, projectId: string): boolean {
  if (value.status !== "prepared-prestart") return false;
  if (!Array.isArray(value.prestart) || value.prestart.length === 0 || value.prestart.length > 200) {
    throw new Error("Prepared shared project returned invalid pre-start requirements");
  }
  const lines: string[] = [];
  for (const entry of value.prestart) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Prepared shared project returned invalid pre-start requirements");
    }
    const contract = entry as CliReport;
    if (typeof contract.appId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(contract.appId)
      || !Array.isArray(contract.effects) || contract.effects.length > 32
      || contract.effects.some((effect) => typeof effect !== "string" || !effect.length || effect.length > 2048)) {
      throw new Error("Prepared shared project returned invalid pre-start requirements");
    }
    lines.push(`${contract.appId}: ${contract.effects.join("; ") || "fresh pre-start verification required"}`);
  }
  note(`Saved owner: ${root} (${projectId}). Selected services have not started.\n`
    + `${lines.join("\n")}\n`
    + `Review self-host app shared status --project-root ${root} --project-id ${projectId}.\n`
    + "Complete the separately approved prerequisites, then choose Resume prepared project in the saved control panel. Setup and Homarr publication remain pending; reuse this saved owner.",
  "Prepared — pre-start requirements pending");
  return true;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
    throw new Error("Shared project returned invalid app IDs");
  }
  return value as string[];
}

function approval(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9-]*:[a-z0-9_-]+:[0-9a-f]{64}$/.test(value)) {
    throw new Error("Shared project returned an invalid approval token");
  }
  return value;
}

function portMapMatches(value: unknown, expected: Record<string, number | null>): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(Object.entries(value).sort()) === JSON.stringify(Object.entries(expected).sort());
}

function additionalPublishedPortRecap(value: unknown, selected: readonly string[]): string {
  if (value === undefined) return "none";
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...selected].sort())) {
    throw new Error("Additional published ports differ from the selected app inventory");
  }
  const lines: string[] = [];
  for (const [appId, ports] of Object.entries(value)) {
    if (!ports || typeof ports !== "object" || Array.isArray(ports)) {
      throw new Error("Additional published port review is invalid");
    }
    for (const [portId, port] of Object.entries(ports)) {
      if (!/^[a-z][a-z0-9-]{0,47}$/.test(portId) || typeof port !== "number"
        || !Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error("Additional published port review is invalid");
      }
      lines.push(`${appId}.${portId}=127.0.0.1:${port}/tcp`);
    }
  }
  return lines.sort().join(", ") || "none";
}

async function ownerSecretFileArgs(value: unknown, stopIfCancelled: Dependencies["stopIfCancelled"]): Promise<string[]> {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string"
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))) {
    throw new Error("Shared project returned invalid owner secret IDs");
  }
  const args: string[] = [];
  for (const id of value as string[]) {
    const path = stopIfCancelled(await text({ message: `Owner-only mode-0600 secret file for ${id}`,
      placeholder: "/absolute/path/to/private/file",
      validate: (input) => !isAbsolute(input) || resolve(input) !== input
        ? "Enter one exact absolute path; the CLI checks ownership and mode 0600" : undefined }));
    args.push("--secret-file", `${id}=${path}`);
  }
  return args;
}

/** The default new-project path compiles the selected app folders into one Compose owner. */
export async function createSharedProject(root: string, dependencies: Dependencies,
  initialAppIds?: readonly string[]): Promise<boolean | "pending-prestart"> {
  const { invoke, runJsonCli, stopIfCancelled } = dependencies;
  const listed = invoke(["catalog", "list"]).data?.apps;
  const recipes = bundledSharedRecipeChoices(invoke(["catalog", "recipes"]).data ?? {}, listed);
  const choiceById = new Map(recipes.map((choice) => [choice.appId, choice]));
  const items: CatalogPickerItem[] = recipes.map((choice) => ({
    id: choice.appId, name: choice.name, description: choice.purpose,
    selected: initialAppIds?.includes(choice.appId) ?? choice.appId === "homarr",
  }));
  if (!Array.isArray(listed) || listed.length > 200) throw new Error("The bundled catalog is not reviewable");
  for (const value of listed) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const app = value as { id?: unknown; name?: unknown };
    if (typeof app.id !== "string" || typeof app.name !== "string" || choiceById.has(app.id)) continue;
    items.push({ id: app.id, name: app.name, description: "Discovery only — no shared Compose recipe",
      selected: false, installable: false });
  }
  items.sort((left, right) => left.name.localeCompare(right.name));
  let selected: string[] | null;
  if (initialAppIds === undefined) selected = await pickCatalogApps(items);
  else {
    if (new Set(initialAppIds).size !== initialAppIds.length || initialAppIds.some((id) => !choiceById.has(id))) {
      throw new Error("Goal selection differs from the shared recipe catalog");
    }
    const customize = stopIfCancelled(await confirm({ message: "Customize the recommended apps?", initialValue: false }));
    selected = [...initialAppIds];
    if (customize) {
      selected = await pickCatalogApps(items);
      note("These apps replace the recommendation. The original goal may no longer be fully covered.", "Customized selection");
    }
  }
  if (selected === null || selected.length === 0) return false;

  const projectId = "selfhost";
  const usedPorts = new Set<number>();
  const selectedPorts: Array<{ id: string; port: number }> = [];
  for (const id of selected) {
    const choice = choiceById.get(id);
    if (!choice) throw new Error(`${id} has no shared Compose recipe`);
    if (choice.manualJob || choice.connector || choice.kind === "shared-derived-compose") continue;
    let port = choice.defaultPort;
    if (port === null) throw new Error(`${id} has no private frontend port`);
    while (usedPorts.has(port) && port <= 65535) port += 1;
    if (port > 65535) throw new Error("No distinct private port remains for this app selection");
    usedPorts.add(port);
    selectedPorts.push({ id, port });
  }
  const argumentsBase = ["app", "shared", "--project-root", root, "--project-id", projectId,
    ...selected.flatMap((id) => ["--app", id]),
    ...selectedPorts.map((item) => ["--port", `${item.id}=${item.port}`])];
  argumentsBase.push(...await collectSharedInstallInputArgs(recipes, selected, async (appId, field) =>
    stopIfCancelled(await text({ message: `${appId}: ${field.label}`, validate: (value) => installInputError(value, field) }))));
  const plan = report(await runJsonCli(["app", "shared", "plan", ...argumentsBase.slice(2), "--json"],
    "Checking the host and compiling one Compose project"), "app shared plan", "review");
  if (JSON.stringify(ids(plan.apps)) !== JSON.stringify([...selected].sort())) {
    throw new Error("Shared project plan changed the selected apps");
  }
  const setup = plan.setup as { direct?: unknown; pending?: unknown } | undefined;
  const direct = ids(setup?.direct);
  const pending = ids(setup?.pending);
  const generatedIds = selected.filter((id) => choiceById.get(id)?.kind === "shared-derived-compose");
  if (generatedIds.length > 0 && plan.publishedPorts === undefined) {
    throw new Error("Generated installation needs the complete published-port review");
  }
  const plannedPorts = plan.ports as Record<string, unknown> | undefined;
  const generatedPorts: Array<{ id: string; port: number }> = [];
  for (const id of generatedIds) {
    const port = plannedPorts?.[id];
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1024 || port > 65535 || usedPorts.has(port)) {
      throw new Error("Generated installation plan has no distinct private frontend port");
    }
    usedPorts.add(port);
    generatedPorts.push({ id, port });
  }
  note(`One Compose project: ${selected.join(", ")}\n` +
    `Private ports: ${[...selectedPorts, ...generatedPorts].map((item) => `${item.id}=${item.port}`).join(", ")}\n` +
    `Additional private ports: ${additionalPublishedPortRecap(plan.publishedPorts, selected)}\n` +
    `Manual jobs: ${selected.filter((id) => choiceById.get(id)?.manualJob).join(", ") || "none"} (prepared, not executed)\n` +
    `Private connectors: ${selected.filter((id) => choiceById.get(id)?.connector).join(", ") || "none"} (daemon only; enrollment and routing need separate approval)\n` +
    `Scripted first run: ${direct.join(", ") || "none"}\n` +
    `Setup still pending: ${pending.join(", ") || "none"}`,
  "Review shared project");
  const approved = stopIfCancelled(await confirm({
    message: "Create this exact shared Compose project?", initialValue: false,
  }));
  if (!approved) return false;
  const secretArgs = await ownerSecretFileArgs(plan.ownerSecretIds, stopIfCancelled);
  const created = report(await runJsonCli(["app", "shared", "apply", ...argumentsBase.slice(2),
    ...secretArgs, "--approve", approval(plan.approval), "--json"], "Creating the shared Compose project"),
  "app shared apply", "applied-unverified", "prepared-prestart");
  if (JSON.stringify(ids(created.apps)) !== JSON.stringify([...selected].sort())) {
    throw new Error("Shared Compose apply returned a different app selection");
  }
  if (generatedIds.length > 0 && JSON.stringify(created.ports) !== JSON.stringify(plan.ports)) {
    throw new Error("Generated installation ports differ from their reviewed plan");
  }
  if (JSON.stringify(created.publishedPorts) !== JSON.stringify(plan.publishedPorts)) {
    throw new Error("Additional generated ports differ from their reviewed plan");
  }
  if (prestartPending(created, root, projectId)) return "pending-prestart";

  if (direct.length > 0) await runSharedFirstRun(root, projectId, selected, dependencies);
  if (selected.includes("homarr")) {
    try { await runSharedHomarr(root, projectId, selected, dependencies); }
    catch {
      note("The shared stack remains saved. Homarr publication remains pending; retry from Set up Homarr dashboard. App accounts and setup checkpoints are retained.",
        "Homarr setup pending");
    }
  }
  outro(`Shared project saved at ${root}. Run self-host app shared status --project-root ${root} --project-id ${projectId} to review it. Data is preserved on restart.`);
  return true;
}

export function sharedRemovedAppChoices(status: CliReport, root: string, projectId: string,
  installed: readonly string[]): Map<string, "reviewable" | "needs-inspection"> {
  if (status.command !== "app shared status" || status.projectRoot !== root || status.projectId !== projectId
    || status.status !== "completed" || status.mutation !== false
    || JSON.stringify([...ids(status.apps)].sort()) !== JSON.stringify([...installed].sort())
    || !Array.isArray(status.removedApps) || status.removedApps.length > 200) {
    throw new Error("Removed app review differs from the selected shared owner");
  }
  const choices = new Map<string, "reviewable" | "needs-inspection">();
  for (const value of status.removedApps) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Removed app review is invalid");
    const row = value as CliReport;
    if (typeof row.appId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.appId)
      || installed.includes(row.appId) || choices.has(row.appId)
      || (row.status !== "reviewable" && row.status !== "needs-inspection")) throw new Error("Removed app review is invalid");
    choices.set(row.appId, row.status);
  }
  return choices;
}

/** Restore one removed unit without first-account setup or credential regeneration. */
export async function reinstallSharedProjectApp(root: string, projectId: string, appId: string,
  installed: readonly string[], dependencies: SetupDependencies): Promise<{ id: string; url: string | null; publishedPort: number | null } | null> {
  const args = ["app", "shared", "reinstall", "--project-root", root, "--project-id", projectId, "--app", appId];
  let reviewed: CliReport;
  try {
    reviewed = report(await dependencies.runJsonCli([...args, "--json"], "Reviewing preserved app restoration"),
      "app shared reinstall", "review");
  } catch {
    note(`${appId} restoration needs inspection. No restore was applied; keep its preserved data and credentials.`, "Restore pending");
    return null;
  }
  function exact(value: CliReport, mutation: boolean) {
    if (value.projectRoot !== root || value.projectId !== projectId || value.appId !== appId
      || value.mutation !== mutation || value.dataPreserved !== true || value.credentialsRegenerated !== false
      || value.accountSetupExecuted !== false || value.acceptanceVerified !== false
      || JSON.stringify([...ids(value.retained)].sort()) !== JSON.stringify([...installed].sort())
      || !Array.isArray(value.services) || value.services.length === 0
      || value.services.some((id) => typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))
      || !value.images || typeof value.images !== "object" || Array.isArray(value.images)
      || Object.keys(value.images).length === 0
      || Object.values(value.images).some((image) => typeof image !== "string" || image.length > 512
        || !/^[A-Za-z0-9][A-Za-z0-9./:_-]*@sha256:[0-9a-f]{64}$/.test(image))
      || (value.port !== null && (typeof value.port !== "number" || !Number.isInteger(value.port)
        || value.port < 1024 || value.port > 65535))) throw new Error("Shared reinstall differs from the selected app and owner");
  }
  exact(reviewed, false);
  const token = approval(reviewed.approval);
  if (!token.startsWith(`SHARED-REINSTALL:${projectId}:`)) throw new Error("Shared reinstall approval differs from its owner");
  note(`Restore: ${appId}\nRetain: ${installed.join(", ")}\nServices: ${ids(reviewed.services).join(", ")}\n`
    + `Images: ${Object.values(reviewed.images as Record<string, string>).join(", ")}\nPreserved port: ${reviewed.port ?? "none"}\n`
    + "Reuse preserved data, images, ports and credentials. No first-admin setup runs; existing login, app function and restart acceptance remain unverified.",
  "Review preserved app restoration");
  if (!dependencies.stopIfCancelled(await confirm({ message: `Restore only ${appId} with its preserved credentials?`, initialValue: false }))) return null;
  const restored = report(await dependencies.runJsonCli([...args, "--approve", token, "--json"], "Restoring the exact preserved app"),
    "app shared reinstall", "restored-unverified");
  exact(restored, true);
  if (JSON.stringify(restored.services) !== JSON.stringify(reviewed.services) || restored.port !== reviewed.port
    || JSON.stringify(restored.images) !== JSON.stringify(reviewed.images)) throw new Error("Shared reinstall differs from its reviewed resources");
  note(`${appId} restored. Verify its existing credentials and function separately; no account setup was executed.`, "Restored — unverified");
  const port = restored.port as number | null;
  // The next owner snapshot resolves the frontend; a preserved port is not a browser URL.
  return { id: appId, url: null, publishedPort: port };
}

/** Extend one completed shared owner; existing units and ports are read-only inputs. */
export async function addSharedProjectApps(root: string, projectId: string,
  existing: Array<{ id: string; url: string | null; publishedPort?: number | null }>, dependencies: Dependencies,
  initialAppIds?: readonly string[], configureNewApps = true): Promise<boolean> {
  const { invoke, runJsonCli, stopIfCancelled } = dependencies;
  const recipes = bundledSharedRecipeChoices(invoke(["catalog", "recipes"]).data ?? {}, invoke(["catalog", "list"]).data?.apps);
  const installed = new Set(existing.map((app) => app.id));
  const available = recipes.filter((choice) => !installed.has(choice.appId));
  if (available.length === 0) {
    note("No additional validated shared Compose recipes are available.", "No apps to add");
    return false;
  }
  const items = available.map((choice) => ({
    id: choice.appId, name: choice.name, description: choice.purpose, selected: false,
  }));
  let selected: string[] | null;
  if (initialAppIds === undefined) selected = await pickCatalogApps(items);
  else {
    if (new Set(initialAppIds).size !== initialAppIds.length
      || initialAppIds.some((id) => !available.some((choice) => choice.appId === id))) {
      throw new Error("Goal additions differ from the current shared recipe catalog");
    }
    selected = [...initialAppIds];
  }
  if (!selected?.length) return false;
  const currentStatus = await runJsonCli(["app", "shared", "status", "--project-root", root, "--project-id", projectId, "--json"],
    "Checking preserved app selections");
  const removed = sharedRemovedAppChoices(currentStatus, root, projectId, [...installed]);
  const restores = selected.filter((id) => removed.has(id)).sort();
  const blocked = restores.filter((id) => removed.get(id) !== "reviewable");
  if (blocked.length) {
    note(`Restoration needs inspection: ${blocked.join(", ")}. No additions or restores were applied.`, "Preserved apps pending");
    return false;
  }
  if (restores.length) {
    const retained = [...existing];
    for (const id of restores) {
      const restored = await reinstallSharedProjectApp(root, projectId, id, retained.map((app) => app.id), dependencies);
      if (!restored) return false;
      retained.push(restored);
    }
    const fresh = selected.filter((id) => !removed.has(id));
    if (!fresh.length) return true;
    return addSharedProjectApps(root, projectId, retained, dependencies, fresh, configureNewApps);
  }
  const selectedSorted = [...selected].sort();
  const choiceById = new Map(available.map((choice) => [choice.appId, choice]));
  const usedPorts = new Set<number>();
  for (const app of existing) {
    if (app.publishedPort !== null && app.publishedPort !== undefined) {
      if (!Number.isInteger(app.publishedPort) || app.publishedPort < 1024
        || app.publishedPort > 65535 || usedPorts.has(app.publishedPort)) {
        throw new Error(`Saved port for ${app.id} is invalid; inspect shared status before adding apps`);
      }
      usedPorts.add(app.publishedPort);
      continue;
    }
    if (!app.url && recipes.some((choice) => choice.appId === app.id && (choice.manualJob || choice.connector))) continue;
    if (!app.url) throw new Error(`Saved port for ${app.id} is unavailable; inspect shared status before adding apps`);
    const url = new URL(app.url);
    const port = Number(url.port);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1"
      || !Number.isInteger(port) || port < 1024 || port > 65535 || usedPorts.has(port)) {
      throw new Error(`Saved port for ${app.id} is invalid; inspect shared status before adding apps`);
    }
    usedPorts.add(port);
  }
  const ports: Record<string, number | null> = {};
  const generatedIds = selectedSorted.filter((id) => choiceById.get(id)?.kind === "shared-derived-compose");
  for (const id of selectedSorted) {
    const choice = choiceById.get(id);
    if (!choice) throw new Error(`${id} has no validated shared Compose recipe`);
    if (choice.manualJob || choice.connector) {
      ports[id] = null;
      continue;
    }
    if (choice.kind === "shared-derived-compose") continue;
    let port = choice.defaultPort;
    if (port === null) throw new Error(`${id} has no private frontend port`);
    while (usedPorts.has(port) && port <= 65535) port += 1;
    if (port > 65535) throw new Error("No distinct private port remains for this app selection");
    usedPorts.add(port);
    ports[id] = port;
  }
  const args = ["app", "shared", "add", "--project-root", root, "--project-id", projectId,
    ...selectedSorted.flatMap((id) => ["--app", id]),
    ...selectedSorted.filter((id) => Object.hasOwn(ports, id) && ports[id] !== null).flatMap((id) => ["--port", `${id}=${ports[id]}`])];
  args.push(...await collectSharedInstallInputArgs(recipes, selectedSorted, async (appId, field) =>
    stopIfCancelled(await text({ message: `${appId}: ${field.label}`, validate: (value) => installInputError(value, field) }))));
  const reviewed = report(await runJsonCli([...args, "--json"],
    "Reviewing additional shared apps"), "app shared add", "review");
  const retained = [...installed].sort();
  if (generatedIds.length > 0 && reviewed.publishedPorts === undefined) {
    throw new Error("Generated addition needs the complete published-port review");
  }
  const reviewedPorts = reviewed.ports as Record<string, unknown> | undefined;
  for (const id of generatedIds) {
    const port = reviewedPorts?.[id];
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1024 || port > 65535 || usedPorts.has(port)) {
      throw new Error("Generated addition plan has no distinct private frontend port");
    }
    usedPorts.add(port);
    ports[id] = port;
  }
  if (reviewed.projectRoot !== root || reviewed.projectId !== projectId || reviewed.mutation !== false
    || JSON.stringify(ids(reviewed.added)) !== JSON.stringify(selectedSorted)
    || JSON.stringify(ids(reviewed.retained)) !== JSON.stringify(retained)
    || !Array.isArray(reviewed.services) || reviewed.services.length === 0
    || reviewed.services.some((service) => typeof service !== "string")
    || !portMapMatches(reviewed.ports, ports)
    || typeof reviewed.approval !== "string"
    || !/^SHARED-ADD:[a-z0-9_-]+:[0-9a-f]{64}$/.test(reviewed.approval)) {
    throw new Error("Shared add review differs from the selected apps, retained owner, or private ports");
  }
  const setup = reviewed.setup as { direct?: unknown; pending?: unknown } | undefined;
  const direct = ids(setup?.direct);
  const pending = ids(setup?.pending);
  if ([...direct, ...pending].some((id) => !selectedSorted.includes(id))) {
    throw new Error("Shared add review reported setup outside the selected additions");
  }
  note(`Add: ${selectedSorted.join(", ")}\nRetain: ${retained.join(", ")}\n`
    + `Services added: ${reviewed.services.join(", ")}\n`
    + `Private ports: ${selectedSorted.filter((id) => ports[id] !== null).map((id) => `${id}=${ports[id]}`).join(", ") || "none"}\n`
    + `Additional private ports: ${additionalPublishedPortRecap(reviewed.publishedPorts, selectedSorted)}\n`
    + `Prepared manual jobs: ${selectedSorted.filter((id) => choiceById.get(id)?.manualJob).join(", ") || "none"} (not executed)\n`
    + `Private connectors: ${selectedSorted.filter((id) => choiceById.get(id)?.connector).join(", ") || "none"} (daemon only; enrollment and routing need separate approval)\n`
    + `Scripted first run: ${direct.join(", ") || "none"}\n`
    + `Setup still pending: ${pending.join(", ") || "none"}\n`
    + "Existing services, data, and private credentials remain unchanged.", "Review shared additions");
  const approved = stopIfCancelled(await confirm({
    message: "Add only these apps to the shared project?", initialValue: false,
  }));
  if (!approved) return false;
  const secretArgs = await ownerSecretFileArgs(reviewed.ownerSecretIds, stopIfCancelled);
  const added = report(await runJsonCli([...args, ...secretArgs, "--approve", approval(reviewed.approval), "--json"],
    "Adding selected shared apps"), "app shared add", "added-unverified", "prepared-prestart");
  if (added.projectRoot !== root || added.projectId !== projectId || added.mutation !== true
    || JSON.stringify(ids(added.added)) !== JSON.stringify(selectedSorted)
    || JSON.stringify(ids(added.retained)) !== JSON.stringify(retained)
    || !portMapMatches(added.ports, ports)
    || JSON.stringify(added.publishedPorts) !== JSON.stringify(reviewed.publishedPorts)) {
    throw new Error("Shared add did not confirm its exact app and port scope");
  }
  if (prestartPending(added, root, projectId)) return false;
  // Capability continuation runs one batch for new and retained goal apps.
  if (configureNewApps && direct.length > 0) await runSharedFirstRun(root, projectId, selectedSorted, dependencies);
  if (configureNewApps && (installed.has("homarr") || selectedSorted.includes("homarr"))) {
    let dashboardApps = [...new Set([...selectedSorted, "homarr"])].sort();
    if (!installed.has("homarr")) dashboardApps = [...new Set([...retained, ...selectedSorted])].sort();
    try { await runSharedHomarr(root, projectId, dashboardApps, dependencies); }
    catch {
      note("Additions are saved. Homarr publication remains pending; retry from Set up Homarr dashboard. Existing dashboard resources remain retained.",
        "Homarr setup pending");
    }
  }
  note(`Added ${selectedSorted.join(", ")}. Runtime, login, and restart acceptance remain unverified.`,
    "Shared apps added");
  return true;
}

export function sharedFrontendIds(selected: readonly string[], manualJobs: readonly string[]): string[] {
  return selected.filter((id) => !manualJobs.includes(id));
}

async function selectedSharedManualJobs(root: string, projectId: string, selected: string[],
  runJsonCli: SetupDependencies["runJsonCli"]): Promise<{ manualJobs: string[]; installed: string[] }> {
  const saved = report(await runJsonCli(["app", "shared", "status", "--project-root", root,
    "--project-id", projectId, "--json"], "Checking saved app execution kinds"),
  "app shared status", "completed");
  if (saved.projectRoot !== root || saved.projectId !== projectId || saved.mutation !== false) {
    throw new Error("Shared execution kinds differ from the selected owner");
  }
  const installed = ids(saved.apps);
  const manualJobs = ids(saved.manualJobs ?? []);
  if (selected.some((id) => !installed.includes(id)) || manualJobs.some((id) => !installed.includes(id))) {
    throw new Error("Shared execution kinds name an unsaved app");
  }
  const prepared = selected.filter((id) => manualJobs.includes(id));
  if (prepared.length) note(`${prepared.join(", ")}: prepared, not executed; no HTTP setup or browser tile.`,
    "Manual jobs");
  return { manualJobs: prepared, installed };
}

export async function runSharedFirstRun(root: string, projectId: string, selected: string[],
  { runJsonCli, stopIfCancelled }: SetupDependencies): Promise<void> {
  const saved = await selectedSharedManualJobs(root, projectId, selected, runJsonCli);
  if (selected.length === 0) return;
  const setupArgs = ["app", "shared", "setup", "--project-root", root, "--project-id", projectId,
    ...selected.flatMap((id) => ["--app", id])];
  let review = report(await runJsonCli([...setupArgs, "--json"],
    "Reviewing direct first-run setup"), "app shared setup", "review");
  const setup = review.setup as { direct?: unknown; pending?: unknown; inputDefinitions?: unknown } | undefined;
  const direct = ids(setup?.direct);
  const pending = ids(setup?.pending);
  note(`Scripted setup: ${direct.join(", ") || "none"}\nPending manual or adapter work: ${pending.join(", ") || "none"}`,
    "First-run coverage");
  if (direct.length === 0) return;
  const pairs = sharedConnectionPairs(saved.installed);
  const inputArgs = await collectSharedSetupInputArgs(setup?.inputDefinitions, selected, async (field) => {
    let message = `${field.appId}: ${field.label}`;
    let placeholder = "Leave blank to retain saved choices or skip this optional setup";
    const connection = pairs.find((pair) => pair.kind === "request-manager" && pair.target === field.appId);
    if (field.key === "root-folder-path" && connection?.root) {
      message += ` (${connection.source} needs ${connection.root})`;
      placeholder = `Use ${connection.root}, or leave blank to keep the saved path; a different path blocks this connection`;
    }
    return stopIfCancelled(await text({ message, placeholder, validate: setupInputValueError }));
  });
  setupArgs.push(...inputArgs);
  if (inputArgs.length > 0) {
    review = report(await runJsonCli([...setupArgs, "--json"],
      "Reviewing first-run setup with your selected inputs"), "app shared setup", "review");
  }
  const runSetup = stopIfCancelled(await confirm({
    message: `Run direct first-run setup for ${direct.join(", ")}?`, initialValue: true,
  }));
  if (!runSetup) return;
  let token = approval(review.approval);
  const stepTokens = new Set<string>();
  const transitioned = new Set<string>();
  for (let step = 0; step < 512; step += 1) {
    const args = [...setupArgs, "--approve", token];
    for (const stepToken of stepTokens) args.push("--approve-step", stepToken);
    const result = report(await runJsonCli([...args, "--json"],
      "Running exact first-run setup steps"), "app shared setup", "setup-attempted");
    const pendingSteps = sharedSetupStepBatch(result.stepApprovals, selected);
    if (result.outcomes !== undefined || pendingSteps.length === 0) {
      note(sharedSetupOutcomeRecap(result.outcomes, selected), "First-run recap");
    }
    if (pendingSteps.length === 0) {
      const transitions = ids(result.transitionCandidates ?? []);
      if (new Set(transitions).size !== transitions.length || transitions.some((id) => !selected.includes(id))) {
        throw new Error("First-run closure candidates differ from the selected shared apps");
      }
      if (transitions.length > 0) {
        for (const appId of transitions) {
          if (transitioned.has(appId)) throw new Error("First-run closure remains unfinished; inspect before retrying");
          if (!await runSharedFirstAccountTransition(root, projectId, appId, { runJsonCli, stopIfCancelled })) return;
          transitioned.add(appId);
        }
        review = report(await runJsonCli([...setupArgs, "--json"],
          "Reviewing setup verification after first-account closure"), "app shared setup", "review");
        token = approval(review.approval);
        stepTokens.clear();
        const verify = stopIfCancelled(await confirm({
          message: "Continue with the freshly reviewed setup verification after closure?", initialValue: true,
        }));
        if (!verify) return;
        continue;
      }
      await runSharedConnections(root, projectId, saved.installed, { runJsonCli, stopIfCancelled });
      return;
    }
    note(pendingSteps.map((next) => `${next.appId}: ${next.progress}`).join("\n"), "Review exact setup steps");
    const allowStep = stopIfCancelled(await confirm({
      message: "Approve all these exact first-run steps?", initialValue: false,
    }));
    if (!allowStep) {
      note(`Setup remains unfinished. Approved checkpoints are saved in ${root} (${projectId}).\n`
        + "Choose Continue scripted first-run setup in this saved project's control panel to review the remaining steps; do not create another project.",
      "Setup paused");
      return;
    }
    for (const next of pendingSteps) {
      const actionPrefix = next.token.slice(0, next.token.lastIndexOf(":"));
      for (const accepted of stepTokens) {
        if (accepted.startsWith(`${actionPrefix}:`)) stepTokens.delete(accepted);
      }
      stepTokens.add(next.token);
    }
  }
  throw new Error("First-run setup exceeded its reviewed step limit");
}

/** The engine supplies only recipe-declared closures after its saved first-account proof. */
async function runSharedFirstAccountTransition(root: string, projectId: string, appId: string,
  { runJsonCli, stopIfCancelled }: SetupDependencies): Promise<boolean> {
  const coordinates = ["--project-root", root, "--project-id", projectId, "--app", appId];
  const review = report(await runJsonCli(["app", "shared", "transition-plan", ...coordinates, "--json"],
    "Reviewing the declared first-account closure"), "app shared transition-plan", "review");
  const environment = review.environment as { name?: unknown; from?: unknown; to?: unknown } | undefined;
  if (review.projectRoot !== root || review.projectId !== projectId || review.appId !== appId
    || review.mutation !== false || typeof review.serviceId !== "string"
    || (review.serviceId !== appId && !review.serviceId.startsWith(`${appId}-`))
    || !environment || typeof environment.name !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/.test(environment.name)
    || typeof environment.from !== "string"
    || (environment.to !== null && typeof environment.to !== "string")
    || environment.from.length > 256
    || (typeof environment.to === "string" && environment.to.length > 256)
    || /[\r\n\0]/.test(environment.from)
    || (typeof environment.to === "string" && /[\r\n\0]/.test(environment.to))) {
    throw new Error("First-account closure review differs from the exact saved app");
  }
  const token = approval(review.approval);
  if (!new RegExp(`^TRANSITION:${appId}:[0-9a-f]{64}$`).test(token)) {
    throw new Error("First-account closure approval differs from the selected app");
  }
  let destination = environment.to;
  if (destination === null) destination = "remove variable";
  note(`${appId}: ${environment.name}: ${environment.from} → ${destination}\n`
    + `Only ${review.serviceId} will be recreated; data and credentials remain. Saved login will be verified afterward.`,
  "Review first-account closure");
  const allow = stopIfCancelled(await confirm({ message: "Apply this exact first-account closure?", initialValue: false }));
  if (!allow) return false;
  const applied = report(await runJsonCli(["app", "shared", "transition-apply", ...coordinates,
    "--approve", token, "--json"], "Closing first-account registration on the saved app"),
  "app shared transition-apply", "recreated-unverified");
  if (applied.projectRoot !== root || applied.projectId !== projectId || applied.appId !== appId
    || applied.serviceId !== review.serviceId || applied.mutation !== true) {
    throw new Error("First-account closure was not confirmed; inspect saved status before retrying");
  }
  return true;
}

/** One reviewed dashboard operation reuses saved credentials; it never deploys apps. */
export async function runSharedHomarr(root: string, projectId: string, selected: string[],
  { runJsonCli, stopIfCancelled, offerHomarrMcp }: SetupDependencies): Promise<void> {
  const { manualJobs } = await selectedSharedManualJobs(root, projectId, selected, runJsonCli);
  selected = sharedFrontendIds(selected, manualJobs);
  if (selected.length === 0) return;
  const base = ["--project-root", root, "--project-id", projectId,
    ...selected.flatMap((id) => ["--app", id])];
  const inputs: string[] = [];
  type HomarrReview = CliReport & { services: unknown[]; pending: Array<{ id: string; requiredInputs: string[] }> };
  async function review(): Promise<HomarrReview | null> {
    let result: CliReport;
    try {
      result = report(await runJsonCli(["app", "shared", "homarr-plan", ...base, ...inputs, "--json"],
        "Reviewing Homarr integrations, widgets, and the stack Notebook"), "app shared homarr-plan", "planned");
    } catch {
      note("Homarr publication could not be reviewed. Finish its saved administrator/API-key setup, then retry from Set up Homarr dashboard. Other apps remain independently operable.",
        "Homarr setup pending");
      return null;
    }
    if (!Array.isArray(result.services) || !Array.isArray(result.pending)) throw new Error("Homarr review is invalid");
    if (result.pending.some((value) => !value || typeof value !== "object" || Array.isArray(value)
      || typeof value.id !== "string" || !Array.isArray(value.requiredInputs)
      || value.requiredInputs.some((input: unknown) => typeof input !== "string"))) throw new Error("Homarr pending inputs are invalid");
    return result as HomarrReview;
  }
  let plan = await review();
  if (!plan) return;
  // An omitted input reuses its saved choice. Do not replace a retained topic
  // with the first-publication default when resuming dashboard publication.
  if (selected.includes("ntfy") && plan.pending.some((value) => value.id === "ntfy" && value.requiredInputs.includes("topic"))) {
    const topic = stopIfCancelled(await text({ message: "ntfy topic for Homarr notifications", initialValue: "homelab",
      placeholder: "homelab", validate: (value) => {
        if (/^[A-Za-z0-9_-]{1,64}$/.test(value)) return undefined;
        return "Use 1–64 letters, numbers, underscores, or hyphens";
      } }));
    inputs.push("--input", `ntfy.topic=${topic}`);
    plan = await review();
    if (!plan) return;
  }
  note(plan.services.map((value) => {
    const app = value as { id: string; integrationKind: string | null; widgets: string[] };
    return `${app.id}: ${app.integrationKind ?? "app tile only"}; ${app.widgets.join(", ") || "no integration widgets"}`;
  }).join("\n"), "Homarr dashboard review");
  if (plan.pending.length > 0) {
    note(plan.pending.map((value) => {
      const item = value as { id: string; requiredInputs: string[] };
      return `${item.id}: missing ${item.requiredInputs.join(", ")}`;
    }).join("\n"), "Finish app setup before attaching Homarr");
    return;
  }
  const approved = stopIfCancelled(await confirm({
    message: "Add these apps, integrations, widgets, and the private stack Notebook to Homarr?", initialValue: true,
  }));
  if (!approved) return;
  const result = report(await runJsonCli(["app", "shared", "homarr-apply", ...base, ...inputs,
    "--approve", approval(plan.approval), "--json"], "Setting up your Homarr dashboard"),
  "app shared homarr-apply", "attached", "attached-with-native-pending");
  if (result.status === "attached-with-native-pending") {
    note("App links and recap were published. Some native integrations and widgets remain pending; check the dashboard recap for their requirements.",
      "Native integrations pending");
  }
  note("Dashboard resources were read back. Rendered widget content and service restart acceptance remain separate checks.",
    "Homarr setup recap");
  try {
    const live = await runJsonCli(["app", "shared", "homarr-status", ...base, "--live", "--json"],
      "Checking Homarr reachability and widget data");
    note(dashboardRecap(live, root, projectId, selected), "Live dashboard recap");
  } catch {
    note("Live dashboard checks could not be completed. Resources are saved, but the stack is not fully verified; use Check dashboard and recap to retry.",
      "Dashboard verification pending");
  }
  const homarr = (result.services as Array<{ id: string; browserUrl: string }>).find((app) => app.id === "homarr");
  if (homarr) {
    note(homarr.browserUrl, "View dashboard (local host)");
    if (offerHomarrMcp && typeof homarr.browserUrl === "string") {
      try { await offerHomarrMcp(root, homarr.browserUrl, projectId); }
      catch { note("Dashboard publication is saved. Use Set up Homarr MCP later to retry the optional read-only profile; no client configuration was installed.", "MCP profile pending"); }
    }
  }
}
