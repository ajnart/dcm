import { homarrSeedNativeEligibility, inspectHomarrStackService, type HomarrStackSeedService } from "./homarr-stack-seed.ts";
import { homarrCatalogReadProcedures, homarrStackMapping } from "./homarr-stack-mapping.ts";
import { homarrReadShapeMatches, homarrVerificationSourceCommit } from "./homarr-read-contract.ts";

/** Version-specific contract; not an attestation of a deployed image's source revision. */
export { homarrVerificationSourceCommit };
/** The shared owner may expose only these fixed, read-only functional queries. */
export const homarrFunctionalReadProcedures = homarrCatalogReadProcedures();
export type HomarrVerificationConfiguration = Omit<HomarrStackSeedService, "credentials"> & {
  boardName: string;
};
/** Caller owns authentication, endpoint restrictions, timeouts and approval scope. No write transport. */
export type HomarrVerificationContext = {
  sourceCommit: string;
  /** An injectable clock for deterministic date-bound contract reads. */
  now?: Date;
  query(procedure: string, input?: unknown): Promise<unknown>;
};
export type HomarrCheck = {
  status: "pass" | "fail" | "not-run";
  reason: string;
  procedure?: string;
};
type Row = Record<string, unknown>;
function row(value: unknown): value is Row { return !!value && typeof value === "object" && !Array.isArray(value); }
function check(status: HomarrCheck["status"], reason: string, procedure?: string): HomarrCheck {
  return { status, reason, ...(procedure ? { procedure } : {}) };
}
function queryFailure(error: unknown): string {
  // HomarrAttachClient emits this bounded transport message, never response bodies.
  if (error instanceof Error) {
    const status = /^Homarr [A-Za-z.]+: HTTP (400|401|403|404|405|408|429|500|502|503|504); inspect credentials, access and live schema$/.exec(error.message);
    if (status) return `homarr-query-http-${status[1]}`;
  }
  return "service-query-failed";
}


