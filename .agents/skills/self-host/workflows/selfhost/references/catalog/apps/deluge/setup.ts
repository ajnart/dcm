import { isAbsolute } from "node:path";
import { createHash } from "node:crypto";

import { appliedStatus, type SetupAdapter, type SetupContext, type SetupRecord } from "../../types/setup";

const APP_ID = "deluge";
const INITIAL_SEED = "deluge";
const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

function responseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Deluge returned an invalid JSON-RPC response");
  }
  return value as Record<string, unknown>;
}

async function rpc(context: SetupContext, method: string, params: string[], action: string,
  cookie?: string, mutation?: { expectedRevision: number | null }): Promise<{ result: unknown; cookie: string | null }> {
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (cookie) headers.Cookie = cookie;
  const request = {
    method: "POST" as const, path: "/json", headers,
    body: JSON.stringify({ method, params, id: 1 }),
    approval: { action, progress: "Verify or rotate the private Deluge Web password", once: mutation !== undefined },
    ...(mutation ? { beforeSendCheckpoint: { expectedRevision: mutation.expectedRevision,
      stage: "password-rotation-attempted" } } : {}),
  };
  const response = await context.http.request(request);
  if (response.status !== 200) throw new Error("Deluge JSON-RPC returned an unexpected status");
  const body = responseObject(await response.json());
  if (body.id !== 1 || body.error !== null) throw new Error("Deluge JSON-RPC returned an error");
  const setCookie = response.headers.get("set-cookie")?.split(";", 1)[0] ?? null;
  if (setCookie !== null && !/^_session_id=[A-Za-z0-9]+$/.test(setCookie)) {
    throw new Error("Deluge returned an unexpected Web session cookie");
  }
  return { result: body.result, cookie: setCookie };
}

async function login(context: SetupContext, password: string, action: string): Promise<string | null> {
  const response = await rpc(context, "auth.login", [password], action);
  if (response.result === false) return null;
  if (response.result !== true || !response.cookie) {
    throw new Error("Deluge login returned no authenticated Web session");
  }
  return response.cookie;
}

function record(context: SetupContext, passwordFile: string): SetupRecord {
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "web-password-verified",
    adminUsername: null, passwordFile };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: null,
  homarrIntegration: "Deluge",
  ready(value) {
    return value.appId === APP_ID && value.stage === "web-password-verified"
      && value.adminUsername === null && typeof value.passwordFile === "string"
      && isAbsolute(value.passwordFile);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
      throw new Error("Deluge setup received a different app project");
    }
    const status = appliedStatus(context, await context.status());
    if (status.username !== null || typeof status.passwordFile !== "string"
      || !isAbsolute(status.passwordFile) || typeof status.port !== "number"
      || status.url !== `http://127.0.0.1:${status.port}`) {
      throw new Error("Deluge has no exact private password-only owner");
    }
    const password = await context.secrets.readAdminPassword();
    if (password.length < 32 || password.length > 128 || !/^[A-Za-z0-9]+$/.test(password)
      || password === INITIAL_SEED) throw new Error("Deluge has no valid saved Web password");

    let checkpoint = await context.checkpoint.read();
    if (checkpoint !== null && (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || !["password-rotation-attempted", "web-password-verified"].includes(checkpoint.stage))) {
      throw new Error("Deluge has an unrecognized password checkpoint");
    }
    if (checkpoint === null) {
      const digest = createHash("sha256").update(password).digest("hex");
      const saved = await context.secrets.readSessionCookies();
      if (Object.keys(saved).some((field) => !["seed_cookie", "password_digest"].includes(field))
        || (Object.keys(saved).length > 0 && (saved.password_digest !== digest
          || !/^_session_id=[A-Za-z0-9]{1,128}$/.test(saved.seed_cookie ?? "")))) {
        throw new Error("Deluge private seed session differs from this password rotation");
      }
      let seedCookie = saved.seed_cookie ?? null;
      if (seedCookie !== null) {
        const valid = await rpc(context, "auth.check_session", [], "deluge-check-seed-session", seedCookie);
        if (valid.result === false) {
          await context.secrets.writeSessionCookies({});
          throw new Error("Deluge seed session expired; request a new approved login on the next run");
        }
        if (valid.result !== true) throw new Error("Deluge seed session readback is invalid");
      } else {
        seedCookie = await login(context, INITIAL_SEED, "deluge-prove-initial-password");
        if (seedCookie !== null) {
          await context.secrets.writeSessionCookies({ seed_cookie: seedCookie, password_digest: digest });
        }
      }
      if (seedCookie === null) throw new Error("Deluge initial password is absent; refusing adoption");
      if (await login(context, password, "deluge-check-saved-password") !== null) {
        throw new Error("Deluge saved password already works without a rotation checkpoint");
      }
      const rotated = await rpc(context, "auth.change_password", [INITIAL_SEED, password],
        "deluge-rotate-web-password", seedCookie, { expectedRevision: null });
      if (rotated.result !== true) throw new Error("Deluge did not confirm Web password rotation");
      checkpoint = await context.checkpoint.read();
    }
    if (!checkpoint || !["password-rotation-attempted", "web-password-verified"].includes(checkpoint.stage)) {
      throw new Error("Deluge password rotation checkpoint is missing");
    }
    if (await login(context, password, "deluge-verify-saved-password") === null) {
      throw new Error("Deluge rejected the saved Web password");
    }
    if (await login(context, INITIAL_SEED, "deluge-reject-initial-password") !== null) {
      throw new Error("Deluge still accepts its initial Web password");
    }
    if (checkpoint.stage === "password-rotation-attempted") {
      await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
        stage: "web-password-verified" });
    }
    return record(context, status.passwordFile);
  },
};

export default adapter;
