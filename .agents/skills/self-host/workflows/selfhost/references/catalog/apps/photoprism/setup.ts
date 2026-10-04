import { isAbsolute } from "node:path";
import { createHash } from "node:crypto";

import { appliedStatus, setupRecord, type SetupAdapter, type SetupCompatibilityResult, type SetupContext, type SetupRecord } from "../../types/setup";

const APP_ID = "photoprism";
const KEY_ACTION = "photoprism-create-api-app-password";
const KEY_ATTEMPTED = "api-app-password-create-attempted";
const KEY_SAVED = "api-app-password-saved";
const KEY_VERIFIED = "admin-and-api-app-password-verified";
const KEY_NAME = "Self-host API";
const KEY_SCOPE = "read";
const KEY_LIFETIME = 31536000;
const liveCompatibility = new WeakMap<SetupRecord, SetupCompatibilityResult>();
type AdminSession = { token: string; userId: number; userUid: string };

function tokenId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function appPassword(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{6}(?:-[A-Za-z0-9]{6}){3}$/.test(value);
}

function session(value: unknown): AdminSession {
  const result = setupRecord(value, "PhotoPrism session");
  const user = setupRecord(result.user, "PhotoPrism session user");
  if (result.status !== "success" || typeof result.access_token !== "string"
    || !/^[0-9a-f]{48}$/.test(result.access_token)
    || result.session_id !== createHash("sha256").update(result.access_token).digest("hex")
    || user.Name !== "admin" || user.Role !== "admin" || user.CanLogin !== true
    || !Number.isSafeInteger(user.ID) || Number(user.ID) < 1
    || typeof user.UID !== "string" || user.UID.length < 1 || user.UID.length > 128) {
    throw new Error("PhotoPrism did not prove an authenticated active administrator session");
  }
  return { token: result.access_token, userId: Number(user.ID), userUid: user.UID };
}

async function verifyAdmin(context: SetupContext, password: string): Promise<AdminSession> {
  if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
    throw new Error("PhotoPrism setup received a different app project");
  }
  if (password.length < 32 || password.length > 72 || !/^[A-Za-z0-9]+$/.test(password)) {
    throw new Error("PhotoPrism has no valid generated administrator password");
  }
  // Public mode returns HTTP 200 session data without checking the password.
  const anonymous = await context.http.request({ method: "GET", path: "/api/v1/session" });
  if (anonymous.status !== 401) throw new Error("PhotoPrism did not deny anonymous session access");
  const passwordDigest = tokenId(password);
  const saved = await context.secrets.readSessionCookies();
  let approvedAdmin: AdminSession | null = null;
  if (Object.keys(saved).length > 0) {
    if (Object.keys(saved).some((name) => !["password_digest", "access_token", "user_id", "user_uid"].includes(name))
      || saved.password_digest !== passwordDigest || !/^[0-9a-f]{48}$/.test(saved.access_token ?? "")
      || !/^[1-9][0-9]*$/.test(saved.user_id ?? "") || !Number.isSafeInteger(Number(saved.user_id))
      || !saved.user_uid || saved.user_uid.length > 128) {
      throw new Error("PhotoPrism private administrator session differs from its saved credential");
    }
    const cached = await context.http.request({ method: "GET", path: "/api/v1/session",
      headers: { Authorization: `Bearer ${saved.access_token}` } });
    // Pinned GetSession reports expired/missing sessions as 401. Preserve the
    // approved bearer on every other failure; a new login changes write intent.
    if (cached.status === 401) {
      await context.secrets.writeSessionCookies({});
    } else {
      if (cached.status !== 200 || !cached.ok) throw new Error("PhotoPrism saved session did not authenticate");
      const verified = session(await cached.json());
      if (verified.token !== saved.access_token || verified.userId !== Number(saved.user_id)
        || verified.userUid !== saved.user_uid) {
        throw new Error("PhotoPrism session readback differs from the saved administrator identity");
      }
      approvedAdmin = verified;
    }
  }
  // Official first-start config creates admin; session creation verifies that
  // exact saved credential even if the first Compose response was lost.
  const response = await context.http.request({
    method: "POST",
    path: "/api/v1/session",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
    approval: { action: "photoprism-admin-login", progress: "Verify PhotoPrism's generated administrator on the exact private origin" },
  });
  if (response.status !== 200 || !response.ok) {
    throw new Error("PhotoPrism did not authorize its generated administrator credential");
  }
  const login = session(await response.json());
  // Keep the transient session token private; it is not a durable API key.
  const readback = await context.http.request({ method: "GET", path: "/api/v1/session",
    headers: { Authorization: `Bearer ${login.token}` } });
  if (readback.status !== 200 || !readback.ok) {
    throw new Error("PhotoPrism saved session did not authenticate");
  }
  const verified = session(await readback.json());
  if (verified.token !== login.token || verified.userId !== login.userId || verified.userUid !== login.userUid) {
    throw new Error("PhotoPrism session readback differs from the saved administrator identity");
  }
  if (approvedAdmin) {
    // A live bearer does not prove the saved password still works. Independently
    // verify it above, but retain the original bearer for the approved key write.
    if (login.userId !== approvedAdmin.userId || login.userUid !== approvedAdmin.userUid) {
      throw new Error("PhotoPrism password login differs from the saved administrator identity");
    }
    return approvedAdmin;
  }
  await context.secrets.writeSessionCookies({ password_digest: passwordDigest, access_token: login.token,
    user_id: String(login.userId), user_uid: login.userUid });
  return login;
}

