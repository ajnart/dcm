import { Buffer } from "node:buffer";
import { dirname, isAbsolute } from "node:path";

import {
  appliedStatus,
  setupRecord,
  type SetupAdapter,
  type SetupCheckpoint,
  type SetupContext,
  type SetupInspectionContext,
  type SetupRecord,
} from "../../types/setup";

// Forgejo v16.0.5 contracts:
// https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/cmd/admin_user_create.go
// https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/cmd/admin_user_list.go
// https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/routers/api/v1/user/user.go
// https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/modules/structs/user.go
// https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/routers/api/v1/utils/access_token.go
// https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/modules/structs/user_app.go
// https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/models/auth/access_token_scope.go
const APP_ID = "forgejo";
const USERNAME = "admin";
const ATTEMPTED = "admin-create-attempted";
const VERIFIED = "admin-login-verified";
const CREATE_ACTION = "forgejo-first-admin";
const KEY_ATTEMPTED = "api-key-create-attempted";
const KEY_VERIFIED = "admin-and-api-key-verified";
const KEY_ACTION = "forgejo-readonly-api-key";
const KEY_NAME = "selfhost-readonly";
const KEY_PATH = "/api/v1/users/admin/tokens";
// The smallest useful scope proves the token's own user, without repository access.
const KEY_SCOPES = ["read:user"];

type ReadContext = Pick<SetupInspectionContext, "projectRoot" | "http" | "secrets">;

function adminAuthorization(password: string): string {
  if (password.length < 12 || password.length > 128 || /[\r\n\0]/.test(password)) {
    throw new Error("Forgejo has no valid saved administrator password");
  }
  return `Basic ${Buffer.from(`${USERNAME}:${password}`, "utf8").toString("base64")}`;
}

async function verifyAdmin(context: ReadContext, password: string, authorization = adminAuthorization(password)): Promise<number | false> {
  let response;
  try {
    response = await context.http.request({
      method: "GET",
      path: "/api/v1/user",
      headers: { Authorization: authorization },
    });
  } catch {
    throw new Error("Forgejo administrator login could not be checked");
  }
  if (response.status === 401 || response.status === 403) return false;
  if (response.status !== 200) throw new Error("Forgejo administrator login could not be checked");
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("Forgejo returned an invalid administrator readback");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Forgejo returned an invalid administrator readback");
  }
  const user = value as Record<string, unknown>;
  if (user.login !== USERNAME || user.is_admin !== true || user.active !== true
    || typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id < 1) {
    throw new Error("The saved Forgejo login is not the expected active administrator");
  }
  return user.id;
}

function result(context: ReadContext, passwordFile: string, apiKeyRef: string): SetupRecord {
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: KEY_VERIFIED,
    username: USERNAME, credentialRef: passwordFile, apiKeyRef };
}

function exactPasswordFile(context: ReadContext, value: unknown): string {
  const status = setupRecord(value, "Forgejo app status");
  const runtime = setupRecord(status.runtime, "Forgejo runtime status");
  if (status.command !== "app status" || status.ownerKind !== "shared"
    || status.appId !== APP_ID || status.projectRoot !== context.projectRoot
    || status.status !== "applied" || status.mutation !== false
    || runtime.state !== "running" || status.username !== USERNAME
    || typeof status.privateFiles !== "string" || !isAbsolute(status.privateFiles)
    || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)
    || dirname(status.passwordFile) !== status.privateFiles) {
    throw new Error("Forgejo has no exact saved administrator handoff file");
  }
  return status.passwordFile;
}

function validCheckpoint(context: ReadContext, checkpoint: SetupCheckpoint | null): void {
  if (checkpoint === null) return;
  if (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
    || ![ATTEMPTED, VERIFIED, KEY_ATTEMPTED, KEY_VERIFIED].includes(checkpoint.stage)
    || !checkpoint.attemptedActions.includes(CREATE_ACTION)) {
    throw new Error("Forgejo has an unrecognized first-admin checkpoint");
  }
  if ([KEY_ATTEMPTED, KEY_VERIFIED].includes(checkpoint.stage)
    && (!checkpoint.attemptedActions.includes(KEY_ACTION)
      || !Number.isSafeInteger(checkpoint.data.userId) || Number(checkpoint.data.userId) < 1)) {
    throw new Error("Forgejo has an unrecognized API-key attempt checkpoint");
  }
  if (checkpoint.stage === KEY_VERIFIED
    && (!Number.isSafeInteger(checkpoint.data.tokenId) || Number(checkpoint.data.tokenId) < 1)) {
    throw new Error("Forgejo has no exact verified API-key identity");
  }
}

