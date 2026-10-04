import { isAbsolute } from "node:path";
import { SetupEngineIoPolling } from "../../../../../../../../../packages/cli/src/lib/setup-engineio-polling.ts";

import {
  appliedStatus,
  setupRecord,
  statusApproval,
  type SetupAdapter,
  type SetupContext,
  type SetupRecord,
} from "../../types/setup";

const VERIFIED_STAGE = "login-verified";
const PAGE_TITLE = "Local service status";
const PAGE_ADD_STAGE = "status-page-add-attempted";
const PAGE_SAVE_STAGE = "status-page-save-attempted";
const KEY_STAGE = "metrics-key-write-attempted";
const KEY_NAME = "self-host metrics";
const MAX_METRICS_BYTES = 131072;
const KEY_ACTION = "uptime-kuma-add-api-key";
const PAGE_ADD_ACTION = "uptime-kuma-add-status-page";
const PAGE_SAVE_ACTION = "uptime-kuma-save-status-page";

export class PollingSocket extends SetupEngineIoPolling {
  constructor(context: Pick<SetupContext, "http">) {
    super(context, {
      // Retain only bounded public key metadata; never retain monitor/notification secrets.
      retainEvents: ["apiKeyList"],
      approval(name) {
        let action = `uptime-kuma-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
        if (name === "getAPIKeyList") action = "uptime-kuma-get-api-key-list";
        if (name === "addAPIKey") action = "uptime-kuma-add-api-key";
        let progress = `Exchange Uptime Kuma ${action}`;
        if (action === "uptime-kuma-add-api-key") {
          progress = "Create the saved administrator's active, nonexpiring self-host metrics key; globally switch /metrics from admin Basic auth to API-key Basic auth (not a general API or MCP token)";
        }
        return { action, progress };
      },
    });
  }
}

async function sharedFirstRun(context: SetupContext, status: SetupRecord): Promise<SetupRecord> {
  if (status.username !== "admin" || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)) {
    throw new Error("Uptime Kuma has no exact saved administrator credential reference");
  }
  const password = await context.secrets.readAdminPassword();
  if (!password || password.length > 1024 || /[\r\n\u0000]/.test(password)) {
    throw new Error("Uptime Kuma saved administrator password is invalid");
  }
  // The pinned main server also exposes this route after database initialization.
  const database = await context.http.request({ method: "GET", path: "/setup-database-info" });
  if (database.status !== 200) throw new Error("Uptime Kuma database gate is unavailable");
  const info = setupRecord(await database.json(), "Uptime Kuma database gate");
  if (info.needSetup !== false || info.runningSetup !== false) {
    throw new Error("Uptime Kuma database gate is not complete");
  }
  const saved = await context.checkpoint.read();
  if (saved && (saved.appId !== context.appId || saved.projectRoot !== context.projectRoot
    || !["admin-write-attempted", VERIFIED_STAGE, PAGE_ADD_STAGE, PAGE_SAVE_STAGE, KEY_STAGE].includes(saved.stage))) {
    throw new Error("Uptime Kuma has an unexpected first-admin checkpoint");
  }
  const socket = new PollingSocket(context);
  await socket.connect();
  const needSetup = await socket.event("needSetup", []);
  if (typeof needSetup !== "boolean") throw new Error("Uptime Kuma setup state is invalid");
  // An attempted write may have committed without its response. Prove login before considering any replay.
  if (saved || !needSetup) {
    const login = setupRecord(await socket.event("login", [{ username: "admin", password }]), "Uptime Kuma login");
    if (login.ok === true && typeof login.token === "string" && login.token.length > 0) {
      if (!saved) throw new Error("Uptime Kuma existing administrator was not created by this setup");
    } else if (!needSetup) {
      throw new Error("Uptime Kuma already has a different administrator; inspect before setup");
    } else {
      throw new Error("Uptime Kuma first-admin write remains ambiguous; inspect before retrying");
    }
  } else {
    const result = setupRecord(await socket.event("setup", ["admin", password],
      { expectedRevision: null, stage: "admin-write-attempted" }), "Uptime Kuma first-admin setup");
    if (result.ok !== true) throw new Error("Uptime Kuma first-admin setup failed; inspect before retrying");
    const login = setupRecord(await socket.event("login", [{ username: "admin", password }]), "Uptime Kuma login");
    if (login.ok !== true || typeof login.token !== "string" || login.token.length === 0) {
      throw new Error("Uptime Kuma first-admin login was not verified");
    }
  }
  const checkpoint = await context.checkpoint.read();
  if (!checkpoint || checkpoint.appId !== context.appId || checkpoint.projectRoot !== context.projectRoot) {
    throw new Error("Uptime Kuma first-admin checkpoint is missing");
  }
  if (checkpoint.stage === "admin-write-attempted") {
    await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision, stage: VERIFIED_STAGE });
  }
  const apiKeyFile = await ensureMetricsKey(context, socket, password);
  if (context.installedAppIds.includes("homarr")) await ensureStatusPage(context, socket);
  return { appId: context.appId, projectRoot: context.projectRoot, stage: VERIFIED_STAGE,
    credentialRef: status.passwordFile, loginVerified: true, apiKeyFile,
    apiKeyScope: "metrics", apiKeyExpires: null, metricsAuth: "api-key-basic-auth",
    metricsAdminBasicAuthReplaced: true, generalApiToken: false, mcpToken: false };
}

/** 2.5.5 API keys authenticate /metrics, not Socket.IO or a general management API. */
async function ensureMetricsKey(context: SetupContext, socket: PollingSocket, password: string): Promise<string> {
  let saved = await context.checkpoint.read();
  if (!saved) throw new Error("Uptime Kuma metrics key requires its owned administrator checkpoint");
  const list = async () => {
    socket.takeEvent("apiKeyList");
    const result = setupRecord(await socket.event("getAPIKeyList", []), "Uptime Kuma key-list acknowledgment");
    const event = socket.takeEvent("apiKeyList");
    if (result.ok !== true || !event || event.length !== 1 || !Array.isArray(event[0]) || event[0].length > 256) {
      throw new Error("Uptime Kuma did not emit its bounded administrator API-key metadata");
    }
    return event[0].map((value) => setupRecord(value, "Uptime Kuma key metadata"));
  };
  let keys = await list();
  let key = await context.secrets.readApiKey();
  if (!key) {
    if (saved.stage === KEY_STAGE || saved.attemptedActions.includes(KEY_ACTION)
      || saved.data.metricsKeyID !== undefined) {
      throw new Error("Uptime Kuma one-time metrics key is unavailable; never recreate or rotate after a lost response");
    }
    if (keys.some((entry) => entry.name === KEY_NAME)) {
      throw new Error("Uptime Kuma metrics key label already exists; do not adopt or rotate it");
    }
    const result = setupRecord(await socket.event("addAPIKey", [{ name: KEY_NAME, active: true, expires: null }],
      { expectedRevision: saved.revision, stage: KEY_STAGE }), "Uptime Kuma metrics key creation");
    if (result.ok !== true || typeof result.key !== "string"
      || !/^uk[1-9][0-9]*_[A-Za-z0-9_-]{40}$/.test(result.key)
      || !Number.isSafeInteger(result.keyID) || Number(result.keyID) <= 0
      || !result.key.startsWith(`uk${result.keyID}_`)) {
      throw new Error("Uptime Kuma metrics key creation is ambiguous; do not replay it");
    }
    // Save the one-time clear key before another checkpoint, socket or HTTP await.
    await context.secrets.writeApiKey(result.key);
    key = result.key;
    saved = (await context.checkpoint.read())!;
    keys = await list();
  }
  const match = /^uk([1-9][0-9]*)_[A-Za-z0-9_-]{40}$/.exec(key);
  if (!match) throw new Error("Uptime Kuma saved metrics key format is invalid");
  const id = Number(match[1]);
  const owned = keys.filter((entry) => entry.id === id);
  if (owned.length !== 1 || keys.filter((entry) => entry.name === KEY_NAME).length !== 1) {
    throw new Error("Uptime Kuma saved metrics key has no unique administrator-owned metadata");
  }
  const metadata = owned[0]!;
  // sendAPIKeyList filters user_id to the authenticated saved administrator on the server.
  if (metadata.name !== KEY_NAME || !Number.isSafeInteger(metadata.userID) || Number(metadata.userID) <= 0
    || metadata.active !== 1 || metadata.status !== "active" || metadata.expires !== null
    || (saved.data.metricsKeyID !== undefined && saved.data.metricsKeyID !== id)
    || (saved.data.metricsKeyUserID !== undefined && saved.data.metricsKeyUserID !== metadata.userID)
    || (saved.stage !== KEY_STAGE && !saved.attemptedActions.includes(KEY_ACTION)
      && saved.data.metricsKeyID === undefined)) {
    throw new Error("Uptime Kuma metrics key owner, label, active state or nonexpiry changed");
  }
  const authorization = `Basic ${Buffer.from(`:${key}`).toString("base64")}`;
  const response = await context.http.request({ method: "GET", path: "/metrics", headers: { Authorization: authorization } });
  const body = await response.text();
  if (response.status !== 200 || Buffer.byteLength(body, "utf8") > MAX_METRICS_BYTES || !/^# (HELP|TYPE) /m.test(body)) {
    throw new Error("Uptime Kuma saved metrics key did not authenticate Prometheus readback");
  }
  const anonymous = await context.http.request({ method: "GET", path: "/metrics" });
  const oldBasic = await context.http.request({ method: "GET", path: "/metrics",
    headers: { Authorization: `Basic ${Buffer.from(`admin:${password}`).toString("base64")}` } });
  if (anonymous.status !== 401 || oldBasic.status !== 401) {
    throw new Error("Uptime Kuma metrics API-key-only authentication was not verified");
  }
  const path = await context.secrets.apiKeyPath();
  if (!path || !isAbsolute(path)) throw new Error("Uptime Kuma metrics key has no private file reference");
  if (saved.stage === KEY_STAGE || saved.data.metricsKeyID === undefined) {
    await context.checkpoint.compareAndSet({ expectedRevision: saved.revision, stage: VERIFIED_STAGE,
      data: { ...saved.data, metricsKeyID: id, metricsKeyUserID: Number(metadata.userID),
        apiKeyScope: "metrics", metricsAuth: "api-key-basic-auth", metricsAdminBasicAuthReplaced: true } });
  }
  return path;
}

/** Pinned status-page event envelopes mirror uptime-status-page-api.ts, with no monitor targets. */
async function ensureStatusPage(context: SetupContext, socket: PollingSocket): Promise<void> {
  let saved = await context.checkpoint.read();
  if (!saved) throw new Error("Uptime Kuma status page requires the administrator checkpoint");
  const getPage = async () => {
    const result = setupRecord(await socket.event("getStatusPage", ["default"]), "Uptime Kuma status page");
    if (result.ok === false && result.msg === "No slug?") return null;
    if (result.ok !== true) throw new Error("Uptime Kuma status-page inspection failed");
    const page = setupRecord(result.config, "Uptime Kuma status-page config");
    if (page.slug !== "default" || page.title !== PAGE_TITLE
      || !Array.isArray(page.domainNameList) || page.domainNameList.length !== 0) {
      throw new Error("Uptime Kuma default status page has a different owner or configuration");
    }
    return page;
  };
  let page = await getPage();
  const recorded = saved.data.statusPageRecorded === true;
  const pageAttempted = saved.attemptedActions.includes(PAGE_ADD_ACTION)
    || saved.attemptedActions.includes(PAGE_SAVE_ACTION);
  if (!recorded && page && !pageAttempted) {
    throw new Error("Uptime Kuma default status page already exists without an owned attempt; do not adopt it");
  }
  if (!recorded && !pageAttempted && saved.stage === VERIFIED_STAGE) {
    const result = setupRecord(await socket.event("addStatusPage", [PAGE_TITLE, "default"],
      { expectedRevision: saved.revision, stage: PAGE_ADD_STAGE }), "Uptime Kuma add status page");
    if (result.ok !== true || result.slug !== "default") {
      throw new Error("Uptime Kuma status-page creation outcome is unknown; inspect before retrying");
    }
    saved = (await context.checkpoint.read())!;
    page = await getPage();
  }
  if (!page) throw new Error("Uptime Kuma attempted status page is missing; inspect instead of replaying creation");
  const publicPage = async () => {
    const response = await context.http.request({ method: "GET", path: "/api/status-page/default" });
    if (response.status !== 200) throw new Error("Uptime Kuma default status page is unavailable");
    const value = setupRecord(await response.json(), "Uptime Kuma public status page");
    if (!Array.isArray(value.publicGroupList) || value.publicGroupList.length !== 0) {
      throw new Error("Uptime Kuma default status page contains unreviewed monitor groups");
    }
  };
  await publicPage();
  if (!recorded && saved.attemptedActions.includes(PAGE_ADD_ACTION)
    && !saved.attemptedActions.includes(PAGE_SAVE_ACTION)) {
    const result = setupRecord(await socket.event("saveStatusPage", ["default", page, "", []],
      { expectedRevision: saved.revision, stage: PAGE_SAVE_STAGE }), "Uptime Kuma save status page");
    if (result.ok !== true) throw new Error("Uptime Kuma status-page save outcome is unknown; inspect before retrying");
    saved = (await context.checkpoint.read())!;
  }
  await getPage();
  await publicPage();
  const response = await context.http.request({ method: "GET", path: "/api/status-page/heartbeat/default" });
  if (response.status !== 200) throw new Error("Uptime Kuma status-page heartbeat endpoint is unavailable");
  const heartbeat = setupRecord(await response.json(), "Uptime Kuma empty heartbeat response");
  for (const key of ["heartbeatList", "uptimeList"]) {
    if (Object.keys(setupRecord(heartbeat[key], "Uptime Kuma empty heartbeat list")).length !== 0) {
      throw new Error("Uptime Kuma status-page heartbeat contains unreviewed monitors");
    }
  }
  if (!recorded) {
    await context.checkpoint.compareAndSet({ expectedRevision: saved.revision, stage: VERIFIED_STAGE,
      data: { ...saved.data, statusPageRecorded: true } });
  }
}

function verified(status: SetupRecord): boolean {
  return status.uptimeOnboardingStage === "login-verified"
    && status.accountUsername === "admin"
    && typeof status.credentialRef === "string" && isAbsolute(status.credentialRef);
}

function checkpoint(context: SetupContext, status: SetupRecord): SetupRecord {
  if (!verified(status)) throw new Error("Uptime Kuma has no saved verified-admin checkpoint");
  return { appId: context.appId, projectRoot: context.projectRoot,
    stage: "login-verified", credentialRef: status.credentialRef };
}

const adapter: SetupAdapter = {
  appId: "uptime-kuma",
  sharedOwner: true,
  peerEffects: [{ peerAppId: "homarr",
    description: "Create a private-network default status page with no monitors for Homarr's unauthenticated status-page integration" }],
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  // Account login alone is not a monitor, availability, or restart health source.
  healthSource: null,
  homarrIntegration: "uptimeKuma",
  ready(record) {
    if (record.appId !== this.appId || record.stage !== "login-verified"
      || typeof record.credentialRef !== "string" || !isAbsolute(record.credentialRef)) return false;
    if (record.loginVerified === true) {
      return typeof record.apiKeyFile === "string" && isAbsolute(record.apiKeyFile)
        && record.apiKeyScope === "metrics" && record.apiKeyExpires === null
        && record.metricsAdminBasicAuthReplaced === true;
    }
    // Legacy standalone onboarding still proves only the owned administrator login.
    return true;
  },
  async firstRun(context) {
    if (context.appId !== this.appId) throw new Error("Uptime Kuma setup received a different app ID");
    let status = appliedStatus(context, await context.status());
    if (status.ownerKind === "shared") return sharedFirstRun(context, status);
    if (verified(status)) return checkpoint(context, status);
    if (status.uptimeOnboardingStage !== null && status.uptimeOnboardingStage !== "attempted") {
      throw new Error("Uptime Kuma has an unrecognized onboarding checkpoint");
    }
    if (status.accountUsername !== null && status.accountUsername !== "admin") {
      throw new Error("Uptime Kuma has a different saved administrator; inspect before setup");
    }

    if (status.credentialRef === null) {
      const plan = setupRecord(await context.read("account-plan", ["--username", "admin"]),
        "Uptime Kuma account plan");
      if (plan.command !== "app account-plan" || plan.appId !== context.appId
        || plan.status !== "ready-for-review" || plan.mutation !== false
        || plan.username !== "admin" || plan.source !== "generate"
        || typeof plan.credentialFile !== "string" || !isAbsolute(plan.credentialFile)
        || typeof plan.approval !== "string"
        || !/^APP-ACCOUNT:uptime-kuma:[0-9a-f]{64}$/.test(plan.approval)) {
        throw new Error("Uptime Kuma returned no exact generated-credential plan");
      }
      await context.apply("account-prepare", plan.approval,
        "Prepare the exact owner-only Uptime Kuma administrator credential", ["--username", "admin"]);
      status = appliedStatus(context, await context.status());
      if (status.accountUsername !== "admin" || status.credentialRef !== plan.credentialFile) {
        throw new Error("Uptime Kuma credential checkpoint changed after preparation");
      }
    } else if (typeof status.credentialRef !== "string" || !isAbsolute(status.credentialRef)) {
      throw new Error("Uptime Kuma has an invalid saved credential reference");
    }

    if (!verified(status)) {
      const approval = statusApproval(status, "onboard");
      await context.apply("onboard", approval,
        "Create or verify the exact Uptime Kuma administrator login");
      status = appliedStatus(context, await context.status());
    }
    return checkpoint(context, status);
  },
};

export default adapter;
