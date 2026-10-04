import { isAbsolute } from "node:path";
import { createHash } from "node:crypto";

import {
  appliedStatus,
  type SetupAdapter,
  type SetupContext,
  type SetupInspectionContext,
  type SetupRecord,
} from "../../types/setup";

const APP_ID = "home-assistant";
const JSON_HEADERS = { "Content-Type": "application/json" };
const VERIFIED = "owner-and-token-verified";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Home Assistant returned an invalid response");
  }
  return value as Record<string, unknown>;
}

async function userStepDone(context: SetupContext, owned: boolean): Promise<boolean> {
  const response = await context.http.request({ method: "GET", path: "/api/onboarding" });
  // The pinned component does not register this view after all onboarding
  // steps are saved and the service restarts. A missing view is not ownership
  // evidence: only an existing creation checkpoint permits password readback.
  if (response.status === 404 && owned) return true;
  if (response.status !== 200) throw new Error("Home Assistant onboarding status is unavailable");
  const steps = await response.json();
  if (!Array.isArray(steps)) throw new Error("Home Assistant onboarding status is invalid");
  const user = steps.find((step) => {
    const entry = object(step);
    return entry.step === "user";
  });
  if (!user || typeof object(user).done !== "boolean") {
    throw new Error("Home Assistant user onboarding status is missing");
  }
  return object(user).done === true;
}

async function verifyAdmin(context: SetupContext, clientId: string): Promise<{
  accessToken: string; passwordLoginVerified: boolean;
}> {
  const password = await context.secrets.readAdminPassword();
  if (!password || /[\r\n\u0000]/.test(password)) throw new Error("Home Assistant administrator credential is invalid");
  const passwordDigest = createHash("sha256").update(password).digest("hex");
  let saved = await context.secrets.readSessionCookies();
  if (Object.keys(saved).some((key) => !["password_digest", "login_flow_id", "auth_code", "access_token"].includes(key))
    || (Object.keys(saved).length > 0 && saved.password_digest !== passwordDigest)
    || (saved.login_flow_id !== undefined && !/^[a-f0-9]{32}$/.test(saved.login_flow_id))
    || (saved.auth_code !== undefined && !/^[a-f0-9]{32}$/.test(saved.auth_code))
    || (saved.access_token !== undefined && !/^[A-Za-z0-9_.-]{32,8192}$/.test(saved.access_token))) {
    throw new Error("Home Assistant saved private login session differs from the owner credential");
  }
  if (saved.access_token) {
    const check = await context.http.request({ method: "GET", path: "/api/",
      headers: { Authorization: `Bearer ${saved.access_token}` } });
    if (check.status === 200) return { accessToken: saved.access_token, passwordLoginVerified: false };
    if (check.status !== 401) throw new Error("Home Assistant saved session could not be verified; do not discard it on uncertainty");
    await context.secrets.writeSessionCookies({});
    saved = {};
  }
  if (!saved.auth_code) {
    if (!saved.login_flow_id) {
      const opened = await context.http.request({
        method: "POST", path: "/auth/login_flow", headers: JSON_HEADERS,
        body: JSON.stringify({ client_id: clientId, redirect_uri: clientId, handler: ["homeassistant", null] }),
        approval: { action: "home-assistant-verify-admin", progress: "Verify private Home Assistant administrator" },
      });
      if (opened.status !== 200) throw new Error("Home Assistant login flow could not be opened");
      const flow = object(await opened.json());
      if (flow.type !== "form" || typeof flow.flow_id !== "string" || !/^[a-f0-9]{32}$/.test(flow.flow_id)) {
        throw new Error("Home Assistant returned an unexpected login flow");
      }
      saved = { password_digest: passwordDigest, login_flow_id: flow.flow_id };
      await context.secrets.writeSessionCookies(saved);
    }
    const verified = await context.http.request({
      method: "POST", path: `/auth/login_flow/${saved.login_flow_id}`, headers: JSON_HEADERS,
      body: JSON.stringify({ client_id: clientId, username: "admin", password }),
      approval: { action: "home-assistant-verify-admin", progress: "Verify private Home Assistant administrator" },
    });
    if (verified.status === 404) {
      await context.secrets.writeSessionCookies({});
      throw new Error("Home Assistant saved login flow is unavailable; open a new approved flow on the next run");
    }
    if (verified.status !== 200) throw new Error("Home Assistant administrator login failed");
    const result = object(await verified.json());
    if (result.type !== "create_entry" || typeof result.result !== "string" || !/^[a-f0-9]{32}$/.test(result.result)) {
      throw new Error("Home Assistant administrator credential was not accepted");
    }
    saved = { password_digest: passwordDigest, auth_code: result.result };
    await context.secrets.writeSessionCookies(saved);
  }
  const exchanged = await context.http.request({ method: "POST", path: "/auth/token",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId,
      code: saved.auth_code }).toString(),
    approval: { action: "home-assistant-exchange-owner-login",
      progress: "Exchange the verified Home Assistant owner login for a private expiring session" } });
  if (exchanged.status === 400) {
    const failure = object(await exchanged.json());
    if (failure.error === "invalid_request" && failure.error_description === "Invalid code") {
      await context.secrets.writeSessionCookies({});
      throw new Error("Home Assistant authorization code expired or was consumed; use a new approved login on the next run");
    }
  }
  if (exchanged.status !== 200) throw new Error("Home Assistant owner session exchange failed");
  const session = object(await exchanged.json());
  if (typeof session.access_token !== "string" || !/^[A-Za-z0-9_.-]{32,8192}$/.test(session.access_token)
    || session.token_type !== "Bearer" || typeof session.expires_in !== "number" || session.expires_in <= 0) {
    throw new Error("Home Assistant did not return a bounded expiring owner session");
  }
  await context.secrets.writeSessionCookies({ password_digest: passwordDigest, access_token: session.access_token });
  return { accessToken: session.access_token, passwordLoginVerified: true };
}

