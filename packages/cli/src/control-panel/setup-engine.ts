import { createHash } from "node:crypto";
import type { SetupAdapter, SetupCompatibilityResult, SetupContext, SetupInspectionContext, SetupPeerTarget, SetupRecord } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { createSetupTransportFacilities, SetupTransportDeferred } from "./setup-transport.ts";
import { setupAdapterSource } from "../lib/setup-contract.ts";
import type { SharedHttpsTarget } from "../lib/shared-https-target.ts";
import { assertTrustedDockerContainerImageObservation } from "../lib/docker-api-authority-probe.ts";

export type SetupOutcome = {
  appId: string;
  state: "ready" | "deferred" | "needs-inspection";
  detail: string;
  /** Verified onboarding identity/key, with registration still awaiting an owner transition. */
  transitionReady?: boolean;
};

/** Internal caller-owned chronology; adapters cannot emit or supply these receipts. */
export type SetupObserver = {
  before(call: { appId: string; phase: "first-run" | "inspect" }): Promise<string>;
  after(attemptId: string, result?: SetupCompatibilityResult): Promise<void>;
  error(attemptId: string, outcome: "failed" | "deferred"): Promise<void>;
};

export type SetupInputs = Record<string, Record<string, string>>;
export type SetupInputDefinition = { appId: string; key: string; label: string };

export type SetupTransport = {
  read(args: string[]): Promise<unknown>;
  mutate(args: string[]): Promise<unknown>;
  approve(appId: string, action: string, token: string, progress: string): Promise<boolean>;
};

export type SetupOwner = {
  inspectManualJob?(appId: string): ReturnType<SetupContext["manualJob"]["inspect"]>;
  status(appId: string): Promise<unknown>;
  handoff(appId: string): Promise<unknown>;
  verifyMutableConfigs?(appId: string): Promise<void>;
  resolveBootstrapCapabilityRecipe?(appId: string): Promise<unknown>;
  resolvePrivateOpenPgpContext?(appId: string): Promise<import("../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/private-openpgp.ts").PrivateOpenPgpContext>;
  resolveHttpsTarget?(appId: string): Promise<SharedHttpsTarget | null>;
  resolvePeerTarget?(appId: string): Promise<SetupPeerTarget>;
  observeContainerImage?(appId: string): ReturnType<NonNullable<SetupContext["observeContainerImage"]>>;
  requireSameDaemonDirectory?(appId: string): Promise<void>;
};

const MAX_PARALLEL_FIRST_RUNS = 8;
const loadedAdapters = new Map<string, { sha256: string; adapter: SetupAdapter }>();

async function loadAdapter(appId: string): Promise<SetupAdapter | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId)) {
    throw new Error("The setup adapter app ID is invalid");
  }
  const source = await setupAdapterSource(appId);
  if (!source) return null;
  const cached = loadedAdapters.get(source.url.href);
  if (cached) {
    if (cached.sha256 !== source.sha256) throw new Error("Setup adapter changed while the CLI was running; restart it and review again");
    return cached.adapter;
  }
  const loaded = await import(source.url.href) as { default?: SetupAdapter };
  const after = await setupAdapterSource(appId);
  if (!after || after.url.href !== source.url.href || after.sha256 !== source.sha256) {
    throw new Error("Setup adapter changed while loading; restart the CLI and review again");
  }
  const adapter = loaded.default;
  if (!adapter || adapter.appId !== appId || typeof adapter.firstRun !== "function"
    || typeof adapter.ready !== "function" || adapter.credentialCommand !== "app handoff"
    || (adapter.inspect !== undefined && typeof adapter.inspect !== "function")
    || (adapter.apiReady !== undefined && typeof adapter.apiReady !== "function")
    || (adapter.compatibilityResult !== undefined && typeof adapter.compatibilityResult !== "function")
    || (adapter.sharedOwner !== undefined && typeof adapter.sharedOwner !== "boolean")
    || !["saved-by-onboarding", "not-created"].includes(adapter.apiKey)
    || (adapter.healthSource !== null && typeof adapter.healthSource !== "string")
    || (adapter.homarrIntegration !== null && typeof adapter.homarrIntegration !== "string")) {
    throw new Error(`${appId} has an invalid packaged first-run adapter`);
  }
  if (adapter.inputDefinitions !== undefined) {
    const fields = adapter.inputDefinitions;
    if (!Array.isArray(fields) || fields.length > 16
      || fields.some((field) => !field || typeof field !== "object"
        || typeof field.key !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(field.key)
        || /(password|secret|token|cookie|api-?key)/i.test(field.key)
        || typeof field.label !== "string" || field.label.length < 1 || field.label.length > 120)
      || new Set(fields.map((field) => field.key)).size !== fields.length) {
      throw new Error(`${appId} has invalid non-secret setup input definitions`);
    }
  }
  if (adapter.setupAfter !== undefined) {
    const after = adapter.setupAfter;
    if (!Array.isArray(after) || after.length > 16
      || after.some((id) => typeof id !== "string"
        || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id === appId)
      || new Set(after).size !== after.length) {
      throw new Error(`${appId} has invalid shared setup dependencies`);
    }
  }
  if (adapter.peerEffects !== undefined) {
    const effects = adapter.peerEffects;
    if (!Array.isArray(effects) || effects.length > 16
      || effects.some((effect) => !effect || typeof effect !== "object"
        || typeof effect.peerAppId !== "string"
        || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(effect.peerAppId)
        || effect.peerAppId === appId || typeof effect.description !== "string"
        || effect.description.length < 1 || effect.description.length > 180)
      || new Set(effects.map((effect) => effect.peerAppId)).size !== effects.length) {
      throw new Error(`${appId} has invalid installed-peer review effects`);
    }
  }
  loadedAdapters.set(source.url.href, { sha256: source.sha256, adapter });
  return adapter;
}

