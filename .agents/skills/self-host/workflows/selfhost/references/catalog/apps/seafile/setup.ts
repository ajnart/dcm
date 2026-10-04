import { isAbsolute } from "node:path";

import { appliedStatus, type SetupAdapter, type SetupContext, type SetupInspectionContext, type SetupRecord } from "../../types/setup";

const APP_ID = "seafile";
const ADMIN_EMAIL = "admin@example.test";
const TOKEN_ACTION = "seafile-acquire-admin-token";
type ReadContext = Pick<SetupInspectionContext, "appId" | "projectRoot" | "status" | "http" | "secrets">;

function validToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

async function sharedStatus(context: ReadContext): Promise<SetupRecord> {
  const status = appliedStatus(context, await context.status());
  if (context.appId !== APP_ID || status.ownerKind !== "shared" || status.username !== ADMIN_EMAIL
    || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)) {
    throw new Error("Seafile has no exact shared email administrator credential");
  }
  return status;
}

async function verifySavedToken(context: ReadContext, token: string): Promise<void> {
  if (!validToken(token)) throw new Error("Seafile saved account token is invalid");
  const identity = await context.http.request({ method: "GET", path: "/api2/account/info/",
    headers: { Authorization: `Bearer ${token}` } });
  if (!identity.ok || identity.status !== 200) throw new Error("Seafile saved account token did not authenticate");
  const account = object(await identity.json(), "Seafile account identity");
  if (account.email !== ADMIN_EMAIL || account.is_staff !== true) {
    throw new Error("Seafile saved token does not identify the exact administrator");
  }
  const admin = await context.http.request({ method: "GET", path: "/api/v2.1/admin/users/",
    query: { page: "1", per_page: "1" }, headers: { Authorization: `Bearer ${token}` } });
  if (!admin.ok || admin.status !== 200) throw new Error("Seafile did not verify administrator API access");
}

async function inspectShared(context: SetupInspectionContext): Promise<SetupRecord> {
  const status = await sharedStatus(context);
  const token = await context.secrets.readApiKey();
  const apiKeyFile = await context.secrets.apiKeyPath();
  if (token === null || apiKeyFile === null || !isAbsolute(apiKeyFile)) {
    throw new Error("Seafile has no saved durable administrator account token");
  }
  await verifySavedToken(context, token);
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-and-token-verified",
    email: ADMIN_EMAIL, credentialRef: status.passwordFile, apiKeyFile };
}

async function sharedFirstRun(context: SetupContext): Promise<SetupRecord> {
  const status = await sharedStatus(context);
  if (await context.secrets.readApiKey() !== null) return inspectShared(context);
  const checkpoint = await context.checkpoint.read();
  if (checkpoint !== null) {
    throw new Error("Seafile token acquisition was attempted without a saved token; inspect privately without replaying");
  }
  const password = await context.secrets.readAdminPassword();
  if (password.length < 32 || password.length > 256 || /[\r\n\u0000]/.test(password)) {
    throw new Error("Seafile has no valid saved administrator password");
  }
  const response = await context.http.request({ method: "POST", path: "/api2/auth-token/",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: ADMIN_EMAIL, password }).toString(),
    approval: { action: TOKEN_ACTION, once: true, progress: "Acquire and privately save the Seafile administrator account token" },
    beforeSendCheckpoint: { expectedRevision: null, stage: "admin-token-request-attempted",
      data: { passwordFile: status.passwordFile as string } } });
  if (!response.ok || response.status !== 200) throw new Error("Seafile account-token acquisition is uncertain; inspect before retrying");
  const token = object(await response.json(), "Seafile account-token response").token;
  if (!validToken(token)) throw new Error("Seafile returned no valid account token; inspect before retrying");
  // Preserve the acquired credential before any fallible identity readback.
  await context.secrets.writeApiKey(token);
  return inspectShared(context);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

async function verifyAdmin(context: SetupContext): Promise<SetupRecord> {
  if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
    throw new Error("Seafile setup received a different app project");
  }
  const password = await context.secrets.readAdminPassword();
  if (password.length < 32 || password.length > 256 || /[\r\n\u0000]/.test(password)) {
    throw new Error("Seafile has no valid saved administrator password");
  }

  // Seafile's documented account-token route accepts form fields.
  const login = await context.http.request({
    method: "POST",
    path: "/api2/auth-token/",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: ADMIN_EMAIL, password }).toString(),
    approval: { action: "seafile-admin-login", progress: "Verify the saved Seafile administrator on the exact private origin" },
  });
  if (!login.ok || login.status !== 200) {
    throw new Error("Seafile rejected its saved administrator credential");
  }
  const token = object(await login.json(), "Seafile account-token response").token;
  if (typeof token !== "string" || token.length < 16 || token.length > 8192 || !/^[A-Za-z0-9_.-]+$/.test(token)) {
    throw new Error("Seafile did not return a valid account token");
  }

  // A successful token by itself proves only login, so use an admin-only read.
  const admin = await context.http.request({
    method: "GET",
    path: "/api/v2.1/admin/users/",
    query: { page: "1", per_page: "1" },
    // The pinned 13.x service uses Bearer; Token is documented for <11 only.
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!admin.ok || admin.status !== 200) {
    throw new Error("Seafile did not verify administrator API access");
  }
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-login-verified", email: ADMIN_EMAIL };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  sharedOwner: true,
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: null,
  ready(record) {
    if (record.stage === "admin-and-token-verified") {
      return record.appId === APP_ID && record.email === ADMIN_EMAIL
        && typeof record.credentialRef === "string" && isAbsolute(record.credentialRef)
        && typeof record.apiKeyFile === "string" && isAbsolute(record.apiKeyFile);
    }
    return record.appId === APP_ID && record.stage === "admin-login-verified"
      && record.email === ADMIN_EMAIL;
  },
  async firstRun(context) {
    const status = appliedStatus(context, await context.status());
    if (status.ownerKind === "shared") return sharedFirstRun(context);
    return verifyAdmin(context);
  },
  inspect: inspectShared,
};

export default adapter;