async function owner(context: SetupContext | SetupInspectionContext, accessToken: string): Promise<string> {
  const current = object(await context.webSocket.request({ path: "/api/websocket", accessToken,
    type: "auth/current_user" }));
  if (typeof current.id !== "string" || !/^[a-f0-9]{32}$/.test(current.id)
    || current.is_owner !== true || current.is_admin !== true
    || !Array.isArray(current.credentials) || !current.credentials.some((credential) =>
      credential && typeof credential === "object" && !Array.isArray(credential)
      && credential.auth_provider_type === "homeassistant" && credential.auth_provider_id === null)) {
    throw new Error("Home Assistant token does not identify the expected local administrator owner");
  }
  return current.id;
}

async function verifyKey(context: SetupContext | SetupInspectionContext, ownerId: string): Promise<string> {
  const token = await context.secrets.readApiKey();
  const path = await context.secrets.apiKeyPath();
  if (!token || !/^[A-Za-z0-9_.-]{32,8192}$/.test(token)
    || typeof path !== "string" || !isAbsolute(path)) {
    throw new Error("Home Assistant long-lived token result was not saved; do not repeat token creation");
  }
  if (await owner(context, token) !== ownerId) {
    throw new Error("Home Assistant saved integration token belongs to a different owner");
  }
  return path;
}

