import { Buffer } from "node:buffer";
import { isAbsolute } from "node:path";

import {
  appliedStatus,
  setupRecord,
  type SetupAdapter,
  type SetupContext,
  type SetupCheckpoint,
  type SetupInspectionContext,
  type SetupRecord,
} from "../../types/setup";

const APP_ID = "ntfy";
const PROBE_TOPIC = "auto-stack-auth-probe";
const ADMIN_VERIFIED = "admin-auth-and-anonymous-denial-verified";
const KEY_ACTION = "ntfy-create-homarr-token";
const KEY_ATTEMPTED = "homarr-token-create-attempted";
const KEY_VERIFIED = "admin-and-homarr-token-verified";

async function exactOwner(context: SetupContext | SetupInspectionContext): Promise<SetupCheckpoint | null> {
  if (context.appId !== APP_ID) throw new Error("ntfy setup received a different app");
  const status = appliedStatus(context, await context.status());
  if (status.ownerKind !== "shared" || status.username !== "admin"
    || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)) {
    throw new Error("ntfy has no exact shared administrator credential reference");
  }
  const checkpoint = await context.checkpoint.read();
  if (checkpoint && (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
    || ![ADMIN_VERIFIED, KEY_ATTEMPTED, KEY_VERIFIED].includes(checkpoint.stage)
    || (checkpoint.stage !== ADMIN_VERIFIED && !checkpoint.attemptedActions.includes(KEY_ACTION)))) {
    throw new Error("ntfy has no matching owned Homarr token checkpoint");
  }
  return checkpoint;
}

function validToken(value: unknown): value is string {
  return typeof value === "string" && /^tk_[-_A-Za-z0-9]{29}$/.test(value);
}

function nonExpiringToken(token: SetupRecord): boolean {
  // v2.28.0 apiAccountTokenResponse omits expires when its Unix timestamp is 0.
  return token.expires === undefined || token.expires === 0;
}

async function adminAuthorization(context: ReadContext): Promise<string> {
  const password = await context.secrets.readAdminPassword();
  if (!password || password.length > 1024 || /[\r\n\u0000]/.test(password)) {
    throw new Error("ntfy has no valid saved administrator password");
  }
  return `Basic ${Buffer.from(`admin:${password}`, "utf8").toString("base64")}`;
}

// https://github.com/binwiederhier/ntfy/blob/v2.28.0/server/server_account.go
// https://github.com/binwiederhier/ntfy/blob/v2.28.0/server/server_middleware.go
// Account token APIs require an authenticated user, not enable-login.
async function homarrTokens(context: ReadContext, authorization: string): Promise<{ matches: SetupRecord[]; count: number }> {
  const response = await context.http.request({ method: "GET", path: "/v1/account",
    headers: { Authorization: authorization } });
  if (response.status !== 200) throw new Error("ntfy administrator account inventory is unavailable");
  const account = setupRecord(await response.json(), "ntfy administrator account");
  if (account.username !== "admin" || account.role !== "admin") {
    throw new Error("ntfy account did not prove the saved administrator identity");
  }
  const tokens = account.tokens ?? [];
  if (!Array.isArray(tokens) || tokens.length > 60) throw new Error("ntfy token inventory is invalid");
  const inventory = tokens.map((token) => setupRecord(token, "ntfy token inventory"));
  if (inventory.some((token) => typeof token.label !== "string")) throw new Error("ntfy token labels are invalid");
  const matches = inventory.filter((token) => token.label === "Homarr");
  if (matches.length > 1 || matches.some((token) => !nonExpiringToken(token) || token.provisioned === true)) {
    throw new Error("ntfy Homarr token inventory differs; inspect before continuing");
  }
  return { matches, count: inventory.length };
}

type ReadContext = Pick<SetupInspectionContext, "projectRoot" | "http" | "secrets">;

