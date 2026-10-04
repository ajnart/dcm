import { createHash } from "node:crypto";
import { homarrNativeEligibility, homarrStackMapping, homarrStackWidgets } from "./homarr-stack-mapping.ts";
import { ownedHomarrTransportMatches, type OwnedHomarrTransport } from "./shared-homarr-transport.ts";

type Row = Record<string, unknown>;
export type HomarrStackSeedClient = {
  query(procedure: string, input?: unknown): Promise<unknown>;
  mutate(procedure: string, input: unknown): Promise<unknown>;
};
export type HomarrStackSeedService = {
  id: string;
  appName: string;
  browserUrl: string;
  serverUrl: string;
  integrationUrl?: string;
  nativeRecipe?: unknown;
  ownedTransport?: OwnedHomarrTransport;
  /** Private caller-owned values: never serialize this input to an artifact. */
  credentials: Record<string, string>;
  prerequisites?: Parameters<typeof homarrStackWidgets>[1];
};
function fail(message: string): never { throw new Error(message); }
function row(value: unknown): value is Row { return value !== null && typeof value === "object" && !Array.isArray(value); }
function rows(value: unknown, name: string): Row[] {
  if (!Array.isArray(value) || !value.every(row)) fail(`Homarr ${name} response has an unsupported shape`);
  return value;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (row(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function digest(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function validateUrl(value: string): void {
  let parsed: URL;
  try { parsed = new URL(value); } catch { fail("Homarr service URL is invalid"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail("Homarr service URLs must be credential-free HTTP(S) URLs");
  }
}
function validateServices(services: HomarrStackSeedService[]): void {
  if (!services.length || new Set(services.map((service) => service.id)).size !== services.length) fail("Homarr stack services must be nonempty and unique");
  for (const service of services) {
    if (!service.appName || service.appName.length > 127 || /[\u0000-\u001f]/.test(service.appName)) fail("Homarr app name is invalid");
    validateUrl(service.browserUrl); validateUrl(service.serverUrl);
    const mapping = homarrStackMapping(service.id);
    if (!mapping) fail("Homarr seed service is unsupported or internal-only");
    integrationUrl(service);
    if (!mapping.integrationKind) continue;
    const allowed = new Set([...mapping.requiredSecrets, ...(mapping.alternativeSecrets ?? []).flat()]);
    for (const [kind, value] of Object.entries(service.credentials)) {
      if (!allowed.has(kind) || typeof value !== "string" || !value) fail("Homarr integration credentials have missing or unsupported fields");
    }
    const sets = [mapping.requiredSecrets, ...(mapping.alternativeSecrets ?? [])];
    if (!sets.some((required) => required.every((kind) => Boolean(service.credentials[kind])))) fail("Homarr integration credentials are incomplete");
  }
}
/** Source-guarded callers must supply the actual restored owner recipe, not eligibility booleans. */
export function homarrSeedNativeEligibility(service: Omit<HomarrStackSeedService, "credentials">) {
  const mapping = homarrStackMapping(service.id);
  const eligibility = homarrNativeEligibility(mapping, service.nativeRecipe, service.ownedTransport);
  if (!eligibility.eligible) return eligibility;
  if (mapping?.nativeTransportRequirement && (!service.integrationUrl
    || !ownedHomarrTransportMatches(service.ownedTransport, service.nativeRecipe,
      mapping.nativeRecipeSha256!, service.integrationUrl))) return { eligible: false,
    reasonCode: "native-owned-https-unverified", requirement: "The integration URL must match the verified same-owner HTTPS transport." };
  return eligibility;
}
function integrationUrl(service: HomarrStackSeedService): string {
  if (!homarrSeedNativeEligibility(service).eligible) fail("Homarr native integration is blocked by its reviewed recipe or transport requirements");
  const url = service.integrationUrl ?? service.serverUrl;
  validateUrl(url);
  return url;
}
async function readBoard(client: HomarrStackSeedClient, boardName: string): Promise<Row & { items: Row[] }> {
  const summaries = rows(await client.query("board.getAllBoards"), "board inventory");
  const matches = summaries.filter((board) => board.name === boardName);
  const board = await client.query("board.getBoardByName", { name: boardName });
  if (matches.length !== 1 || !row(board) || board.id !== matches[0].id || board.name !== boardName || board.isPublic !== false
    || matches[0].isPublic !== false || typeof board.id !== "string") fail("Homarr requires exactly one private board");
  const items = rows(board.items, "board items");
  rows(board.sections, "board sections");
  if (items.some((item) => typeof item.id !== "string") || new Set(items.map((item) => item.id)).size !== items.length) fail("Homarr board has invalid or duplicate item IDs");
  return { ...board, items };
}
function integrationName(service: HomarrStackSeedService): string { return `Auto-Stack: ${service.id}`; }
function findIntegration(inventory: Row[], service: HomarrStackSeedService): Row | null {
  const mapping = homarrStackMapping(service.id)!;
  const candidates = inventory.filter((entry) => entry.name === integrationName(service)
    || (entry.kind === mapping.integrationKind && entry.url === integrationUrl(service)));
  if (!candidates.length) return null;
  if (candidates.length !== 1) fail("Homarr integration ownership is ambiguous; inspect before retrying");
  const entry = candidates[0];
  if (entry.name !== integrationName(service) || entry.kind !== mapping.integrationKind || entry.url !== integrationUrl(service)
    || typeof entry.id !== "string" || !row(entry.permissions) || entry.permissions.hasFullAccess !== true || entry.permissions.hasUseAccess !== true) {
    fail("An existing Homarr integration conflicts with the managed stack; nothing was overwritten");
  }
  return entry;
}
async function assertLinked(client: HomarrStackSeedClient, integration: Row, app: Row, service: HomarrStackSeedService): Promise<Row> {
  const detail = await client.query("integration.byId", { id: integration.id });
  if (!row(detail) || detail.id !== integration.id || detail.kind !== integration.kind || detail.url !== integrationUrl(service)
    || detail.name !== integrationName(service) || !row(detail.app) || detail.app.id !== app.id) fail("Homarr integration is not linked to the exact app");
  const metrics = homarrStackMapping(service.id)?.widgets.find((widget) => widget.kind === "stats")?.metrics;
  let statsCatalog: Row[] = [];
  if (metrics) {
    const catalog = await client.query("widget.stats.catalog", { integrationId: integration.id });
    if (!row(catalog) || catalog.name !== integrationName(service)) fail("Homarr stats catalog is not linked to the exact integration");
    statsCatalog = rows(catalog.metrics, "stats catalog");
    if (statsCatalog.length > 100 || new Set(statsCatalog.map((metric) => metric.key)).size !== statsCatalog.length
      || statsCatalog.some((metric) => typeof metric.key !== "string" || typeof metric.label !== "string"
        || !["count", "bytes", "grams", "percent", "seconds", "milliseconds", "bytesPerSecond", "text"].includes(String(metric.unit)))
      || metrics.some((key) => !statsCatalog.some((metric) => metric.key === key))) fail("Homarr stats metrics differ from the reviewed descriptor");
    statsCatalog = statsCatalog.map(({ key, label, unit }) => ({ key, label, unit }));
  }
  // Only retain non-secret metadata in the approval snapshot.
  return { id: detail.id, name: detail.name, kind: detail.kind, url: detail.url, appId: detail.app.id, statsCatalog,
    secrets: rows(detail.secrets, "integration secret metadata").map((secret) => ({ kind: secret.kind, updatedAt: secret.updatedAt })) };
}
function findWidgets(board: Row & { items: Row[] }, integrationId: unknown, service: HomarrStackSeedService): Row[] {
  const selected = homarrStackWidgets(service.id, service.prerequisites, String(integrationId));
  const candidates = board.items.filter((item) => selected.some((widget) => widget.kind === item.kind)
    && Array.isArray(item.integrationIds) && item.integrationIds.includes(integrationId));
  for (const widget of selected) {
    const matching = candidates.filter((item) => item.kind === widget.kind);
    if (matching.length > 1 || matching.some((item) => canonical(item.integrationIds) !== canonical([integrationId])
      || Object.entries(widget.options).some(([key, value]) => !row(item.options) || canonical(item.options[key]) !== canonical(value)))) {
      fail("Homarr widget configuration conflicts with the exact managed integration");
    }
  }
  return candidates;
}
async function inspect(client: HomarrStackSeedClient, boardName: string, services: HomarrStackSeedService[]) {
  validateServices(services);
  const board = await readBoard(client, boardName);
  const settings = await client.query("board.getBoardSettings", { id: board.id });
  if (!row(settings) || settings.id !== board.id || settings.name !== boardName) fail("Homarr board modify access was not proven");
  const apps = rows(await client.query("app.all"), "app inventory");
  const inventory = rows(await client.query("integration.all"), "integration inventory");
  const kinds = rows(await client.query("integration.getKinds"), "integration kinds");
  const entries = [];
  for (const service of services) {
    const candidates = apps.filter((app) => app.name === service.appName);
    if (candidates.length !== 1 || typeof candidates[0].id !== "string" || candidates[0].href !== service.browserUrl) fail("Attach the exact app tile before planning Homarr integrations");
    const app = candidates[0];
    // app.update requires all six fields; preserve their exact saved values.
    // https://github.com/homarr-labs/homarr/blob/407acc55354bbd71634ac3e8126646730d7a2cc2/packages/validation/src/app.ts
    if (typeof app.iconUrl !== "string" || !app.iconUrl || (app.description !== null && typeof app.description !== "string")
      || (app.pingUrl !== null && app.pingUrl !== service.serverUrl)) {
      fail("Homarr app metadata or custom ping target conflicts; use a separately approved repair boundary");
    }
    const tiles = board.items.filter((item) => item.kind === "app" && row(item.options) && item.options.appId === app.id);
    if (tiles.length !== 1) fail("Homarr board must contain exactly one matching app tile");
    const mapping = homarrStackMapping(service.id)!;
    let integration: Row | null = null;
    let detail: Row | null = null;
    let widgets: Row[] = [];
    if (mapping.integrationKind) {
      const liveKinds = kinds.filter((kind) => kind.kind === mapping.integrationKind);
      if (liveKinds.length !== 1 || !Array.isArray(liveKinds[0].requiredSecrets)
        || !liveKinds[0].requiredSecrets.length || !liveKinds[0].requiredSecrets.every((group) => Array.isArray(group)
          && group.every((kind) => typeof kind === "string") && new Set(group).size === group.length)) {
        fail("Live Homarr does not advertise the selected integration schema");
      }
      const credentialKinds = Object.keys(service.credentials).sort();
      const alternatives = liveKinds[0].requiredSecrets as string[][];
      if (!alternatives.some((group) => canonical([...group].sort()) === canonical(credentialKinds))) {
        fail("Live Homarr rejects the selected credential combination");
      }
      integration = findIntegration(inventory, service);
      if (integration) {
        detail = await assertLinked(client, integration, app, service);
        widgets = findWidgets(board, integration.id, service);
      }
    }
    entries.push({ service, app, integration, detail, widgets });
  }
  return { board, apps, inventory, kinds, entries };
}
type State = Awaited<ReturnType<typeof inspect>>;
export async function inspectHomarrStackBoard(client: HomarrStackSeedClient, boardName: string) {
  const board = await readBoard(client, boardName);
  return { id: board.id, name: board.name, private: true };
}

/** Read existing resource structure only: never test a connection or create an integration. */
export async function inspectHomarrStackService(client: HomarrStackSeedClient, boardName: string,
  service: HomarrStackSeedService) {
  validateUrl(service.browserUrl);
  validateUrl(service.serverUrl);
  const mapping = homarrStackMapping(service.id);
  if (!mapping) fail("Homarr seed service is unsupported or internal-only");
  integrationUrl(service);
  const board = await readBoard(client, boardName);
  const apps = rows(await client.query("app.all"), "app inventory");
  const candidates = apps.filter((app) => app.name === service.appName);
  if (candidates.length > 1 || candidates.some((app) => typeof app.id !== "string"
    || app.href !== service.browserUrl)) fail("Homarr app metadata conflicts with the exact selected service");
  const app = candidates[0] ?? null;
  const tiles = board.items.filter((item) => app && item.kind === "app"
    && row(item.options) && item.options.appId === app.id);
  if (tiles.length > 1) fail("Homarr board has duplicate app tiles");
  let integration: Row | null = null;
  let widgets: Row[] = [];
  if (mapping.integrationKind) {
    integration = findIntegration(rows(await client.query("integration.all"), "integration inventory"), service);
    if (integration && app) {
      await assertLinked(client, integration, app, service);
      widgets = findWidgets(board, integration.id, service);
    }
  }
  const selectedWidgets = homarrStackWidgets(service.id, service.prerequisites)
    .map((widget) => ({ kind: widget.kind, present: widgets.some((item) => item.kind === widget.kind) }));
  return { integrationKind: mapping.integrationKind, integrationId: integration?.id ?? null,
    integrationStructureVerified: mapping.integrationKind === null || (integration !== null && app !== null),
    widgets: selectedWidgets, widgetStructureVerified: selectedWidgets.every((widget) => widget.present),
    omittedWidgets: mapping.widgets.filter((widget) => widget.prerequisite
      && !homarrStackWidgets(service.id, service.prerequisites).some((selected) => selected.kind === widget.kind))
      .map((widget) => ({ kind: widget.kind, prerequisite: widget.prerequisite })),
    connectionVerification: "not-retested", tileOnly: mapping.tileOnly === true };
}

function approvalFor(state: State): string {
  const services = state.entries.map(({ service, app, integration, detail, widgets }) => ({
    id: service.id, appName: service.appName, browserUrl: service.browserUrl, serverUrl: service.serverUrl,
    integrationUrl: integrationUrl(service), ownedTransport: service.ownedTransport,
    pingTarget: { old: app.pingUrl, new: service.serverUrl },
    credentials: Object.fromEntries(Object.entries(service.credentials).map(([kind, value]) => [kind, digest(value)])),
    selectedWidgets: homarrStackWidgets(service.id, service.prerequisites), app, integration, detail, widgets,
  }));
  return `HOMARR-STACK:${state.board.id}:${digest({ board: state.board, apps: state.apps, inventory: state.inventory, kinds: state.kinds, services })}`;
}
export async function planHomarrStackSeed(client: HomarrStackSeedClient, boardName: string, services: HomarrStackSeedService[]) {
  const state = await inspect(client, boardName, services);
  return { approval: approvalFor(state), boardId: state.board.id, connectionVerification: "not-observed", services: state.entries.map(({ service, app, integration, widgets }) => ({
    id: service.id, appId: app.id, integrationId: integration?.id ?? null, integrationKind: homarrStackMapping(service.id)!.integrationKind,
    tileOnly: homarrStackMapping(service.id)!.tileOnly === true,
    integrationUrl: integrationUrl(service),
    pingTarget: { old: app.pingUrl, new: service.serverUrl, changeRequired: app.pingUrl !== service.serverUrl },
    widgets: homarrStackWidgets(service.id, service.prerequisites).map((widget) => ({ kind: widget.kind,
      metrics: widget.metrics, present: widgets.some((item) => item.kind === widget.kind) })),
  })) };
}
function assertPreserved(before: State["board"], after: State["board"]): void {
  if (before.id !== after.id || after.isPublic !== false || canonical(before.sections) !== canonical(after.sections)) fail("Homarr board changed; inspect and re-plan");
  for (const item of before.items) {
    const candidate = after.items.find((entry) => entry.id === item.id);
    if (!candidate || canonical(candidate) !== canonical(item)) fail("An existing Homarr board item changed; inspect and re-plan");
  }
}
export async function applyHomarrStackSeed(client: HomarrStackSeedClient, boardName: string, services: HomarrStackSeedService[], approval: string) {
  const state = await inspect(client, boardName, services);
  if (approval !== approvalFor(state)) fail("Homarr stack approval is stale or incorrect; no writes were attempted");
  const reports = [];
  let board = state.board;
  let additions = 0;
  for (const entry of state.entries) {
    const { service, app } = entry;
    const mapping = homarrStackMapping(service.id)!;
    const pingTarget = { old: app.pingUrl, new: service.serverUrl, changed: false, persisted: false };
    if (app.pingUrl !== service.serverUrl) {
      const beforeApps = rows(await client.query("app.all"), "app inventory");
      const before = beforeApps.filter((candidate) => candidate.id === app.id);
      if (before.length !== 1 || canonical(before[0]) !== canonical(app)) fail("Homarr app changed after approval; inspect and re-plan");
      try {
        await client.mutate("app.update", { id: app.id, name: app.name, iconUrl: app.iconUrl,
          href: app.href, description: app.description, pingUrl: service.serverUrl });
      } catch { /* Read back even if the update response was lost; do not replay. */ }
      const afterApps = rows(await client.query("app.all"), "app inventory");
      const after = afterApps.filter((candidate) => candidate.id === app.id);
      if (after.length !== 1 || canonical(after[0]) !== canonical({ ...app, pingUrl: service.serverUrl })) {
        fail("Homarr ping target update is uncertain; inspect and re-plan before retrying");
      }
      pingTarget.changed = true;
    }
    pingTarget.persisted = true;
    if (!mapping.integrationKind) {
      reports.push({ id: service.id, appId: app.id, tileOnly: true, pingTarget, structureVerified: true, connection: "not-applicable" });
      continue;
    }
    let integration = entry.integration;
    let created = false;
    let createResponseObserved = false;
    if (!integration) {
      try {
        const result = await client.mutate("integration.create", { name: integrationName(service), kind: mapping.integrationKind, url: integrationUrl(service),
          secrets: Object.entries(service.credentials).map(([kind, value]) => ({ kind, value })), attemptSearchEngineCreation: false, app: { id: app.id } });
        createResponseObserved = row(result) && !Object.hasOwn(result, "error");
      } catch { /* Reconcile a possibly committed write without replaying it. */ }
      integration = findIntegration(rows(await client.query("integration.all"), "integration inventory"), service);
      if (!integration) fail(`Homarr integration for ${service.id} did not persist; inspect and re-plan before retrying`);
      created = true;
    }
    await assertLinked(client, integration, app, service);
    let widgets = findWidgets(board, integration.id, service);
    for (const widget of homarrStackWidgets(service.id, service.prerequisites, String(integration.id))) {
      if (widgets.some((item) => item.kind === widget.kind)) continue;
      try { await client.mutate("board.addItem", { boardId: board.id, kind: widget.kind, options: widget.options, integrationIds: [integration.id] }); }
      catch { /* Read back before any subsequent write; never blindly replay. */ }
      const next = await readBoard(client, boardName);
      assertPreserved(board, next);
      widgets = findWidgets(next, integration.id, service);
      if (!widgets.some((item) => item.kind === widget.kind) || next.items.length !== board.items.length + 1) fail("Homarr widget write is uncertain; inspect and re-plan");
      board = next; additions += 1;
    }
    let connection = "not-retested";
    if (created) connection = "tested-by-create";
    reports.push({ id: service.id, appId: app.id, integrationId: integration.id, integrationCreated: created,
      connection, createResponseObserved, pingTarget,
      widgetIds: widgets.map((item) => item.id), widgetKinds: widgets.map((item) => item.kind), structureVerified: true, renderedContentVerified: false });
  }
  const finalBoard = await readBoard(client, boardName);
  assertPreserved(board, finalBoard);
  if (finalBoard.items.length !== state.board.items.length + additions) fail("Homarr board gained unexpected items; inspect before retrying");
  for (const { service, app } of state.entries) {
    const currentApps = rows(await client.query("app.all"), "app inventory");
    if (currentApps.filter((candidate) => candidate.id === app.id
      && canonical(candidate) === canonical({ ...app, pingUrl: service.serverUrl })).length !== 1) fail("Homarr app linkage changed during attachment");
  }
  return { boardId: finalBoard.id, boardPreserved: true, renderedContentVerified: false, services: reports };
}
