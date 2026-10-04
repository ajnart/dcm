import { isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { createSetupProofRecorder } from "../../shared/setup-proof";

import {
  appliedStatus,
  type SetupAdapter,
  type SetupContext,
  type SetupRecord,
} from "../../types/setup";

const APP_ID = "audiobookshelf";
const VERSION = "2.37.0";
const USERNAME = "admin";
const proof = createSetupProofRecorder();

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

async function serverStatus(context: Pick<SetupContext, "http">): Promise<boolean> {
  const response = await context.http.request({ method: "GET", path: "/status" });
  if (response.status !== 200) throw new Error("Audiobookshelf status is unavailable");
  const body = object(await response.json(), "Audiobookshelf status");
  if (body.app !== APP_ID || body.serverVersion !== VERSION || typeof body.isInit !== "boolean") {
    throw new Error("Audiobookshelf is not the pinned v2.37.0 server");
  }
  return body.isInit;
}

async function verifyLogin(context: SetupContext): Promise<Record<string, unknown>> {
  const password = await savedPassword(context);
  const digest = createHash("sha256").update(password).digest("hex");
  const saved = await context.secrets.readSessionCookies();
  if (Object.keys(saved).some((key) => !["bearer", "owner_id", "password_digest"].includes(key))
    || (Object.keys(saved).length > 0 && (saved.password_digest !== digest
      || !saved.bearer || !validToken(saved.bearer)
      || !/^[A-Za-z0-9_-]{1,128}$/.test(saved.owner_id ?? "")))) {
    throw new Error("Audiobookshelf private setup session differs from its saved owner credential");
  }
  let retainedOwner: Record<string, unknown> | null = null;
  if (saved.bearer) retainedOwner = await sessionOwner(context, saved.bearer, saved.owner_id);
  const response = await context.http.request({
    method: "POST", path: "/login",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password }),
    approval: { action: "audiobookshelf-verify-root-login", progress: "Verify the saved Audiobookshelf root account" },
  });
  if (response.status !== 200) throw new Error("Audiobookshelf root login failed");
  const body = object(await response.json(), "Audiobookshelf login response");
  const user = object(body.user, "Audiobookshelf login user");
  if (user.username !== USERNAME || user.type !== "root"
    || typeof user.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(user.id)
    || typeof user.accessToken !== "string" || !validToken(user.accessToken)) {
    throw new Error("Audiobookshelf saved credentials did not authenticate the expected root user");
  }
  if (retainedOwner) {
    if (user.id !== retainedOwner.id) {
      throw new Error("Audiobookshelf fresh password login differs from the retained root identity");
    }
    // A valid retained bearer does not prove the password. Verify it freshly,
    // but preserve the original bearer bound to a pending API-key approval.
    await sessionOwner(context, user.accessToken, user.id, false);
    return retainedOwner;
  }
  await context.secrets.writeSessionCookies({ bearer: user.accessToken,
    owner_id: user.id, password_digest: digest });
  // Retain the issued session before uncertain network readback. It is not
  // trusted for setup writes until the exact root identity has been verified.
  return sessionOwner(context, user.accessToken, user.id);
}

async function sessionOwner(context: SetupContext, bearer: string,
  expectedId: string, clearSavedSession = true): Promise<Record<string, unknown>> {
  const response = await context.http.request({ method: "GET", path: "/api/me",
    headers: { Authorization: `Bearer ${bearer}` } });
  if (response.status === 401) {
    if (clearSavedSession) await context.secrets.writeSessionCookies({});
    throw new Error("Audiobookshelf setup session was rejected; request a new approved login on the next run");
  }
  if (response.status !== 200) throw new Error("Audiobookshelf setup-session owner readback failed");
  const owner = object(await response.json(), "Audiobookshelf setup-session owner");
  if (owner.id !== expectedId || owner.username !== USERNAME || owner.type !== "root") {
    throw new Error("Audiobookshelf setup session does not authenticate the exact saved root account");
  }
  return { ...owner, accessToken: bearer };
}