/** Packaged adapter obligation, not an observation that a key was created. */
export async function setupApiKeyContract(appId: string): Promise<"saved-by-onboarding" | "not-created" | null> {
  const adapter = await loadAdapter(appId);
  return adapter?.apiKey ?? null;
}

/** Resolve packaged per-app setup from the app folder, without a central ID registry. */
export async function setupAdapterAvailable(appId: string): Promise<boolean> {
  const adapter = await loadAdapter(appId);
  return adapter !== null && adapter.sharedOwner !== false;
}

/** Current executable app-owned result mapping; no adapter or private-state execution. */
export async function setupCompatibilityAvailable(appId: string): Promise<boolean> {
  const adapter = await loadAdapter(appId);
  return adapter !== null && adapter.sharedOwner !== false
    && typeof adapter.compatibilityResult === "function";
}

/** Read packaged ordering metadata without running a first-run adapter. */
export async function resolveSetupAfter(appIds: readonly string[]): Promise<Map<string, readonly string[]>> {
  const result = new Map<string, readonly string[]>();
  for (const appId of [...new Set(appIds)]) {
    const adapter = await loadAdapter(appId);
    result.set(appId, adapter?.setupAfter ?? []);
  }
  return result;
}

/** Read declared non-secret choices without executing an adapter or opening its state. */
export async function resolveSetupInputDefinitions(appIds: readonly string[]): Promise<SetupInputDefinition[]> {
  const definitions: SetupInputDefinition[] = [];
  for (const appId of [...new Set(appIds)].sort()) {
    const adapter = await loadAdapter(appId);
    for (const field of adapter?.inputDefinitions ?? []) {
      definitions.push({ appId, key: field.key, label: field.label });
    }
  }
  return definitions;
}

/** Show app-owned peer effects in the shared setup review before any mutation. */
export async function resolvePeerEffects(appIds: readonly string[], installedAppIds: readonly string[]):
  Promise<{ appId: string; peerAppId: string; description: string }[]> {
  const effects: { appId: string; peerAppId: string; description: string }[] = [];
  for (const appId of [...new Set(appIds)].sort()) {
    const adapter = await loadAdapter(appId);
    for (const effect of adapter?.peerEffects ?? []) {
      if (installedAppIds.includes(effect.peerAppId)) effects.push({ appId, ...effect });
    }
  }
  return effects;
}

