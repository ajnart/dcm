import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupCheckpoint, type SetupContext, type SetupHttpResponse, type SetupRecord } from "../../types/setup";

const APP = "frigate";
const ROTATE = "frigate-rotate-first-admin-password";
const STAGES = ["bootstrap-verified", "rotation-attempted", "administrator-verified"];

function checkpoint(context: SetupContext, value: SetupCheckpoint | null, passwordFile: string): SetupCheckpoint | null {
  if (value && (value.appId !== APP || value.projectRoot !== context.projectRoot
    || !STAGES.includes(value.stage) || value.data.passwordFile !== passwordFile
    || (value.stage !== "bootstrap-verified" && !value.attemptedActions.includes(ROTATE)))) {
    throw new Error("Frigate first-admin checkpoint differs from the saved owner");
  }
  return value;
}

async function privateOrigin(context: SetupContext): Promise<void> {
  const denied = await context.http.request({ method: "GET", path: "/api/profile" });
  if (![401, 403].includes(denied.status)) throw new Error("Frigate anonymous profile access was not denied; refuse unauthenticated or proxy-only access");
}

function cookie(response: SetupHttpResponse): string {
  const headers = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const tokens = headers.flatMap((value) => [...value.matchAll(/(?:^|,\s*)frigate_token=([^;,\s]+)(?:;|,|$)/g)].map((match) => match[1]));
  if (tokens.length !== 1 || tokens[0].length < 16 || tokens[0].length > 4096 || /[\r\n\0]/.test(tokens[0])) {
    throw new Error("Frigate returned no single valid private login cookie");
  }
  return tokens[0];
}

async function profile(context: SetupContext, token: string): Promise<void> {
  const response = await context.http.request({ method: "GET", path: "/api/profile", headers: { Cookie: `frigate_token=${token}` } });
  if (response.status === 401) {
    await context.secrets.writeSessionCookies({});
    throw new Error("Frigate saved bootstrap session expired; inspect before approving a new bootstrap login");
  }
  if (response.status !== 200 || !response.ok) throw new Error("Frigate admin profile could not be verified; retain the private session");
  const identity = setupRecord(await response.json(), "Frigate profile");
  if (identity.username !== "admin" || identity.role !== "admin" || !Array.isArray(identity.allowed_cameras)) {
    throw new Error("Frigate login did not authenticate the exact administrator");
  }
  // NGINX protects /api/version even though the backend marks /version public.
  const version = await context.http.request({ method: "GET", path: "/api/version", headers: { Cookie: `frigate_token=${token}` } });
  if (version.status !== 200 || !version.ok || !/^0\.18\.0(?:-[A-Za-z0-9]+)?$/.test((await version.text()).trim())) {
    throw new Error("Frigate is not the pinned v0.18.0 server");
  }
}

async function login(context: SetupContext, password: string, bootstrap: boolean): Promise<string> {
  let action = "frigate-verify-saved-admin-login";
  if (bootstrap) action = "frigate-verify-bootstrap-admin-login";
  const response = await context.http.request({ method: "POST", path: "/api/login",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: "admin", password }),
    approval: { action, progress: "Verify the exact private Frigate administrator credential" } });
  if (response.status !== 200 || !response.ok || (await response.text()).trim() !== "") throw new Error("Frigate administrator login failed; never replay an uncertain password rotation");
  return cookie(response);
}

async function bootstrap(context: SetupContext, digest: string): Promise<string> {
  const saved = await context.secrets.readSessionCookies();
  if (Object.keys(saved).some((key) => !["frigate_token", "owner_digest"].includes(key))
    || (Object.keys(saved).length > 0 && saved.owner_digest !== digest)) throw new Error("Frigate bootstrap session differs from its saved owner credential");
  let token = saved.frigate_token;
  if (!token) {
    const temporary = await context.secrets.readBootstrapPassword();
    if (!/^[a-f0-9]{32}$/.test(temporary)) throw new Error("Frigate has no exact current-start generated bootstrap password");
    token = await login(context, temporary, true);
    if (!token) throw new Error("Frigate has no bootstrap session");
    await context.secrets.writeSessionCookies({ frigate_token: token, owner_digest: digest });
  }
  if (token.length < 16 || token.length > 4096 || /[\r\n\0]/.test(token)) throw new Error("Frigate saved bootstrap session is invalid");
  await profile(context, token);
  return token;
}

const adapter: SetupAdapter = {
  appId: APP, credentialCommand: "app handoff", apiKey: "not-created", healthSource: null, homarrIntegration: "Frigate",
  ready(value) { return value.appId === APP && value.stage === "administrator-verified" && value.adminUsername === "admin"
    && value.version === "0.18.0" && value.cameraConfiguration === "not-configured"
    && typeof value.passwordFile === "string" && isAbsolute(value.passwordFile); },
  async firstRun(context) {
    const status = appliedStatus(context, await context.status());
    if (status.username !== "admin" || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)) {
      throw new Error("Frigate has no exact saved administrator password file");
    }
    const password = await context.secrets.readAdminPassword();
    if (password.length < 12 || password.length > 1024 || /[\r\n\0]/.test(password)) throw new Error("Frigate saved generated administrator password is invalid");
    await privateOrigin(context);
    let saved = checkpoint(context, await context.checkpoint.read(), status.passwordFile);
    if (!saved || saved.stage === "bootstrap-verified") {
      const digest = createHash("sha256").update(password).digest("hex");
      const token = await bootstrap(context, digest);
      if (!saved) saved = await context.checkpoint.compareAndSet({ expectedRevision: null,
        stage: "bootstrap-verified", data: { passwordFile: status.passwordFile } });
      const response = await context.http.request({ method: "PUT", path: "/api/users/admin/password",
        headers: { "Content-Type": "application/json", Cookie: `frigate_token=${token}` }, body: JSON.stringify({ password }),
        approval: { action: ROTATE, once: true, progress: "Rotate the first Frigate admin to the saved generated password once" },
        beforeSendCheckpoint: { expectedRevision: saved.revision, stage: "rotation-attempted", data: saved.data } });
      if (response.status !== 200 || !response.ok || setupRecord(await response.json(), "Frigate rotation").success !== true) {
        throw new Error("Frigate password rotation has an uncertain outcome; verify saved login and never repeat PUT");
      }
      saved = checkpoint(context, await context.checkpoint.read(), status.passwordFile);
    }
    if (!saved || !saved.attemptedActions.includes(ROTATE)) throw new Error("Frigate has no checkpointed first-admin rotation");
    const token = await login(context, password, false);
    await profile(context, token);
    if (saved.stage !== "administrator-verified") await context.checkpoint.compareAndSet({ expectedRevision: saved.revision,
      stage: "administrator-verified", data: saved.data });
    return { appId: APP, projectRoot: context.projectRoot, stage: "administrator-verified", adminUsername: "admin",
      passwordFile: status.passwordFile, version: "0.18.0", cameraConfiguration: "not-configured", apiKey: "not-created" };
  },
};

export default adapter;