async function savedPassword(context: SetupContext): Promise<string> {
  const password = await context.secrets.readAdminPassword();
  if (!password || password.length > 1024 || /[\r\n\u0000]/.test(password)) {
    throw new Error("Audiobookshelf has no valid saved administrator password");
  }
  return password;
}

function validToken(value: string): boolean {
  return value.length <= 8192 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

async function inventory(context: SetupContext, accessToken: string): Promise<Record<string, unknown>[]> {
  const response = await context.http.request({ method: "GET", path: "/api/api-keys",
    headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status !== 200) throw new Error("Audiobookshelf API-key inventory failed");
  const payload = object(await response.json(), "Audiobookshelf API-key inventory");
  if (!Array.isArray(payload.apiKeys)) throw new Error("Audiobookshelf API-key inventory is invalid");
  return payload.apiKeys.map((entry) => object(entry, "Audiobookshelf API-key entry"));
}

// Pinned v2.37.0 ApiKeyController: keys are returned only on creation.
// A lost creation response must stop; inventory cannot recover its secret.
async function verifyApiKey(context: SetupContext, owner: Record<string, unknown>): Promise<string> {
  let saved = await context.checkpoint.read();
  if (!saved || saved.appId !== APP_ID || saved.projectRoot !== context.projectRoot
    || !["root-login-verified", "api-key-create-attempted", "root-and-api-key-verified"].includes(saved.stage)) {
    throw new Error("Audiobookshelf has no trusted root checkpoint before API-key setup");
  }
  let key = await context.secrets.readApiKey();
  if (key !== null && !validToken(key)) throw new Error("Audiobookshelf saved API key is invalid");
  if (!key) {
    if (saved.stage !== "root-login-verified"
      || saved.attemptedActions.includes("audiobookshelf-create-api-key")) {
      throw new Error("Audiobookshelf key creation was attempted without a captured secret; inspect without replaying");
    }
    if ((await inventory(context, owner.accessToken as string))
      .some((entry) => entry.name === "auto-stack-homarr")) {
      throw new Error("Audiobookshelf already has an unowned integration key with this name; inspect without adopting it");
    }
    const response = await context.http.request({ method: "POST", path: "/api/api-keys",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.accessToken}` },
      body: JSON.stringify({ name: "auto-stack-homarr", userId: owner.id, isActive: true }),
      approval: { action: "audiobookshelf-create-api-key", once: true,
        progress: "Create one durable Audiobookshelf API key for the saved root account" },
      beforeSendCheckpoint: { expectedRevision: saved.revision, stage: "api-key-create-attempted",
        data: { ownerId: owner.id as string } } });
    if (response.status !== 200) throw new Error("Audiobookshelf key creation is uncertain; inspect without replaying");
    const created = object(object(await response.json(), "Audiobookshelf API-key response").apiKey,
      "Audiobookshelf API key");
    if (typeof created.apiKey !== "string" || !validToken(created.apiKey)
      || created.userId !== owner.id || created.isActive !== true
      || created.name !== "auto-stack-homarr") {
      throw new Error("Audiobookshelf did not return the exact root-owned active API key");
    }
    key = created.apiKey;
    await context.secrets.writeApiKey(key);
    if (await context.secrets.readApiKey() !== key) throw new Error("Audiobookshelf key was not saved privately");
    saved = await context.checkpoint.read();
  }
  if (!saved || saved.stage === "root-login-verified" || saved.data.ownerId !== owner.id
    || !saved.attemptedActions.includes("audiobookshelf-create-api-key")) {
    throw new Error("Audiobookshelf API key has no matching creation provenance");
  }
  const matches = (await inventory(context, owner.accessToken as string))
    .filter((entry) => entry.name === "auto-stack-homarr");
  if (matches.length !== 1 || matches[0].userId !== owner.id || matches[0].isActive !== true) {
    throw new Error("Audiobookshelf durable API-key ownership did not pass inventory readback");
  }
  const response = await context.http.request({ method: "GET", path: "/api/me",
    headers: { Authorization: `Bearer ${key}` } });
  if (response.status !== 200) throw new Error("Audiobookshelf saved API key was rejected");
  const user = object(await response.json(), "Audiobookshelf API-key owner");
  if (user.id !== owner.id || user.username !== USERNAME || user.type !== "root") {
    throw new Error("Audiobookshelf API key does not authenticate the saved root account");
  }
  if (saved.stage !== "root-and-api-key-verified") {
    await context.checkpoint.compareAndSet({ expectedRevision: saved.revision,
      stage: "root-and-api-key-verified", data: saved.data });
  }
  const path = await context.secrets.apiKeyPath();
  if (!path || !isAbsolute(path)) throw new Error("Audiobookshelf API-key handoff path is missing");
  return path;
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  compatibilityResult(record) {
    return proof.result(record);
  },
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: "Audiobookshelf",
  ready(value) {
    return value.appId === APP_ID && value.stage === "root-and-api-key-verified"
      && value.version === VERSION && value.adminUsername === USERNAME
      && typeof value.credentialRef === "string" && isAbsolute(value.credentialRef)
      && typeof value.apiKeyFile === "string" && isAbsolute(value.apiKeyFile);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("Audiobookshelf setup received another app ID");
    const status = appliedStatus(context, await context.status());
    if (status.username !== USERNAME || typeof status.passwordFile !== "string"
      || !isAbsolute(status.passwordFile)) {
      throw new Error("Audiobookshelf has no exact saved administrator credential");
    }
    const initialized = await serverStatus(context);
    const checkpoint = await context.checkpoint.read();
    if (checkpoint && (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || !["init-attempted", "root-login-verified", "api-key-create-attempted",
        "root-and-api-key-verified"].includes(checkpoint.stage))) {
      throw new Error("Audiobookshelf setup checkpoint is unexpected");
    }
    // Entry provenance cannot be inferred from a checkpoint completed later
    // during this invocation. Interrupted initialization/key work earns neither origin.
    let origin: "fresh" | "resume" | null = null;
    if (checkpoint?.stage === "root-and-api-key-verified" && checkpoint.schemaVersion === 1
      && Number.isSafeInteger(checkpoint.revision) && checkpoint.revision > 0
      && checkpoint.attemptedActions.includes("audiobookshelf-create-root")
      && checkpoint.attemptedActions.includes("audiobookshelf-create-api-key")
      && typeof checkpoint.data.ownerId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(checkpoint.data.ownerId)) {
      origin = "resume";
    }
    if (!initialized) {
      if (checkpoint) {
        throw new Error("Audiobookshelf initialization was attempted but is not complete; inspect before retrying");
      }
      const password = await savedPassword(context);
      const response = await context.http.request({
        method: "POST", path: "/init",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newRoot: { username: USERNAME, password } }),
        approval: { action: "audiobookshelf-create-root", once: true,
          progress: "Create the first Audiobookshelf root account on this exact private server" },
        beforeSendCheckpoint: { expectedRevision: null, stage: "init-attempted" },
      });
      if (response.status !== 200) {
        throw new Error("Audiobookshelf root creation has an uncertain outcome; inspect before retrying");
      }
      origin = "fresh";
    } else if (!checkpoint) {
      throw new Error("Audiobookshelf already has a root account outside this setup; do not adopt it blindly");
    }
    if (!(await serverStatus(context))) throw new Error("Audiobookshelf still reports no root account");
    const owner = await verifyLogin(context);
    const current = await context.checkpoint.read();
    if (!current || current.appId !== APP_ID || current.projectRoot !== context.projectRoot) {
      throw new Error("Audiobookshelf has no trusted initialization checkpoint");
    }
    if (current.stage === "init-attempted") {
      await context.checkpoint.compareAndSet({ expectedRevision: current.revision,
        stage: "root-login-verified" });
    }
    const apiKeyFile = await verifyApiKey(context, owner);
    return proof.record({ appId: APP_ID, projectRoot: context.projectRoot, stage: "root-and-api-key-verified",
      version: VERSION, adminUsername: USERNAME, credentialRef: status.passwordFile, apiKeyFile }, origin, "verified");
  },
};

export default adapter;