/** Validate app-owned, non-secret choices before review or any first-run mutation. */
export async function resolveSetupInputs(appIds: readonly string[], supplied: SetupInputs): Promise<SetupInputs> {
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)
    || Object.keys(supplied).some((id) => !appIds.includes(id))) {
    throw new Error("Setup inputs name an unselected app");
  }
  const resolved: SetupInputs = Object.create(null);
  for (const appId of [...new Set(appIds)].sort()) {
    const adapter = await loadAdapter(appId);
    const values = Object.hasOwn(supplied, appId) ? supplied[appId] : {};
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new Error(`${appId} setup inputs are invalid`);
    }
    const allowed = new Set(adapter?.inputDefinitions?.map((field) => field.key) ?? []);
    const entries = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
    if (entries.length > 16 || entries.some(([key, value]) => !allowed.has(key)
      || typeof value !== "string" || value.length < 1 || value.length > 512
      || /[\u0000-\u001f\u007f]/.test(value))) {
      throw new Error(`${appId} has unknown or invalid non-secret setup inputs`);
    }
    if (entries.length > 0) resolved[appId] = Object.fromEntries(entries);
  }
  return resolved;
}

class SetupDeferred extends Error {}

function appArgs(appId: string, root: string, action: string, args: string[] = []): string[] {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId) || !/^[a-z]+(?:-[a-z]+)*$/.test(action)) {
    throw new Error("The setup adapter requested an invalid app command");
  }
  return ["app", action, "--id", appId, "--project-root", root, ...args, "--json"];
}

