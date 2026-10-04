import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { assertPrivatePath, ownedByCurrentUser, privateMode, protectPrivatePath } from "./lib/platform-private.ts";
import { HomarrAttachClient, inspectHomarrService, planHomarrService, applyHomarrService, validateInput } from "./homarr-attach.ts";
import { loadSharedProjectState } from "./lib/shared-project-state.ts";
import { withSharedProjectMutationLock } from "./lib/batch-mutation-lock.ts";
import { sharedUnitRecipeCheck, sharedUnitSecretHandoff } from "./lib/shared-unit-setup.ts";
import { restoreSavedSharedSelection } from "./lib/shared-saved-recipe.ts";
import { resolveAppFrontend, resolveSharedAppMetadata } from "./lib/resolved-app.ts";
import { checkedManualJobRecipe } from "./lib/manual-job.ts";
import { checkedConnectorRecipe, checkedPrivateDaemonRecipe } from "./lib/multi-service-recipe.ts";
import { homarrIntegrationCredentials, homarrNativeEligibility, homarrStackMapping, homarrStackWidgets,
  homarrStackWidgetChoices } from "./lib/homarr-stack-mapping.ts";
import { inspectHomarrStackBoard, inspectHomarrStackService, planHomarrStackSeed, applyHomarrStackSeed,
  homarrSeedNativeEligibility,
  type HomarrStackSeedClient, type HomarrStackSeedService } from "./lib/homarr-stack-seed.ts";
import { homarrFunctionalReadProcedures, homarrVerificationSourceCommit,
  verifyHomarrService, type HomarrCheck } from "./lib/homarr-live-verification.ts";
import { planHomarrNonBrowserRecap, applyHomarrNonBrowserRecap, inspectHomarrNonBrowserRecap,
  type HomarrNonBrowserDescriptor } from "./lib/homarr-non-browser-recap.ts";
import { invalidateSharedHomarrCompatibility, prepareSharedHomarrCompatibility, publishSharedHomarrCompatibility,
  withSharedHomarrCompatibilityLock } from "./lib/shared-homarr-compatibility.ts";
import { resolveOwnedHomarrTransport } from "./lib/shared-homarr-transport.ts";

type Entry = Record<string, any>;
type Dependencies = {
  recipeFor: Parameters<typeof sharedUnitSecretHandoff>[3];
  appFor(appId: string): Entry;
  approvalFor: Parameters<typeof sharedUnitSecretHandoff>[4];
};
function fail(message: string): never { throw new Error(`Shared Homarr: ${message}`); }
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function fingerprints(values: Record<string, string>) {
  return Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, value]) => [kind, digest(value)]));
}

function readOnlyClient(client: HomarrStackSeedClient, functional = false): HomarrStackSeedClient {
  const queries = new Map<string, Promise<unknown>>();
  const allowed = new Set(["board.getAllBoards", "board.getBoardByName", "board.getBoardSettings",
    "app.all", "integration.all", "integration.getKinds", "integration.byId", "widget.stats.catalog"]);
  if (functional) {
    for (const procedure of homarrFunctionalReadProcedures) allowed.add(procedure);
  }
  return {
    query(procedure, input) {
      if (!allowed.has(procedure)) fail("unsupported read-only dashboard query");
      const key = JSON.stringify([procedure, input ?? null]);
      const saved = queries.get(key);
      if (saved) return saved;
      if (queries.size >= 1024) fail("read-only dashboard query limit exceeded");
      const requested = client.query(procedure, input);
      queries.set(key, requested);
      return requested;
    },
    async mutate() { fail("read-only dashboard inspection cannot mutate"); },
  };
}

