import { createHash } from "node:crypto";

import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext, type SetupRecord } from "../../types/setup";

// Pinned Community implementation, not Docmost's Enterprise public API contract.
// https://github.com/docmost/docmost/blob/9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af/apps/server/src/core/auth/auth.controller.ts
const APP_ID = "docmost";
const EMAIL = "admin@example.test";
const NAME = "Admin";
const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sessionCookie(value: string | null): boolean {
  return typeof value === "string" && /(?:^|,\s*)authToken=[^;,\s]+(?:;|,|$)/.test(value);
}

function successfulEnvelope(value: unknown): boolean {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  return envelope.success === true && envelope.status === 200;
}

async function proveLogin(context: SetupContext, password: string): Promise<{
  userId: string; workspaceId: string;
}> {
  const digest = createHash("sha256").update(password).digest("hex");
  const saved = await context.secrets.readSessionCookies();
  if (Object.keys(saved).some((key) => !["authToken", "pending_authToken", "password_digest"].includes(key))
    || (Object.keys(saved).length > 0 && saved.password_digest !== digest)) {
    throw new Error("Docmost saved private session differs from the owner password");
  }
  let retainedOwner: { userId: string; workspaceId: string } | null = null;
  if (saved.authToken) retainedOwner = await sessionOwner(context, saved.authToken);
  let cookie = saved.pending_authToken;
  if (!cookie) {
    const response = await context.http.request({
      method: "POST", path: "/api/auth/login", headers: JSON_HEADERS,
      body: JSON.stringify({ email: EMAIL, password }),
      approval: { action: "docmost-prove-login", progress: "Verify the saved Docmost owner by fresh password login" },
    });
    if (response.status !== 200 || !sessionCookie(response.headers.get("set-cookie"))) {
      throw new Error("Docmost did not verify the saved first-owner credential");
    }
    const body = await response.text();
    if (body.trim() && !successfulEnvelope(JSON.parse(body))) {
      throw new Error("Docmost login returned an unexpected response");
    }
    cookie = response.headers.get("set-cookie")?.match(/(?:^|,\s*)authToken=([^;,\s]+)/)?.[1] ?? "";
    if (!cookie || cookie.length > 8192 || /[\r\n\0]/.test(cookie)) {
      throw new Error("Docmost returned an unsafe private session cookie");
    }
    // Retain this exact fresh proof while its separate identity approval is pending.
    await context.secrets.writeSessionCookies({ ...saved, password_digest: digest, pending_authToken: cookie });
  }
  const freshOwner = await sessionOwner(context, cookie, true);
  if (retainedOwner) {
    if (freshOwner.userId !== retainedOwner.userId || freshOwner.workspaceId !== retainedOwner.workspaceId) {
      await clearPendingSession(context);
      throw new Error("Docmost fresh password login differs from the retained owner or workspace");
    }
    // Preserve the original cookie for any already-reviewed owner request.
    await clearPendingSession(context);
    return retainedOwner;
  }
  await context.secrets.writeSessionCookies({ authToken: cookie, password_digest: digest });
  return freshOwner;
}

async function clearPendingSession(context: SetupContext): Promise<void> {
  const saved = await context.secrets.readSessionCookies();
  delete saved.pending_authToken;
  await context.secrets.writeSessionCookies(saved);
}

async function sessionOwner(context: SetupContext, cookie: string, pendingFreshSession = false): Promise<{
  userId: string; workspaceId: string;
}> {
  if (!cookie || cookie.length > 8192 || /[\r\n\0]/.test(cookie)) {
    throw new Error("Docmost returned an unsafe private session cookie");
  }
  // The pinned controller uses POST for this read-only identity operation.
  // Session creation and identity reads remain separately approved requests.
  let action = "docmost-read-owner-identity";
  if (pendingFreshSession) action = "docmost-read-fresh-owner-identity";
  const identity = await context.http.request({ method: "POST", path: "/api/users/me",
    headers: { ...JSON_HEADERS, Cookie: `authToken=${cookie}` }, body: "{}",
    approval: { action,
      progress: "Verify the saved Docmost session's current owner role and workspace identity" } });
  if (identity.status === 401) {
    if (pendingFreshSession) await clearPendingSession(context);
    else await context.secrets.writeSessionCookies({});
    throw new Error("Docmost saved session expired or was rejected; use a new approved login on the next run");
  }
  if (identity.status !== 200) throw new Error("Docmost owner identity readback failed");
  const envelope = setupRecord(await identity.json(), "Docmost identity envelope");
  if (!successfulEnvelope(envelope)) throw new Error("Docmost returned an invalid owner identity envelope");
  const data = setupRecord(envelope.data, "Docmost owner identity");
  const user = setupRecord(data.user, "Docmost owner user");
  const workspace = setupRecord(data.workspace, "Docmost owner workspace");
  if (user.email !== EMAIL || user.role !== "owner" || typeof user.id !== "string"
    || !UUID.test(user.id) || typeof workspace.id !== "string" || !UUID.test(workspace.id)
    || user.workspaceId !== workspace.id) {
    throw new Error("Docmost saved login is not the expected workspace owner");
  }
  return { userId: user.id, workspaceId: workspace.id };
}

