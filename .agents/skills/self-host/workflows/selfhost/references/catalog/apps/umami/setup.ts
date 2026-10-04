import { createHash } from "node:crypto";
import { appliedStatus, type SetupAdapter, type SetupContext, type SetupRecord } from "../../types/setup";

const APP_ID = "umami";
const USERNAME = "admin";
const INITIAL_SEED = "umami";
const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

type LoginIdentity = { id: string; username: string; role: string; isAdmin: boolean; token: string };

async function seededSession(context: SetupContext, password: string): Promise<LoginIdentity> {
  const saved = await context.secrets.readSessionCookies();
  const passwordDigest = createHash("sha256").update(password).digest("hex");
  if (Object.keys(saved).length > 0) {
    if (Object.keys(saved).sort().join(",") !== "admin_id,password_digest,seed_token"
      || saved.password_digest !== passwordDigest
      || !/^[0-9a-f-]{36}$/i.test(saved.admin_id ?? "")
      || !/^[A-Za-z0-9._-]{1,8192}$/.test(saved.seed_token ?? "")) {
      throw new Error("Umami saved seeded session differs from the private owner credential");
    }
    return { id: saved.admin_id!, username: USERNAME, role: "admin", isAdmin: true,
      token: saved.seed_token! };
  }
  const seed = await login(context, INITIAL_SEED, "umami-prove-seeded-admin");
  if (seed === null) throw new Error("Umami seeded admin is absent or already changed; refusing adoption");
  // Approval includes the exact bearer. Keep it private and stable across review retries;
  // a fresh login generates another token and would invalidate the reviewed rotation.
  await context.secrets.writeSessionCookies({ admin_id: seed.id,
    password_digest: passwordDigest, seed_token: seed.token });
  return seed;
}

async function login(context: SetupContext, password: string, action: string): Promise<LoginIdentity | null> {
  const response = await context.http.request({
    method: "POST", path: "/api/auth/login", headers: JSON_HEADERS,
    body: JSON.stringify({ username: USERNAME, password }),
    approval: { action, progress: "Check the exact private Umami administrator login" },
  });
  if (response.status === 401 || response.status === 403) return null;
  if (response.status !== 200) throw new Error("Umami login returned an unexpected response");
  const value = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Umami login returned no identity");
  const result = value as Record<string, unknown>;
  const user = result.user;
  if (typeof result.token !== "string" || !result.token || !user || typeof user !== "object" || Array.isArray(user)) {
    throw new Error("Umami login returned no authenticated administrator");
  }
  const identity = user as Record<string, unknown>;
  if (typeof identity.id !== "string" || !/^[0-9a-f-]{36}$/i.test(identity.id)
    || identity.username !== USERNAME || identity.role !== "admin" || identity.isAdmin !== true) {
    throw new Error("Umami login identity is not the expected seeded administrator");
  }
  return { id: identity.id, username: USERNAME, role: "admin", isAdmin: true, token: result.token };
}

function record(context: SetupContext): SetupRecord {
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-rotation-verified",
    adminUsername: USERNAME, credentialRef: "app handoff" };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: "/api/heartbeat",
  homarrIntegration: "umami",
  ready(status) {
    return status.appId === APP_ID && status.stage === "admin-rotation-verified"
      && status.adminUsername === USERNAME && status.credentialRef === "app handoff";
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("Umami setup received a different app ID");
    appliedStatus(context, await context.status());
    const password = await context.secrets.readAdminPassword();
    if (password.length < 32 || password.length > 128 || !/^[A-Za-z0-9]+$/.test(password)
      || password === INITIAL_SEED) throw new Error("Umami has no valid generated administrator password");

    let checkpoint = await context.checkpoint.read();
    if (checkpoint !== null && (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || !["rotation-attempted", "admin-rotation-verified"].includes(checkpoint.stage))) {
      throw new Error("Umami has an unrecognized administrator-rotation checkpoint");
    }
    if (checkpoint === null) {
      const seed = await seededSession(context, password);
      const generated = await login(context, password, "umami-check-generated-admin");
      if (generated !== null) throw new Error("Umami generated password already works without a rotation checkpoint");
      const response = await context.http.request({
        method: "POST", path: `/api/users/${seed.id}`,
        headers: { ...JSON_HEADERS, Authorization: `Bearer ${seed.token}` },
        body: JSON.stringify({ password }),
        approval: { action: "umami-rotate-seeded-admin", once: true,
          progress: "Replace the seeded Umami administrator password on the exact private origin" },
        beforeSendCheckpoint: { expectedRevision: null, stage: "rotation-attempted", data: { adminId: seed.id } },
      });
      if (response.status !== 200) throw new Error("Umami rotation was not confirmed; only saved-credential login may reconcile it");
      checkpoint = await context.checkpoint.read();
    }
    if (!checkpoint || (checkpoint.stage !== "rotation-attempted" && checkpoint.stage !== "admin-rotation-verified")) {
      throw new Error("Umami rotation checkpoint is missing");
    }
    const adminId = checkpoint.data.adminId;
    if (typeof adminId !== "string" || !/^[0-9a-f-]{36}$/i.test(adminId)) {
      throw new Error("Umami rotation checkpoint has no exact administrator identity");
    }
    // The pinned login binds tokens to the password hash; rotation invalidates this seed bearer.
    // Lost rotation responses reconcile below with the generated password, never replay the write.
    await context.secrets.writeSessionCookies({});
    const generated = await login(context, password, "umami-verify-generated-admin");
    if (generated === null || generated.id !== adminId) throw new Error("Umami did not verify the saved rotated administrator");
    if (await login(context, INITIAL_SEED, "umami-reject-seeded-admin") !== null) {
      throw new Error("Umami still accepts its seeded administrator password");
    }
    if (checkpoint.stage === "rotation-attempted") {
      checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
        stage: "admin-rotation-verified", data: { adminId } });
    }
    return record(context);
  },
};

export default adapter;