/** Redacted structural readback; no credentials, raw inventories, or write methods are returned. */
export async function inspectSharedHomarrServices(client: HomarrStackSeedClient, boardName: string,
  services: Array<{ input: unknown; seed: HomarrStackSeedService;
    nativeEligibility?: ReturnType<typeof homarrNativeEligibility> }>, retainFailures = false) {
  const reader = readOnlyClient(client);
  const board = await inspectHomarrStackBoard(reader, boardName);
  const selected = await Promise.all(services.map(async (service) => {
    try {
      const mapping = homarrStackMapping(service.seed.id);
      let eligibility = homarrSeedNativeEligibility(service.seed);
      if (service.nativeEligibility?.eligible === false) eligibility = service.nativeEligibility;
      if (!eligibility.eligible) {
        const tile = await inspectHomarrService(reader, service.input);
        return { ...tile, integrationKind: mapping?.integrationKind ?? null, integrationId: null,
          integrationStructureVerified: false, widgetStructureVerified: false, widgets: [], omittedWidgets: [],
          tileOnly: false, nativeIntegrationPending: true, nativeIntegrationReason: eligibility.reasonCode,
          nativeIntegrationRequirement: eligibility.requirement, connectionVerification: "blocked-native" };
      }
      const [tile, native] = await Promise.all([
        inspectHomarrService(reader, service.input),
        inspectHomarrStackService(reader, boardName, service.seed),
      ]);
      return { ...tile, ...native };
    } catch (error) {
      if (!retainFailures) throw error;
      return { id: service.seed.id, status: "resource-readback-failed",
        metadataVerified: false, structureVerified: false, notebookContentVerified: false,
        notebookLayoutVerified: false, integrationStructureVerified: false, widgetStructureVerified: false };
    }
  }));
  let status = "needs-attachment";
  if (selected.length > 0 && selected.every((service) => service.metadataVerified && service.structureVerified
    && service.notebookContentVerified && service.notebookLayoutVerified
    && service.integrationStructureVerified && service.widgetStructureVerified)) status = "attached";
  return { status, board,
    mutation: false, apiKeyAuthorizationVerified: true, services: selected,
    serviceRuntimeVerified: false, renderedContentVerified: false };
}

/** Functional queries run through Homarr's saved authentication, not direct app probes. */
export async function checkSharedHomarrServices(client: HomarrStackSeedClient, boardName: string,
  services: Array<{ seed: HomarrStackSeedService; nativeEligibility?: ReturnType<typeof homarrNativeEligibility> }>,
  testStoredIntegration?: (id: string) => Promise<HomarrCheck>) {
  const reader = readOnlyClient(client, true);
  const selected = services.filter(({ seed, nativeEligibility }) => {
    return nativeEligibility?.eligible !== false && homarrSeedNativeEligibility(seed).eligible;
  });
  if (selected.length > 256) fail("live dashboard service limit exceeded");
  const results: Awaited<ReturnType<typeof verifyHomarrService>>[] = new Array(selected.length);
  const integrationReads = new Map<string, Promise<HomarrCheck>>();
  let cursor = 0;
  async function worker() {
    while (cursor < selected.length) {
      const index = cursor++;
      const { seed } = selected[index];
      const result = await verifyHomarrService({
        id: seed.id, appName: seed.appName, browserUrl: seed.browserUrl,
        serverUrl: seed.serverUrl, integrationUrl: seed.integrationUrl,
        nativeRecipe: seed.nativeRecipe, ownedTransport: seed.ownedTransport,
        prerequisites: seed.prerequisites, boardName,
      }, { sourceCommit: homarrVerificationSourceCommit,
        query: (procedure, input) => reader.query(procedure, input) });
      results[index] = result;
      if (!testStoredIntegration || result.checks.tile.status !== "pass") continue;
      try {
        const structure = await inspectHomarrStackService(reader, boardName, { ...seed, credentials: {} });
        if (!structure.integrationId || !structure.integrationStructureVerified || structure.tileOnly) continue;
        const id = structure.integrationId as string;
        if (!integrationReads.has(id)) integrationReads.set(id, testStoredIntegration(id));
        result.checks.integrationTest = await integrationReads.get(id)!;
      } catch {
        result.checks.integrationTest = { status: "fail", reason: "stored-integration-readback-failed" };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, selected.length) }, () => worker()));
  return results;
}

