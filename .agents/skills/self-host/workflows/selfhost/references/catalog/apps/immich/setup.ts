import { isAbsolute } from "node:path";
import { appliedStatus, setupRecord, statusApproval, type SetupAdapter, type SetupContext, type SetupRecord } from "../../types/setup";

const APP_ID = "immich";
const EMAIL = "admin@example.test";
const STAGE = "admin-login-verified-setup-open";
const KEY_ATTEMPTED = "homarr-key-create-attempted";
const KEY_SAVED = "homarr-key-saved";
const KEY_VERIFIED = "admin-login-and-homarr-key-verified-setup-open";
const SETUP_CLOSED = "setup-closed-admin-login-and-homarr-key-verified";
const KEY_ACTION = "immich-create-homarr-api-key";
// https://v2.preview.homarr.dev/docs/integrations/immich/
const HOMARR_PERMISSIONS = [
  "album.statistics", "album.read", "album.create", "user.read", "user.update", "asset.read", "asset.view",
  "asset.download", "asset.statistics", "server.statistics", "server.about",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function exactKey(value: SetupRecord): boolean {
  return typeof value.id === "string" && UUID.test(value.id) && value.name === "Homarr"
    && Array.isArray(value.permissions) && value.permissions.length === HOMARR_PERMISSIONS.length
    && JSON.stringify([...value.permissions].sort()) === JSON.stringify([...HOMARR_PERMISSIONS].sort());
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 24 && value.length <= 4096
    && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function closed(status: SetupRecord): boolean {
  return status.onboardingStage === "closed" && status.setupClosed === true;
}

async function standaloneCheckpoint(context: SetupContext): Promise<SetupRecord> {
  const status = appliedStatus(context, await context.status());
  if (!closed(status) || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)) {
    throw new Error("Immich has no saved, closed administrator checkpoint");
  }
  const handoff = setupRecord(await context.read("handoff"), "Immich handoff");
  if (handoff.command !== "app handoff" || handoff.appId !== context.appId
    || handoff.status !== "setup-closed-login-verified"
    || handoff.mutation !== false || handoff.secretful !== false
    || handoff.passwordFile !== status.passwordFile || Object.hasOwn(handoff, "env")) {
    throw new Error("Immich private handoff does not match its closed setup checkpoint");
  }
  return { appId: context.appId, projectRoot: context.projectRoot,
    stage: "setup-closed-login-verified", credentialRef: status.passwordFile };
}

async function standaloneFirstRun(context: SetupContext, initialStatus: SetupRecord): Promise<SetupRecord> {
  let status = initialStatus;
  if (closed(status)) return standaloneCheckpoint(context);
  if (status.onboardingStage === "pending" || status.onboardingStage === "signup-attempted") {
    const approval = statusApproval(status, "onboard");
    const onboarded = setupRecord(await context.apply("onboard", approval,
      "Create or verify the exact private Immich administrator"), "Immich onboarding");
    if (onboarded.command !== "app onboard" || onboarded.appId !== context.appId
      || onboarded.status !== "login-verified-setup-open" || onboarded.setupClosed !== false) {
      throw new Error("Immich onboarding did not verify the saved administrator");
    }
    status = appliedStatus(context, await context.status());
  }
  if (status.onboardingStage !== "login-verified" && status.onboardingStage !== "closing") {
    throw new Error("Immich has an unrecognized first-account checkpoint");
  }
  const plan = setupRecord(await context.read("close-plan"), "Immich setup-closure plan");
  const change = setupRecord(plan.change, "Immich setup-closure change");
  if (plan.command !== "app close-plan" || plan.appId !== context.appId
    || !["ready-for-review", "ready-to-resume"].includes(String(plan.status))
    || plan.mutation !== false || plan.projectId !== status.projectId
    || plan.setupClosed !== false || change.environment !== "IMMICH_ALLOW_SETUP"
    || change.from !== "true" || change.to !== "false"
    || typeof plan.approval !== "string"
    || !/^APP-CLOSE-SETUP:immich:[0-9a-f]{64}$/.test(plan.approval)) {
    throw new Error("Immich setup closure has no exact reviewed approval");
  }
  const result = setupRecord(await context.apply("close-setup", plan.approval,
    "Disable Immich setup on the exact project and reverify administrator login"), "Immich setup closure");
  if (result.command !== "app close-setup" || result.appId !== context.appId
    || result.status !== "setup-closed-login-verified"
    || result.setupClosed !== true || result.acceptanceVerified !== false) {
    throw new Error("Immich setup closure did not verify administrator login");
  }
  return standaloneCheckpoint(context);
}

async function initialized(context: SetupContext): Promise<boolean> {
  const response = await context.http.request({ method: "GET", path: "/api/server/config" });
  if (response.status !== 200) throw new Error("Immich initialization state is unavailable");
  const config = setupRecord(await response.json(), "Immich server config");
  if (typeof config.isInitialized !== "boolean") throw new Error("Immich initialization state is invalid");
  return config.isInitialized;
}

async function verifyLogin(context: SetupContext, password: string): Promise<string> {
  const response = await context.http.request({ method: "POST", path: "/api/auth/login",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password }),
    approval: { action: "immich-verify-admin-login", progress: "Verify the saved Immich administrator login" },
  });
  if (response.status !== 201) throw new Error("Immich saved administrator login failed");
  const login = setupRecord(await response.json(), "Immich administrator login");
  if (login.userEmail !== EMAIL || login.isAdmin !== true || typeof login.accessToken !== "string"
    || login.accessToken.length === 0) throw new Error("Immich login did not prove the saved administrator identity");
  return login.accessToken;
}