async function appSessions(context: SetupContext, admin: AdminSession): Promise<SetupRecord[]> {
  const response = await context.http.request({ method: "GET",
    path: `/api/v1/users/${encodeURIComponent(admin.userUid)}/sessions`,
    query: { count: "100", q: KEY_NAME }, headers: { Authorization: `Bearer ${admin.token}` } });
  if (response.status !== 200 || !response.ok) throw new Error("PhotoPrism app password metadata is unavailable");
  const value = await response.json();
  if (!Array.isArray(value) || value.length >= 100) throw new Error("PhotoPrism app password listing is not bounded and complete");
  return value.map((entry) => setupRecord(entry, "PhotoPrism app password metadata"))
    .filter((entry) => entry.ClientName === KEY_NAME);
}

async function apiCredential(context: SetupContext, admin: AdminSession, password: string): Promise<SetupRecord> {
  let checkpoint = await context.checkpoint.read();
  let key = await context.secrets.readApiKey();
  if (checkpoint && (checkpoint.data.userId !== admin.userId || checkpoint.data.userUid !== admin.userUid)) {
    throw new Error("PhotoPrism app password checkpoint belongs to a different administrator");
  }
  if (!checkpoint && key !== null) throw new Error("PhotoPrism API credential has no creation checkpoint; inspect manually");
  if (checkpoint && key === null) throw new Error("PhotoPrism app password creation was attempted without a saved secret; do not repeat it");
  if (!checkpoint) {
    if ((await appSessions(context, admin)).length !== 0) {
      throw new Error("PhotoPrism already has a matching app password outside this setup; inspect manually");
    }
    // Pinned CE OAuthToken's password grant creates a user-bound application
    // credential, not an extended login session. NewClientSession persists it
    // with no idle timeout and the explicit one-year lifetime and read scope.
    const response = await context.http.request({ method: "POST", path: "/api/v1/oauth/token",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ grant_type: "password", username: "admin", password,
        client_name: KEY_NAME, scope: KEY_SCOPE, expires_in: KEY_LIFETIME }),
      approval: { action: KEY_ACTION, once: true,
        progress: "Create one PhotoPrism read-only API app password with a one-year lifetime" },
      beforeSendCheckpoint: { expectedRevision: null, stage: KEY_ATTEMPTED,
        data: { userId: admin.userId, userUid: admin.userUid } },
    });
    if (response.status !== 200 || !response.ok) throw new Error("PhotoPrism app password creation outcome is uncertain; do not repeat it");
    const created = setupRecord(await response.json(), "PhotoPrism app password creation");
    if (!appPassword(created.access_token)) throw new Error("PhotoPrism returned no usable app password; do not repeat creation");
    key = created.access_token;
    // The one-time secret must survive every later metadata/readback failure.
    await context.secrets.writeApiKey(key);
    if (created.status !== "success" || created.token_type !== "Bearer" || created.scope !== KEY_SCOPE
      || created.client_name !== KEY_NAME || created.session_id !== tokenId(key)
      || !Number.isSafeInteger(created.expires_in) || Number(created.expires_in) < KEY_LIFETIME - 60
      || Number(created.expires_in) > KEY_LIFETIME) {
      throw new Error("PhotoPrism created app password metadata differs; inspect manually");
    }
    checkpoint = await context.checkpoint.read();
    if (!checkpoint || checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || checkpoint.stage !== KEY_ATTEMPTED || !checkpoint.attemptedActions.includes(KEY_ACTION)
      || checkpoint.data.userId !== admin.userId || checkpoint.data.userUid !== admin.userUid) {
      throw new Error("PhotoPrism app password creation checkpoint changed");
    }
    checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
      stage: KEY_SAVED, data: { ...checkpoint.data, sessionId: tokenId(key) } });
  }
  if (!appPassword(key) || !checkpoint) throw new Error("PhotoPrism saved API app password is invalid");
  const id = tokenId(key);
  if (checkpoint.data.sessionId !== undefined && checkpoint.data.sessionId !== id) {
    throw new Error("PhotoPrism saved app password differs from its creation identity");
  }
  const response = await context.http.request({ method: "GET", path: `/api/v1/session/${id}`,
    headers: { Authorization: `Bearer ${key}` } });
  if (response.status !== 200 || !response.ok) throw new Error("PhotoPrism saved API app password did not authenticate");
  const verified = setupRecord(await response.json(), "PhotoPrism API app password readback");
  const user = setupRecord(verified.user, "PhotoPrism API app password user");
  if (verified.status !== "success" || verified.access_token !== key || verified.session_id !== id
    || verified.token_type !== "Bearer" || verified.provider !== "application" || verified.scope !== KEY_SCOPE
    || !Number.isSafeInteger(verified.expires_in) || Number(verified.expires_in) <= 0
    || Number(verified.expires_in) > KEY_LIFETIME || user.ID !== admin.userId || user.UID !== admin.userUid
    || user.Name !== "admin" || user.Role !== "admin" || user.CanLogin !== true) {
    throw new Error("PhotoPrism API app password identity, provider, scope, or expiry differs");
  }
  const entries = await appSessions(context, admin);
  if (entries.length !== 1) throw new Error("PhotoPrism saved app password has no unique matching creation record");
  const entry = entries[0];
  const createdAt = Date.parse(String(entry.CreatedAt));
  const lifetime = Number(entry.Expires) - Math.floor(createdAt / 1000);
  if (typeof entry.ID !== "string" || !/^sess[0-9a-z]{8}$/.test(entry.ID)
    || entry.UserUID !== admin.userUid || entry.UserName !== "admin" || entry.ClientUID !== ""
    || entry.AuthProvider !== "application" || entry.AuthMethod !== "default" || entry.GrantType !== "password"
    || entry.AuthScope !== KEY_SCOPE || entry.Timeout !== 0 || !Number.isSafeInteger(entry.Expires)
    || !Number.isFinite(createdAt) || Math.abs(lifetime - KEY_LIFETIME) > 1
    || (checkpoint.data.creationId !== undefined && checkpoint.data.creationId !== entry.ID)
    || (checkpoint.data.expiresAt !== undefined && checkpoint.data.expiresAt !== entry.Expires)) {
    throw new Error("PhotoPrism app password creation record or lifetime differs");
  }
  const apiKeyFile = await context.secrets.apiKeyPath();
  if (!apiKeyFile || !isAbsolute(apiKeyFile)) throw new Error("PhotoPrism API credential has no canonical private file");
  if (checkpoint.stage !== KEY_VERIFIED) {
    await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision, stage: KEY_VERIFIED,
      data: { ...checkpoint.data, sessionId: id, creationId: entry.ID, expiresAt: Number(entry.Expires) } });
  }
  return { apiKeyFile, apiCredentialKind: "app-password", apiScope: KEY_SCOPE,
    apiExpiresAt: Number(entry.Expires), apiCreationId: entry.ID };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  compatibilityResult(record) {
    const result = liveCompatibility.get(record) ?? null;
    liveCompatibility.delete(record);
    return result;
  },
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: null,
  ready(record) {
    return record.appId === APP_ID && record.stage === KEY_VERIFIED && record.adminUsername === "admin"
      && typeof record.apiKeyFile === "string" && isAbsolute(record.apiKeyFile)
      && record.apiCredentialKind === "app-password" && record.apiScope === KEY_SCOPE;
  },
  async firstRun(context) {
    if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) throw new Error("PhotoPrism setup received a different app project");
    const status = appliedStatus(context, await context.status());
    if (status.username !== "admin" || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)) {
      throw new Error("PhotoPrism has no exact saved administrator credential");
    }
    const checkpoint = await context.checkpoint.read();
    if (checkpoint && (checkpoint.schemaVersion !== 1 || checkpoint.appId !== APP_ID
      || checkpoint.projectRoot !== context.projectRoot || ![KEY_ATTEMPTED, KEY_SAVED, KEY_VERIFIED].includes(checkpoint.stage)
      || !Number.isSafeInteger(checkpoint.revision) || checkpoint.revision < 1
      || !Array.isArray(checkpoint.attemptedActions) || !checkpoint.attemptedActions.includes(KEY_ACTION)
      || !Number.isSafeInteger(checkpoint.data.userId) || Number(checkpoint.data.userId) < 1
      || typeof checkpoint.data.userUid !== "string" || checkpoint.data.userUid.length < 1
      || checkpoint.data.userUid.length > 128
      || (checkpoint.stage !== KEY_ATTEMPTED && (typeof checkpoint.data.sessionId !== "string"
        || !/^[0-9a-f]{64}$/.test(checkpoint.data.sessionId)))
      || (checkpoint.stage === KEY_VERIFIED && (typeof checkpoint.data.creationId !== "string"
        || !/^sess[0-9a-z]{8}$/.test(checkpoint.data.creationId)
        || !Number.isSafeInteger(checkpoint.data.expiresAt) || Number(checkpoint.data.expiresAt) < 1)))) {
      throw new Error("PhotoPrism has an unexpected API app password checkpoint");
    }
    // Snapshot entry state: completing a partial API-key checkpoint does not
    // prove this invocation resumed an already verified owner.
    const resumedVerifiedOwner = checkpoint?.stage === KEY_VERIFIED;
    const password = await context.secrets.readAdminPassword();
    const admin = await verifyAdmin(context, password);
    const credential = await apiCredential(context, admin, password);
    const record: SetupRecord = { appId: APP_ID, projectRoot: context.projectRoot, stage: KEY_VERIFIED, adminUsername: "admin",
      credentialRef: status.passwordFile, ...credential, acceptanceVerified: false };
    if (resumedVerifiedOwner) {
      // The completed exact-owner checkpoint and fresh password, administrator,
      // and app-password readbacks above are required together. Environment
      // bootstrap never observes owner creation, so it cannot issue fresh proof.
      const result: SetupCompatibilityResult = { origin: "resume", credentialReadback: "verified" };
      record.setupCompatibility = result;
      liveCompatibility.set(record, result);
    }
    return record;
  },
};

export default adapter;
