import { isAbsolute, join } from "node:path";
import {
  appliedStatus, setupRecord, statusApproval,
  type SetupAdapter, type SetupCheckpoint, type SetupContext,
  type SetupHttpRequest, type SetupRecord,
} from "../../types/setup";

const APP_ID = "homarr";
const stages = ["claim-attempted", "claim-issued", "welcome-attempted", "welcome-complete",
  "admin-attempted", "admin-created", "setup-attempted", "setup-complete",
  "key-attempted", "key-saved", "verified"] as const;
type Stage = typeof stages[number];
type Json = Record<string, unknown>;

function object(value: unknown, label: string): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Homarr ${label} is invalid`);
  }
  return value as Json;
}

function key(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

function complete(status: SetupRecord): boolean {
  if (status.setupClosed !== true || status.homarrSetup === null) return false;
  const saved = setupRecord(status.homarrSetup, "Homarr setup");
  return saved.stage === "complete" && saved.boardName === "personal";
}

async function standalone(context: SetupContext): Promise<SetupRecord> {
  const status = appliedStatus(context, await context.status());
  if (!complete(status)) throw new Error("Homarr onboarding did not reach its saved complete checkpoint");
  const handoff = setupRecord(await context.read("handoff"), "Homarr handoff");
  const expectedKey = typeof status.privateFiles === "string"
    ? join(status.privateFiles, "homarr-api-key") : null;
  if (handoff.command !== "app handoff" || handoff.appId !== context.appId
    || handoff.status !== "homarr-admin-and-api-key-recorded"
    || handoff.mutation !== false || handoff.secretful !== false
    || typeof handoff.apiKeyFile !== "string" || !isAbsolute(handoff.apiKeyFile)
    || handoff.apiKeyFile !== expectedKey || Object.hasOwn(handoff, "env")) {
    throw new Error("Homarr has no verified private API-key reference");
  }
  return { appId: context.appId, projectRoot: context.projectRoot,
    stage: "admin-and-api-key-verified", apiKeyRef: handoff.apiKeyFile };
}

function checkpoint(context: SetupContext, value: unknown): SetupCheckpoint | null {
  if (value === null) return null;
  const saved = object(value, "checkpoint");
  if (saved.schemaVersion !== 1 || saved.appId !== APP_ID
    || saved.projectRoot !== context.projectRoot
    || !Number.isSafeInteger(saved.revision) || Number(saved.revision) < 1
    || !stages.includes(saved.stage as Stage) || !Array.isArray(saved.attemptedActions)
    || !saved.attemptedActions.every((action) => typeof action === "string")
    || !saved.data || typeof saved.data !== "object") {
    throw new Error("Homarr checkpoint differs from the exact app project");
  }
  return saved as SetupCheckpoint;
}

class Session {
  private readonly cookies = new Map<string, string>();
  private loaded = false;
  constructor(private readonly context: SetupContext, private readonly fresh = false) {
    this.loaded = fresh;
  }
  async adopt(session: Session) {
    for (const [name, value] of session.cookies) this.cookies.set(name, value);
    await this.context.secrets.writeSessionCookies(Object.fromEntries(this.cookies));
  }
  async request(request: SetupHttpRequest, isolated = false, preserveCookies = false) {
    if (!isolated && !this.loaded) {
      const saved = await this.context.secrets.readSessionCookies();
      for (const [name, value] of Object.entries(saved)) this.cookies.set(name, value);
      this.loaded = true;
    }
    const headers = { ...request.headers };
    if (!isolated && this.cookies.size > 0) {
      headers.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    }
    const response = await this.context.http.request({ ...request, headers });
    if (!isolated && !preserveCookies) {
      const received = response.headers.getSetCookie?.() ?? [];
      for (const raw of received) {
        const first = raw.split(";", 1)[0];
        const separator = first?.indexOf("=") ?? -1;
        if (separator <= 0) continue;
        const name = first.slice(0, separator).trim();
        const value = first.slice(separator + 1).trim();
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
          || /[\r\n;]/.test(value)) continue;
        if (/(?:^|;)\s*max-age=0(?:;|$)/i.test(raw)) this.cookies.delete(name);
        else this.cookies.set(name, value);
      }
      if (received.length > 0 && !this.fresh) {
        await this.context.secrets.writeSessionCookies(Object.fromEntries(this.cookies));
      }
    }
    return response;
  }
}

async function json(session: Session, request: SetupHttpRequest, label: string,
  isolated = false): Promise<Json> {
  const response = await session.request(request, isolated);
  if (!response.ok) throw new Error(`Homarr ${label} was rejected (${response.status})`);
  try { return object(await response.json(), label); }
  catch { throw new Error(`Homarr ${label} returned invalid JSON`); }
}

async function procedure(session: Session, name: string, label: string,
  input?: unknown, write?: Pick<SetupHttpRequest,
    "approval" | "beforeSendCheckpoint" | "timeoutMs">): Promise<unknown> {
  const request: SetupHttpRequest = { method: write ? "POST" : "GET", path: `/api/trpc/${name}` };
  if (write) {
    request.headers = { "Content-Type": "application/json" };
    request.body = JSON.stringify({ json: input });
    request.approval = write.approval;
    request.beforeSendCheckpoint = write.beforeSendCheckpoint;
    request.timeoutMs = write.timeoutMs;
  } else if (input !== undefined) {
    request.query = { input: JSON.stringify({ json: input }) };
  }
  const payload = await json(session, request, label);
  return object(object(payload.result, label).data, label).json;
}

async function currentStep(session: Session): Promise<"start" | "user" | "setup" | "finish"> {
  const step = object(await procedure(session, "onboard.currentStep", "current step"), "current step").current;
  if (step === "start" || step === "user" || step === "setup" || step === "finish") return step;
  throw new Error("Homarr onboarding step is unsupported");
}

function oneTime(saved: SetupCheckpoint | null, action: string, stage: Stage) {
  if (saved?.attemptedActions.includes(action)) {
    throw new Error(`Homarr ${action} was already attempted; inspect before replaying`);
  }
  return { approval: { action, progress: `Perform the exact Homarr ${action} step`, once: true },
    beforeSendCheckpoint: { expectedRevision: saved?.revision ?? null, stage } };
}

async function refresh(context: SetupContext): Promise<SetupCheckpoint> {
  const value = checkpoint(context, await context.checkpoint.read());
  if (!value) throw new Error("Homarr attempted action has no saved checkpoint");
  return value;
}

async function save(context: SetupContext, saved: SetupCheckpoint, stage: Stage): Promise<SetupCheckpoint> {
  const next = checkpoint(context, await context.checkpoint.compareAndSet({
    expectedRevision: saved.revision, stage,
  }));
  if (!next || next.stage !== stage || next.revision !== saved.revision + 1) {
    throw new Error("Homarr checkpoint could not be confirmed");
  }
  return next;
}

function admin(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && (value as Json).name === "admin" && Array.isArray((value as Json).permissions)
    && ((value as Json).permissions as unknown[]).includes("admin");
}

async function verifyAdmin(context: SetupContext, session: Session, password: string, origin: string): Promise<void> {
  // Password proof must not inherit an already authenticated administrator cookie.
  const proof = new Session(context, true);
  const csrf = (await json(proof, { method: "GET", path: "/api/auth/csrf" }, "CSRF token")).csrfToken;
  if (typeof csrf !== "string" || csrf.length < 8) throw new Error("Homarr CSRF token is unavailable");
  const login = await json(proof, { method: "POST", path: "/api/auth/callback/credentials",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" },
    body: new URLSearchParams({ name: "admin", password, csrfToken: csrf,
      callbackUrl: origin }).toString(),
    approval: { action: "homarr-verify-admin", progress: "Verify the saved Homarr administrator login" },
  }, "administrator login");
  let callback: URL | null = null;
  if (typeof login.url === "string") {
    try { callback = new URL(login.url); } catch { /* Invalid callbacks are not login proof. */ }
  }
  if (!callback || callback.href !== new URL(origin).href) {
    throw new Error("Homarr administrator login was not verified");
  }
  const user = object((await json(proof, { method: "GET", path: "/api/auth/session" }, "admin session")).user,
    "admin user");
  if (!admin(user)) throw new Error("Homarr administrator session was not verified");
  // Keep valid retained authorization unchanged while later writes await review.
  const retained = await session.request({ method: "GET", path: "/api/auth/session" }, false, true);
  if (!retained.ok) throw new Error("Homarr retained administrator session readback was inconclusive");
  const retainedUser = object(await retained.json(), "retained admin session").user;
  if (admin(retainedUser)) return;
  if (retainedUser) throw new Error("Homarr retained administrator session identity differs");
  await session.adopt(proof);
}

function setupInput(): Json {
  return {
    server: { defaultLocale: "en", defaultColorScheme: "dark", analyticsEnabled: false },
    board: { name: "personal", primaryColor: "#228BE6", secondaryColor: "#15AABF",
      itemRadius: "md", layoutPreset: "balanced", leftSidebar: false, rightSidebar: false },
    selectedIntegrationIds: [], selectedAppIds: [], integrations: [], apps: [],
    selectedDockerSourceIds: [], selectedWidgetKinds: [],
  };
}

async function verifyKey(session: Session, value: string): Promise<boolean> {
  if (!key(value)) throw new Error("Homarr saved API key format is invalid");
  const response = await session.request({ method: "GET", path: "/api/trpc/apiKeys.getAll",
    headers: { ApiKey: value } }, true);
  if (response.status === 401 || response.status === 403) return false;
  if (!response.ok) throw new Error("Homarr API-key verification was inconclusive");
  const payload = object(await response.json(), "API-key verification");
  const data = object(object(payload.result, "API-key verification").data, "API-key verification");
  if (!Array.isArray(data.json)) throw new Error("Homarr API-key verification was inconclusive");
  return true;
}

async function verifyBoard(session: Session): Promise<void> {
  const boards = await procedure(session, "board.getAllBoards", "board list");
  if (!Array.isArray(boards)) throw new Error("Homarr board list is invalid");
  const matches = boards.filter((board) => board && typeof board === "object" && board.name === "personal");
  if (matches.length !== 1 || typeof matches[0].id !== "string" || matches[0].isPublic !== false) {
    throw new Error("Homarr needs exactly one private personal board");
  }
  const detail = object(await procedure(session, "board.getBoardByName", "personal board",
    { name: "personal" }), "personal board");
  if (detail.id !== matches[0].id || detail.name !== "personal" || detail.isPublic !== false
    || !Array.isArray(detail.items) || !Array.isArray(detail.sections)) {
    throw new Error("Homarr private personal board readback did not match");
  }
}

async function shared(context: SetupContext, status: SetupRecord): Promise<SetupRecord> {
  if (typeof status.url !== "string" || !/^http:\/\/127\.0\.0\.1:[0-9]{4,5}$/.test(status.url)) {
    throw new Error("Homarr has no exact saved loopback origin");
  }
  const password = await context.secrets.readAdminPassword();
  if (password.length < 8 || password.length > 255) throw new Error("Homarr saved admin password is invalid");
  const session = new Session(context);
  let saved = checkpoint(context, await context.checkpoint.read());
  let step = await currentStep(session);
  if (step === "start" || step === "user") {
    if (saved?.attemptedActions.includes("homarr-create-admin")) {
      throw new Error("Homarr first-admin creation is uncertain; inspect before retrying");
    }
    const firstClaim = !saved?.attemptedActions.includes("homarr-claim");
    const claimRequest: SetupHttpRequest = { method: "POST", path: "/api/onboarding/claim" };
    if (firstClaim) Object.assign(claimRequest, oneTime(saved, "homarr-claim", "claim-attempted"));
    else claimRequest.approval = { action: "homarr-refresh-claim",
      progress: "Refresh the exact Homarr onboarding claim for this private session" };
    const claim = await json(session, claimRequest, "onboarding claim");
    if (claim.status !== "issued" && claim.status !== "active") {
      throw new Error("Homarr onboarding claim is unavailable");
    }
    if (firstClaim || saved?.stage === "claim-attempted") {
      saved = await save(context, await refresh(context), "claim-issued");
    } else if (saved?.stage === "welcome-attempted" && step === "user") {
      saved = await save(context, saved, "welcome-complete");
    } else if (saved?.stage !== "claim-issued" && saved?.stage !== "welcome-complete") {
      throw new Error("Homarr onboarding checkpoint does not match its current step");
    }
  }
  if (step === "start") {
    await procedure(session, "onboard.nextStep", "welcome",
      undefined, oneTime(saved, "homarr-welcome", "welcome-attempted"));
    saved = await save(context, await refresh(context), "welcome-complete");
    step = await currentStep(session);
  }
  if (step === "user") {
    await procedure(session, "user.initUser", "first administrator", {
      username: "admin", password, confirmPassword: password, email: "admin@example.test",
    }, oneTime(saved, "homarr-create-admin", "admin-attempted"));
    saved = await save(context, await refresh(context), "admin-created");
  }
  await verifyAdmin(context, session, password, status.url);
  step = await currentStep(session);
  if (step === "setup") {
    await procedure(session, "onboard.completeSetup", "board setup", setupInput(),
      { ...oneTime(saved, "homarr-complete-setup", "setup-attempted"), timeoutMs: 120_000 });
    saved = await save(context, await refresh(context), "setup-complete");
    step = await currentStep(session);
  }
  if (step !== "finish") throw new Error("Homarr onboarding did not finish");
  let apiKey = await context.secrets.readApiKey();
  if (apiKey !== null && !await verifyKey(session, apiKey)) {
    throw new Error("Homarr saved API key is not authorized; inspect before creating another");
  }
  if (apiKey === null) {
    if (saved?.attemptedActions.includes("homarr-create-key")) {
      throw new Error("Homarr API-key creation was attempted but no key was saved; inspect before retrying");
    }
    const created = object(await procedure(session, "apiKeys.create", "API-key creation",
      undefined, oneTime(saved, "homarr-create-key", "key-attempted")), "created API key");
    if (!key(created.apiKey)) throw new Error("Homarr returned an invalid one-time API key");
    await context.secrets.writeApiKey(created.apiKey);
    saved = await save(context, await refresh(context), "key-saved");
    apiKey = created.apiKey;
    if (!await verifyKey(session, apiKey)) throw new Error("Homarr created API key is not authorized");
  }
  await verifyBoard(session);
  if (!saved) throw new Error("Homarr has no saved first-run checkpoint");
  if (saved.stage !== "verified") saved = await save(context, saved, "verified");
  const apiKeyRef = await context.secrets.apiKeyPath();
  if (!apiKeyRef || !isAbsolute(apiKeyRef)) {
    throw new Error("Homarr verified key has no saved private reference");
  }
  return { appId: APP_ID, projectRoot: context.projectRoot,
    stage: "admin-and-api-key-verified", apiKeyRef };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: null,
  ready(record) {
    return record.appId === this.appId && record.stage === "admin-and-api-key-verified"
      && typeof record.apiKeyRef === "string" && isAbsolute(record.apiKeyRef);
  },
  async firstRun(context) {
    if (context.appId !== this.appId) throw new Error("Homarr setup received a different app ID");
    const status = appliedStatus(context, await context.status());
    if (status.ownerKind === "shared") return shared(context, status);
    if (complete(status)) return standalone(context);
    const approval = statusApproval(status, "onboard");
    await context.apply("onboard", approval,
      "Create or verify the exact Homarr admin, personal board setup, and private API key");
    return standalone(context);
  },
};

export default adapter;