function setupContext(appId: string, root: string, transport: SetupTransport,
  approvalQueue: { tail: Promise<void> }, owner?: SetupOwner,
  inputs: Readonly<Record<string, string>> = {}, installedAppIds: readonly string[] = [appId]):
  { context: SetupContext; redact(value: string): string } {
  const secrets = new Set<string>();
  const registerSecret = (value: string) => {
    if (typeof value === "string" && value.length >= 4 && value.length <= 8192) secrets.add(value);
  };
  const redact = (value: string) => {
    let safe = value;
    for (const secret of [...secrets].sort((left, right) => right.length - left.length)) {
      safe = safe.replaceAll(secret, "[redacted]");
    }
    return safe;
  };
  const readStatus = () => owner
    ? owner.status(appId) : transport.read(appArgs(appId, root, "status", ["--live"]));
  const facilities = createSetupTransportFacilities({
    appId,
    projectRoot: root,
    readStatus,
    verifyMutableConfigs: owner?.verifyMutableConfigs?.bind(owner, appId),
    resolveBootstrapCapabilityRecipe: owner?.resolveBootstrapCapabilityRecipe?.bind(owner, appId),
    resolvePrivateOpenPgpContext: owner?.resolvePrivateOpenPgpContext?.bind(owner, appId),
    resolveHttpsTarget: owner?.resolveHttpsTarget?.bind(owner, appId),
    resolvePeerTarget: owner?.resolvePeerTarget?.bind(owner),
    readHandoff: () => owner
      ? owner.handoff(appId) : transport.read(appArgs(appId, root, "handoff")),
    async approve(action, token, progress) {
      return transport.approve(appId, action, token, progress);
    },
    approvalQueue,
    inputDigest: createHash("sha256").update(JSON.stringify(inputs)).digest("hex"),
    registerSecret,
    redact,
  });
  const inspectPeer = async (peerId: string): Promise<{ record: SetupRecord; runtime: SetupContext }> => {
    if (!owner || peerId === appId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(peerId)) {
      throw new Error("Verified peer inspection needs a different app in one shared project");
    }
    const current = await readStatus() as Record<string, unknown>;
    const peer = await owner.status(peerId) as Record<string, unknown>;
    if (current.ownerKind !== "shared" || peer.ownerKind !== "shared"
      || current.projectRoot !== root || peer.projectRoot !== root
      || current.projectId !== peer.projectId
      || current.ownerRevision !== peer.ownerRevision
      || current.manifestHash !== peer.manifestHash
      || current.composeTarget !== peer.composeTarget) {
      throw new Error(`${peerId} is not in ${appId}'s exact saved shared project`);
    }
    const adapter = await loadAdapter(peerId);
    if (!adapter?.inspect) throw new Error(`${peerId} has no read-only first-run inspection`);
    const peerRuntime = setupContext(peerId, root, transport, approvalQueue, owner);
    const record = await adapter.inspect(inspectionContext(peerRuntime.context));
    if (!adapter.ready(record) || record.appId !== peerId || record.projectRoot !== root) {
      throw new Error(`${peerId} has no verified first-run setup`);
    }
    return { record, runtime: peerRuntime.context };
  };
  const context: SetupContext = {
    manualJob: { async inspect() {
      if (!owner?.inspectManualJob) throw new Error("This setup owner has no manual-job preparation inspection route");
      return owner.inspectManualJob(appId);
    } },
    appId, projectRoot: root, inputs: Object.freeze({ ...inputs }),
    installedAppIds: Object.freeze([...installedAppIds]),
    status: readStatus,
    async requireSameDaemonDirectory() {
      if (!owner?.requireSameDaemonDirectory) throw new Error("This setup owner has no same-daemon directory proof route");
      await owner.requireSameDaemonDirectory(appId);
    },
    async observeContainerImage() {
      if (!owner?.observeContainerImage) throw new Error("This setup owner has no Docker container image observation route");
      const observation = await owner.observeContainerImage(appId);
      assertTrustedDockerContainerImageObservation(observation, observation.containerId);
      return observation;
    },
    read(action, args) {
      if (owner) {
        if (action === "handoff" && (!args || args.length === 0)) return owner.handoff(appId);
        throw new Error(`${appId} has no shared-owner ${action} read route`);
      }
      return transport.read(appArgs(appId, root, action, args));
    },
    async apply(action, approval, progress, args) {
      if (owner) throw new Error(`${appId} has no shared-owner ${action} mutation route`);
      if (approval.length > 512 || !/^[A-Z][A-Z0-9-]*:[a-z0-9-]+:[0-9a-f]{64}$/.test(approval)
        || !approval.includes(`:${appId}:`)) {
        throw new Error(`${appId} has no exact setup approval for ${action}`);
      }
      const prior = approvalQueue.tail;
      let release = () => {};
      approvalQueue.tail = new Promise<void>((resolve) => { release = resolve; });
      await prior;
      let approved = false;
      try {
        approved = await transport.approve(appId, action, approval, redact(progress));
      } finally {
        release();
      }
      if (!approved) throw new SetupDeferred(`${appId} ${action} was not approved`);
      return transport.mutate(appArgs(appId, root, action, ["--approve", approval, ...(args ?? [])]));
    },
    // Bootstrap credentials use the transport's fixed current-start profile
    // and register with this owner's redactor before reaching an adapter.
    // They are deliberately excluded from inspectionContext below.
    ...facilities,
    peers: {
      ...facilities.peers,
      async inspectVerified(peerId) {
        return (await inspectPeer(peerId)).record;
      },
      async readVerifiedAdmin(peerId) {
        if (appId !== "seerr" || peerId !== "jellyfin" || !owner) {
          throw new Error("Verified peer administrator access is limited to Seerr's shared Jellyfin peer");
        }
        const peer = await inspectPeer(peerId);
        if (peer.record.adminUsername !== "admin") {
          throw new Error("Jellyfin has no verified administrator setup");
        }
        const password = await peer.runtime.secrets.readAdminPassword();
        registerSecret(password);
        return { username: "admin", password };
      },
    },
  };
  return { context, redact };
}

function inspectionContext(context: SetupContext): SetupInspectionContext {
  return {
    manualJob: context.manualJob,
    appId: context.appId,
    projectRoot: context.projectRoot,
    status: context.status,
    observeContainerImage: context.observeContainerImage,
    requireSameDaemonDirectory: context.requireSameDaemonDirectory,
    jmap: {
      captured: context.jmap.captured,
      bootstrapRejectionPassword: context.jmap.bootstrapRejectionPassword,
      request(request) {
        if (!request || request.effect !== "read"
          || Object.keys(request).some((key) => !["endpoint", "origin", "path", "authorization", "body", "effect"].includes(key))) {
          throw new Error("First-run inspection accepts only the read-only JMAP owner profile");
        }
        return context.jmap.request({ endpoint: request.endpoint, origin: request.origin,
          path: request.path, authorization: request.authorization, body: request.body, effect: "read" });
      },
    },
    http: {
      request(request) {
        if ((request.method !== "GET" && request.method !== "HEAD")
          || Object.keys(request).some((key) => !["method", "path", "query", "headers", "requireHttps"].includes(key))) {
          throw new Error("First-run inspection accepts read-only HTTP methods");
        }
        return context.http.request({ method: request.method, path: request.path,
          query: request.query, headers: request.headers, requireHttps: request.requireHttps });
      },
    },
    webSocket: {
      warriorIdleSnapshot(request) {
        return context.webSocket.warriorIdleSnapshot(request);
      },
      request(request) {
        if (request.type !== "auth/current_user"
          || Object.keys(request).some((key) => !["path","accessToken","type"].includes(key))) {
          throw new Error("First-run inspection accepts only the read-only WebSocket owner profile");
        }
        return context.webSocket.request(request);
      },
    },
    checkpoint: { read: context.checkpoint.read },
    secrets: {
      verifyMutableConfigs: context.secrets.verifyMutableConfigs,
      readSessionCookies: context.secrets.readSessionCookies,
      readAdminPassword: context.secrets.readAdminPassword,
      apiKeyPath: context.secrets.apiKeyPath,
      readApiKey: context.secrets.readApiKey,
    },
  };
}

