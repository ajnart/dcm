import { confirm, note } from "@clack/prompts";
import { isAbsolute, resolve } from "node:path";
import { serviceLinks, type ServiceLinkOwner } from "../lib/service-links.ts";
import { MAX_SHARED_APPS } from "../lib/shared-project-limits.ts";
import { sharedSetupStepBatch } from "./shared-setup-inputs.ts";

type Report = Record<string, unknown>;
type Dependencies = {
  runJsonCli(args: string[], progress: string): Promise<Report>;
  stopIfCancelled<T>(value: T | symbol): T;
};
export type SharedConnectionOutcome = {
  source: string; target: string; linkId: string;
  state: "deferred" | "pending" | "verified"; detail: string;
};
const pending = "Connection not verified; inspect saved setup and connection checkpoints before retrying.";
function fail(): never { throw new Error("Shared connection report differs from its reviewed owner or pair"); }
function object(value: unknown): Report {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Report;
}
function owner(value: unknown, root: string, projectId: string): ServiceLinkOwner {
  const row = object(value);
  if (row.projectRoot !== root || row.projectId !== projectId
    || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1
    || typeof row.manifestHash !== "string" || !/^[a-f0-9]{64}$/.test(row.manifestHash)) fail();
  return { projectRoot: root, projectId, revision: Number(row.revision), manifestHash: row.manifestHash };
}
function checkedReport(value: unknown, action: "plan" | "apply", root: string, projectId: string,
  source: string, target: string, reviewed?: ServiceLinkOwner): Report {
  const result = object(value);
  if (result.command !== `connect ${action}` || result.source !== source || result.target !== target) fail();
  const actual = owner(result.owner, root, projectId);
  if (reviewed && (actual.revision !== reviewed.revision || actual.manifestHash !== reviewed.manifestHash)) fail();
  return result;
}

export function sharedConnectionPairs(selected: readonly string[]) {
  return serviceLinks.filter((link) => selected.includes(link.source) && selected.includes(link.target));
}

/** Discover descriptor-owned pairs only; all requests and mutations stay in connect's exact-owner engine. */
export async function runSharedConnections(root: string, projectId: string, selected: readonly string[],
  { runJsonCli, stopIfCancelled }: Dependencies): Promise<SharedConnectionOutcome[]> {
  if (!isAbsolute(root) || resolve(root) !== root || !/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(projectId)
    || !Array.isArray(selected) || selected.length > MAX_SHARED_APPS
    || new Set(selected).size !== selected.length
    || selected.some((id) => typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))) fail();
  const pairs = sharedConnectionPairs(selected);
  const outcomes: SharedConnectionOutcome[] = [];
  for (const { source, target } of pairs) {
    const outcome: SharedConnectionOutcome = { source, target, linkId: `${source}-to-${target}`, state: "pending", detail: pending };
    const args = ["--project-root", root, "--project-id", projectId, "--source", source, "--target", target];
    let reviewed: ServiceLinkOwner;
    let token: string;
    let prerequisites: string[];
    try {
      const plan = checkedReport(await runJsonCli(["connect", "plan", ...args, "--json"],
        `Reviewing ${source} → ${target}`), "plan", root, projectId, source, target);
      if (plan.mutation !== false || typeof plan.approval !== "string"
        || !new RegExp(`^CONNECT:${projectId}:[a-f0-9]{64}$`).test(plan.approval)) fail();
      if (!Array.isArray(plan.prerequisites) || plan.prerequisites.length > 16
        || plan.prerequisites.some((item) => typeof item !== "string" || !item.length || item.length > 512
          || /[\u0000-\u001f\u007f]/.test(item))) fail();
      prerequisites = plan.prerequisites as string[];
      reviewed = owner(plan.owner, root, projectId);
      token = plan.approval;
    } catch {
      outcomes.push(outcome);
      continue;
    }
    note(`${source} → ${target}: review the supported API connection in this shared project.\n`
      + `${prerequisites.join("\n")}\n`
      + "Media indexers, requests, downloads and restart acceptance remain unverified.", "Service connection");
    const approved = stopIfCancelled(await confirm({ message: `Connect ${source} to ${target} using this exact shared owner?`, initialValue: false }));
    if (!approved) {
      outcome.state = "deferred";
      outcome.detail = "Connection approval declined; this pair was not applied.";
      outcomes.push(outcome);
      continue;
    }
    const stepTokens = new Set<string>();
    for (let round = 0; round < 64; round += 1) {
      let steps: ReturnType<typeof sharedSetupStepBatch>;
      try {
        const applyArgs = ["connect", "apply", ...args, "--approve", token];
        for (const accepted of stepTokens) applyArgs.push("--approve-step", accepted);
        const result = checkedReport(await runJsonCli([...applyArgs, "--json"],
          `Connecting ${source} → ${target}`), "apply", root, projectId, source, target, reviewed);
        if (typeof result.mutation !== "boolean") fail();
        steps = sharedSetupStepBatch(result.stepApprovals, [source, target]);
        if (steps.some((step) => !new RegExp(`^APP-SETUP-${step.action.toUpperCase()}:${step.appId}:[a-f0-9]{64}$`).test(step.token)
          || /[\u0000-\u001f\u007f]/.test(step.progress))) fail();
        if (result.status === "api-link-verified") {
          const verified = checkedReport({ ...object(result.outcome), command: "connect apply" },
            "apply", root, projectId, source, target, reviewed);
          if (steps.length !== 0 || verified.status !== "api-link-verified" || verified.linkId !== outcome.linkId) fail();
          outcome.state = "verified";
          outcome.detail = "Exact saved API connection and provider readback verified; full application acceptance remains pending.";
          break;
        }
        if (result.status !== "step-review" || result.outcome !== null || steps.length === 0
          || steps.some((step) => stepTokens.has(step.token))) fail();
      } catch {
        break;
      }
      if (round === 63) break;
      note(steps.map((step) => `${step.appId}: ${step.progress}`).join("\n"), "Review exact connection steps");
      const allow = stopIfCancelled(await confirm({ message: "Approve all these exact connection steps?", initialValue: false }));
      if (!allow) {
        outcome.state = "deferred";
        outcome.detail = "Further connection steps declined; saved progress retained and verification remains unfinished.";
        break;
      }
      for (const step of steps) {
        const prefix = step.token.slice(0, step.token.lastIndexOf(":"));
        for (const accepted of stepTokens) if (accepted.startsWith(`${prefix}:`)) stepTokens.delete(accepted);
        stepTokens.add(step.token);
      }
    }
    outcomes.push(outcome);
  }
  if (outcomes.length > 0) note(outcomes.map((item) => `${item.source} → ${item.target}: ${item.state}. ${item.detail}`).join("\n"), "Service connection recap");
  return outcomes;
}
