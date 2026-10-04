import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext, type SetupRecord } from "../../types/setup";

const APP_ID = "homebridge";
const CREATE = "homebridge-create-first-admin";
// Image 2026-09-25 bundles UI 5.29.0. Routes and fields are pinned to:
// https://github.com/homebridge/homebridge-config-ui-x/tree/v5.29.0/src
async function settings(context: SetupContext): Promise<SetupRecord> {
  const response = await context.http.request({ method: "GET", path: "/api/auth/settings" });
  if (response.status !== 200) throw new Error("Homebridge settings are unavailable");
  const env = setupRecord(setupRecord(await response.json(), "Homebridge settings").env, "Homebridge environment");
  if (env.packageVersion !== "5.29.0" || typeof env.setupWizardComplete !== "boolean"
    || typeof env.instanceId !== "string" || !/^[a-f0-9]{64}$/.test(env.instanceId)) {
    throw new Error("Homebridge does not match the pinned UI bootstrap contract");
  }
  return env;
}

async function verify(context: SetupContext, password: string): Promise<number> {
  const response = await context.http.request({
    method: "POST", path: "/api/auth/login",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
    approval: { action: "homebridge-verify-admin-login", progress: "Authenticate the saved Homebridge administrator on the exact private origin" },
  });
  if (response.status !== 201) throw new Error("Homebridge rejected the saved administrator login");
  const login = setupRecord(await response.json(), "Homebridge login");
  if (typeof login.access_token !== "string" || !login.access_token || login.access_token.length > 16384
    || /[\r\n\u0000]/.test(login.access_token) || login.token_type !== "Bearer"
    || typeof login.expires_in !== "number" || login.expires_in <= 0) {
    throw new Error("Homebridge did not issue an expiring administrator session");
  }
  const users = await context.http.request({ method: "GET", path: "/api/users", headers: { Authorization: `Bearer ${login.access_token}` } });
  if (users.status !== 200) throw new Error("Homebridge administrator readback failed");
  const inventory = await users.json();
  if (!Array.isArray(inventory)) throw new Error("Homebridge returned an invalid user inventory");
  const owners = inventory.filter((user) => user && typeof user === "object"
    && user.username === "admin");
  if (owners.length !== 1) throw new Error("Homebridge has no unique saved administrator");
  const owner = setupRecord(owners[0], "Homebridge owner");
  if (owner.username !== "admin" || owner.admin !== true || !Number.isSafeInteger(owner.id) || Number(owner.id) < 1) {
    throw new Error("Homebridge's saved identity is not the expected first administrator");
  }
  // The token is a short-lived session, not a durable API key. Never save it.
  return Number(owner.id);
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  async firstRun(context): Promise<SetupRecord> {
    appliedStatus(context, await context.status());
    const password = await context.secrets.readAdminPassword();
    if (!password || password.length > 1024 || /[\r\n\u0000]/.test(password)) throw new Error("Homebridge has no valid saved administrator password");
    let checkpoint = await context.checkpoint.read();
    const env = await settings(context);
    if (checkpoint && (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || checkpoint.schemaVersion !== 1 || !Number.isSafeInteger(checkpoint.revision)
      || checkpoint.data.instanceId !== env.instanceId
      || !checkpoint.attemptedActions.includes(CREATE)
      || !["first-admin-attempted", "admin-auth-verified"].includes(checkpoint.stage))) {
      throw new Error("Homebridge checkpoint does not match this exact instance");
    }
    if (env.setupWizardComplete === false) {
      if (checkpoint) throw new Error("Homebridge first-admin attempt is unresolved; inspect without replaying creation");
      const response = await context.http.request({
        method: "POST", path: "/api/setup-wizard/create-first-user",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", name: "Administrator", admin: true, password }),
        approval: { action: CREATE, progress: "Create the first Homebridge administrator with the saved private password", once: true },
        beforeSendCheckpoint: { expectedRevision: null, stage: "first-admin-attempted", data: { instanceId: String(env.instanceId) } },
      });
      if (response.status !== 201) throw new Error("Homebridge first administrator creation is unresolved; inspect before continuing");
      checkpoint = await context.checkpoint.read();
    } else if (!checkpoint) {
      throw new Error("Homebridge already has an owner without this setup checkpoint; refuse adoption");
    }
    const ownerId = await verify(context, password);
    if (checkpoint?.stage === "admin-auth-verified" && checkpoint.data.ownerId !== ownerId) {
      throw new Error("Homebridge administrator identity changed");
    }
    const readback = await settings(context);
    if (readback.setupWizardComplete !== true || readback.instanceId !== env.instanceId) throw new Error("Homebridge wizard completion was not verified");
    if (checkpoint?.stage !== "admin-auth-verified") {
      await context.checkpoint.compareAndSet({ expectedRevision: checkpoint?.revision ?? null,
        stage: "admin-auth-verified", data: { instanceId: String(env.instanceId), ownerId } });
    }
    return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-auth-verified", adminUsername: "admin", ownerId,
      apiCredential: "expiring-bearer-session", durableApiKey: false, lanPairingVerified: false, restartPersistenceVerified: false };
  },
  ready(status): boolean { return status.appId === APP_ID && status.stage === "admin-auth-verified" && status.adminUsername === "admin"; },
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: null,
  homarrIntegration: null,
};

export default adapter;
