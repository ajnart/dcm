export type SelectionPlan = {
  added: string[];
  retained: string[];
  updated: string[];
  removed: string[];
};

/** A changed image is a review item, not permission to replace a container. */
export function selectionPlan(installed: readonly string[], selected: readonly string[],
  availableUpdates: readonly string[] = []): SelectionPlan {
  const current = new Set(installed);
  const desired = new Set(selected);
  const updates = new Set(availableUpdates);
  const plan: SelectionPlan = { added: [], retained: [], updated: [], removed: [] };
  for (const id of desired) {
    if (!current.has(id)) {
      plan.added.push(id);
      continue;
    }
    if (updates.has(id)) {
      plan.updated.push(id);
      continue;
    }
    plan.retained.push(id);
  }
  for (const id of current) {
    if (!desired.has(id)) plan.removed.push(id);
  }
  for (const list of Object.values(plan)) list.sort();
  return plan;
}
