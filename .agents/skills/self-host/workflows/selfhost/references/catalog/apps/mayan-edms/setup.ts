import { isAbsolute } from "node:path";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext,
  type SetupInspectionContext, type SetupRecord } from "../../types/setup";

const APP_ID = "mayan-edms";
const CURRENT_USER = "/api/v4/users/current/";
const LOGIN = "/authentication/login/";
const CLEAR = "mayan-clear-initial-credential-display";
const TOKEN = "mayan-acquire-api-token";
type ReadContext = Pick<SetupInspectionContext, "appId" | "projectRoot" | "status" | "http" | "secrets">;

function exactStatus(context: ReadContext, value: unknown): SetupRecord {
  const status = appliedStatus(context, value);
  if (context.appId !== APP_ID || status.ownerKind !== "shared" || status.username !== "admin"
    || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)) {
    throw new Error("Mayan requires the exact shared seeded-owner project");
  }
  return status;
}

async function identity(context: ReadContext, authorization: string): Promise<number> {
  const response = await context.http.request({ method: "GET", path: CURRENT_USER,
    headers: { Authorization: authorization, Accept: "application/json" } });
  if (!response.ok || response.status !== 200) throw new Error("Mayan saved identity did not authenticate");
  const user = setupRecord(await response.json(), "Mayan current user");
  if (user.username !== "admin" || user.is_active !== true
    || !Number.isSafeInteger(user.id) || Number(user.id) < 1) {
    throw new Error("Mayan authentication did not identify the saved active owner");
  }
  return Number(user.id);
}

async function credentials(context: ReadContext) {
  const password = await context.secrets.readAdminPassword();
  if (!/^[A-Za-z0-9_-]{43,172}$/.test(password)) throw new Error("Mayan saved administrator password is invalid");
  const authorization = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
  const userId = await identity(context, authorization);
  await userViewPermission(context, authorization, userId);
  return { password, authorization, userId };
}

async function userViewPermission(context: ReadContext, authorization: string, userId: number): Promise<void> {
  const response = await context.http.request({ method: "GET", path: "/api/v4/users/",
    headers: { Authorization: authorization, Accept: "application/json" } });
  if (!response.ok || response.status !== 200) throw new Error("Mayan user-view permission was not verified");
  const list = setupRecord(await response.json(), "Mayan owner-visible users");
  if (!Number.isSafeInteger(list.count) || Number(list.count) < 1
    || !Array.isArray(list.results) || list.results.length > 100 || Number(list.count) < list.results.length) {
    throw new Error("Mayan owner-visible user list is invalid");
  }
  const matches = list.results.filter((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const user = entry as SetupRecord;
    return user.id === userId && user.username === "admin" && user.is_active === true;
  });
  if (matches.length !== 1) throw new Error("Mayan user listing did not contain the exact saved active owner");
}

async function initialCredentialVisible(context: ReadContext, password: string): Promise<boolean> {
  const response = await context.http.request({ method: "GET", path: LOGIN });
  if (!response.ok || response.status !== 200) throw new Error("Mayan private login page could not be inspected");
  const html = await response.text();
  // The pinned template renders a base64url password verbatim inside <strong>.
  // Keep page content and the comparison value private; never return either.
  return html.includes(password);
}

async function verifyToken(context: ReadContext, token: string, userId: number): Promise<void> {
  if (!/^[0-9a-f]{40}$/.test(token)) throw new Error("Mayan saved API token is invalid");
  if (await identity(context, `Token ${token}`) !== userId) {
    throw new Error("Mayan API token belongs to a different identity");
  }
  await userViewPermission(context, `Token ${token}`, userId);
}

