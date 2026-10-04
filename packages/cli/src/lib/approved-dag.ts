export type ApprovedJob = {
  id: string;
  needs: readonly string[];
  owns: readonly string[];
  run: () => Promise<boolean>;
};

export type JobResult = { id: string; status: "applied" | "inspect-checkpoint" | "blocked" };
export type JobTransition = (id: string, status: "launch-attempted" | JobResult["status"]) => Promise<void>;

export async function runApprovedDag(jobs: readonly ApprovedJob[], completed: ReadonlySet<string>,
  concurrency: number, onTransition?: JobTransition): Promise<JobResult[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error("Approved job concurrency must be between 1 and 8");
  }
  const ids = new Set<string>();
  const ownership = new Map<string, string[]>();
  for (const job of jobs) {
    if (!job.id || ids.has(job.id) || completed.has(job.id) || !job.owns.length) {
      throw new Error("Approved jobs need unique pending IDs and explicit ownership");
    }
    ids.add(job.id);
    const ownResources = new Set<string>();
    for (const resource of job.owns) {
      if (!resource || ownResources.has(resource)) {
        throw new Error(`Approved job ${job.id} has invalid or repeated ownership: ${resource}`);
      }
      ownResources.add(resource);
      ownership.set(resource, [...(ownership.get(resource) ?? []), job.id]);
    }
  }
  for (const job of jobs) {
    if (job.needs.some((need) => need === job.id || (!ids.has(need) && !completed.has(need)))) {
      throw new Error(`Approved job ${job.id} has an unknown or self dependency`);
    }
  }
  const reachable = new Set(completed);
  const unresolved = new Map(jobs.map((job) => [job.id, job]));
  while (unresolved.size) {
    const ready = [...unresolved.values()].filter((job) => job.needs.every((need) => reachable.has(need)));
    if (!ready.length) throw new Error("Approved job dependencies contain a cycle");
    for (const job of ready) {
      unresolved.delete(job.id);
      reachable.add(job.id);
    }
  }
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const dependsOn = (id: string, ancestor: string, seen = new Set<string>()): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    const job = byId.get(id);
    if (!job) return false;
    return job.needs.some((need) => need === ancestor || dependsOn(need, ancestor, seen));
  };
  // A later stage may reuse its prerequisite's resources; independent owners may not.
  for (const [resource, owners] of ownership) {
    for (let left = 0; left < owners.length; left += 1) {
      for (let right = left + 1; right < owners.length; right += 1) {
        if (!dependsOn(owners[left], owners[right])
          && !dependsOn(owners[right], owners[left])) {
          throw new Error(`Approved jobs share unordered mutable ownership: ${resource}`);
        }
      }
    }
  }
  const pending = new Map(jobs.map((job) => [job.id, job]));
  const outcomes = new Map<string, JobResult["status"]>();
  while (pending.size) {
    const blocked = [...pending.values()].filter((job) => job.needs.some((need) => {
      const status = outcomes.get(need);
      return status === "inspect-checkpoint" || status === "blocked";
    }));
    for (const job of blocked) {
      pending.delete(job.id);
      outcomes.set(job.id, "blocked");
      await onTransition?.(job.id, "blocked");
    }
    const ready = [...pending.values()].filter((job) => job.needs.every((need) =>
      completed.has(need) || outcomes.get(need) === "applied"));
    const batch: ApprovedJob[] = [];
    const batchOwnership = new Set<string>();
    for (const job of ready) {
      if (batch.length === concurrency) break;
      if (job.owns.some((resource) => batchOwnership.has(resource))) continue;
      batch.push(job);
      for (const resource of job.owns) batchOwnership.add(resource);
    }
    for (const job of batch) pending.delete(job.id);
    const progressErrors = await Promise.all(batch.map(async (job) => {
      try { await onTransition?.(job.id, "launch-attempted"); }
      catch (error) { return error; }
      let ok = false;
      try { ok = await job.run(); }
      catch { /* The checkpoint must be inspected before any retry. */ }
      const status = ok ? "applied" : "inspect-checkpoint";
      outcomes.set(job.id, status);
      try { await onTransition?.(job.id, status); }
      catch (error) { return error; }
      return null;
    }));
    const progressError = progressErrors.find((error) => error !== null);
    if (progressError) throw progressError;
  }
  return jobs.map((job) => ({ id: job.id, status: outcomes.get(job.id)! }));
}