/** Only the reviewed saved integration ID is sent; Homarr loads its own stored credentials. */
export async function testSharedHomarrStoredIntegration(origin: string, apiKey: string, id: string,
  request: typeof fetch = fetch): Promise<HomarrCheck> {
  const procedure = "GET /api/integrations/{id}/test-connection";
  const result = (status: HomarrCheck["status"], reason: string): HomarrCheck => ({ status, reason, procedure });
  let base: URL;
  try { base = new URL(origin); }
  catch { return result("fail", "stored-integration-request-scope-invalid"); }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash
    || base.pathname !== "/" || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || !apiKey) {
    return result("fail", "stored-integration-request-scope-invalid");
  }
  try {
    const response = await request(new URL(`/api/integrations/${id}/test-connection`, base), {
      method: "GET", headers: { ApiKey: apiKey, accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404 || response.status === 405) {
      await response.body?.cancel();
      return result("not-run", "stored-integration-route-unavailable-or-inaccessible");
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) return result("fail", "stored-integration-auth-denied");
      return result("fail", "stored-integration-http-failed");
    }
    const reader = response.body?.getReader();
    if (!reader) return result("fail", "stored-integration-invalid-response");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > 4096) {
          await reader.cancel();
          return result("fail", "stored-integration-invalid-response");
        }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) return result("fail", "stored-integration-invalid-response");
    const value = body as Record<string, unknown>;
    if (value.success === true && Object.keys(value).length === 1) return result("pass", "stored-integration-connection-verified");
    const errors = new Set(["missingSecret", "authorization", "certificate", "request", "statusCode", "parse", "unknown"]);
    if (value.success === false && Object.keys(value).length === 2 && typeof value.error === "string" && errors.has(value.error)) {
      return result("fail", `stored-integration-${value.error}`);
    }
    return result("fail", "stored-integration-invalid-response");
  } catch {
    return result("fail", "stored-integration-transport-or-response-failed");
  }
}

export function sharedHomarrPreparedJob(appId: string, manifest: Entry, recipe: Entry): Entry | null {
  if (!checkedManualJobRecipe(recipe)) return null;
  if (recipe.appId !== appId || manifest.id !== appId || typeof manifest.name !== "string"
    || typeof recipe.services[0].purpose !== "string") fail("prepared job metadata differs from the selected app");
  return { id: appId, name: manifest.name, description: recipe.services[0].purpose,
    state: "prepared", executed: false, browserUrl: null, integrationKind: null,
    notebookStatus: "not-published", reason: "Manual jobs have no HTTP frontend; review their configuration in the project recap." };
}

/** A running connector is not a browser app or a prepared manual job. */
export function sharedHomarrPendingConnector(appId: string, manifest: Entry, recipe: Entry): Entry | null {
  if (!checkedConnectorRecipe(recipe)) return null;
  if (recipe.appId !== appId || manifest.id !== appId || typeof manifest.name !== "string"
    || !manifest.name.trim() || typeof recipe.services[0].purpose !== "string") {
    fail("connector metadata differs from the selected app");
  }
  return { id: appId, name: manifest.name, description: recipe.services[0].purpose,
    state: "connector-applied-unverified", enrollmentStatus: "pending",
    enrollmentVerified: false, clientAccessVerified: false,
    browserUrl: null, integrationKind: null, apiKeyFile: null,
    notebookStatus: "not-published",
    reason: "Private connectors have no browser frontend; enrollment and client access need separate verification." };
}

export function sharedHomarrPendingDaemon(appId: string, manifest: Entry, recipe: Entry): Entry | null {
  if (!checkedPrivateDaemonRecipe(recipe)) return null;
  if (recipe.appId !== appId || manifest.id !== appId || typeof manifest.name !== "string"
    || !manifest.name.trim() || typeof recipe.services[0].purpose !== "string") {
    fail("private daemon metadata differs from the selected app");
  }
  return { id: appId, name: manifest.name, description: recipe.services[0].purpose,
    state: "daemon-applied-unverified", enrollmentStatus: "pending",
    enrollmentVerified: false, clientAccessVerified: false, runtimeVerified: false,
    browserUrl: null, integrationKind: null, apiKeyFile: null, notebookStatus: "not-published",
    reason: "Private daemons have no browser frontend; runtime, enrollment and client access need separate verification." };
}

