import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { recipeFor } from "./app.ts";
import { sharedPlanApproval } from "./shared-project.ts";
import { inspectApiCredentialSetup, inspectFirstRunSetup } from "./control-panel/setup-engine.ts";
import { createSetupTransportFacilities } from "./control-panel/setup-transport.ts";
import { withSharedProjectMutationLock } from "./lib/batch-mutation-lock.ts";
import { loadSharedProjectState, type SharedProjectState } from "./lib/shared-project-state.ts";
import { sharedUnitHandoff, sharedUnitStatus } from "./lib/shared-unit-setup.ts";
import { runServiceLink, serviceLinks, type ServiceLinkCheckpoint, type ServiceLinkContext,
  type ServiceLinkOwner } from "./lib/service-links.ts";

type Options = { action: "plan" | "apply"; root: string; projectId: string; source: string;
  target: string; approval: string | null; approvedSteps: string[]; json: boolean };
function fail(message: string): never { throw new Error(`Connect: ${message}`); }
export function parseConnectOptions(args: string[]): Options {
  const action = args[0];
  if (action !== "plan" && action !== "apply") fail("use connect plan|apply --project-root ROOT --project-id ID --source APP --target APP");
  const values = new Map<string, string>();
  const approvedSteps: string[] = [];
  let json = false;
  const allowed = ["--project-root", "--project-id", "--source", "--target", "--approve", "--approve-step"];
  for (let index = 1; index < args.length; index += 1) {
    const key = args[index]!;
    if (key === "--json") { if (json) fail("duplicate --json"); json = true; continue; }
    if (!allowed.includes(key) || !args[index + 1] || args[index + 1]!.startsWith("--")) fail("invalid connect option");
    const value = args[++index]!;
    if (key === "--approve-step") { approvedSteps.push(value); continue; }
    if (values.has(key)) fail("duplicate connect option");
    values.set(key, value);
  }
  const root = values.get("--project-root") ?? "";
  const projectId = values.get("--project-id") ?? "";
  const source = values.get("--source") ?? "";
  const target = values.get("--target") ?? "";
  const approval = values.get("--approve") ?? null;
  if (!isAbsolute(root) || resolve(root) !== root || !/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(projectId)
    || !serviceLinks.some((link) => link.source === source && link.target === target)) fail("select an exact absolute root, shared project ID, and supported source/target link");
  if (action === "plan" && (approval !== null || approvedSteps.length)) fail("plan is read-only; omit approvals");
  if (action === "apply" && approval === null) fail("apply requires the exact connect-plan approval");
  if (approvedSteps.some((token) => !/^APP-SETUP-[A-Z0-9-]+:[a-z0-9-]+:[0-9a-f]{64}$/.test(token))) fail("invalid exact step approval");
  return { action, root, projectId, source, target, approval, approvedSteps, json };
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function identity(state: SharedProjectState): ServiceLinkOwner {
  return { projectRoot: dirname(dirname(dirname(state.project.directory))), projectId: state.project.id, revision: state.revision,
    manifestHash: state.manifestHash };
}
export function connectApproval(owner: ServiceLinkOwner, source: string, target: string): string {
  const descriptor = serviceLinks.find((item) => item.source === source && item.target === target);
  if (!descriptor) fail("unsupported link descriptor");
  return `CONNECT:${owner.projectId}:${hash({ version: 1, owner, descriptor })}`;
}
async function stateFor(options: Options): Promise<SharedProjectState> {
  const directory = join(options.root, ".selfhost", "shared", options.projectId);
  const state = await loadSharedProjectState(directory, options.projectId);
  return checkedConnectState(state, options.root, options.projectId, options.source, options.target);
}
export function checkedConnectState(state: SharedProjectState | null, root: string,
  projectId: string, source: string, target: string): SharedProjectState {
  const directory = join(root, ".selfhost", "shared", projectId);
  if (!state || state.project.root !== join(root, ".selfhost", "shared") || state.project.directory !== directory
    || state.project.id !== projectId
    || state.checkpoint.phase !== "completed"
    || !Object.hasOwn(state.units, source) || !Object.hasOwn(state.units, target)) {
    fail("link requires both selected apps in one completed exact shared Compose owner");
  }
  return state;
}
export function connectPeerEndpoint(state: SharedProjectState, appId: string): { host: string; port: number } {
  const services = state.manifest.services.filter((service) => service.id === appId);
  const service = services[0];
  if (services.length !== 1 || !service || !service.networks.includes("front")
    || service.ports.length !== 1 || service.ports[0].protocol !== "tcp"
    || !Number.isSafeInteger(service.ports[0].target) || service.ports[0].target < 1
    || service.ports[0].target > 65535) fail("peer has no exact saved frontend TCP endpoint on the shared front network");
  return { host: appId, port: service.ports[0].target };
}
export function checkConnectCategory(value: unknown, categoryName: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("qBittorrent category inventory is invalid");
  const category = (value as Record<string, any>)[categoryName];
  if (!category || category.name !== categoryName || category.savePath !== `/data/torrents/${categoryName}`) {
    fail("qBittorrent target category does not match the selected managed downloader link");
  }
}
async function privateDirectory(path: string): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()
    || (stat.mode & 0o7777) !== 0o700 || await realpath(path) !== path) fail("link checkpoint directory is not owner-only");
}