function tokenRecord(value: unknown): SetupRecord {
  const token = setupRecord(value, "Forgejo API key");
  if (!Number.isSafeInteger(token.id) || Number(token.id) < 1 || token.name !== KEY_NAME
    || !Array.isArray(token.scopes) || token.scopes.length !== 1 || token.scopes[0] !== KEY_SCOPES[0]
    || typeof token.token_last_eight !== "string" || !/^[a-f0-9]{8}$/.test(token.token_last_eight)) {
    throw new Error("Forgejo API key has an unexpected identity or scope");
  }
  return token;
}

async function listTokens(context: ReadContext, password: string): Promise<SetupRecord[]> {
  try {
    const response = await context.http.request({ method: "GET", path: KEY_PATH,
      headers: { Authorization: adminAuthorization(password) }, query: { page: "1", limit: "100" } });
    if (response.status !== 200) throw new Error();
    const value = await response.json();
    const total = response.headers.get("x-total-count");
    if (!Array.isArray(value) || value.length > 100 || total === null || !/^\d+$/.test(total)
      || Number(total) !== value.length) throw new Error();
    return value.map((item) => setupRecord(item, "Forgejo token inventory"));
  } catch {
    throw new Error("Forgejo complete bounded token inventory could not be checked");
  }
}

async function verifyKey(context: ReadContext, password: string, checkpoint: SetupCheckpoint): Promise<{ apiKeyRef: string; tokenId: number }> {
  const key = await context.secrets.readApiKey();
  const apiKeyRef = await context.secrets.apiKeyPath();
  if (key === null || !/^[a-f0-9]{40}$/.test(key) || apiKeyRef === null || !isAbsolute(apiKeyRef)) {
    throw new Error("Forgejo API-key creation has an ambiguous outcome; do not retry it");
  }
  const tokens = await listTokens(context, password);
  const owned = tokens.filter((token) => token.name === KEY_NAME);
  if (owned.length !== 1) throw new Error("Forgejo saved API key has no unique owner readback");
  const token = tokenRecord(owned[0]);
  if (token.token_last_eight !== key.slice(-8)
    || (checkpoint.data.tokenId !== undefined && token.id !== checkpoint.data.tokenId)
    || await verifyAdmin(context, password, `token ${key}`) !== checkpoint.data.userId) {
    throw new Error("Forgejo saved API key does not match its owner checkpoint");
  }
  return { apiKeyRef, tokenId: Number(token.id) };
}

async function ensureKey(context: SetupContext, password: string, userId: number): Promise<string> {
  let checkpoint = await context.checkpoint.read();
  validCheckpoint(context, checkpoint);
  if (checkpoint === null) throw new Error("Forgejo first-admin checkpoint is missing");
  if (checkpoint.stage === VERIFIED) {
    if (await context.secrets.readApiKey() !== null || (await listTokens(context, password)).some((token) => token.name === KEY_NAME)) {
      throw new Error("Forgejo API key exists without this setup's token checkpoint");
    }
    const response = await context.http.request({ method: "POST", path: KEY_PATH,
      headers: { Authorization: adminAuthorization(password), "Content-Type": "application/json" },
      body: JSON.stringify({ name: KEY_NAME, scopes: KEY_SCOPES }),
      approval: { action: KEY_ACTION, progress: "Create one read-only Forgejo user API key", once: true },
      beforeSendCheckpoint: { expectedRevision: checkpoint.revision, stage: KEY_ATTEMPTED, data: { userId } } });
    if (response.status !== 201) throw new Error("Forgejo API key creation was not confirmed; inspect before recovery");
    let value: unknown;
    try { value = await response.json(); } catch { throw new Error("Forgejo API key creation returned no usable private output"); }
    const token = tokenRecord(value);
    if (typeof token.sha1 !== "string" || !/^[a-f0-9]{40}$/.test(token.sha1) || token.token_last_eight !== token.sha1.slice(-8)) {
      throw new Error("Forgejo API key creation returned no usable private output");
    }
    // Persist the once-returned secret before any network read or checkpoint write.
    await context.secrets.writeApiKey(token.sha1);
    checkpoint = await context.checkpoint.read();
    validCheckpoint(context, checkpoint);
    if (checkpoint?.stage !== KEY_ATTEMPTED) throw new Error("Forgejo API key attempt checkpoint is missing");
    checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
      stage: KEY_ATTEMPTED, data: { userId, tokenId: Number(token.id) } });
  }
  if (checkpoint.data.userId !== userId) throw new Error("Forgejo administrator differs from its token checkpoint");
  const verified = await verifyKey(context, password, checkpoint);
  if (checkpoint.stage !== KEY_VERIFIED) {
    await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision, stage: KEY_VERIFIED,
      data: { userId, tokenId: verified.tokenId } });
  }
  return verified.apiKeyRef;
}

