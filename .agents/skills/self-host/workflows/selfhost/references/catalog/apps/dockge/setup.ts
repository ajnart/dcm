import { isAbsolute, join } from "node:path";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext, type SetupCheckpoint } from "../../types/setup.ts";
import { SetupEngineIoPolling } from "../../../../../../../../../packages/cli/src/lib/setup-engineio-polling.ts";

const ATTEMPTED = "administrator-write-attempted";
const VERIFIED = "administrator-settings-verified";
const SETUP_ACTION = "dockge-setup";

function checkedCheckpoint(context: SetupContext, value: SetupCheckpoint | null) {
  if (value && (value.schemaVersion !== 1 || value.appId !== "dockge" || value.projectRoot !== context.projectRoot
    || !Number.isSafeInteger(value.revision) || value.revision < 1
    || ![ATTEMPTED, VERIFIED].includes(value.stage) || !value.attemptedActions.includes(SETUP_ACTION))) {
    throw new Error("Dockge first-owner checkpoint differs; inspect before continuing");
  }
  return value;
}

function socket(context: SetupContext) {
  return new SetupEngineIoPolling(context, {
    retainEvents: ["setup", "info"],
    approval(event) {
      const actions: Record<string, { action: string; progress: string }> = {
        setup: { action: SETUP_ACTION, progress: "Create Dockge's first administrator with the saved private password only after fresh empty-user-table evidence" },
        login: { action: "dockge-login", progress: "Freshly verify the saved Dockge administrator password; keep its JWT private and session-only" },
        getSettings: { action: "dockge-get-settings", progress: "Read authenticated Dockge settings; no stack mutation or authentication policy change" },
      };
      const intent = actions[event];
      if (!intent) throw new Error("Dockge application event is outside its reviewed setup profile");
      return intent;
    },
  });
}

async function verifiedLogin(client: SetupEngineIoPolling, password: string): Promise<void> {
  client.takeEvent("info");
  const result = setupRecord(await client.event("login", [{ username: "admin", password }]), "Dockge password login");
  if (result.ok !== true || typeof result.token !== "string"
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(result.token)
    || result.token.length > 8192 || result.tokenRequired === true) {
    throw new Error("Dockge saved administrator password login is unverified; never replay account creation");
  }
  // The authenticated namespace is sufficient. Never persist the password-bound
  // JWT as an API key or checkpoint data; every resume uses fresh password login.
  const info = await client.waitEvent("info");
  if (!info || info.length !== 1 || setupRecord(info[0], "Dockge authenticated info").version !== "1.5.0") {
    throw new Error("Dockge authenticated version differs from pinned 1.5.0");
  }
  const settings = setupRecord(await client.event("getSettings", []), "Dockge authenticated settings");
  const data = setupRecord(settings.data, "Dockge settings data");
  if (settings.ok !== true || (data.disableAuth !== undefined && data.disableAuth !== false)) {
    throw new Error("Dockge authenticated settings or enabled-auth policy could not be verified");
  }
}

const adapter: SetupAdapter = {
  appId: "dockge", sharedOwner: true, credentialCommand: "app handoff", apiKey: "not-created",
  healthSource: null, homarrIntegration: null,
  async firstRun(context) {
    if (context.appId !== "dockge") throw new Error("Dockge setup owner differs");
    const status = appliedStatus(context, await context.status());
    if (status.ownerKind !== "shared" || status.username !== "admin"
      || typeof status.privateFiles !== "string" || !isAbsolute(status.privateFiles)
      || status.passwordFile !== join(status.privateFiles, "admin-password")) {
      throw new Error("Dockge needs its exact saved shared-owner administrator credential");
    }
    if (!context.requireSameDaemonDirectory) throw new Error("Dockge same-host Docker management/path gate is unavailable");
    await context.requireSameDaemonDirectory();
    const password = await context.secrets.readAdminPassword();
    if (!/^[A-Za-z0-9]{43}$/.test(password)) throw new Error("Dockge generated administrator credential differs");
    const saved = checkedCheckpoint(context, await context.checkpoint.read());
    const client = socket(context);
    await client.connect();
    if (!saved) {
      const setup = await client.waitEvent("setup");
      if (setup.length !== 0) throw new Error("Dockge empty-user-table setup event differs");
      const result = setupRecord(await client.event("setup", ["admin", password],
        { expectedRevision: null, stage: ATTEMPTED }), "Dockge first-owner creation");
      if (result.ok !== true) throw new Error("Dockge first-owner creation is uncertain; inspect and never replay setup");
    }
    await verifiedLogin(client, password);
    const after = checkedCheckpoint(context, await context.checkpoint.read());
    if (!after) throw new Error("Dockge first-owner attempted-write checkpoint is missing");
    if (after.stage !== VERIFIED) await context.checkpoint.compareAndSet({ expectedRevision: after.revision, stage: VERIFIED });
    await context.requireSameDaemonDirectory();
    return { appId: "dockge", projectRoot: context.projectRoot, stage: VERIFIED, credentialRef: status.passwordFile,
      loginVerified: true, settingsVerified: true, enabledAuthentication: true,
      sessionAuthentication: "password-bound-jwt", apiKeyCreated: false,
      sameDaemonDirectoryVerified: true, stackManagementVerified: false, restartPersistenceVerified: false };
  },
  ready(record) {
    return record.appId === "dockge" && record.stage === VERIFIED && record.loginVerified === true
      && record.settingsVerified === true && record.enabledAuthentication === true
      && record.sameDaemonDirectoryVerified === true && record.apiKeyCreated === false
      && typeof record.credentialRef === "string" && isAbsolute(record.credentialRef);
  },
};
export default adapter;