async function homarrKey(context: SetupContext, token: string): Promise<string> {
  let checkpoint = await context.checkpoint.read();
  if (!checkpoint) throw new Error("Immich has no trusted administrator checkpoint");
  const response = await context.http.request({ method: "GET", path: "/api/api-keys",
    headers: { Authorization: `Bearer ${token}` } });
  if (response.status !== 200) throw new Error("Immich API key inventory is unavailable");
  const inventory = await response.json();
  if (!Array.isArray(inventory) || inventory.some((entry) => !entry || typeof entry !== "object"
    || Array.isArray(entry) || typeof entry.name !== "string")) {
    throw new Error("Immich API key inventory is invalid");
  }
  const keys = inventory.filter((entry) => entry.name === "Homarr");
  if (keys.length > 1 || keys.some((entry) => !exactKey(entry))) {
    throw new Error("Immich Homarr key inventory differs; inspect before continuing");
  }
  let secret = await context.secrets.readApiKey();
  if (secret === null) {
    if (keys.length > 0 || checkpoint.stage !== STAGE || checkpoint.attemptedActions.includes(KEY_ACTION)) {
      throw new Error("Immich Homarr key has no saved secret or an uncertain creation; inspect without creating a replacement");
    }
    const createdResponse = await context.http.request({ method: "POST", path: "/api/api-keys",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Homarr", permissions: HOMARR_PERMISSIONS }),
      approval: { action: KEY_ACTION, once: true, progress: "Create the scoped Homarr API key for the verified Immich administrator" },
      beforeSendCheckpoint: { expectedRevision: checkpoint.revision, stage: KEY_ATTEMPTED },
    });
    if (createdResponse.status !== 201) throw new Error("Immich Homarr key creation is uncertain; inspect before retrying");
    const created = setupRecord(await createdResponse.json(), "Immich Homarr API key creation");
    if (!validKey(created.secret)) throw new Error("Immich Homarr key has no usable one-time secret; inspect manually");
    secret = created.secret;
    // Preserve the one-time secret before inspecting metadata or making another request.
    await context.secrets.writeApiKey(secret);
    if (!exactKey(created)) throw new Error("Immich created Homarr key metadata differs; inspect manually");
    checkpoint = await context.checkpoint.read();
    if (!checkpoint || checkpoint.stage !== KEY_ATTEMPTED) throw new Error("Immich Homarr key checkpoint changed");
    checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
      stage: KEY_SAVED, data: { homarrKeyId: created.id as string } });
  } else if (keys.length !== 1) {
    throw new Error("Immich saved Homarr secret has no unique matching key; inspect manually");
  }
  if (!validKey(secret)) throw new Error("Immich saved Homarr API key is invalid");
  const verifiedResponse = await context.http.request({ method: "GET", path: "/api/api-keys/me",
    headers: { "x-api-key": secret } });
  if (verifiedResponse.status !== 200) throw new Error("Immich saved Homarr API key did not authenticate");
  const verified = setupRecord(await verifiedResponse.json(), "Immich Homarr API key verification");
  if (!exactKey(verified) || (keys.length === 1 && verified.id !== keys[0].id)
    || (checkpoint.data.homarrKeyId !== undefined && verified.id !== checkpoint.data.homarrKeyId)) {
    throw new Error("Immich saved Homarr key identity or permissions differ");
  }
  const apiKeyFile = await context.secrets.apiKeyPath();
  if (!apiKeyFile || !isAbsolute(apiKeyFile)) throw new Error("Immich Homarr key has no canonical private file");
  if (![KEY_VERIFIED, SETUP_CLOSED].includes(checkpoint.stage) || checkpoint.data.homarrKeyId !== verified.id) {
    await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
      stage: KEY_VERIFIED, data: { homarrKeyId: verified.id as string } });
  }
  return apiKeyFile;
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: "immich",
  ready(record) {
    if (record.appId !== APP_ID || typeof record.credentialRef !== "string"
      || !isAbsolute(record.credentialRef)) return false;
    return record.stage === "setup-closed-login-verified"
      || (record.stage === SETUP_CLOSED && record.setupClosed === true
        && typeof record.apiKeyFile === "string" && isAbsolute(record.apiKeyFile));
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("Immich setup received a different app ID");
    const status = appliedStatus(context, await context.status());
    if (status.ownerKind !== "shared") return standaloneFirstRun(context, status);
    if (status.username !== EMAIL || typeof status.passwordFile !== "string"
      || !isAbsolute(status.passwordFile)) throw new Error("Immich has no exact saved email administrator credential");
    const password = await context.secrets.readAdminPassword();
    if (!password || password.length > 1024 || /[\r\n\u0000]/.test(password)) {
      throw new Error("Immich saved administrator password is invalid");
    }
    let checkpoint = await context.checkpoint.read();
    if (checkpoint && (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || !["signup-attempted", STAGE, KEY_ATTEMPTED, KEY_SAVED, KEY_VERIFIED, SETUP_CLOSED].includes(checkpoint.stage))) {
      throw new Error("Immich has an unexpected first-account checkpoint");
    }
    const isInitialized = await initialized(context);
    if (!isInitialized) {
      if (checkpoint) throw new Error("Immich signup was attempted but is incomplete; inspect before retrying");
      const response = await context.http.request({ method: "POST", path: "/api/auth/admin-sign-up",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: EMAIL, name: "Admin", password }),
        approval: { action: "immich-create-first-admin", once: true,
          progress: "Create the first Immich administrator on this private instance" },
        beforeSendCheckpoint: { expectedRevision: null, stage: "signup-attempted" },
      });
      if (response.status !== 201) throw new Error("Immich signup outcome is uncertain; inspect before retrying");
    } else if (!checkpoint) {
      throw new Error("Immich is already initialized outside this setup; do not adopt it blindly");
    }
    if (!(await initialized(context))) throw new Error("Immich first administrator is not initialized");
    const token = await verifyLogin(context, password);
    checkpoint = await context.checkpoint.read();
    if (!checkpoint || checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot) {
      throw new Error("Immich has no trusted signup checkpoint");
    }
    if (checkpoint.stage === "signup-attempted") {
      await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision, stage: STAGE });
    }
    const apiKeyFile = await homarrKey(context, token);
    // v3.2.2 server config and admin-sign-up's guard share isSetupAvailable():
    // setup.allow && !hasAdmin(). Verified admin login plus this readback proves
    // intrinsic first-admin closure without another signup or environment write.
    if (!(await initialized(context))) throw new Error("Immich first-admin setup closure was not verified");
    checkpoint = await context.checkpoint.read();
    if (!checkpoint || ![KEY_VERIFIED, SETUP_CLOSED].includes(checkpoint.stage)) {
      throw new Error("Immich has no verified administrator and Homarr key checkpoint");
    }
    if (checkpoint.stage !== SETUP_CLOSED) {
      await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision, stage: SETUP_CLOSED,
        data: { ...checkpoint.data, setupClosed: true } });
    }
    return { appId: APP_ID, projectRoot: context.projectRoot, stage: SETUP_CLOSED,
      email: EMAIL, credentialRef: status.passwordFile, apiKeyFile, setupClosed: true,
      setupClosure: "intrinsic-first-admin", acceptanceVerified: false };
  },
};

export default adapter;