/** Evidence failure must not turn completed setup into a replayable failed mutation. */
async function finishObservation(observer: SetupObserver, attemptId: string,
  adapter: SetupAdapter, record: SetupRecord): Promise<void> {
  try {
    const result = adapter.compatibilityResult?.(record);
    if (result && (Object.keys(result).sort().join() !== "credentialReadback,origin"
      || !["fresh", "resume"].includes(result.origin)
      || !["verified", "no-account-verified"].includes(result.credentialReadback))) {
      throw new Error("Invalid app-owned setup result");
    }
    if (result) await observer.after(attemptId, { ...result });
    else await observer.after(attemptId);
  } catch {
    console.error("Setup completed; compatibility evidence is incomplete. Inspect without replaying setup mutations.");
  }
}

/** Journal errors must not replace an app outcome or abort independent setup work. */
async function recordObservationError(observer: SetupObserver, attemptId: string,
  outcome: "failed" | "deferred"): Promise<void> {
  try {
    await observer.error(attemptId, outcome);
  } catch {
    console.error("Setup outcome preserved; compatibility evidence is incomplete. Inspect without replaying setup mutations.");
  }
}

/** Rechecks a saved first-run result without exposing any setup mutation method. */
export async function inspectFirstRunSetup(root: string, appId: string,
  read: SetupTransport["read"], owner?: SetupOwner, observer?: SetupObserver): Promise<SetupOutcome> {
  return inspectSavedSetup(root, appId, read, owner, "account", observer);
}

/** Read-only API proof only: no account claim or setup compatibility observation. */
export async function inspectApiCredentialSetup(root: string, appId: string,
  read: SetupTransport["read"], owner?: SetupOwner): Promise<SetupOutcome> {
  return inspectSavedSetup(root, appId, read, owner, "api");
}

async function inspectSavedSetup(root: string, appId: string, read: SetupTransport["read"],
  owner: SetupOwner | undefined, purpose: "account" | "api", observer?: SetupObserver): Promise<SetupOutcome> {
  const transport: SetupTransport = {
    read,
    async mutate() { throw new Error("First-run inspection cannot mutate an app"); },
    async approve() { return false; },
  };
  let runtime: ReturnType<typeof setupContext> | null = null;
  let attemptId: string | null = null;
  try {
    const adapter = await loadAdapter(appId);
    if (!adapter?.inspect) {
      return { appId, state: "needs-inspection", detail: "No read-only first-run inspection route" };
    }
    if (purpose === "api" && owner && adapter.sharedOwner === false) {
      return { appId, state: "needs-inspection", detail: "No verified shared-owner API inspection route" };
    }
    runtime = setupContext(appId, root, transport, { tail: Promise.resolve() }, owner);
    if (observer) attemptId = await observer.before({ appId, phase: "inspect" });
    const record = await adapter.inspect(inspectionContext(runtime.context));
    let ready = false;
    if (record.appId === appId && record.projectRoot === root) {
      if (purpose === "api" && adapter.apiReady) ready = adapter.apiReady(record);
      else ready = adapter.ready(record);
    }
    if (!ready) {
      if (observer && attemptId) await recordObservationError(observer, attemptId, "failed");
      if (purpose === "api") return { appId, state: "needs-inspection", detail: "Saved API credential is not verified" };
      return { appId, state: "needs-inspection", detail: "Saved first-run result is not verified" };
    }
    if (purpose === "api") {
      return { appId, state: "ready", detail: "Saved API credential rechecked; administrator password, function, and restart remain unverified" };
    }
    if (observer && attemptId) await finishObservation(observer, attemptId, adapter, record);
    return { appId, state: "ready", detail: "Saved first-run record rechecked; API-key authorization, function, and restart remain separate" };
  } catch (error) {
    if (observer && attemptId) await recordObservationError(observer, attemptId, "failed");
    let detail = "Unknown first-run inspection error";
    if (error instanceof Error) detail = (runtime?.redact(error.message) ?? error.message).slice(0, 180);
    return { appId, state: "needs-inspection", detail };
  }
}