/** Immutable, mode-0600 revision files give per-link CAS under the shared-project lock. */
export async function connectLedger(directory: string, owner: ServiceLinkOwner, linkId: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*-to-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(linkId)) fail("invalid link ledger identity");
  let revision = 0;
  let current: ServiceLinkCheckpoint | null = null;
  try { await privateDirectory(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  async function read(): Promise<ServiceLinkCheckpoint | null> {
    revision = 0;
    current = null;
    for (;;) {
      const path = join(directory, `${linkId}.${revision + 1}.json`);
      let file;
      try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") break; throw error; }
      try {
        await privateDirectory(directory);
        const stat = await file.stat();
        const named = await lstat(path);
        if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.()
          || (stat.mode & 0o7777) !== 0o600 || stat.size > 8192
          || stat.ino !== named.ino || stat.dev !== named.dev || named.isSymbolicLink()) fail("unsafe link checkpoint file");
        const record = JSON.parse(await file.readFile("utf8"));
        if (record.schemaVersion !== 1 || record.revision !== revision + 1
          || record.previousHash !== hash(current) || record.checkpoint?.linkId !== linkId
          || hash(record.checkpoint.owner) !== hash(owner)
          || !["attempted", "verified"].includes(record.checkpoint.phase)) fail("link checkpoint CAS identity changed");
        revision += 1;
        current = record.checkpoint;
      } finally { await file.close(); }
      if (revision > 10000) fail("link checkpoint history exceeds its bound");
    }
    return current;
  }
  await read();
  return { read: async (_id: string) => read(), async save(checkpoint: ServiceLinkCheckpoint) {
    if (checkpoint.linkId !== linkId || hash(checkpoint.owner) !== hash(owner)) fail("link checkpoint identity differs");
    const expectedRevision = revision;
    const expectedHash = hash(current);
    await read();
    if (revision !== expectedRevision || hash(current) !== expectedHash) fail("link checkpoint changed concurrently");
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    await privateDirectory(directory);
    const file = await open(join(directory, `${linkId}.${revision + 1}.json`),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(JSON.stringify({ schemaVersion: 1, revision: revision + 1,
      previousHash: expectedHash, checkpoint })); await file.sync(); }
    finally { await file.close(); }
    current = checkpoint;
    revision += 1;
  } };
}