async function probe(context: ReadContext, requireKey = true): Promise<SetupRecord> {
  const path = `/${PROBE_TOPIC}/json`;
  const query = { poll: "1", since: "all" };
  const anonymous = await context.http.request({ method: "GET", path, query });
  if (anonymous.status !== 401 && anonymous.status !== 403) {
    throw new Error("ntfy did not deny anonymous subscription");
  }
  const authorization = await adminAuthorization(context);
  const admin = await context.http.request({
    method: "GET", path, query, headers: { Authorization: authorization },
  });
  if (admin.status !== 200) {
    throw new Error("ntfy did not authenticate the saved administrator for topic subscription");
  }
  const result: SetupRecord = {
    appId: APP_ID,
    projectRoot: context.projectRoot,
    stage: ADMIN_VERIFIED,
    adminUsername: "admin",
    anonymousSubscriptionDenied: true,
    notificationDeliveryVerified: false,
  };
  if (!requireKey) return result;
  const secret = await context.secrets.readApiKey();
  if (!validToken(secret)) throw new Error("ntfy has no valid saved Homarr API token");
  const { matches } = await homarrTokens(context, authorization);
  if (matches.length !== 1 || matches[0].token !== secret) {
    throw new Error("ntfy saved Homarr token does not match its unique inventory entry");
  }
  const bearer = await context.http.request({ method: "GET", path, query,
    headers: { Authorization: `Bearer ${secret}` } });
  if (bearer.status !== 200) throw new Error("ntfy saved Homarr token did not authenticate subscription");
  const apiKeyFile = await context.secrets.apiKeyPath();
  if (!apiKeyFile || !isAbsolute(apiKeyFile)) throw new Error("ntfy Homarr token has no canonical private file");
  return { ...result, stage: KEY_VERIFIED, apiKeyFile, homarrTokenLabel: "Homarr",
    homarrTokenScope: "administrator", homarrTokenSubscriptionVerified: true };
}

async function createHomarrToken(context: SetupContext): Promise<void> {
  const authorization = await adminAuthorization(context);
  const { matches, count } = await homarrTokens(context, authorization);
  const secret = await context.secrets.readApiKey();
  let checkpoint = await context.checkpoint.read();
  if (secret !== null) {
    if (!checkpoint || !checkpoint.attemptedActions.includes(KEY_ACTION)) {
      throw new Error("ntfy saved Homarr token has no owned creation checkpoint");
    }
    return; // probe verifies saved secret and inventory without creating a replacement.
  }
  if (matches.length > 0 || checkpoint?.attemptedActions.includes(KEY_ACTION)
    || (checkpoint && checkpoint.stage !== ADMIN_VERIFIED)) {
    throw new Error("ntfy Homarr token has no saved secret or uncertain creation; inspect without creating a replacement");
  }
  if (!checkpoint) {
    checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: null, stage: ADMIN_VERIFIED });
  }
  // https://github.com/binwiederhier/ntfy/blob/v2.28.0/user/manager.go
  // CreateToken prunes above 60 entries; refuse creation at capacity instead.
  if (count >= 60) {
    throw new Error("ntfy token inventory is at capacity; creation could prune existing tokens");
  }
  const response = await context.http.request({ method: "POST", path: "/v1/account/token",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    // https://github.com/binwiederhier/ntfy/blob/v2.28.0/user/manager_sqlite.go
    // expires=0 is non-expiring, not the default 72-hour login session.
    body: JSON.stringify({ label: "Homarr", expires: 0 }),
    approval: { action: KEY_ACTION, once: true, progress: "Create the Homarr API token for the verified ntfy administrator" },
    beforeSendCheckpoint: { expectedRevision: checkpoint.revision, stage: KEY_ATTEMPTED },
  });
  if (response.status !== 200) throw new Error("ntfy Homarr token creation is uncertain; inspect before retrying");
  const created = setupRecord(await response.json(), "ntfy Homarr token creation");
  if (!validToken(created.token)) throw new Error("ntfy created token has no usable secret; inspect manually");
  // Save before inspecting metadata or issuing any follow-up request.
  await context.secrets.writeApiKey(created.token);
  if (created.label !== "Homarr" || !nonExpiringToken(created)) {
    throw new Error("ntfy created Homarr token metadata differs; inspect manually");
  }
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  async firstRun(context: SetupContext): Promise<SetupRecord> {
    await exactOwner(context);
    await probe(context, false);
    await createHomarrToken(context);
    const result = await probe(context);
    const checkpoint = await context.checkpoint.read();
    if (!checkpoint) throw new Error("ntfy Homarr token checkpoint is unavailable");
    if (checkpoint.stage !== KEY_VERIFIED) {
      await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision, stage: KEY_VERIFIED });
    }
    return result;
  },
  async inspect(context): Promise<SetupRecord> {
    const checkpoint = await exactOwner(context);
    if (checkpoint?.stage !== KEY_VERIFIED) {
      throw new Error("ntfy has no completed owned Homarr token checkpoint");
    }
    return probe(context);
  },
  ready(status): boolean {
    return status.appId === APP_ID && status.stage === KEY_VERIFIED
      && status.adminUsername === "admin" && status.anonymousSubscriptionDenied === true
      && status.homarrTokenSubscriptionVerified === true && typeof status.apiKeyFile === "string"
      && isAbsolute(status.apiKeyFile);
  },
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: "ntfy",
};

export default adapter;