async function inspect(context: SetupInspectionContext): Promise<SetupRecord> {
  const status = exactStatus(context, await context.status());
  const owner = await credentials(context);
  if (await initialCredentialVisible(context, owner.password)) {
    throw new Error("Mayan still discloses its initial administrator credential");
  }
  const anonymous = await context.http.request({ method: "GET", path: CURRENT_USER,
    headers: { Accept: "application/json" } });
  if (![401, 403].includes(anonymous.status)) throw new Error("Mayan anonymous current-user access was not rejected");
  const token = await context.secrets.readApiKey();
  const apiKeyFile = await context.secrets.apiKeyPath();
  if (token === null || apiKeyFile === null || !isAbsolute(apiKeyFile)) {
    throw new Error("Mayan has no saved durable API token");
  }
  await verifyToken(context, token, owner.userId);
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "owner-login-and-api-token-verified",
    credentialRef: status.passwordFile, apiKeyFile, initialCredentialDisclosure: false,
    userViewPermission: "user-list-and-saved-owner-visible", administratorAuthority: "not-verified" };
}

const adapter: SetupAdapter = {
  appId: APP_ID, sharedOwner: true, credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding", healthSource: null, homarrIntegration: null,
  ready(record) {
    return record.appId === APP_ID && record.stage === "owner-login-and-api-token-verified"
      && record.initialCredentialDisclosure === false
      && record.userViewPermission === "user-list-and-saved-owner-visible"
      && record.administratorAuthority === "not-verified"
      && typeof record.credentialRef === "string" && isAbsolute(record.credentialRef)
      && typeof record.apiKeyFile === "string" && isAbsolute(record.apiKeyFile);
  },
  inspect,
  async firstRun(context: SetupContext): Promise<SetupRecord> {
    const status = exactStatus(context, await context.status());
    const owner = await credentials(context);
    let prior = await context.checkpoint.read();
    if (prior !== null && (prior.appId !== APP_ID || prior.projectRoot !== context.projectRoot
      || prior.data.userId !== owner.userId || prior.data.passwordFile !== status.passwordFile)) {
      throw new Error("Mayan setup checkpoint differs from the saved owner");
    }
    if (await initialCredentialVisible(context, owner.password)) {
      if (prior?.attemptedActions.includes(CLEAR)) {
        throw new Error("Mayan credential cleanup was already attempted; reconcile privately without resetting the account");
      }
      // The source calls set_password and the post_save handler clears the
      // bootstrap singleton when its hash changes. First authenticate the
      // exact saved password; submit that same password, never reset an unknown owner.
      const response = await context.http.request({ method: "PATCH", path: CURRENT_USER,
        headers: { Authorization: owner.authorization, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ password: owner.password }),
        approval: { action: CLEAR, progress: "Rehash the verified saved Mayan password to clear its initial credential display", once: true },
        beforeSendCheckpoint: { expectedRevision: prior?.revision ?? null, stage: "credential-cleanup-attempted",
          data: { userId: owner.userId, passwordFile: status.passwordFile as string } },
      });
      if (!response.ok || response.status !== 200) throw new Error("Mayan credential cleanup did not return HTTP 200");
      if (await identity(context, owner.authorization) !== owner.userId
        || await initialCredentialVisible(context, owner.password)) {
        throw new Error("Mayan credential cleanup was not verified");
      }
      prior = await context.checkpoint.read();
    }
    const existing = await context.secrets.readApiKey();
    if (existing !== null) {
      await verifyToken(context, existing, owner.userId);
      return inspect(context);
    }
    if (prior?.attemptedActions.includes(TOKEN)) {
      throw new Error("Mayan token acquisition was already attempted without a saved token; reconcile privately, do not replay");
    }
    const response = await context.http.request({ method: "POST", path: "/api/v4/auth/token/obtain/",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username: "admin", password: owner.password }),
      approval: { action: TOKEN, progress: "Acquire the existing or first durable Mayan saved-owner API token", once: true },
      beforeSendCheckpoint: { expectedRevision: prior?.revision ?? null, stage: "token-request-attempted",
        data: { userId: owner.userId, passwordFile: status.passwordFile as string } },
    });
    if (!response.ok || response.status !== 200) throw new Error("Mayan token acquisition did not return HTTP 200");
    const payload = setupRecord(await response.json(), "Mayan token response");
    if (typeof payload.token !== "string") throw new Error("Mayan token response is invalid");
    if (!/^[0-9a-f]{40}$/.test(payload.token)) throw new Error("Mayan token response is invalid");
    await context.secrets.writeApiKey(payload.token);
    await verifyToken(context, payload.token, owner.userId);
    return inspect(context);
  },
};

export default adapter;