/** Actual Homarr-server queries. Never serializes inventories, credentials, URLs, data or exceptions. */
export async function verifyHomarrService(configuration: HomarrVerificationConfiguration, privateHttpContext: HomarrVerificationContext) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(configuration.id) || configuration.id.length > 47) {
    throw new Error("Homarr verification requires a catalog service identity");
  }
  const checks = {
    tile: check("not-run", "source-contract-unavailable"),
    reachability: check("not-run", "source-contract-unavailable"),
    integrationTest: check("not-run", "read-only-procedure-unavailable"),
    // A second API read is not a browser reload or rendered-content observation.
    reload: check("not-run", "browser-reload-not-observed"),
  };
  const widgets: { kind: string; structure: HomarrCheck; data: HomarrCheck }[] = [];
  const report = { serviceId: configuration.id, mutation: false, sourceCommit: homarrVerificationSourceCommit,
    deployedSourceRevisionVerified: false, checks, widgets, renderedContentVerified: false };
  if (privateHttpContext.sourceCommit !== homarrVerificationSourceCommit) return report;
  if (!homarrSeedNativeEligibility(configuration).eligible) {
    checks.integrationTest = check("not-run", "native-recipe-or-transport-blocked");
    return report;
  }
  const reads = new Map<string, Promise<unknown>>();
  const mapping = homarrStackMapping(configuration.id);
  const now = privateHttpContext.now ?? new Date();
  const client = { query(procedure: string, input?: unknown) {
    const key = JSON.stringify([procedure, input ?? null]);
    if (!reads.has(key)) {
      if (reads.size >= 64) throw new Error("Homarr verification query limit exceeded");
      reads.set(key, privateHttpContext.query(procedure, input));
    }
    return reads.get(key)!;
  },
    async mutate(): Promise<never> { throw new Error("Homarr verification is read-only"); } };
  let structure;
  let apps: unknown;
  try {
    structure = await inspectHomarrStackService(client, configuration.boardName, { ...configuration, credentials: {} });
    apps = await client.query("app.all");
  } catch {
    checks.tile = check("fail", "resource-readback-failed");
    checks.reachability = check("not-run", "exact-tile-unverified");
    return report;
  }
  const candidates = Array.isArray(apps) ? apps.filter((app) => row(app) && app.name === configuration.appName) : [];
  const app = candidates[0];
  if (candidates.length !== 1 || !row(app) || typeof app.id !== "string" || app.href !== configuration.browserUrl) {
    checks.tile = check("fail", "exact-app-missing");
    checks.reachability = check("not-run", "exact-tile-unverified");
  } else {
    // The existing inspector validates duplicates but does not report tile presence.
    try {
      const board = await client.query("board.getBoardByName", { name: configuration.boardName });
      const tiles = row(board) && Array.isArray(board.items)
        ? board.items.filter((item) => row(item) && item.kind === "app" && row(item.options) && item.options.appId === app.id) : [];
      if (tiles.length === 1) checks.tile = check("pass", "exact-private-board-tile-present");
      else checks.tile = check("fail", "exact-tile-missing");
    } catch { checks.tile = check("fail", "resource-readback-failed"); }
    if (checks.tile.status !== "pass") checks.reachability = check("not-run", "exact-tile-unverified");
    else if ((app.pingUrl ?? app.href) !== configuration.serverUrl) {
      // Homarr sends the request before returning its target. Check scope first.
      checks.reachability = check("not-run", "saved-server-target-mismatch");
    }
    else {
      try {
        const response = await client.query("widget.app.ping", { id: app.id });
        if (!row(response) || response.url !== configuration.serverUrl) {
          checks.reachability = check("fail", "server-target-mismatch", "widget.app.ping");
        } else if (typeof response.statusCode === "number" && Number.isInteger(response.statusCode)
          && response.statusCode >= 200 && response.statusCode < 400 && !response.error) {
          checks.reachability = check("pass", "homarr-server-http-response", "widget.app.ping");
        } else checks.reachability = check("fail", "homarr-server-http-failed", "widget.app.ping");
      } catch { checks.reachability = check("fail", "homarr-server-query-failed", "widget.app.ping"); }
    }
  }
  if (structure.tileOnly) checks.integrationTest = check("not-run", "tile-only-service");
  for (const widget of structure.widgets) {
    const entry = { kind: widget.kind, structure: check("fail", "widget-missing"), data: check("not-run", "widget-missing") };
    widgets.push(entry);
    if (!widget.present) continue;
    entry.structure = check("pass", "exact-widget-present");
    if (!structure.integrationStructureVerified || !structure.integrationId) {
      entry.data = check("not-run", "exact-integration-unverified"); continue;
    }
    const query = mapping?.verification?.widgets.find((contract) => contract.kind === widget.kind);
    if (!query) { entry.data = check("not-run", "widget-query-not-supported"); continue; }
    if (mapping?.verification?.sourceCommit !== privateHttpContext.sourceCommit) {
      entry.data = check("not-run", "source-contract-unavailable"); continue;
    }
    const input: Record<string, unknown> = { ...query.input };
    if (query.inputMode === "many") input.integrationIds = [structure.integrationId];
    else input.integrationId = structure.integrationId;
    let missing = false;
    for (const [name, prerequisite] of Object.entries(query.inputBindings ?? {})) {
      const value = configuration.prerequisites?.[prerequisite];
      if (!value) { missing = true; break; }
      input[name] = value;
    }
    if (missing) { entry.data = check("not-run", "prerequisite-not-configured"); continue; }
    if (query.dateBindings && !Number.isFinite(now.getTime())) {
      entry.data = check("not-run", "query-date-unavailable"); continue;
    }
    for (const [name, part] of Object.entries(query.dateBindings ?? {})) {
      if (part === "year") input[name] = now.getUTCFullYear();
      else input[name] = now.getUTCMonth() + 1;
    }
    try {
      const response = await client.query(query.procedure, input);
      if (query.inputMode === "many" && query.envelope === "direct"
        && (!row(response) || response.integrationId !== structure.integrationId)) {
        entry.data = check("fail", "service-query-failed", query.procedure); continue;
      }
      let data = response;
      if (query.inputMode === "many" && query.envelope !== "direct" && query.field !== null) {
        const matches = Array.isArray(response) ? response.filter((value) => row(value)
          && (value.integrationId === structure.integrationId || (row(value.integration) && value.integration.id === structure.integrationId))) : [];
        if (matches.length !== 1 || !row(matches[0]) || matches[0].error) {
          entry.data = check("fail", "service-query-failed", query.procedure); continue;
        }
        data = matches[0][query.field];
      } else {
        if (query.inputMode === "many" && query.envelope !== "direct" && Array.isArray(response)) {
          if (response.length !== 1 || !row(response[0]) || response[0].error
            || !(response[0].integrationId === structure.integrationId
              || (row(response[0].integration) && response[0].integration.id === structure.integrationId))) {
            entry.data = check("fail", "service-query-failed", query.procedure); continue;
          }
        }
        if (row(response) && (response.error || (response.integrationId !== undefined && response.integrationId !== structure.integrationId))) {
          entry.data = check("fail", "service-query-failed", query.procedure); continue;
        }
        if (query.field !== null) {
          if (!row(response)) { entry.data = check("fail", "service-query-invalid-data", query.procedure); continue; }
          data = response[query.field];
        }
      }
      if (homarrReadShapeMatches(data, query.shape, { integrationId: structure.integrationId })) entry.data = check("pass", "service-query-data-readback", query.procedure);
      else entry.data = check("fail", "service-query-invalid-data", query.procedure);
    } catch (error) { entry.data = check("fail", queryFailure(error), query.procedure); }
  }
  for (const omitted of structure.omittedWidgets) widgets.push({ kind: omitted.kind,
    structure: check("not-run", "prerequisite-not-configured"), data: check("not-run", "prerequisite-not-configured") });
  return report;
}