async function privateDirectory(directory: string) {
  const metadata = await lstat(directory);
  assertPrivatePath(directory, 0o700);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !ownedByCurrentUser(metadata)
    || !privateMode(metadata, 0o700) || await realpath(directory) !== directory) fail("connection directory is not owner-only");
}
async function readConnections(directory: string): Promise<Entry | null> {
  await privateDirectory(directory);
  const path = join(directory, "connections.json");
  let before;
  try { before = await lstat(path); }
  catch (error: any) { if (error.code === "ENOENT") return null; throw error; }
  assertPrivatePath(path, 0o600);
  if (!before.isFile() || !ownedByCurrentUser(before) || before.nlink !== 1
    || !privateMode(before, 0o600) || before.size < 1 || before.size > 1024 * 1024) fail("connection export is not an exact owner-only file");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const after = await handle.stat();
    if (after.ino !== before.ino || after.dev !== before.dev || after.size !== before.size) fail("connection export changed during inspection");
    const contents = await handle.readFile("utf8");
    if (Buffer.byteLength(contents) > 1024 * 1024) fail("connection export exceeds its limit");
    let value;
    try { value = JSON.parse(contents); } catch { fail("connection export has invalid JSON"); }
    if (!value || value.schemaVersion !== 1 || !value.inputs || typeof value.inputs !== "object"
      || Array.isArray(value.inputs) || !Array.isArray(value.services)) fail("connection export has an unsupported schema");
    return value;
  } finally { await handle.close(); }
}
async function writeConnections(directory: string, expected: Entry | null, payload: Entry): Promise<string> {
  if (digest(await readConnections(directory)) !== digest(expected)) fail("connection export changed after approval");
  const path = join(directory, "connections.json");
  const temporary = join(directory, `.connections-${randomUUID()}.tmp`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { protectPrivatePath(temporary, 0o600); await handle.writeFile(JSON.stringify(payload, null, 2)); await handle.sync(); }
  finally { await handle.close(); }
  try {
    await privateDirectory(directory);
    if (digest(await readConnections(directory)) !== digest(expected)) fail("connection export changed before replacement");
    await rename(temporary, path);
  } catch (error) { await unlink(temporary); throw error; }
  return path;
}

/** Secrets enter only the approved owner-only export; reports contain metadata and digests. */
export async function sharedHomarr(root: string, projectId: string, appIds: string[],
  inputs: Record<string, Record<string, string>>, applyToken: string | null | undefined, dependencies: Dependencies,
  readOnlyStatus = false, functionalChecks = false): Promise<Entry> {
  const run = () => runSharedHomarr(root, projectId, appIds, inputs, applyToken, dependencies, readOnlyStatus, functionalChecks);
  if (applyToken || (readOnlyStatus && functionalChecks)) {
    return withSharedHomarrCompatibilityLock(root, projectId, run);
  }
  return run();
}

async function runSharedHomarr(root: string, projectId: string, appIds: string[],
  inputs: Record<string, Record<string, string>>, applyToken: string | null | undefined, dependencies: Dependencies,
  readOnlyStatus: boolean, functionalChecks: boolean): Promise<Entry> {
  if (readOnlyStatus && applyToken) fail("read-only status does not accept an approval");
  if (functionalChecks && !readOnlyStatus) fail("functional checks require read-only status");
  if (!appIds.length || new Set(appIds).size !== appIds.length) fail("select distinct saved apps");
  const ids = [...appIds].sort();
  async function inspect() {
    const directory = join(root, ".selfhost", "shared", projectId);
    const state = await loadSharedProjectState(directory, projectId);
    if (!state || state.project.directory !== directory || state.project.root !== join(root, ".selfhost", "shared")
      || state.checkpoint.phase !== "completed" || !state.units.homarr
      || ids.some((id) => !state.units[id])) fail("requires completed saved units and Homarr");
    const previousConnections = await readConnections(directory);
    const choices: Record<string, Record<string, string>> = {};
    for (const source of [previousConnections?.inputs ?? {}, inputs]) {
      for (const [id, supplied] of Object.entries(source)) {
        if (id !== "homarr" && !ids.includes(id)) {
          if (source === inputs) fail("inputs name an unselected app");
          if (!state.units[id]) continue;
        }
        if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) fail("inputs must contain declared nonsecret fields");
        const mapping = homarrStackMapping(id);
        const declared = new Set([...(mapping?.requiredSecrets ?? []), ...(mapping?.alternativeSecrets ?? []).flat()]
          .filter((kind) => ["topic", "slug"].includes(kind)));
        for (const [, choice] of homarrStackWidgetChoices(mapping)) declared.add(choice);
        if (id === "homarr") declared.add("board-name");
        for (const [kind, value] of Object.entries(supplied)) {
          if (!declared.has(kind) || typeof value !== "string" || !value.trim()
            || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) fail("unknown or invalid nonsecret input");
          choices[id] ??= {};
          choices[id][kind] = value.trim();
        }
      }
    }
    const boardName = choices.homarr?.["board-name"] ?? "personal";
    if (!/^[A-Za-z0-9_-]{1,255}$/.test(boardName)) fail("boardName is invalid");
    const services = state.manifest.services as Entry[];
    function metadata(id: string) {
      const info = dependencies.recipeFor(id);
      const matches = services.filter((service) => service.id === id);
      if (matches.length !== 1) fail("saved frontend is ambiguous");
      if (!Array.isArray(matches[0].networks) || !matches[0].networks.includes("front")) {
        fail("saved frontend does not share the Homarr front network");
      }
      return resolveSharedAppMetadata(id, dependencies.appFor(id), info.recipe, matches[0]);
    }
    const homarr = metadata("homarr");
    if (homarr.browserUrl === null || homarr.serverUrl === null) fail("Homarr requires a browser frontend");
    const owner = await sharedUnitSecretHandoff(root, projectId, "homarr", dependencies.recipeFor, dependencies.approvalFor);
    if (typeof owner.apiKey !== "string" || !owner.apiKey) fail("Homarr API key is not saved; complete Homarr setup first");
    let client: HomarrStackSeedClient = new HomarrAttachClient(homarr.browserUrl, owner.apiKey);
    if (readOnlyStatus) client = readOnlyClient(client, functionalChecks);
    // Live-status observations must start after the owner/source witness is captured.
    // Do not populate the reader cache with earlier board/app/integration responses.
    let inventory: Entry = { boards: [], board: null, apps: [], integrations: [], kinds: [] };
    if (!readOnlyStatus) inventory = {
      boards: await client.query("board.getAllBoards"),
      board: await client.query("board.getBoardByName", { name: boardName }),
      apps: await client.query("app.all"), integrations: await client.query("integration.all"),
      kinds: await client.query("integration.getKinds"),
    };
    const selected = [];
    const preparedJobs: Entry[] = [];
    const pendingConnectors: Entry[] = [];
    const pendingDaemons: Entry[] = [];
    const nonBrowserServices: Entry[] = [];
    const pending: Entry[] = [];
    const pendingNativeIntegrations: Entry[] = [];
    const recipeChecks: Record<string, string> = {};
    for (const id of ids) {
      const recipeCheck = sharedUnitRecipeCheck(state, id, dependencies.recipeFor);
      if (readOnlyStatus) recipeChecks[id] = recipeCheck;
      else if (recipeCheck !== "matches-saved-selection") {
        fail("saved selection differs from its recipe; inspect before publication");
      }
      const job = sharedHomarrPreparedJob(id, dependencies.appFor(id), dependencies.recipeFor(id).recipe);
      if (job) {
        preparedJobs.push(job);
        continue;
      }
      const connector = sharedHomarrPendingConnector(id, dependencies.appFor(id), dependencies.recipeFor(id).recipe);
      if (connector) {
        if (sharedUnitRecipeCheck(state, id, dependencies.recipeFor) !== "matches-saved-selection") {
          fail("connector recipe differs from its saved selection");
        }
        pendingConnectors.push(connector);
        continue;
      }
      const daemon = sharedHomarrPendingDaemon(id, dependencies.appFor(id), dependencies.recipeFor(id).recipe);
      if (daemon) {
        if (sharedUnitRecipeCheck(state, id, dependencies.recipeFor) !== "matches-saved-selection") {
          fail("private daemon recipe differs from its saved selection");
        }
        pendingDaemons.push(daemon);
        continue;
      }
      const app = metadata(id);
      if (app.browserUrl === null || app.serverUrl === null) {
        nonBrowserServices.push({ id: app.id, name: app.name, description: app.description,
          state: "tcp-applied-unverified",
          endpoint: app.endpoint, serverEndpoint: app.serverEndpoint, browserUrl: null,
          integrationKind: null, notebookStatus: "not-published",
          reason: "This app uses a private TCP endpoint, not a browser or HTTP integration." });
        continue;
      }
      let handoff: Entry;
      if (readOnlyStatus) {
        // Saved dashboard reads need no underlying app credential or setup contract.
        // Keep the strict handoff/recipe gate on publication and every setup path.
        handoff = {};
      } else {
        handoff = await sharedUnitSecretHandoff(root, projectId, id, dependencies.recipeFor, dependencies.approvalFor);
      }
      const mapping = homarrStackMapping(id);
      let nativeRecipe = dependencies.recipeFor(id).recipe;
      if ((mapping?.nativeRecipeSha256 || mapping?.nativeEligibility) && recipeCheck === "matches-saved-selection") {
        nativeRecipe = restoreSavedSharedSelection(state, id, dependencies.recipeFor).recipe;
      }
      let ownedTransport;
      if (mapping?.nativeTransportRequirement && recipeCheck === "matches-saved-selection"
        && homarrNativeEligibility(mapping, nativeRecipe).reasonCode === "native-owned-https-unverified") {
        ownedTransport = await resolveOwnedHomarrTransport(state, id, nativeRecipe, dependencies) ?? undefined;
      }
      let nativeEligibility = homarrNativeEligibility(mapping, nativeRecipe, ownedTransport);
      if (mapping?.integrationKind && recipeCheck !== "matches-saved-selection") nativeEligibility = {
        eligible: false, reasonCode: "native-recipe-contract-changed",
        requirement: "The current native API recipe differs from the saved selection; review the owned recipe before connecting." };
      if (!nativeEligibility.eligible) pendingNativeIntegrations.push({ id,
        integrationKind: mapping!.integrationKind, reasonCode: nativeEligibility.reasonCode,
        requirement: nativeEligibility.requirement });
      const provided = choices[id] ?? {};
      let credentials: Record<string, string> = {};
      let missing: string[] = [];
      if (!readOnlyStatus && mapping?.integrationKind && nativeEligibility.eligible) {
        ({ credentials, missing } = homarrIntegrationCredentials(mapping, handoff, provided));
      }
      if (missing.length) pending.push({ id, requiredInputs: missing });
      const input = validateInput({ schemaVersion: 2, homarr: { origin: homarr.browserUrl, boardName },
        service: { id, name: app.name, description: app.description, href: app.browserUrl,
          iconUrl: app.iconUrl, access: "local", storagePath: app.storagePath, credentialFile: null } });
      let tile: Entry | null = null;
      if (!readOnlyStatus) tile = await planHomarrService(client, input);
      const seed: HomarrStackSeedService = { id, appName: input.service.name, browserUrl: input.service.href,
        serverUrl: app.serverUrl, integrationUrl: ownedTransport?.integrationUrl ?? app.serverUrl,
        nativeRecipe, ownedTransport, credentials };
      for (const [name, choice] of homarrStackWidgetChoices(mapping)) {
        if (!provided[choice]) continue;
        seed.prerequisites ??= {};
        seed.prerequisites[name] = provided[choice];
      }
      const existing = Array.isArray(inventory.apps)
        ? inventory.apps.find((candidate: Entry) => candidate.name === seed.appName) : null;
      if (!readOnlyStatus && existing && existing.pingUrl !== null && existing.pingUrl !== seed.serverUrl) {
        fail("an existing app has a custom ping target; review a separate repair before publication");
      }
      const pingTarget = { old: existing?.pingUrl ?? null, new: seed.serverUrl,
        changeRequired: existing?.pingUrl !== seed.serverUrl };
      selected.push({ app, input, tile, seed, mapping, handoff, pingTarget, nativeEligibility });
    }
    const recapServices = [...preparedJobs, ...pendingConnectors, ...pendingDaemons, ...nonBrowserServices];
    // The Notebook describes the saved project, not this invocation's subset.
    // Never remove a retained service merely because --app selected another unit.
    for (const id of Object.keys(state.units).sort().filter((id) => !ids.includes(id))) {
      const manifest = dependencies.appFor(id);
      const recipe = dependencies.recipeFor(id).recipe;
      const recipeCheck = sharedUnitRecipeCheck(state, id, dependencies.recipeFor);
      if (!readOnlyStatus && recipeCheck !== "matches-saved-selection") {
        fail("a retained recipe differs from the saved recap; inspect before publication");
      }
      let service = sharedHomarrPreparedJob(id, manifest, recipe)
        ?? sharedHomarrPendingConnector(id, manifest, recipe)
        ?? sharedHomarrPendingDaemon(id, manifest, recipe);
      if (!service && resolveAppFrontend(manifest).kind !== "tcp") continue;
      if (readOnlyStatus) recipeChecks[id] = recipeCheck;
      if (!service) {
        const app = metadata(id);
        service = { id: app.id, name: app.name, description: app.description,
          state: "tcp-applied-unverified", serverEndpoint: app.serverEndpoint };
      }
      recapServices.push(service);
    }
    const nonBrowserDescriptors: HomarrNonBrowserDescriptor[] = recapServices.map((service) => {
      const descriptor: HomarrNonBrowserDescriptor = { id: service.id, name: service.name,
        description: service.description, state: service.state };
      if (service.serverEndpoint) descriptor.endpoint = {
        host: service.serverEndpoint.host, port: service.serverEndpoint.port,
        protocol: service.serverEndpoint.protocol,
      };
      return descriptor;
    });
    let nonBrowserRecap: Awaited<ReturnType<typeof planHomarrNonBrowserRecap>> | null = null;
    if (!readOnlyStatus) nonBrowserRecap = await planHomarrNonBrowserRecap(client, boardName, nonBrowserDescriptors);
    const snapshot = { recordHash: state.recordHash, boardName, inventory, key: digest(owner.apiKey), choices,
      previousConnections: digest(previousConnections),
      ownerCredentials: fingerprints(Object.fromEntries(["username", "password", "apiKey"]
        .filter((kind) => typeof owner[kind] === "string").map((kind) => [kind, owner[kind]]))),
      preparedJobs, pendingConnectors, pendingDaemons, nonBrowserServices, pendingNativeIntegrations, nonBrowserRecap,
      services: selected.map(({ app, tile, seed, handoff, pingTarget, nativeEligibility }) => ({ app, tile, pingTarget, nativeEligibility,
        integrationUrl: seed.integrationUrl, ownedTransport: seed.ownedTransport,
        selectedWidgets: homarrStackWidgets(app.id, seed.prerequisites), credentials: fingerprints(seed.credentials),
        exportCredentials: fingerprints(Object.fromEntries(["username", "password", "apiKey"]
          .filter((kind) => typeof handoff[kind] === "string").map((kind) => [kind, handoff[kind]]))) })), pending };
    const approval = `SHARED-HOMARR:${projectId}:${digest(snapshot)}`;
    const report = { command: "shared homarr", projectId, boardName, mutation: false, approval,
      status: "planned", pending, preparedJobs, pendingConnectors, pendingDaemons, nonBrowserServices, pendingNativeIntegrations, nonBrowserRecap,
      services: selected.map(({ app, seed, mapping, pingTarget, nativeEligibility }) => ({ id: app.id,
        browserUrl: app.browserUrl, serverUrl: app.serverUrl, integrationKind: mapping?.integrationKind ?? null,
        integrationUrl: seed.integrationUrl,
        pingTarget,
        statsMetrics: mapping?.widgets.find((widget) => widget.kind === "stats")?.metrics ?? [],
        widgets: nativeEligibility.eligible ? homarrStackWidgets(app.id, seed.prerequisites).map((item) => item.kind) : [],
        nativeIntegrationPending: !nativeEligibility.eligible,
        nativeIntegrationReason: nativeEligibility.reasonCode,
        nativeIntegrationRequirement: nativeEligibility.requirement,
        omittedWidgets: (mapping?.widgets ?? []).filter((item) => item.prerequisite
          && !homarrStackWidgets(app.id, seed.prerequisites).some((widget) => widget.kind === item.kind))
          .map((item) => ({ kind: item.kind, prerequisite: item.prerequisite })),
        tileOnly: !mapping?.integrationKind })) };
    const connectionFor = (app: Entry, handoff: Entry) => ({ id: app.id, browserUrl: app.browserUrl,
      serverUrl: app.serverUrl, storagePath: app.storagePath, privateFiles: handoff.privateFiles,
      passwordFile: handoff.passwordFile, apiKeyFile: handoff.apiKeyFile,
      username: handoff.username, password: handoff.password, apiKey: handoff.apiKey });
    const connections = { schemaVersion: 1, projectId, recordHash: state.recordHash, inputs: choices, preparedJobs, pendingConnectors, pendingDaemons, nonBrowserServices,
      nonBrowserDescriptors,
      services: [connectionFor(homarr, owner), ...(previousConnections?.services ?? [])
        .filter((service: Entry) => service && typeof service.id === "string"
          && service.id !== "homarr" && !ids.includes(service.id) && state.units[service.id]),
        ...selected.filter((item) => item.app.id !== "homarr")
        .map((item) => connectionFor(item.app, item.handoff))] };
    const testStoredIntegration = (id: string) => testSharedHomarrStoredIntegration(homarr.browserUrl!, owner.apiKey, id);
    return { state, client, selected, approval, report, recipeChecks, nonBrowserDescriptors, testStoredIntegration,
      ports: [homarr.publishedPort], directory, previousConnections, connections };
  }
  const initial = await inspect();
  if (readOnlyStatus) {
    let compatibilityWitness;
    let compatibilityEvidenceIncomplete = false;
    if (functionalChecks) {
      try {
        compatibilityWitness = await prepareSharedHomarrCompatibility(initial.state,
          initial.report.boardName, initial.selected, dependencies);
      } catch { compatibilityEvidenceIncomplete = true; }
    }
    const readback = await inspectSharedHomarrServices(initial.client, initial.report.boardName, initial.selected, functionalChecks);
    let functional: Awaited<ReturnType<typeof checkSharedHomarrServices>> | undefined;
    if (functionalChecks) {
      functional = await checkSharedHomarrServices(initial.client, initial.report.boardName, initial.selected, initial.testStoredIntegration);
    }
    const nonBrowserRecap = await inspectHomarrNonBrowserRecap(initial.client,
      initial.report.boardName, initial.nonBrowserDescriptors);
    let status = readback.status;
    // A TCP/job/connector-only selection has no browser tiles to attach. Its
    // private recap is the complete dashboard resource for this selection.
    if (initial.selected.length === 0 && !nonBrowserRecap.skipped
      && nonBrowserRecap.notebookContentVerified && nonBrowserRecap.notebookLayoutVerified) {
      status = "attached";
    }
    if (!nonBrowserRecap.skipped && (!nonBrowserRecap.notebookContentVerified
      || !nonBrowserRecap.notebookLayoutVerified)) status = "needs-attachment";
    const checkedAt = new Date().toISOString();
    if (functional && compatibilityWitness) {
      try {
        await publishSharedHomarrCompatibility(compatibilityWitness, readback, functional, dependencies, checkedAt);
      } catch { compatibilityEvidenceIncomplete = true; }
    }
    return { command: "shared homarr-status", projectId, boardName: initial.report.boardName,
      preparedJobs: initial.report.preparedJobs, pendingConnectors: initial.report.pendingConnectors,
      pendingDaemons: initial.report.pendingDaemons,
      nonBrowserServices: initial.report.nonBrowserServices,
      pendingNativeIntegrations: initial.report.pendingNativeIntegrations,
      recipeChecks: initial.recipeChecks,
      recipeMigrationVerified: false, ...readback, status, nonBrowserRecap,
      ...(functional ? { functional, checkedAt, acceptanceVerified: false, compatibilityEvidenceIncomplete } : {}) };
  }
  if (!applyToken) return initial.report;
  return withSharedProjectMutationLock(root, projectId, initial.ports, async () => {
    const fresh = await inspect();
    if (applyToken !== fresh.approval) fail("approval is stale; re-plan before writes");
    if (fresh.report.pending.length) fail("required integration credentials or inputs are missing");
    await invalidateSharedHomarrCompatibility(fresh.state, dependencies);
    const connectionConfigPath = await writeConnections(fresh.directory, fresh.previousConnections, fresh.connections);
    const tiles = [];
    for (const item of fresh.selected) {
      // Previous tiles legitimately update the managed recap; bind the next internal plan now.
      const current = await planHomarrService(fresh.client, item.input);
      tiles.push(await applyHomarrService(fresh.client, item.input, current.approval));
    }
    const integrated = fresh.selected.filter((item) => item.mapping && item.nativeEligibility.eligible).map((item) => item.seed);
    let seed: Entry | null = null;
    if (integrated.length) {
      const plan = await planHomarrStackSeed(fresh.client, fresh.report.boardName, integrated);
      seed = await applyHomarrStackSeed(fresh.client, fresh.report.boardName, integrated, plan.approval);
    }
    // Tile publication may legitimately change board state after the outer review.
    // Rebind this internal plan now; descriptors remain bound to that review.
    const recapPlan = await planHomarrNonBrowserRecap(fresh.client, fresh.report.boardName, fresh.nonBrowserDescriptors);
    const nonBrowserRecap = await applyHomarrNonBrowserRecap(fresh.client,
      fresh.report.boardName, fresh.nonBrowserDescriptors, recapPlan.approval);
    let status = "attached";
    if (fresh.report.pendingNativeIntegrations.length) status = "attached-with-native-pending";
    return { ...fresh.report, status, mutation: true, tiles, seed, nonBrowserRecap, connectionConfigPath,
      serviceRuntimeVerified: false, renderedContentVerified: false };
  });
}
