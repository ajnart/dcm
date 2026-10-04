import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { confirm, note, outro, select } from "@clack/prompts";
import { bundledRecipeChoices, bundledSharedRecipeChoices, type RecipeChoice } from "../interactive-catalog.ts";
import { pickCatalogApps, type CatalogPickerItem } from "./catalog-picker.ts";
import { excludedAppIds, saveExcludedAppIds } from "./project-selection.ts";
import { enrichProjectSnapshot, loadProjectSnapshot, type ProjectSnapshot } from "./project-snapshot.ts";
import { selectionPlan } from "./selection-plan.ts";
import { applyCliUpdate, checkCliUpdate } from "./cli-update.ts";
import { addSharedProjectApps, createSharedProject, runSharedFirstRun, runSharedHomarr,
  reinstallSharedProjectApp, sharedRemovedAppChoices } from "./shared-create.ts";
import { runSharedConnections, sharedConnectionPairs } from "./shared-connections.ts";
import { dashboardRecap } from "./dashboard-recap.ts";
import { runSharedPrivateHttps } from "./shared-private-https.ts";
import { runSharedImageUpdate } from "./shared-image-update.ts";

type ControlPanelDependencies = {
  readOnlyCliJson: (args: string[], signal?: AbortSignal) => Promise<unknown>;
  inspectFirstRun: (root: string, appId: string) => Promise<boolean>;
  stopIfCancelled: <T>(value: T | symbol) => T;
  invoke: (args: string[]) => { data?: Record<string, unknown> };
  runJsonCli: (args: string[], progress: string, acceptedNonzeroKind?: string,
    secretStdin?: string) => Promise<Record<string, unknown>>;
  chooseRoot: (createIfMissing: boolean, requireExplicit?: boolean) => Promise<string>;
  installRecipeBatchFlow: (choices: RecipeChoice[], root: string, withHomarr?: boolean,
    homarrChoice?: RecipeChoice, expectedWorkflow?: unknown, allowOptionalHomarr?: boolean) => Promise<void>;
  installRecipeFlow: (choices: RecipeChoice[], selectedAppId?: string,
    selectedRoot?: string, selectedHomarr?: boolean, inAppJourney?: boolean,
    allowOptionalHomarr?: boolean) => Promise<void>;
  offerOptionalHomarrFanIn: (root: string, appIds: string[], choices: RecipeChoice[],
    homarrChoice?: RecipeChoice) => Promise<boolean>;
  offerConnectedHomarrApp: (root: string, appId: string) => Promise<string | null>;
  resumeFlow: (existingRoot?: string) => Promise<void>;
  planFlow: (root?: string) => Promise<void>;
  offerHomarrMcp?: (root: string, url: string, projectId?: string) => Promise<void>;
};