export async function connectCommand(args: string[]): Promise<void> {
  const options = parseConnectOptions(args);
  const initial = await stateFor(options);
  const owner = identity(initial);
  const approval = connectApproval(owner, options.source, options.target);
  const descriptor = serviceLinks.find((link) => link.source === options.source && link.target === options.target)!;
  const prerequisites = ["Saved API credentials must be freshly verified in this exact shared Compose owner; password-based downloader links also require verified saved account credentials."];
  if (descriptor.kind === "request-manager") {
    prerequisites.push(`The target must have the exact accessible root folder ${descriptor.root} and one quality profile named Any.`);
  }
  if (descriptor.kind === "download-client") {
    prerequisites.push(`The downloader must already have category ${descriptor.category} with save path /data/torrents/${descriptor.category}; rerun its shared setup if missing.`);
  }
  if (descriptor.kind === "application") {
    prerequisites.push("The source indexer inventory must be empty; synchronizing existing indexers requires separate approval and is not supported by this link operation.");
  }
  const response = { command: "connect plan", mutation: false, owner,
    source: options.source, target: options.target, approval, prerequisites,
    boundary: "Account-only setup stays independent. No indexers, media requests, downloads, or restart acceptance.",
    next: "Apply this exact approval, then review each returned --approve-step token before retrying." };
  if (options.action === "plan") {
    if (options.json) console.log(JSON.stringify(response, null, 2));
    else console.log(`${options.source} -> ${options.target}\nApproval: ${approval}\n${prerequisites.join("\n")}\n${response.boundary}`);
    return;
  }
  if (options.approval !== approval) fail("approval differs from the exact saved owner and link descriptor");
  await withSharedProjectMutationLock(options.root, options.projectId, [], async () => {
    const current = await stateFor(options);
    if (hash(identity(current)) !== hash(owner)) fail("shared owner changed after review");
    const secrets = new Set<string>();
    const registerSecret = (value: string) => { if (value) secrets.add(value); };
    const redact = (message: string) => {
      for (const secret of [...secrets].sort((a, b) => b.length - a.length)) message = message.split(secret).join("[redacted]");
      return message;
    };
    const queue = { tail: Promise.resolve() };
    const steps: { appId: string; action: string; token: string; progress: string }[] = [];
    const approvalFor = (state: SharedProjectState) => sharedPlanApproval({ manifest: state.manifest,
      units: state.units, selectionFingerprints: state.selectionFingerprints, settings: state.settings,
      projectDirectory: state.project.directory });
    const exact = (value: Record<string, any>) => {
      if (value.ownerRevision !== owner.revision || value.manifestHash !== owner.manifestHash
        || value.ownerKind !== "shared" || value.projectId !== owner.projectId) fail("peer shared owner changed");
      return value;
    };
    const setupOwner = {
      async status(appId: string) { return exact(await sharedUnitStatus(options.root, options.projectId, appId, recipeFor, approvalFor)); },
      async handoff(appId: string) { return exact(await sharedUnitHandoff(options.root, options.projectId, appId, recipeFor, approvalFor)); },
    };
    const ledger = await connectLedger(join(current.project.directory, "service-links"), owner,
      `${options.source}-to-${options.target}`);
    let pendingAttempt: ServiceLinkCheckpoint | null = null;
    let mutationStarted = false;
    const facilities = new Map<string, ReturnType<typeof createSetupTransportFacilities>>();
    function transport(appId: string) {
      let cached = facilities.get(appId);
      if (cached) return cached;
      cached = createSetupTransportFacilities({ appId, projectRoot: options.root,
        readStatus: () => setupOwner.status(appId), readHandoff: () => setupOwner.handoff(appId),
        registerSecret, redact, approvalQueue: queue, inputDigest: hash({ owner, source: options.source, target: options.target }),
        async approve(action, token, progress) {
          if (!options.approvedSteps.includes(token)) { steps.push({ appId, action, token, progress: redact(progress) }); return false; }
          if (pendingAttempt) {
            await ledger.save(pendingAttempt);
            pendingAttempt = null;
          }
          mutationStarted = true;
          return true;
        } });
      facilities.set(appId, cached);
      return cached;
    }
    const context: ServiceLinkContext = {
      owner,
      async verifiedPeer(appId) {
        const read = async () => { throw new Error("Standalone inspection is forbidden"); };
        let inspected;
        let proof = "API credential";
        if (descriptor.kind === "download-client" && descriptor.target === appId) {
          proof = "account";
          inspected = await inspectFirstRunSetup(options.root, appId, read, setupOwner);
        } else inspected = await inspectApiCredentialSetup(options.root, appId, read, setupOwner);
        if (inspected.state !== "ready") fail(`${appId} ${proof} is not freshly verified: ${redact(inspected.detail)}`);
        const status = await setupOwner.status(appId);
        const secret = transport(appId);
        const apiKey = await secret.secrets.readApiKey();
        let password: string | undefined;
        if (appId === "qbittorrent") password = await secret.secrets.readAdminPassword();
        if (appId === "qbittorrent") {
          const descriptor = serviceLinks.find((link) => link.source === options.source && link.target === options.target)!;
          const result = await secret.http.request({ method: "GET", path: "/api/v2/torrents/categories",
            headers: { Authorization: `Bearer ${apiKey}`, Origin: status.url, Referer: `${status.url}/` } });
          if (result.status !== 200) fail("qBittorrent category inspection was not authorized");
          checkConnectCategory(await result.json(), descriptor.category!);
        }
        return { appId, owner, verified: true, apiKey: apiKey ?? undefined,
          username: status.username, password, externalUrl: status.url, server: connectPeerEndpoint(current, appId) };
      },
      request: (appId, request) => transport(appId).http.request(request),
      checkpoint: { read: ledger.read, async save(checkpoint) {
        // Delay durable attempted state until that exact HTTP step is approved; denied review sends no bytes.
        if (checkpoint.phase === "attempted") { pendingAttempt = checkpoint; return; }
        await ledger.save(checkpoint);
      } },
    };
    let outcome: unknown;
    let status = "api-link-verified";
    try { outcome = await runServiceLink(context, options.source, options.target); }
    catch (error) {
      if (steps.length && error instanceof Error) { status = "step-review"; outcome = null; }
      else throw new Error(redact(error instanceof Error ? error.message : "Service link failed"));
    }
    const result = { command: "connect apply", mutation: mutationStarted, owner,
      source: options.source, target: options.target, status, outcome, stepApprovals: steps,
      next: response.next, boundary: response.boundary };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else { console.log(`${options.source} -> ${options.target}: ${status}`); for (const step of steps) console.log(`${step.token}\n${step.progress}`); }
  });
}