/** Each app owns its steps; independent apps can be started together. */
export async function runFirstRunSetups(root: string, appIds: readonly string[],
  transport: SetupTransport, owner?: SetupOwner, inputs: SetupInputs = {},
  installedAppIds?: readonly string[], observer?: SetupObserver): Promise<SetupOutcome[]> {
  const queue = { tail: Promise.resolve() };
  const unique = [...new Set(appIds)];
  const selection = installedAppIds ?? appIds;
  if (installedAppIds && (unique.some((id) => !selection.includes(id))
    || selection.some((id) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))
    || new Set(selection).size !== selection.length)) {
    throw new Error("First-run app selection differs from the reviewed setup group");
  }
  const results: SetupOutcome[] = [];
  for (let start = 0; start < unique.length; start += MAX_PARALLEL_FIRST_RUNS) {
    const batch = unique.slice(start, start + MAX_PARALLEL_FIRST_RUNS);
    const completed = await Promise.all(batch.map(async (appId): Promise<SetupOutcome> => {
      let runtime: ReturnType<typeof setupContext> | null = null;
      let attemptId: string | null = null;
      try {
        const adapter = await loadAdapter(appId);
        if (!adapter) return { appId, state: "needs-inspection", detail: "No verified first-run adapter" };
        if (owner && adapter.sharedOwner === false) {
          return { appId, state: "needs-inspection", detail: "No verified shared-owner first-run adapter" };
        }
        const supplied = inputs[appId] ? { [appId]: inputs[appId] } : {};
        const resolved = await resolveSetupInputs([appId], supplied);
        runtime = setupContext(appId, root, transport, queue, owner, resolved[appId], selection);
        if (observer) attemptId = await observer.before({ appId, phase: "first-run" });
        const record = await adapter.firstRun(runtime.context);
        const transition: Pick<SetupOutcome, "transitionReady"> = {};
        if (record.appId === appId && record.projectRoot === root
          && record.adminLoginVerified === true && record.apiKeyVerified === true
          && record.registrationClosed === false) transition.transitionReady = true;
        if (record.appId !== appId || record.projectRoot !== root || !adapter.ready(record)) {
          if (observer && attemptId) await recordObservationError(observer, attemptId, "failed");
          return { appId, state: "needs-inspection", detail: "First-run checkpoint is not verified", ...transition };
        }
        if (observer && attemptId) await finishObservation(observer, attemptId, adapter, record);
        return { appId, state: "ready", detail: "First-run checkpoint verified; functional and restart checks remain separate", ...transition };
      } catch (error) {
        if (observer && attemptId) {
          let outcome: "failed" | "deferred" = "failed";
          if (error instanceof SetupDeferred || error instanceof SetupTransportDeferred) outcome = "deferred";
          await recordObservationError(observer, attemptId, outcome);
        }
        if (error instanceof SetupDeferred) {
          return { appId, state: "deferred", detail: "Setup approval declined or cancelled; in-flight approved app steps were allowed to finish" };
        }
        if (error instanceof SetupTransportDeferred) {
          return { appId, state: "deferred",
            detail: (runtime?.redact(error.message) ?? error.message).slice(0, 180) };
        }
        let detail = "Unknown setup error";
        if (error instanceof Error) detail = (runtime?.redact(error.message) ?? error.message).slice(0, 180);
        return { appId, state: "needs-inspection", detail };
      }
    }));
    results.push(...completed);
  }
  return results;
}