async function record(context: SetupContext | SetupInspectionContext, ownerId: string,
  credentialRef: string, apiKeyFile: string, passwordLoginVerified: boolean): Promise<SetupRecord> {
  const response = await context.http.request({ method: "GET", path: "/api/onboarding" });
  const pendingOnboardingSteps: string[] = [];
  // This readback follows verified saved owner/token proof. The pinned view is
  // removed on restart only after every onboarding step has been saved.
  if (response.status !== 404) {
    if (response.status !== 200) throw new Error("Home Assistant onboarding completion could not be read back");
    const steps = await response.json();
    const required = ["user", "core_config", "analytics", "integration"];
    if (!Array.isArray(steps) || steps.length !== required.length) {
      throw new Error("Home Assistant onboarding completion has an unexpected step contract");
    }
    for (const step of required) {
      const matches = steps.filter((value) => object(value).step === step);
      if (matches.length !== 1 || typeof object(matches[0]).done !== "boolean") {
        throw new Error("Home Assistant onboarding completion has an unexpected step contract");
      }
      if (object(matches[0]).done !== true) pendingOnboardingSteps.push(step);
    }
    if (pendingOnboardingSteps.includes("user")) throw new Error("Home Assistant saved owner onboarding is no longer complete");
  }
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: VERIFIED,
    adminUsername: "admin", ownerId, credentialRef, apiKeyFile, ownerRoleVerified: true,
    apiKeyVerified: true, passwordLoginVerified,
    passwordLoginPreviouslyVerified: true, onboardingComplete: pendingOnboardingSteps.length === 0,
    pendingOnboardingSteps, restartPersistenceVerified: false };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: "Home Assistant",
  ready(value) {
    return value.appId === APP_ID && value.stage === VERIFIED
      && value.adminUsername === "admin" && value.ownerRoleVerified === true
      && value.apiKeyVerified === true && typeof value.ownerId === "string"
      && /^[a-f0-9]{32}$/.test(value.ownerId) && typeof value.credentialRef === "string"
      && isAbsolute(value.credentialRef) && typeof value.apiKeyFile === "string" && isAbsolute(value.apiKeyFile);
  },
  async firstRun(context: SetupContext): Promise<SetupRecord> {
    if (context.appId !== APP_ID) throw new Error("Home Assistant setup received a different app ID");
    const status = appliedStatus(context, await context.status());
    if (!Number.isInteger(status.port) || status.port < 1024 || status.port > 65535
      || status.url !== `http://127.0.0.1:${status.port}` || status.username !== "admin"
      || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)) {
      throw new Error("Home Assistant has no exact private browser origin");
    }
    const clientId = `${status.url}/`;
    const checkpoint = await context.checkpoint.read();
    if (checkpoint && (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || !["owner-attempted", "admin-verified", "token-attempted", VERIFIED].includes(checkpoint.stage)
      || !checkpoint.attemptedActions.includes("home-assistant-first-admin"))) {
      throw new Error("Home Assistant has an unrecognized first-owner checkpoint");
    }
    const done = await userStepDone(context, checkpoint !== null);
    if (!done) {
      if (checkpoint !== null) {
        throw new Error("Home Assistant first-owner request may have been sent; inspect the exact instance before retrying");
      }
      const password = await context.secrets.readAdminPassword();
      if (!password || /[\r\n\u0000]/.test(password)) throw new Error("Home Assistant administrator credential is invalid");
      const response = await context.http.request({
        method: "POST", path: "/api/onboarding/users", headers: JSON_HEADERS,
        body: JSON.stringify({ name: "Administrator", username: "admin", password, client_id: clientId, language: "en" }),
        approval: { action: "home-assistant-first-admin", progress: "Create private Home Assistant owner", once: true },
        beforeSendCheckpoint: { expectedRevision: null, stage: "owner-attempted" },
      });
      if (response.status !== 200) throw new Error("Home Assistant first-owner creation failed; inspect before retrying");
    } else if (checkpoint === null) {
      throw new Error("Home Assistant already has an owner outside this setup; refusing to adopt it");
    }
    const { accessToken, passwordLoginVerified } = await verifyAdmin(context, clientId);
    const ownerId = await owner(context, accessToken);
    if (!await userStepDone(context, true)) throw new Error("Home Assistant user onboarding did not persist");
    let latest = await context.checkpoint.read();
    if (!latest || (latest.data.ownerId !== undefined && latest.data.ownerId !== ownerId)
      || (latest.data.credentialRef !== undefined && latest.data.credentialRef !== status.passwordFile)) {
      throw new Error("Home Assistant owner differs from the saved first-owner checkpoint");
    }
    if (latest.stage === "owner-attempted" || latest.stage === "admin-verified") {
      if (await context.secrets.readApiKey() !== null) {
        throw new Error("Home Assistant has an integration token without its creation checkpoint");
      }
      const created = await context.webSocket.request({ path: "/api/websocket", accessToken,
        type: "auth/long_lived_access_token", payload: { client_name: "selfhost-homarr", lifespan: 3650 },
        approval: { action: "home-assistant-create-integration-token", once: true,
          progress: "Create and privately save one ten-year Home Assistant owner token for Homarr" },
        beforeSendCheckpoint: { expectedRevision: latest.revision, stage: "token-attempted",
          data: { ownerId, credentialRef: status.passwordFile } } });
      if (typeof created !== "string" || !/^[A-Za-z0-9_.-]{32,8192}$/.test(created)) {
        throw new Error("Home Assistant token creation result is invalid; do not retry it");
      }
      await context.secrets.writeApiKey(created);
      latest = await context.checkpoint.read();
    }
    if (!latest || !["token-attempted", VERIFIED].includes(latest.stage)
      || latest.data.ownerId !== ownerId || latest.data.credentialRef !== status.passwordFile) {
      throw new Error("Home Assistant has no matching integration-token creation checkpoint");
    }
    const apiKeyFile = await verifyKey(context, ownerId);
    if (latest.stage === VERIFIED && latest.data.apiKeyFile !== apiKeyFile) {
      throw new Error("Home Assistant integration credential file differs from its verified checkpoint");
    }
    if (latest.stage !== VERIFIED) {
      await context.checkpoint.compareAndSet({ expectedRevision: latest.revision, stage: VERIFIED,
        data: { ownerId, credentialRef: status.passwordFile, apiKeyFile } });
    }
    return record(context, ownerId, status.passwordFile, apiKeyFile, passwordLoginVerified);
  },
  async inspect(context) {
    const status = appliedStatus(context, await context.status());
    const checkpoint = await context.checkpoint.read();
    if (checkpoint?.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || checkpoint.stage !== VERIFIED || typeof checkpoint.data.ownerId !== "string"
      || checkpoint.data.credentialRef !== status.passwordFile
      || !checkpoint.attemptedActions.includes("home-assistant-create-integration-token")) {
      throw new Error("Home Assistant has no verified integration-token owner checkpoint");
    }
    const apiKeyFile = await verifyKey(context, checkpoint.data.ownerId);
    if (checkpoint.data.apiKeyFile !== apiKeyFile || typeof status.passwordFile !== "string") {
      throw new Error("Home Assistant token inspection differs from its saved owner");
    }
    // This proves current token/role identity, not a new password login. The
    // read-only interface cannot repeat the HTTP login-flow POSTs.
    return record(context, checkpoint.data.ownerId, status.passwordFile, apiKeyFile, false);
  },
};

export default adapter;