async function requireEmptyUsers(context: SetupContext): Promise<void> {
  const list = await context.container.exec({
    effect: "read",
    // The standard image starts a root supervisor. Its Forgejo wrapper sets
    // paths, not uid; use the same shipped su-exec/git boundary as the server.
    argv: ["su-exec", "git", "forgejo", "admin", "user", "list"],
    approval: { action: "forgejo-list-users", progress: "Check the exact Forgejo database for an empty user table" },
  });
  if (list.exitCode !== 0) throw new Error("Forgejo user inventory could not be checked");
  const lines = list.stdout.trim().split(/\r?\n/);
  if (lines.length !== 1 || !/^ID\s+Username\s+Email\s+IsActive\s+IsAdmin\s+2FA\s*$/.test(lines[0]!)) {
    throw new Error("Forgejo already has a user or returned an unexpected inventory; inspect before setup");
  }
}

const setup: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: null,
  ready(record) {
    return record.appId === APP_ID && record.stage === KEY_VERIFIED
      && record.username === USERNAME && typeof record.credentialRef === "string"
      && isAbsolute(record.credentialRef) && typeof record.apiKeyRef === "string" && isAbsolute(record.apiKeyRef);
  },
  async inspect(context) {
    if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
      throw new Error("Forgejo inspection received a different app project");
    }
    const passwordFile = exactPasswordFile(context, await context.status());
    const checkpoint = await context.checkpoint.read();
    validCheckpoint(context, checkpoint);
    if (checkpoint?.stage !== KEY_VERIFIED) throw new Error("Forgejo has no verified account-and-key checkpoint; resume setup");
    const password = await context.secrets.readAdminPassword();
    if (await verifyAdmin(context, password) !== checkpoint.data.userId) {
      throw new Error("The saved Forgejo administrator no longer logs in");
    }
    return result(context, passwordFile, (await verifyKey(context, password, checkpoint)).apiKeyRef);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
      throw new Error("Forgejo setup received a different app project");
    }
    const status = appliedStatus(context, await context.status());
    const passwordFile = exactPasswordFile(context, status);
    let checkpoint = await context.checkpoint.read();
    validCheckpoint(context, checkpoint);
    const savedPassword = await context.secrets.readAdminPassword();
    if (await verifyAdmin(context, savedPassword)) {
      if (checkpoint === null) {
        throw new Error("Forgejo has an administrator without this setup's creation checkpoint");
      }
    } else {
      if (checkpoint !== null) {
        throw new Error("Forgejo first-admin creation has an ambiguous outcome; do not retry it");
      }
      await requireEmptyUsers(context);
      const created = await context.container.exec({
        effect: "write",
        argv: ["su-exec", "git", "forgejo", "admin", "user", "create", "--username", USERNAME,
          "--email", "admin@forgejo.invalid", "--admin", "--random-password",
          "--random-password-length", "48", "--must-change-password=false"],
        approval: { action: CREATE_ACTION, progress: "Create one Forgejo administrator with an app-generated password", once: true },
        beforeSendCheckpoint: { expectedRevision: null, stage: ATTEMPTED },
        captureAdminPassword: { format: "one-line", prefix: "generated random password is '", suffix: "'" },
      });
      if (created.exitCode !== 0 || created.stdout !== "") {
        throw new Error("Forgejo administrator creation was not privately captured");
      }
      if (!await verifyAdmin(context, await context.secrets.readAdminPassword())) {
        throw new Error("Forgejo did not verify its newly created administrator by fresh login");
      }
      checkpoint = await context.checkpoint.read();
      validCheckpoint(context, checkpoint);
    }
    if (checkpoint === null) throw new Error("Forgejo first-admin checkpoint is missing");
    if (checkpoint.stage === ATTEMPTED) {
      await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision, stage: VERIFIED });
    }
    const password = await context.secrets.readAdminPassword();
    const userId = await verifyAdmin(context, password);
    if (userId === false) throw new Error("The saved Forgejo administrator no longer logs in");
    return result(context, passwordFile, await ensureKey(context, password, userId));
  },
};

export default setup;