function verified(context: SetupContext, userId: string, workspaceId: string): SetupRecord {
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "owner-login-verified",
    email: EMAIL, credentialRef: "app handoff", userId, workspaceId, ownerRoleVerified: true };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: "/api/health",
  homarrIntegration: null,
  ready(record) {
    return record.appId === APP_ID && record.stage === "owner-login-verified"
      && record.email === EMAIL && record.credentialRef === "app handoff"
      && record.ownerRoleVerified === true && typeof record.userId === "string"
      && UUID.test(record.userId) && typeof record.workspaceId === "string" && UUID.test(record.workspaceId);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("Docmost setup received a different app ID");
    appliedStatus(context, await context.status());
    const password = await context.secrets.readAdminPassword();
    if (password.length < 8 || password.length > 70 || /[\r\n\u0000]/.test(password)) {
      throw new Error("Docmost has no valid saved administrator password");
    }
    let checkpoint = await context.checkpoint.read();
    if (checkpoint !== null && (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || !["owner-attempted", "owner-login-verified"].includes(checkpoint.stage)
      || !checkpoint.attemptedActions.includes("docmost-first-owner"))) {
      throw new Error("Docmost has an unrecognized first-owner checkpoint");
    }
    if (checkpoint === null) {
      const response = await context.http.request({
        method: "POST", path: "/api/auth/setup", headers: JSON_HEADERS,
        body: JSON.stringify({ name: NAME, email: EMAIL, password }),
        approval: { action: "docmost-first-owner", progress: "Create the first private Docmost workspace and owner once", once: true },
        beforeSendCheckpoint: { expectedRevision: null, stage: "owner-attempted" },
      });
      if (response.status !== 200 || !sessionCookie(response.headers.get("set-cookie"))) {
        throw new Error("Docmost owner setup was not confirmed; only a fresh saved-credential login may recover it");
      }
      const envelope = await response.json();
      if (!successfulEnvelope(envelope) || !envelope || typeof envelope !== "object"
        || Array.isArray(envelope) || !("data" in envelope)) {
        throw new Error("Docmost returned an invalid first-workspace response");
      }
      const workspace = (envelope as { data: unknown }).data;
      if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)
        || !["id", "name", "defaultSpaceId"].every((key) => {
          const value = (workspace as Record<string, unknown>)[key];
          return typeof value === "string" && value.length > 0 && value.length <= 255;
        })) {
        throw new Error("Docmost returned no verified first-workspace identity");
      }
      const workspaceId = (workspace as Record<string, unknown>).id;
      if (typeof workspaceId !== "string" || !UUID.test(workspaceId)) {
        throw new Error("Docmost returned an invalid first-workspace ID");
      }
      checkpoint = await context.checkpoint.read();
      if (!checkpoint) throw new Error("Docmost first-workspace checkpoint is missing");
      await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
        stage: "owner-attempted", data: { workspaceId } });
    }
    const { userId, workspaceId } = await proveLogin(context, password);
    const latest = await context.checkpoint.read();
    if (!latest || (latest.data.workspaceId !== undefined && latest.data.workspaceId !== workspaceId)
      || (latest.data.userId !== undefined && latest.data.userId !== userId)) {
      throw new Error("Docmost owner identity differs from the saved first-workspace checkpoint");
    }
    await context.checkpoint.compareAndSet({ expectedRevision: latest.revision,
      stage: "owner-login-verified", data: { userId, workspaceId } });
    return verified(context, userId, workspaceId);
  },
};

export default adapter;