export function createControlPanel({
  readOnlyCliJson, inspectFirstRun, stopIfCancelled, invoke, runJsonCli, chooseRoot,
  installRecipeBatchFlow, installRecipeFlow, offerOptionalHomarrFanIn,
  offerConnectedHomarrApp, resumeFlow, planFlow, offerHomarrMcp,
}: ControlPanelDependencies) {
  async function offerCliUpdate(onLaunch = false): Promise<boolean> {
    const update = await checkCliUpdate();
    if (onLaunch && update.status !== "available") return false;
    if (update.status !== "available") {
      note(update.message, "CLI update");
      return false;
    }
    note(`Installed: ${update.currentVersion}\nAvailable: ${update.targetVersion}`, "New CLI version");
    const approved = stopIfCancelled(await confirm({
      message: "Update CLI? [Y/n]",
      initialValue: true,
    }));
    if (!approved) return false;
    try {
      note(await applyCliUpdate(update), "CLI updated");
    } catch (error) {
      note(error instanceof Error ? error.message : "CLI update failed; inspect the installed package before retrying.", "CLI update not confirmed");
      return true;
    }
    return true;
  }

  function sharedImageSummary(app: ProjectSnapshot["shared"][number]["apps"][number]): string {
    if (app.update.status === "available") return "image update available (review before applying)";
    if (app.update.status === "current") return "image current";
    return "image update unknown or checking";
  }

  async function savedControlPanelRoot(): Promise<ProjectSnapshot | null> {
    const candidates = [...new Set([resolve(process.cwd()), join(homedir(), ".selfhostedskills")])];
    const projects: ProjectSnapshot[] = [];
    for (const root of candidates) {
      if (!existsSync(join(root, ".selfhost"))) continue;
      const snapshot = await loadProjectSnapshot(root, readOnlyCliJson);
      if (snapshot.apps.length > 0 || snapshot.owners.project || snapshot.owners.cli
        || snapshot.owners.stack || snapshot.owners.appBatch || snapshot.owners.bundles.length > 0
        || snapshot.shared.length > 0) {
        projects.push(snapshot);
      }
    }
    if (projects.length === 0) return null;
    if (projects.length === 1) return projects[0];
    const root = stopIfCancelled(await select({
      message: "Which saved project should this control panel open?",
      options: projects.map((project) => ({ value: project.root, label: project.root })),
    }));
    return projects.find((project) => project.root === root) ?? null;
  }

  function recipeCatalog(): RecipeChoice[] {
    const recipes = invoke(["catalog", "recipes"]);
    return bundledRecipeChoices(recipes.data ?? {});
  }

  function controlPanelSummary(snapshot: ProjectSnapshot, checked: boolean, excluded: readonly string[]): string {
    const lines = [`Project: ${snapshot.root}`];
    const owners: string[] = [];
    if (snapshot.owners.project) owners.push("saved plan");
    if (snapshot.owners.cli) owners.push("media");
    if (snapshot.owners.stack) owners.push("legacy stack");
    if (snapshot.owners.appBatch) owners.push("app batch");
    if (snapshot.owners.bundles.length) owners.push(`${snapshot.owners.bundles.length} household bundle(s)`);
    if (owners.length) lines.push(`Other project owners: ${owners.join(", ")}`);
    for (const project of snapshot.shared) {
      lines.push(`Shared Compose ${project.id}: ${project.stage}`);
      for (const app of project.apps) {
        if (app.manualJob) {
          lines.push(`  ${app.id}: prepared, not executed; no HTTP frontend; ${sharedImageSummary(app)}`);
          continue;
        }
        lines.push(`  ${app.id}: ${app.url ?? "URL unknown"}, `
          + (app.runtime ? `${app.runtime.state}, health ${app.runtime.health}` : "health unknown")
          + `; ${sharedImageSummary(app)}`);
      }
    }
    if (snapshot.apps.length === 0) lines.push("No independently saved app recipes yet.");
    for (const app of snapshot.apps) {
      let selection = "active";
      if (excluded.includes(app.id)) selection = "excluded from selection";
      let health = "health unknown";
      if (app.runtime) health = `${app.runtime.state}, health ${app.runtime.health}`;
      else if (!checked && app.stage === "applied") health = "health checking";
      let update = "image update unknown";
      if (!checked && app.image) update = "checking";
      else if (checked) update = app.update.status;
      if (update === "available") update = "image update available";
      if (update === "current") update = "image current";
      if (update === "unknown") update = "image update unknown";
      lines.push(`${app.id}: ${selection}; ${app.stage}; ${health}; ${update}; ${app.url ?? "URL unknown"}`);
    }
    lines.push("Health is Docker's documented container check when present; unknown is not healthy. App login and function are separate checks.");
    return lines.join("\n");
  }

  async function sharedControlPanelFlow(initialSnapshot: ProjectSnapshot): Promise<void> {
    const root = initialSnapshot.root;
    let snapshot = initialSnapshot;
    let enrichmentController = new AbortController();
    function startSharedChecks(current: ProjectSnapshot): Promise<ProjectSnapshot> {
      enrichmentController.abort();
      enrichmentController = new AbortController();
      const signal = enrichmentController.signal;
      return enrichProjectSnapshot(current, (args) => readOnlyCliJson(args, signal))
        .then((checked) => {
          // A completed check may refresh this owner, never a newer mutation snapshot.
          if (!signal.aborted && snapshot === current) snapshot = checked;
          return checked;
        });
    }
    let backgroundChecks = startSharedChecks(snapshot);
    void backgroundChecks.catch(() => {});
    const selectedId = snapshot.shared.length === 1 ? snapshot.shared[0]!.id
      : stopIfCancelled(await select({ message: "Which shared Compose project?",
        options: snapshot.shared.map((project) => ({ value: project.id, label: project.id })) }));
    while (true) {
      const project = snapshot.shared.find((entry) => entry.id === selectedId);
      if (!project) throw new Error("The saved shared project changed; inspect it before continuing");
      const automaticApps = project.apps.filter((app) => !app.manualJob);
      note(`Project: ${root}\nShared Compose: ${project.id} (${project.stage})\n`
        + project.apps.map((app) => {
          let limits = "";
          if (app.limitations.length) limits = `; ${app.limitations.join("; ")}`;
          if (app.manualJob) return `${app.id}: prepared, not executed; no HTTP frontend; ${sharedImageSummary(app)}${limits}`;
          return `${app.id}: ${app.url ?? "URL unknown"}, `
            + (app.runtime ? `${app.runtime.state}, health ${app.runtime.health}` : "health checking or unknown")
            + `; ${sharedImageSummary(app)}${limits}`;
        })
          .join("\n"),
      "Saved shared project");
      const action = stopIfCancelled(await select({ message: "What would you like to do?", options: [
        { value: "refresh", label: "Refresh health and image updates", hint: "Read-only Docker and bounded registry checks" },
        ...(project.stage === "prepared"
          ? [{ value: "resume", label: "Resume prepared project", hint: "Review pending prerequisites and approve its exact saved scope" }]
          : []),
        { value: "selection", label: "Change app selection", hint: "Search, Space to toggle, Enter to review; preserves data" },
        { value: "add", label: "Add apps to this shared project", hint: "Review additions; retain existing services" },
        { value: "goal", label: "Add a capability", hint: "Resolve a goal; reuse this project's services" },
        { value: "start", label: "Start one app or this project", hint: "Only its saved Compose services" },
        { value: "stop", label: "Stop one app or this project", hint: "Keeps volumes and private credentials" },
        { value: "image-update", label: "Update app images", hint: "Review exact digest changes; preserves data and credentials" },
        { value: "recipe-migration", label: "Review saved recipe changes", hint: "Compatible settings only; preserves data and credentials" },
        { value: "setup", label: "Continue scripted first-run setup" },
        ...(sharedConnectionPairs(project.apps.map((app) => app.id)).length > 0
          ? [{ value: "connections", label: "Connect installed apps", hint: "Review supported links; reuse saved credentials" }]
          : []),
        { value: "https", label: "Set up private HTTPS", hint: "Host-only Caddy routes; keeps existing apps and credentials" },
        ...(project.apps.some((app) => app.id === "homarr")
          ? [{ value: "dashboard-status", label: "Check dashboard and recap", hint: "Read-only; uses the saved Homarr API key" },
            { value: "homarr", label: "Set up Homarr dashboard", hint: "Integrations, widgets, app tiles, and stack recap" }]
          : []),
        ...(offerHomarrMcp && project.apps.some((app) => app.id === "homarr")
          ? [{ value: "homarr-mcp", label: "Set up Homarr MCP", hint: "Optional read-only profile; client installation stays separate" }]
          : []),
        { value: "handoff", label: "Show an app's saved credentials" },
        { value: "update-cli", label: "Check for CLI update", hint: "Private release, reviewed before installation" },
        { value: "exit", label: "Exit" },
      ] }));
      if (action === "exit") {
        enrichmentController.abort();
        return;
      }
      if (action === "update-cli") {
        if (await offerCliUpdate()) {
          enrichmentController.abort();
          return;
        }
        continue;
      }
      if (action === "refresh") {
        snapshot = await loadProjectSnapshot(root, readOnlyCliJson);
        backgroundChecks = startSharedChecks(snapshot);
        snapshot = await backgroundChecks.catch(() => snapshot);
        continue;
      }
      if (action === "resume") {
        if (project.stage !== "prepared") throw new Error("Only a prepared shared project can resume here");
        const coordinates = ["--project-root", root, "--project-id", project.id];
        const review = await runJsonCli(["app", "shared", "status", ...coordinates, "--json"],
          "Reviewing the current prepared shared owner");
        const selected = project.apps.map((app) => app.id).sort();
        if (review.command !== "app shared status" || review.projectRoot !== root
          || review.projectId !== project.id || review.status !== "prepared" || review.mutation !== false
          || JSON.stringify(review.apps) !== JSON.stringify(selected)
          || !Array.isArray(review.prestart) || review.prestart.length > 200) {
          throw new Error("Prepared resume review differs from the selected saved owner");
        }
        const prerequisites = review.prestart.map((entry: unknown) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new Error("Prepared resume returned invalid prerequisites");
          }
          const contract = entry as Record<string, unknown>;
          if (typeof contract.appId !== "string" || !selected.includes(contract.appId)
            || !Array.isArray(contract.effects) || contract.effects.length > 32
            || contract.effects.some((effect) => typeof effect !== "string" || !effect.length
              || effect.length > 2048 || /[\r\n\0]/.test(effect))) {
            throw new Error("Prepared resume returned invalid prerequisites");
          }
          return `${contract.appId}: ${contract.effects.join("; ") || "fresh pre-start verification required"}`;
        });
        note(`Saved owner: ${root} (${project.id})\nApps: ${selected.join(", ")}\n`
          + `${prerequisites.join("\n") || "No declared pre-start prerequisites."}\n`
          + "Prerequisites require separate approval and fresh proof. Resume checks them before starting services; it does not approve them. Setup and Homarr publication remain separate.",
        "Review prepared project resume");
        if (review.recovery || typeof review.resumeApproval !== "string"
          || !new RegExp(`^SHARED-(APPLY|RESUME):${project.id}:[0-9a-f]{64}$`).test(review.resumeApproval)) {
          note("This checkpoint has no exact resume approval. Inspect the saved owner before continuing; nothing changed.",
            "Resume unavailable");
          continue;
        }
        const approved = stopIfCancelled(await confirm({
          message: "Resume this exact prepared project after its separately approved prerequisites?", initialValue: false,
        }));
        if (!approved) continue;
        enrichmentController.abort();
        try {
          const resumed = await runJsonCli(["app", "shared", "resume", ...coordinates,
            "--approve", review.resumeApproval, "--json"], "Resuming the exact prepared shared owner");
          if (resumed.command !== "app shared resume" || resumed.projectId !== project.id
            || resumed.status !== "applied-unverified" || resumed.mutation !== true
            || JSON.stringify(resumed.apps) !== JSON.stringify(selected)) {
            throw new Error("Shared resume did not confirm the reviewed owner scope");
          }
          note("The saved project resumed. Runtime and application acceptance remain unverified; first-run setup and Homarr publication were not run.",
            "Shared project resumed");
        } catch {
          note("Resume did not confirm completion. Prerequisites may still need separate approval or fresh proof. Refresh the saved checkpoint before retrying; setup and Homarr publication remain pending.",
            "Shared resume pending");
        }
        snapshot = await loadProjectSnapshot(root, readOnlyCliJson);
        backgroundChecks = startSharedChecks(snapshot);
        void backgroundChecks.catch(() => {});
        continue;
      }
      if (action === "add") {
        if (project.stage !== "completed") {
          note(`The shared project is ${project.stage}. Inspect its exact saved checkpoint before adding apps.`,
            "Shared project needs recovery");
          continue;
        }
        await addSharedProjectApps(root, project.id, project.apps, { invoke, runJsonCli, stopIfCancelled, offerHomarrMcp });
        snapshot = await loadProjectSnapshot(root, readOnlyCliJson);
        backgroundChecks = startSharedChecks(snapshot);
        void backgroundChecks.catch(() => {});
        continue;
      }
      if (action === "goal") {
        enrichmentController.abort();
        await planFlow(root);
        snapshot = await loadProjectSnapshot(root, readOnlyCliJson);
        backgroundChecks = startSharedChecks(snapshot);
        void backgroundChecks.catch(() => {});
        continue;
      }
      if (action === "selection") {
        if (project.stage !== "completed") {
          note(`The shared project is ${project.stage}. Inspect its exact checkpoint before changing selection.`,
            "Shared project needs recovery");
          continue;
        }
        enrichmentController.abort();
        await changeSharedSelectedApps(root, project);
        snapshot = await loadProjectSnapshot(root, readOnlyCliJson);
        backgroundChecks = startSharedChecks(snapshot);
        void backgroundChecks.catch(() => {});
        continue;
      }
      if (action === "start" || action === "stop") {
        if (project.stage !== "completed") {
          note(`The shared project is ${project.stage}. Inspect its exact saved checkpoint before changing containers.`,
            "Shared project needs recovery");
          continue;
        }
        if (automaticApps.length === 0) {
          note("Only prepared manual jobs are selected; ordinary start/stop does not execute them.", "No automatic services");
          continue;
        }
        const target = stopIfCancelled(await select({
          message: `Which app should ${action}?`,
          options: [
            { value: "__all__", label: "All automatic apps in this shared project" },
            ...automaticApps.map((app) => ({ value: app.id, label: app.id })),
          ],
        }));
        const selected = target === "__all__"
          ? automaticApps.map((app) => app.id).sort() : [target];
        const args = ["app", "shared", action, "--project-root", root,
          "--project-id", project.id, ...selected.flatMap((id) => ["--app", id])];
        const review = await runJsonCli([...args, "--json"],
          `Reviewing exact shared ${action} scope`);
        if (review.command !== `app shared ${action}` || review.projectRoot !== root
          || review.projectId !== project.id || review.mutation !== false
          || JSON.stringify(review.apps) !== JSON.stringify(selected)) {
          throw new Error(`Shared ${action} review differs from the selected project`);
        }
        if (review.status === "no-change") {
          note(`The selected app services are already ${action === "start" ? "running" : "stopped"}.`,
            "No change");
          continue;
        }
        if (review.status !== "review" || typeof review.approval !== "string"
          || !/^SELECTED-(START|STOP):[a-z0-9_-]+:[0-9a-f]{64}$/.test(review.approval)
          || !Array.isArray(review.services) || review.services.length === 0
          || review.services.some((id: unknown) => typeof id !== "string")) {
          throw new Error(`Shared ${action} returned no exact service plan`);
        }
        note(`${selected.join(", ")}\nServices: ${review.services.join(", ")}\n`
          + "Only these saved Compose services will change. Volumes, data, and credentials remain.",
        `Review shared ${action}`);
        const approved = stopIfCancelled(await confirm({
          message: `${action === "start" ? "Start" : "Stop"} these services?`, initialValue: false,
        }));
        if (!approved) continue;
        const changed = await runJsonCli([...args, "--approve", review.approval, "--json"],
          `Changing exact shared ${action} scope`);
        if (changed.command !== `app shared ${action}` || changed.projectRoot !== root
          || changed.projectId !== project.id || changed.status !== "changed-unverified"
          || changed.mutation !== true || JSON.stringify(changed.apps) !== JSON.stringify(selected)) {
          throw new Error(`Shared ${action} did not confirm its exact service scope`);
        }
        snapshot = await loadProjectSnapshot(root, readOnlyCliJson);
        backgroundChecks = startSharedChecks(snapshot);
        void backgroundChecks.catch(() => {});
        continue;
      }
      if (action === "image-update") {
        if (automaticApps.length === 0) {
          note("There are no running app units to update. Prepared jobs are not run by this action.", "No app image update");
          continue;
        }
        const appId = stopIfCancelled(await select({ message: "Which app's images?",
          options: automaticApps.map((app) => ({ value: app.id, label: app.id, hint: sharedImageSummary(app) })) }));
        const app = automaticApps.find((entry) => entry.id === appId);
        if (!app) throw new Error("The selected app is absent from the saved project");
        const changed = await runSharedImageUpdate(root, project.id, app, {
          readOnlyCliJson, runJsonCli, note,
          confirm: async () => stopIfCancelled(await confirm({
            message: "Apply this exact app image update?", initialValue: false,
          })),
          beforeApply: () => enrichmentController.abort(),
        });
        if (changed) {
          snapshot = await loadProjectSnapshot(root, readOnlyCliJson);
          backgroundChecks = startSharedChecks(snapshot);
          void backgroundChecks.catch(() => {});
        }
        continue;
      }
      if (project.stage !== "completed" && action !== "recipe-migration") {
        note(`The shared project is ${project.stage}. Inspect self-host app shared status --project-root ${root} --project-id ${project.id} before attempting setup or credentials.`,
          "Shared project needs recovery");
        continue;
      }
      if (action === "recipe-migration") {
        if (automaticApps.length === 0) {
          note("There are no automatic app units to migrate.", "No recipe migration");
          continue;
        }
        const appId = stopIfCancelled(await select({ message: "Which app's saved recipe?",
          options: automaticApps.map((app) => ({ value: app.id, label: app.id })) }));
        const coordinates = ["--project-root", root, "--project-id", project.id, "--app", appId];
        let review: Record<string, unknown>;
        try {
          review = await readOnlyCliJson(["app", "shared", "recipe-migration-plan", ...coordinates, "--json"]) as Record<string, unknown>;
        } catch {
          note("No compatible additive recipe migration is available. Nothing changed; inspect CLI status for broader recipe changes.", "Recipe unchanged or needs review");
          continue;
        }
        const resumeReviewed = review?.status === "resume-reviewed";
        if (!review || review.command !== "app shared recipe-migration-plan"
          || (review.status !== "review" && !resumeReviewed)
          || review.resumeReviewed !== resumeReviewed
          || (resumeReviewed && (!Number.isSafeInteger(review.pendingRevision) || Number(review.pendingRevision) < 1))
          || review.mutation !== false || review.projectRoot !== root || review.projectId !== project.id
          || review.appId !== appId || review.dataPreserved !== true || review.credentialsRegenerated !== false
          || typeof review.approval !== "string" || !new RegExp(`^RECIPE-MIGRATION:${appId}:[a-f0-9]{64}$`).test(review.approval)
          || !Array.isArray(review.services) || review.services.length === 0
          || review.services.some((id) => typeof id !== "string" || (id !== appId && !id.startsWith(`${appId}-`)))
          || !Array.isArray(review.additions) || review.additions.length === 0) {
          throw new Error("Recipe migration review differs from the selected saved app");
        }
        const services = review.services as string[];
        const additions = review.additions as Array<{ serviceId: string; name: string; value: string }>;
        if (additions.some((entry) => !entry || !services.includes(entry.serviceId)
          || typeof entry.name !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/.test(entry.name)
          || typeof entry.value !== "string" || entry.value.length > 256 || /[\r\n\0]/.test(entry.value))) {
          throw new Error("Recipe migration returned invalid settings");
        }
        let migrationTitle = "Review recipe migration";
        if (resumeReviewed) migrationTitle = "Resume reviewed recipe migration";
        note(`Services: ${services.join(", ")}\n`
          + additions.map((entry) => `${entry.serviceId}: add ${entry.name}=${entry.value}`).join("\n")
          + "\nThis briefly recreates only the selected app unit. Data and saved credentials remain.", migrationTitle);
        const approved = stopIfCancelled(await confirm({ message: "Apply this exact recipe migration?", initialValue: false }));
        if (!approved) continue;
        enrichmentController.abort();
        const applied = await runJsonCli(["app", "shared", "recipe-migration-apply", ...coordinates,
          "--approve", review.approval, "--json"], "Migrating only the selected saved app unit");
        if (applied.command !== "app shared recipe-migration-apply" || applied.status !== "migrated-unverified"
          || applied.projectRoot !== root || applied.projectId !== project.id || applied.appId !== appId
          || applied.mutation !== true || applied.credentialsRegenerated !== false || applied.dataPreserved !== true) {
          throw new Error("Recipe migration did not confirm the selected unit; inspect saved status before retrying");
        }
        note("Recipe updated; existing data and credentials retained. Verify login and application function separately.", "Migration recorded");
        snapshot = await loadProjectSnapshot(root, readOnlyCliJson);
        backgroundChecks = startSharedChecks(snapshot);
        void backgroundChecks.catch(() => {});
        continue;
      }
      if (action === "connections") {
        await runSharedConnections(root, project.id, project.apps.map((app) => app.id),
          { runJsonCli, stopIfCancelled });
        continue;
      }
      if (action === "setup") {
        enrichmentController.abort();
        await runSharedFirstRun(root, project.id, project.apps.map((app) => app.id),
          { runJsonCli, stopIfCancelled });
        snapshot = await loadProjectSnapshot(root, readOnlyCliJson);
        const refreshed = snapshot.shared.find((saved) => saved.id === project.id);
        if (refreshed?.stage === "completed" && refreshed.apps.some((app) => app.id === "homarr")) {
          try {
            await runSharedHomarr(root, refreshed.id, refreshed.apps.map((app) => app.id),
              { runJsonCli, stopIfCancelled, offerHomarrMcp });
          } catch {
            note("Saved app accounts and setup checkpoints are retained. Homarr publication remains pending; retry from Set up Homarr dashboard.",
              "Homarr setup pending");
          }
          snapshot = await loadProjectSnapshot(root, readOnlyCliJson);
        }
        backgroundChecks = startSharedChecks(snapshot);
        void backgroundChecks.catch(() => {});
        continue;
      }
      if (action === "https") {
        enrichmentController.abort();
        try {
          await runSharedPrivateHttps(root, project.id, project.apps, { runJsonCli, stopIfCancelled });
        } catch (error) {
          note(error instanceof Error ? error.message : "Private HTTPS requires inspection before continuing.",
            "Private HTTPS not completed");
        }
        snapshot = await loadProjectSnapshot(root, readOnlyCliJson);
        backgroundChecks = startSharedChecks(snapshot);
        void backgroundChecks.catch(() => {});
        continue;
      }
      if (action === "dashboard-status") {
        const selected = project.apps.map((app) => app.id).sort();
        const readback = await readOnlyCliJson(["app", "shared", "homarr-status", "--project-root", root,
          "--project-id", project.id, ...selected.flatMap((id) => ["--app", id]), "--live", "--json"]);
        note(dashboardRecap(readback, root, project.id, selected), "Homarr dashboard recap");
        continue;
      }
      if (action === "homarr") {
        await runSharedHomarr(root, project.id, project.apps.map((app) => app.id),
          { runJsonCli, stopIfCancelled, offerHomarrMcp });
        continue;
      }
      if (action === "homarr-mcp") {
        const homarr = project.apps.find((app) => app.id === "homarr");
        if (!offerHomarrMcp || typeof homarr?.url !== "string") {
          note("This shared Homarr owner has no saved URL for MCP preparation. Finish its saved setup and refresh status first.", "MCP profile pending");
          continue;
        }
        try { await offerHomarrMcp(root, homarr.url, project.id); }
        catch { note("The optional Homarr MCP profile remains unfinished. Dashboard setup is separate; no client configuration was installed.", "MCP profile pending"); }
        continue;
      }
      if (automaticApps.length === 0) {
        note("Prepared jobs have no application administrator account; inspect their owner secret-file references through the CLI.",
          "No app credentials");
        continue;
      }
      const appId = stopIfCancelled(await select({ message: "Which app's private credentials?",
        options: automaticApps.map((app) => ({ value: app.id, label: app.id })) }));
      const show = stopIfCancelled(await confirm({
        message: `Display ${appId} credentials in this terminal?`, initialValue: false,
      }));
      if (!show) continue;
      const handoff = await runJsonCli(["app", "shared", "handoff", "--project-root", root,
        "--project-id", project.id, "--app", appId, "--show", "--json"],
      `Reading ${appId}'s exact private handoff`);
      if (handoff.command !== "app shared handoff" || handoff.appId !== appId
        || handoff.projectRoot !== root || handoff.projectId !== project.id
        || handoff.mutation !== false || handoff.secretful !== true) {
        throw new Error("Shared credential handoff did not match the selected app");
      }
      note(`URL: ${handoff.setupUrl ?? handoff.url ?? "unknown"}\nUsername: ${handoff.username ?? "none"}`
        + `\nPassword: ${handoff.password ?? "none"}\nAPI key: ${handoff.apiKey ?? "none"}`,
      `${appId} private credentials`);
    }
  }

  async function changeSharedSelectedApps(root: string, project: ProjectSnapshot["shared"][number]): Promise<void> {
    const listed = invoke(["catalog", "list"]).data?.apps;
    const recipes = bundledSharedRecipeChoices(invoke(["catalog", "recipes"]).data ?? {}, listed);
    const installed = project.apps.map((app) => app.id);
    const items: CatalogPickerItem[] = recipes.map((choice) => ({
      id: choice.appId, name: choice.name, description: choice.purpose,
      selected: installed.includes(choice.appId),
    }));
    if (!Array.isArray(listed) || listed.length > 200) throw new Error("The bundled app catalog is not reviewable");
    const known = new Set(items.map((item) => item.id));
    for (const app of project.apps) {
      if (known.has(app.id)) continue;
      items.push({ id: app.id, name: app.id, description: "Saved shared app; no current install recipe", selected: true });
      known.add(app.id);
    }
    for (const value of listed) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const app = value as { id?: unknown; name?: unknown };
      if (typeof app.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(app.id)
        || typeof app.name !== "string" || app.name.length > 120 || known.has(app.id)) continue;
      items.push({ id: app.id, name: app.name, description: "Discovery only — no shared Compose recipe",
        selected: false, installable: false });
      known.add(app.id);
    }
    items.sort((left, right) => left.name.localeCompare(right.name));
    const selected = await pickCatalogApps(items);
    if (selected === null) return;
    if (new Set(selected).size !== selected.length || selected.some((id) => !items.some((item) => item.id === id
      && item.installable !== false))) throw new Error("Shared selection differs from the reviewable catalog");
    const updates = project.apps.filter((app) => app.update.status === "available").map((app) => app.id);
    const plan = selectionPlan(installed, selected, updates);
    let restores: string[] = [];
    let fresh = plan.added;
    if (plan.added.length > 0) {
      const status = await runJsonCli(["app", "shared", "status", "--project-root", root,
        "--project-id", project.id, "--json"], "Reviewing preserved app selections");
      const removed = sharedRemovedAppChoices(status, root, project.id, installed);
      restores = plan.added.filter((id) => removed.has(id));
      fresh = plan.added.filter((id) => !removed.has(id));
      const blocked = restores.filter((id) => removed.get(id) !== "reviewable");
      if (blocked.length) {
        note(`Restoration needs inspection: ${blocked.join(", ")}. No selection changes were applied; preserved data and credentials remain.`,
          "Preserved apps pending");
        return;
      }
    }
    note(`Added: ${fresh.join(", ") || "none"}\nRestore preserved apps: ${restores.join(", ") || "none"}\nRetained: ${plan.retained.join(", ") || "none"}`
      + `\nImage updates available: ${plan.updated.join(", ") || "none"}`
      + `\nRemoved from this shared project: ${plan.removed.join(", ") || "none"}`
      + "\nOnly reviewed app units change. Data and saved credentials remain. Image updates are not applied.",
    "Review shared selection");
    if (plan.added.length === 0 && plan.removed.length === 0) return;
    const proceed = stopIfCancelled(await confirm({
      message: "Continue to exact shared-project reviews for these changes?", initialValue: false,
    }));
    if (!proceed) return;
    if (plan.removed.length > 0 && !await removeSharedSelectedApps(root, project.id, installed, plan.removed)) return;
    const retained: Array<{ id: string; url: string | null; publishedPort?: number | null }> =
      project.apps.filter((app) => !plan.removed.includes(app.id));
    for (const id of restores) {
      const restored = await reinstallSharedProjectApp(root, project.id, id, retained.map((app) => app.id),
        { runJsonCli, stopIfCancelled });
      if (!restored) {
        note("Restoration was not completed. Keep any earlier approved changes and inspect this same owner; no first-account setup was run.",
          "Partial selection change");
        return;
      }
      retained.push(restored);
    }
    if (fresh.length > 0) {
      if (!await addSharedProjectApps(root, project.id, retained,
        { invoke, runJsonCli, stopIfCancelled, offerHomarrMcp }, fresh)) {
        note("Additions were not started or remain pending. Keep any prepared owner and earlier approved removals; inspect shared status before continuing.",
          "Partial selection change");
        return;
      }
    }
    let recap = "Selection changes recorded in this shared Compose owner. App function, required connections and restart acceptance remain separate.";
    if (fresh.length > 0 && selected.includes("homarr")) {
      recap += " Homarr publication for additions was offered separately; declined or unfinished publication remains pending.";
    }
    recap += " Existing dashboard resources were retained, including resources for removed apps; dashboard retirement remains separate.";
    note(recap, "Shared selection changed");
  }

  async function removeSharedSelectedApps(root: string, projectId: string,
    installed: readonly string[], removed: readonly string[]): Promise<boolean> {
    const args = ["app", "shared", "remove", "--project-root", root, "--project-id", projectId,
      ...removed.flatMap((id) => ["--app", id])];
    const retained = installed.filter((id) => !removed.includes(id)).sort();
    if (retained.length === 0) {
      note("Stop the project; full owner retirement is not implemented. No removals or additions were applied.",
        "Shared removal blocked");
      return false;
    }
    let review: Record<string, unknown>;
    try {
      review = await runJsonCli([...args, "--json"], "Reviewing exact shared removals");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The exact removal plan could not be reviewed";
      note(`${detail}\nNo removals or additions were applied.`, "Shared removal blocked");
      return false;
    }
    if (review.command !== "app shared remove" || review.status !== "review" || review.projectRoot !== root
      || review.projectId !== projectId || review.mutation !== false
      || JSON.stringify(review.apps) !== JSON.stringify(removed)
      || JSON.stringify(review.retained) !== JSON.stringify(retained)
      || review.dataPreserved !== true || review.credentialsPreserved !== true
      || typeof review.approval !== "string" || !/^SHARED-REMOVE:[a-z0-9_-]+:[0-9a-f]{64}$/.test(review.approval)
      || !Array.isArray(review.services) || review.services.length === 0
      || review.services.some((id) => typeof id !== "string")) {
      throw new Error("Shared removal review differs from the selected owner or preserved data boundary");
    }
    note(`Apps: ${removed.join(", ")}\nServices: ${review.services.join(", ")}\n`
      + `Retained apps: ${retained.join(", ") || "none"}\nData and credentials remain; this is not a purge.`,
    "Review shared removal");
    const approved = stopIfCancelled(await confirm({
      message: "Remove only these app units from the shared project, keeping their data?", initialValue: false,
    }));
    if (!approved) return false;
    let applied: Record<string, unknown>;
    try {
      applied = await runJsonCli([...args, "--apply", "--approval", review.approval, "--json"],
        "Removing exact shared app units");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The exact removal result could not be confirmed";
      note(`${detail}\nAdditions were not attempted. Inspect the saved shared checkpoint before retrying.`,
        "Shared removal needs inspection");
      return false;
    }
    if (applied.command !== "app shared remove" || applied.status !== "removed-unverified"
      || applied.projectRoot !== root || applied.projectId !== projectId || applied.mutation !== true
      || JSON.stringify(applied.apps) !== JSON.stringify(removed)
      || JSON.stringify(applied.retained) !== JSON.stringify(retained)
      || applied.dataPreserved !== true || applied.credentialsPreserved !== true) {
      throw new Error("Shared removal did not confirm the exact selection; inspect saved status before retrying");
    }
    return true;
  }

  async function exactAppLifecycle(root: string, ids: readonly string[], action: "up" | "down"): Promise<boolean> {
    if (ids.length === 0) {
      note("No apps are installed in this saved plan. Choose Select apps for a new project to install them.", "Nothing installed");
      return false;
    }
    const pending: Array<{ id: string; approval: string }> = [];
    for (const id of ids) {
      const value = await readOnlyCliJson(["app", "status", "--id", id,
        "--project-root", root, "--live", "--json"]);
      const status = value as { command?: unknown; appId?: unknown; projectRoot?: unknown;
        status?: unknown; runtime?: { state?: unknown }; approvals?: Record<string, unknown> };
      if (status.command !== "app status" || status.appId !== id || status.projectRoot !== root
        || status.status !== "applied" || typeof status.approvals?.[action] !== "string") {
        throw new Error(`The exact ${id} lifecycle approval is unavailable. No project lifecycle was started.`);
      }
      const state = status.runtime?.state;
      if (state !== "running" && state !== "stopped" && state !== "partial"
        && state !== "exited" && state !== "created") {
        throw new Error(`${id} has an unknown Docker state. No project lifecycle was started.`);
      }
      if (action === "up" && state === "running") continue;
      if (action === "down" && state !== "running" && state !== "partial") continue;
      pending.push({ id, approval: status.approvals[action] as string });
    }
    if (pending.length === 0) {
      note(`All selected app containers are already ${action === "up" ? "running" : "stopped"}.`, "No change");
      return true;
    }
    note(`${pending.map((item) => item.id).join(", ")}\nOnly these exact Compose projects will ${action === "up" ? "start" : "stop"}. Data, credentials, and volumes are preserved.`,
      "Review project lifecycle");
    const approved = stopIfCancelled(await confirm({
      message: `${action === "up" ? "Start" : "Stop"} these ${pending.length} app project(s)?`, initialValue: false,
    }));
    if (!approved) return false;
    const completed: string[] = [];
    for (const item of pending) {
      try {
        const result = await runJsonCli(["app", action, "--id", item.id, "--project-root", root,
          "--approve", item.approval, "--json"], `${action === "up" ? "Starting" : "Stopping"} ${item.id}`);
        if (result.command !== `app ${action}` || result.appId !== item.id || result.mutation !== true
          || result.status !== (action === "up" ? "started-unverified" : "stopped")) {
          throw new Error(`${item.id} returned an unexpected lifecycle checkpoint.`);
        }
        completed.push(item.id);
      } catch (error) {
        note(`Completed: ${completed.join(", ") || "none"}\nNeeds inspection: ${item.id}\nNot attempted: ${pending.slice(completed.length + 1).map((entry) => entry.id).join(", ") || "none"}\nThe active selection was not saved. Check each exact app status before retrying.`,
          "Partial lifecycle");
        throw error;
      }
    }
    note(`${pending.length} app project(s) ${action === "up" ? "started" : "stopped"}. Data was retained. Verify login and app function separately.`,
      "Project lifecycle recorded");
    return true;
  }

  async function firstRunVerified(root: string, id: string): Promise<boolean> {
    try {
      const value = await readOnlyCliJson(["app", "status", "--id", id,
        "--project-root", root, "--live", "--json"]);
      const status = value as { command?: unknown; appId?: unknown; projectRoot?: unknown;
        status?: unknown; mutation?: unknown; runtime?: { state?: unknown };
        homarrSetup?: { stage?: unknown }; onboardingStage?: unknown;
        uptimeOnboardingStage?: unknown; prowlarrOnboardingStage?: unknown; setupClosed?: unknown };
      if (status.command !== "app status" || status.appId !== id || status.projectRoot !== root
        || status.status !== "applied" || status.mutation !== false
        || status.runtime?.state !== "running") return false;
      const handoff = await readOnlyCliJson(["app", "handoff", "--id", id,
        "--project-root", root, "--json"]) as { command?: unknown; appId?: unknown;
        mutation?: unknown; secretful?: unknown; apiKeyFile?: unknown;
        passwordFile?: unknown; credentialFile?: unknown };
      if (handoff.command !== "app handoff" || handoff.appId !== id
        || handoff.mutation !== false || handoff.secretful !== false) return false;
      if (id === "homarr") {
        return status.homarrSetup?.stage === "complete" && status.setupClosed === true
          && typeof handoff.apiKeyFile === "string";
      }
      if (id === "immich") {
        return status.onboardingStage === "closed" && status.setupClosed === true
          && typeof handoff.passwordFile === "string";
      }
      if (id === "uptime-kuma") {
        return status.uptimeOnboardingStage === "login-verified"
          && typeof handoff.credentialFile === "string";
      }
      if (id === "prowlarr") {
        if (status.prowlarrOnboardingStage !== "login-verified"
          || typeof handoff.passwordFile !== "string"
          || typeof handoff.apiKeyFile !== "string") return false;
        const checked = await readOnlyCliJson(["app", "login-check", "--id", id,
          "--project-root", root, "--json"]) as { command?: unknown; appId?: unknown;
          projectRoot?: unknown; mutation?: unknown; status?: unknown;
          loginVerified?: unknown; apiVerified?: unknown;
          passwordFile?: unknown; apiKeyFile?: unknown };
        return checked.command === "app login-check" && checked.appId === id
          && checked.projectRoot === root && checked.mutation === false
          && checked.status === "admin-and-api-verified"
          && checked.loginVerified === true && checked.apiVerified === true
          && checked.passwordFile === handoff.passwordFile
          && checked.apiKeyFile === handoff.apiKeyFile;
      }
      if (id === "paperless-ngx" && typeof handoff.passwordFile === "string") {
        const checked = await readOnlyCliJson(["app", "login-check", "--id", id,
          "--project-root", root, "--json"]) as { command?: unknown; appId?: unknown;
          mutation?: unknown; status?: unknown; loginVerified?: unknown };
        if (checked.command !== "app login-check" || checked.appId !== id
          || checked.mutation !== false || checked.status !== "admin-verified"
          || checked.loginVerified !== true || typeof handoff.apiKeyFile !== "string") return false;
        const token = await readOnlyCliJson(["app", "paperless-token-status", "--id", id,
          "--project-root", root, "--json"]) as { command?: unknown; appId?: unknown;
          mutation?: unknown; status?: unknown; adminVerified?: unknown;
          apiVerified?: unknown; apiKeyFile?: unknown };
        return token.command === "app paperless-token-status" && token.appId === id
          && token.mutation === false && token.status === "token-verified"
          && token.adminVerified === true && token.apiVerified === true
          && token.apiKeyFile === handoff.apiKeyFile;
      }
      return inspectFirstRun(root, id);
    } catch {
      return false;
    }
  }

  async function savedAppRunning(root: string, id: string): Promise<boolean> {
    try {
      const value = await readOnlyCliJson(["app", "status", "--id", id,
        "--project-root", root, "--live", "--json"]);
      const status = value as { command?: unknown; appId?: unknown; projectRoot?: unknown;
        status?: unknown; mutation?: unknown; runtime?: { state?: unknown } };
      return status.command === "app status" && status.appId === id && status.projectRoot === root
        && status.status === "applied" && status.mutation === false
        && status.runtime?.state === "running";
    } catch {
      return false;
    }
  }

  async function changeSelectedApps(root: string, snapshot: ProjectSnapshot,
    backgroundChecks?: Promise<ProjectSnapshot>): Promise<void> {
    const choices = recipeCatalog();
    const installed = snapshot.apps.map((app) => app.id);
    const excluded = await excludedAppIds(root);
    const active = installed.filter((id) => !excluded.includes(id));
    const items: CatalogPickerItem[] = choices.map((choice) => ({
      id: choice.appId, name: choice.name, description: choice.purpose,
      selected: active.includes(choice.appId),
    }));
    for (const id of installed) {
      if (choices.some((choice) => choice.appId === id)) continue;
      items.push({ id, name: id, description: "Existing app; no new bounded recipe in this catalog",
        selected: active.includes(id) });
    }
    const listed = invoke(["catalog", "list"]);
    const catalogApps = listed.data?.apps;
    if (!Array.isArray(catalogApps) || catalogApps.length > 200) {
      throw new Error("The bundled app catalog is not reviewable");
    }
    const selectable = new Set(items.map((item) => item.id));
    for (const value of catalogApps) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const app = value as { id?: unknown; name?: unknown };
      if (typeof app.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(app.id)
        || typeof app.name !== "string" || app.name.length > 120 || selectable.has(app.id)) continue;
      items.push({ id: app.id, name: app.name, description: "Discovery only — no verified install contract",
        selected: false, installable: false });
    }
    items.sort((left, right) => left.name.localeCompare(right.name));
    const selected = await pickCatalogApps(items);
    if (!selected) return;
    const checked = backgroundChecks ? await backgroundChecks.catch(() => snapshot) : snapshot;
    const updates = checked.apps.filter((app) => app.update.status === "available").map((app) => app.id);
    const plan = selectionPlan(active, selected, updates);
    note(`Added: ${plan.added.join(", ") || "none"}\nRetained: ${plan.retained.join(", ") || "none"}`
      + `\nImage updates available: ${plan.updated.join(", ") || "none"}`
      + `\nRemoved from active selection: ${plan.removed.join(", ") || "none"}`
      + "\nRemoval stops only the exact owned container. Its state, data, and credentials remain for re-selection. Image updates need a separate migration review.",
    "Review selection change");
    if (plan.added.length === 0 && plan.removed.length === 0) return;
    const installable = new Map(choices.map((choice) => [choice.appId, choice]));
    const unsupported = plan.added.filter((id) => !installed.includes(id) && !installable.has(id));
    if (unsupported.length > 0) {
      note(`${unsupported.join(", ")} cannot be installed from a bounded recipe yet. No selection was changed.`, "Discovery-only app");
      return;
    }
    const approved = stopIfCancelled(await confirm({
      message: "Apply this selection with exact app approvals and preserved data?", initialValue: false,
    }));
    if (!approved) return;
    const fresh = plan.added.filter((id) => !installed.includes(id) && id !== "homarr");
    const freshChoices: RecipeChoice[] = [];
    for (const id of fresh) {
      const choice = installable.get(id);
      if (!choice) throw new Error("An installable recipe disappeared during review.");
      freshChoices.push(choice);
    }
    const includeHomarr = selected.includes("homarr");
    const homarrChoice = installable.get("homarr");
    const allowOptionalHomarr = !plan.removed.includes("homarr");
    const revived = plan.added.filter((id) => installed.includes(id));
    if (revived.includes("homarr") && !await exactAppLifecycle(root, ["homarr"], "up")) return;
    if (freshChoices.length >= 2 && !snapshot.owners.appBatch) {
      await installRecipeBatchFlow(freshChoices, root, includeHomarr, homarrChoice,
        undefined, allowOptionalHomarr);
    } else {
      for (const choice of freshChoices) {
        await installRecipeFlow(choices, choice.appId, root, includeHomarr, false, allowOptionalHomarr);
      }
    }
    if (plan.added.includes("homarr") && !installed.includes("homarr") && freshChoices.length === 0) {
      await installRecipeFlow(choices, "homarr", root, undefined, true);
    }
    const otherRevived = revived.filter((id) => id !== "homarr");
    if (otherRevived.length && !await exactAppLifecycle(root, otherRevived, "up")) return;
    for (const id of plan.added) {
      const legacy = installed.includes(id) && !installable.has(id);
      const ready = legacy ? await savedAppRunning(root, id) : await firstRunVerified(root, id);
      if (ready) {
        if (legacy) note(`${id} is running, but this catalog has no first-run contract for it. Login and function remain unverified.`,
          "Existing app limitation");
        continue;
      }
      note(`${id} has no live, verified ${legacy ? "owned runtime" : "first-run checkpoint and private handoff"}. Existing apps were not stopped and the active selection was not saved. Resume this exact app before retrying the selection.`,
        "Partial selection");
      return;
    }
    if (plan.removed.length && !await exactAppLifecycle(root, plan.removed, "down")) return;
    if (plan.added.includes("homarr")) {
      const existingApps = selected.filter((id) => id !== "homarr" && installed.includes(id));
      if (existingApps.length > 0) {
        const attached = await offerOptionalHomarrFanIn(root, existingApps, choices, homarrChoice);
        if (!attached) {
          note("Homarr remains installed, but one or more local-only app bookmarks are unfinished. Use Review Homarr links from this panel to retry exact readback.",
            "Homarr links pending");
        }
      }
    }
    const after = await loadProjectSnapshot(root, readOnlyCliJson);
    const missing = selected.filter((id) => !after.apps.some((app) => app.id === id && app.stage === "applied"));
    if (missing.length) {
      note(`${missing.join(", ")} is not fully applied. The active selection was not saved; inspect each exact app checkpoint.`, "Partial selection");
      return;
    }
    const activeAfter = [...selected];
    const optionalHomarrAdded = !installed.includes("homarr") && !selected.includes("homarr")
      && after.apps.some((app) => app.id === "homarr" && app.stage === "applied");
    if (optionalHomarrAdded) {
      if (!await firstRunVerified(root, "homarr")) {
        note("Optional Homarr has no verified running first-run checkpoint. The active selection was not saved; resume its exact project first.",
          "Homarr setup pending");
        return;
      }
      activeAfter.push("homarr");
    }
    await saveExcludedAppIds(root, after.apps.map((app) => app.id).filter((id) => !activeAfter.includes(id)));
    note(`Saved active selection: ${activeAfter.join(", ") || "none"}. Removed apps keep their data and can be selected again.`, "Selection saved");
  }

  async function controlPanelFlow(initialSnapshot: ProjectSnapshot): Promise<void> {
    if (initialSnapshot.shared.length > 0) {
      await sharedControlPanelFlow(initialSnapshot);
      return;
    }
    const root = initialSnapshot.root;
    let snapshot = initialSnapshot;
    const initialController = new AbortController();
    let enrichmentController = initialController;
    let enrichment = enrichProjectSnapshot(snapshot,
      (args) => readOnlyCliJson(args, initialController.signal));
    void enrichment.catch(() => {});
    while (true) {
      const excluded = await excludedAppIds(root);
      note(controlPanelSummary(snapshot, false, excluded), "Saved project");
      const action = stopIfCancelled(await select({
        message: "What would you like to do?",
        options: [
          { value: "status", label: "Refresh status and image updates", hint: "Checks exact Docker projects and the registry" },
          { value: "apps", label: "Change app selection", hint: "Search, Space to toggle, Enter to review" },
          { value: "new-project", label: "Select apps for a new project", hint: "Choose a separate project directory" },
          ...(!excluded.includes("homarr")
            && snapshot.apps.some((app) => app.id === "homarr" && app.stage === "applied")
            ? [{ value: "homarr-links", label: "Review Homarr dashboard", hint: "Tiles, stack Notebook, and native app connections" }]
            : []),
          { value: "up", label: "Start selected apps", hint: "Exact Compose projects, data preserved" },
          { value: "down", label: "Stop selected apps", hint: "Exact Compose projects, data preserved" },
          { value: "resume", label: "Continue saved setup", hint: "Accounts, Homarr, and recovery checkpoints" },
          { value: "update-cli", label: "Check for CLI update", hint: "Private release, reviewed before installation" },
          { value: "plan", label: "Plan another stack", hint: "Legacy planning and catalog options" },
          { value: "exit", label: "Exit" },
        ],
      }));
      if (action === "exit") {
        enrichmentController.abort();
        outro("No further change requested.");
        return;
      }
      if (action === "resume") {
        enrichmentController.abort();
        await resumeFlow(root);
        return;
      }
      if (action === "new-project") {
        enrichmentController.abort();
        await createSelectedProjectFlow(root);
        return;
      }
      if (action === "plan") {
        enrichmentController.abort();
        await planFlow(root);
        return;
      }
      if (action === "update-cli") {
        if (await offerCliUpdate()) {
          enrichmentController.abort();
          return;
        }
      }
      if (action === "status") {
        snapshot = await enrichment;
        note(controlPanelSummary(snapshot, true, excluded), "Current project checks");
      }
      if (action === "apps") {
        if (snapshot.apps.length === 0 && snapshot.shared.length === 0
          && !snapshot.owners.cli && !snapshot.owners.stack && !snapshot.owners.appBatch
          && snapshot.owners.bundles.length === 0) {
          await createSharedProject(root, { invoke, runJsonCli, stopIfCancelled, offerHomarrMcp });
        } else await changeSelectedApps(root, snapshot, enrichment);
      }
      if (action === "homarr-links") {
        const currentExcluded = await excludedAppIds(root);
        if (currentExcluded.includes("homarr")) {
          note("Homarr is excluded from the active selection. Re-select it before changing its board.",
            "Homarr links deferred");
          continue;
        }
        const localOnly: string[] = [];
        const connected: string[] = [];
        for (const app of snapshot.apps) {
          if (app.id === "homarr" || app.stage !== "applied" || currentExcluded.includes(app.id)) continue;
          const value = await readOnlyCliJson(["app", "status", "--id", app.id,
            "--project-root", root, "--json"]) as { command?: unknown; appId?: unknown;
            projectRoot?: unknown; status?: unknown; homarrNetwork?: unknown };
          if (value.command === "app status" && value.appId === app.id
            && value.projectRoot === root && value.status === "applied") {
            if (value.homarrNetwork === null) localOnly.push(app.id);
            else if (typeof value.homarrNetwork === "string") connected.push(app.id);
          }
        }
        if (localOnly.length === 0 && connected.length === 0) {
          note("There are no active app projects with a verified Homarr attachment route.", "No dashboard apps to review");
        }
        if (localOnly.length > 0) {
          const choices = recipeCatalog();
          const attached = await offerOptionalHomarrFanIn(root, localOnly, choices,
            choices.find((choice) => choice.appId === "homarr"));
          if (!attached) note("No full local-only Homarr readback was recorded. You can retry this panel action after checking each exact app.",
            "Homarr links pending");
        }
        for (const id of connected) {
          const attached = await offerConnectedHomarrApp(root, id);
          if (!attached) note(`${id} has no full dashboard read-back yet. Resume that app's exact project before retrying.`,
            "Homarr app pending");
        }
      }
      if (action === "up" || action === "down") {
        const currentExcluded = await excludedAppIds(root);
        const active = snapshot.apps.map((app) => app.id).filter((id) => !currentExcluded.includes(id));
        await exactAppLifecycle(root, active, action);
      }
      enrichmentController.abort();
      snapshot = await loadProjectSnapshot(root, readOnlyCliJson);
      const nextController = new AbortController();
      enrichmentController = nextController;
      enrichment = enrichProjectSnapshot(snapshot,
        (args) => readOnlyCliJson(args, nextController.signal));
      void enrichment.catch(() => {});
    }
  }

  async function createSelectedProjectFlow(openedRoot?: string): Promise<void> {
    const root = await chooseRoot(true, openedRoot !== undefined);
    if (root === openedRoot) throw new Error("Choose a different directory for the new project.");
    const snapshot = await loadProjectSnapshot(root, readOnlyCliJson);
    if (openedRoot && (snapshot.apps.length > 0 || snapshot.owners.project || snapshot.owners.cli
      || snapshot.owners.stack || snapshot.owners.appBatch || snapshot.owners.bundles.length > 0
      || snapshot.shared.length > 0)) {
      throw new Error("The chosen directory already has a saved project. Choose an unused directory for the new project.");
    }
    const created = await createSharedProject(root, { invoke, runJsonCli, stopIfCancelled, offerHomarrMcp });
    if (created === false) outro("No app was installed. The project directory can be used again later.");
  }

  return { savedControlPanelRoot, controlPanelFlow, createSelectedProjectFlow, offerCliUpdate };
}
