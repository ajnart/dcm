import type { RecipeChoice } from "../interactive-catalog.ts";
import type { ProjectSnapshot } from "./project-snapshot.ts";
import { sharedIntentSelection, type SharedIntentSelection } from "./shared-intent.ts";

type SharedProject = ProjectSnapshot["shared"][number];
type Dependencies = {
  chooseProject: (projects: SharedProject[]) => Promise<string>;
  review: (selection: SharedIntentSelection) => Promise<boolean>;
  blocked: (details: string[]) => void;
  resume: (root: string) => Promise<void>;
  create: (root: string, apps: string[]) => Promise<unknown>;
  add: (root: string, project: SharedProject, apps: string[]) => Promise<boolean>;
  setup: (root: string, id: string, apps: string[]) => Promise<unknown>;
  homarr: (root: string, id: string, apps: string[]) => Promise<unknown>;
};

/** Terminal goal continuation: never substitute an independent owner for a shared gap. */
export async function continueSharedGoal(plan: unknown, recipes: RecipeChoice[],
  snapshot: ProjectSnapshot, dependencies: Dependencies): Promise<void> {
  const { root } = snapshot;
  const legacyOwner = snapshot.apps.length > 0 || snapshot.owners.cli || snapshot.owners.stack
    || snapshot.owners.appBatch || snapshot.owners.bundles.length > 0;
  if (legacyOwner) {
    if (snapshot.shared.length > 0) {
      dependencies.blocked(["Shared and legacy owners coexist. Review their exact ownership before extending this goal."]);
      return;
    }
    dependencies.blocked(["Retain the saved legacy owner; continue its upkeep instead of creating another owner."]);
    await dependencies.resume(root);
    return;
  }
  let project = snapshot.shared[0];
  if (snapshot.shared.length > 1) {
    const id = await dependencies.chooseProject(snapshot.shared);
    project = snapshot.shared.find((item) => item.id === id);
    if (!project) throw new Error("Selected shared owner is not in the inspected project");
  }
  const conflicts: string[] = [];
  if (project && project.stage !== "completed") {
    conflicts.push("Resume the unfinished shared owner before extending its goals.");
  }
  const selection = sharedIntentSelection(plan, recipes, {
    existingAppIds: project?.apps.map((app) => app.id),
    existingRecipeSha256: Object.fromEntries((project?.apps ?? []).map((app) => [app.id, app.recipeSha256])),
    conflicts,
  });
  if (selection.status !== "ready") {
    dependencies.blocked(selection.gaps.map((gap) => gap.detail));
    return;
  }
  if (!await dependencies.review(selection)) return;
  if (!project) {
    await dependencies.create(root, selection.composeApps);
    return;
  }
  if (selection.missing.length > 0) {
    if (!await dependencies.add(root, project, selection.missing)) return;
  }
  await dependencies.setup(root, project.id, selection.composeApps);
  if (selection.composeApps.includes("homarr")) {
    await dependencies.homarr(root, project.id,
      [...new Set([...selection.retained, ...selection.composeApps])]);
  }
}
