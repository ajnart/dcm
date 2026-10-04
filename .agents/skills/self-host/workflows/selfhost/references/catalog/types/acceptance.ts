import type { SetupContext, SetupRecord } from "./setup";

/** checkpoint is an isolated acceptance ledger, never the first-run ledger. */
export type AcceptanceContext = Pick<SetupContext,
  "appId" | "projectRoot" | "status" | "http" | "checkpoint" | "secrets"> & {
    /** Reviewed workload selection, bound to the dispatcher's exact approval. */
    inputs?: Readonly<Record<string, string>>;
  };

/** Trusted, persisted observations supplied by the shared lifecycle dispatcher,
 * never caller-provided strings or a pair of application HTTP reads.
 * sequence increases within this exact owner lineage; epoch identifies a start.
 */
export type AcceptanceRuntimeEvidence = {
  source: "shared-selected-lifecycle";
  appId: string;
  projectRoot: string;
  ownerId: string;
  recipeSha256: string;
  manifestHash: string;
  units: readonly { serviceId: string; imageId: string }[];
  epoch: string;
  sequence: number;
  evidenceId: string;
  state: "running" | "stopped";
};

export type AcceptanceAdapter = {
  appId: string;
  source: string;
  inputDefinitions?: readonly { key: string; label: string }[];
  begin(context: AcceptanceContext, running: AcceptanceRuntimeEvidence): Promise<SetupRecord>;
  finish(context: AcceptanceContext, restart: {
    stopped: AcceptanceRuntimeEvidence;
    running: AcceptanceRuntimeEvidence;
  }): Promise<SetupRecord>;
};
