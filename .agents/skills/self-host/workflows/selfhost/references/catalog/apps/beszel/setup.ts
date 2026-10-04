import { isAbsolute } from "node:path";

import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext,
  type SetupRecord } from "../../types/setup";

const APP_ID = "beszel";
const EMAIL = "admin@example.test";
const STAGE = "admin-and-superuser-verified";

async function firstRun(context: SetupContext): Promise<boolean> {
  const response = await context.http.request({ method: "GET", path: "/api/beszel/first-run" });
  if (response.status !== 200) throw new Error("Beszel first-run state is unavailable");
  const body = setupRecord(await response.json(), "Beszel first-run state");
  if (typeof body.firstRun !== "boolean") throw new Error("Beszel first-run state is invalid");
  return body.firstRun;
}

async function verifyAccount(context: SetupContext, collection: string, password: string): Promise<void> {
  const actionCollection = collection.replace(/^_/, "");
  const response = await context.http.request({
    method: "POST", path: `/api/collections/${collection}/auth-with-password`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: EMAIL, password }),
    approval: { action: `beszel-verify-${actionCollection}-login`,
      progress: `Verify the saved Beszel ${collection} account` },
  });
  if (response.status !== 200) throw new Error(`Beszel ${collection} login failed`);
  const body = setupRecord(await response.json(), `Beszel ${collection} login`);
  const record = setupRecord(body.record, `Beszel ${collection} identity`);
  if (record.email !== EMAIL || typeof body.token !== "string" || body.token.length === 0) {
    throw new Error(`Beszel ${collection} login did not prove the saved identity`);
  }
  if (collection === "users" && record.role !== "admin") {
    throw new Error("Beszel Hub account is not an administrator");
  }
  if (collection === "_superusers" && record.collectionName !== "_superusers") {
    throw new Error("Beszel PocketBase superuser identity is unproven");
  }
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: null,
  homarrIntegration: "beszel",
  ready(record) {
    return record.appId === APP_ID && record.stage === STAGE
      && record.adminLoginVerified === true && record.superuserLoginVerified === true
      && typeof record.credentialRef === "string" && isAbsolute(record.credentialRef);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("Beszel setup received a different app");
    const status = appliedStatus(context, await context.status());
    if (status.ownerKind !== "shared" || status.username !== EMAIL
      || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)) {
      throw new Error("Beszel has no exact saved email and password reference");
    }
    const password = await context.secrets.readAdminPassword();
    if (!password || password.length > 1024 || /[\r\n\u0000]/.test(password)) {
      throw new Error("Beszel saved administrator password is invalid");
    }
    let checkpoint = await context.checkpoint.read();
    if (checkpoint && (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || !["signup-attempted", STAGE].includes(checkpoint.stage))) {
      throw new Error("Beszel has an unexpected first-run checkpoint");
    }
    if (await firstRun(context)) {
      if (checkpoint) throw new Error("Beszel signup was attempted but remains incomplete; inspect before retrying");
      const response = await context.http.request({ method: "POST", path: "/api/beszel/create-user",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password }),
        approval: { action: "beszel-create-first-admin", once: true,
          progress: "Create the Beszel Hub admin and PocketBase superuser on this private instance" },
        beforeSendCheckpoint: { expectedRevision: null, stage: "signup-attempted" } });
      if (response.status !== 200) throw new Error("Beszel signup outcome is uncertain; inspect before retrying");
    } else if (!checkpoint) {
      throw new Error("Beszel already has a user outside this setup; do not adopt it blindly");
    }
    if (await firstRun(context)) throw new Error("Beszel first-user creation did not finish");
    await verifyAccount(context, "users", password);
    await verifyAccount(context, "_superusers", password);
    checkpoint = await context.checkpoint.read();
    if (!checkpoint || checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot) {
      throw new Error("Beszel has no trusted first-user checkpoint");
    }
    if (checkpoint.stage !== STAGE) {
      await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision, stage: STAGE });
    }
    return { appId: APP_ID, projectRoot: context.projectRoot, stage: STAGE,
      credentialRef: status.passwordFile, email: EMAIL,
      adminLoginVerified: true, superuserLoginVerified: true };
  },
};

export default adapter;
