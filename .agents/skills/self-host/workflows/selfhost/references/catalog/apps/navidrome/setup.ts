import { appliedStatus, type SetupAdapter, type SetupCompatibilityResult, type SetupContext, type SetupRecord } from "../../types/setup";
import { createSetupProofRecorder } from "../../shared/setup-proof";

// Pinned v0.64.0 UI and server contracts:
// https://github.com/navidrome/navidrome/blob/v0.64.0/ui/src/authProvider.js
// https://github.com/navidrome/navidrome/blob/v0.64.0/server/auth.go
// https://github.com/navidrome/navidrome/blob/v0.64.0/server/nativeapi/native_api.go
const APP_ID = "navidrome";
const USERNAME = "admin";
const CREATE = "navidrome-first-admin";
const HEADERS = { "content-type": "application/json", accept: "application/json" };
const proof = createSetupProofRecorder();

type AdminSession = { id: string; token: string };

function validAdmin(value: unknown): value is AdminSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return body.username === USERNAME && body.isAdmin === true
    && typeof body.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(body.id)
    && typeof body.token === "string" && body.token.length <= 8192
    && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(body.token);
}

async function login(context: SetupContext, password: string): Promise<AdminSession | null> {
  const response = await context.http.request({
    method: "POST", path: "/auth/login", headers: HEADERS,
    body: JSON.stringify({ username: USERNAME, password }),
    approval: { action: "navidrome-prove-login", progress: "Verify the saved Navidrome admin by fresh password login" },
  });
  if (response.status === 401) return null;
  if (response.status !== 200) throw new Error("Navidrome did not verify the saved administrator credential");
  const identity = await response.json();
  if (!validAdmin(identity)) {
    throw new Error("Navidrome did not verify the saved administrator credential");
  }
  return { id: identity.id, token: identity.token };
}

async function verifyAdminApi(context: SetupContext, session: AdminSession): Promise<void> {
  // Native JWTs are transient, not durable API keys. Keep the extracted token
  // in memory and prove that the protected API recognizes the same administrator.
  const response = await context.http.request({ method: "GET", path: `/api/user/${session.id}`,
    headers: { "X-ND-Authorization": `Bearer ${session.token}`, accept: "application/json" } });
  if (response.status !== 200 || !response.ok) {
    throw new Error("Navidrome did not verify its saved administrator through the protected API");
  }
  const value = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Navidrome returned an invalid protected administrator identity");
  }
  const identity = value as Record<string, unknown>;
  if (identity.id !== session.id || identity.userName !== USERNAME || identity.isAdmin !== true) {
    throw new Error("Navidrome protected API identity differs from the saved administrator");
  }
}

function verified(context: SetupContext): SetupRecord {
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-login-verified",
    username: USERNAME, credentialRef: "app handoff", authenticatedAdminApiVerified: true };
}

const setup: SetupAdapter = {
  appId: APP_ID,
  compatibilityResult(record) {
    return proof.result(record);
  },
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: "/auth/login",
  homarrIntegration: null,
  ready(record) {
    return record.appId === APP_ID && record.stage === "admin-login-verified"
      && record.username === USERNAME && record.credentialRef === "app handoff"
      && record.authenticatedAdminApiVerified === true;
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("Navidrome setup received a different app ID");
    appliedStatus(context, await context.status());
    const password = await context.secrets.readAdminPassword();
    if (password.length < 32 || password.length > 128 || !/^[A-Za-z0-9]+$/.test(password)) {
      throw new Error("Navidrome has no valid saved administrator password");
    }
    const checkpoint = await context.checkpoint.read();
    if (checkpoint !== null && (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || !["admin-create-attempted", "admin-login-verified"].includes(checkpoint.stage)
      || !checkpoint.attemptedActions.includes(CREATE))) {
      throw new Error("Navidrome has an unrecognized first-admin checkpoint");
    }
    // Snapshot provenance before this invocation can promote an attempted owner.
    let origin: SetupCompatibilityResult["origin"] | null = null;
    if (checkpoint?.stage === "admin-login-verified"
      && typeof checkpoint.data.userId === "string"
      && /^[A-Za-z0-9_-]{1,128}$/.test(checkpoint.data.userId)) {
      origin = "resume";
    }
    let session = await login(context, password);
    const existingLogin = session !== null;
    if (existingLogin && checkpoint === null) {
      throw new Error("Navidrome has an unowned administrator matching the saved password; first-admin provenance is missing");
    }
    if (!existingLogin) {
      if (checkpoint !== null) {
        throw new Error("Navidrome admin creation was already attempted, but the saved credential does not log in");
      }
      const response = await context.http.request({
        method: "POST", path: "/auth/createAdmin", headers: HEADERS,
        body: JSON.stringify({ username: USERNAME, password }),
        approval: { action: CREATE, progress: "Create the first Navidrome administrator once", once: true },
        beforeSendCheckpoint: { expectedRevision: null, stage: "admin-create-attempted" },
      });
      if (response.status !== 200) {
        throw new Error("Navidrome did not confirm first-admin creation; retry only by saved-credential login");
      }
      const created = await response.json();
      if (!validAdmin(created)) {
        throw new Error("Navidrome did not confirm first-admin creation; retry only by saved-credential login");
      }
      const attempted = await context.checkpoint.read();
      if (!attempted || attempted.appId !== APP_ID || attempted.projectRoot !== context.projectRoot
        || attempted.stage !== "admin-create-attempted" || !attempted.attemptedActions.includes(CREATE)
        || (attempted.data.userId !== undefined && attempted.data.userId !== created.id)) {
        throw new Error("Navidrome first-admin checkpoint changed during administrator creation");
      }
      await context.checkpoint.compareAndSet({ expectedRevision: attempted.revision,
        stage: "admin-create-attempted", data: { userId: created.id } });
      session = await login(context, password);
      if (!session || session.id !== created.id) {
        throw new Error("Navidrome did not verify its newly created administrator by fresh login");
      }
      // The pinned createAdmin contract refuses any existing user, so this
      // acknowledged, matching new identity proves first-owner creation.
      origin = "fresh";
    }
    if (!session) throw new Error("Navidrome has no authenticated administrator session");
    const userId = session.id;
    if (checkpoint?.data.userId !== undefined && checkpoint.data.userId !== userId) {
      throw new Error("Navidrome administrator identity differs from the saved first-admin owner");
    }
    await verifyAdminApi(context, session);
    const latest = await context.checkpoint.read();
    if (!latest || latest.appId !== APP_ID || latest.projectRoot !== context.projectRoot
      || !["admin-create-attempted", "admin-login-verified"].includes(latest.stage)
      || !latest.attemptedActions.includes(CREATE)
      || (latest.data.userId !== undefined && latest.data.userId !== userId)) {
      throw new Error("Navidrome first-admin checkpoint changed during administrator verification");
    }
    if (latest.stage !== "admin-login-verified" || latest.data.userId !== userId) {
      await context.checkpoint.compareAndSet({ expectedRevision: latest.revision,
        stage: "admin-login-verified", data: { userId } });
    }
    return proof.record(verified(context), origin, "verified");
  },
};

export default setup;
