import { isAbsolute } from "node:path";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext, type SetupInspectionContext } from "../../types/setup.ts";
import { verifyAutheliaLoginState } from "./login-contract.ts";

const STAGE = "portal-one-factor-identity-verified";
const COOKIE = "authelia_session";
function privateCookie(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 4096 && /^[A-Za-z0-9._~-]+$/.test(value);
}
async function state(context: SetupContext | SetupInspectionContext, username: string, cookie: string): Promise<boolean> {
  const response = await context.http.request({ method: "GET", requireHttps: true, path: "/api/state",
    headers: { Cookie: `${COOKIE}=${cookie}` } });
  if (response.status !== 200) return false;
  const body = await response.json();
  try { verifyAutheliaLoginState(body, { username }); }
  catch { return false; }
  return true;
}
const adapter: SetupAdapter = {
  appId: "authelia", sharedOwner: true,
  async firstRun(context) {
    const status = appliedStatus(context, await context.status());
    if (context.appId !== "authelia" || status.ownerKind !== "shared"
      || typeof status.username !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(status.username)
      || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)) {
      throw new Error("Authelia needs its exact shared file-user identity");
    }
    const checkpoint = await context.checkpoint.read();
    if (checkpoint && (checkpoint.appId !== "authelia" || checkpoint.projectRoot !== context.projectRoot || checkpoint.stage !== STAGE)) {
      throw new Error("Authelia has another setup checkpoint");
    }
    await context.secrets.verifyMutableConfigs();
    const saved = await context.secrets.readSessionCookies();
    if (Object.keys(saved).some((key) => key !== COOKIE) || (saved[COOKIE] !== undefined && !privateCookie(saved[COOKIE]))) {
      throw new Error("Authelia private session is invalid");
    }
    let cookie = saved[COOKIE];
    if (cookie && !await state(context, status.username, cookie)) {
      await context.secrets.writeSessionCookies({});
      throw new Error("Authelia saved session expired or differs; a new approved login is required");
    }
    if (!cookie) {
      // Prove the exact saved HTTPS transport before releasing password bytes.
      const initial = await context.http.request({ method: "GET", requireHttps: true, path: "/api/state" });
      if (initial.status !== 200) throw new Error("Authelia owner-bound HTTPS state route is unavailable");
      const password = await context.secrets.readAdminPassword();
      const response = await context.http.request({ method: "POST", requireHttps: true, path: "/api/firstfactor",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: status.username, password, keepMeLoggedIn: false }),
        approval: { action: "authelia-verify-firstfactor-login", progress: "Authenticate the saved Authelia file user on the exact approved private HTTPS portal" } });
      if (response.status !== 200 || setupRecord(await response.json(), "Authelia login").status !== "OK") {
        throw new Error("Authelia saved file-user login failed");
      }
      const headers = response.headers.getSetCookie?.() ?? [];
      const matches = headers.filter((header) => header.startsWith(`${COOKIE}=`));
      if (matches.length !== 1 || !/;\s*secure(?:;|$)/i.test(matches[0]!)
        || !/;\s*httponly(?:;|$)/i.test(matches[0]!)) throw new Error("Authelia did not return its secure private session");
      cookie = matches[0]!.split(";", 1)[0]!.slice(COOKIE.length + 1);
      if (!privateCookie(cookie)) throw new Error("Authelia returned an invalid private session");
      await context.secrets.writeSessionCookies({ [COOKIE]: cookie });
      if (!await state(context, status.username, cookie)) throw new Error("Authelia login did not prove the exact one-factor identity");
    }
    if (!checkpoint) await context.checkpoint.compareAndSet({ expectedRevision: null, stage: STAGE });
    return { appId: "authelia", projectRoot: context.projectRoot, stage: STAGE, username: status.username,
      oneFactorIdentityVerified: true, protectedTargetSsoVerified: false, intendedClientDnsTrustVerified: false,
      restartPersistenceVerified: false, apiTokenCreated: false };
  },
  async inspect(context) {
    const status = appliedStatus(context, await context.status());
    const checkpoint = await context.checkpoint.read();
    if (context.appId !== "authelia" || status.ownerKind !== "shared" || typeof status.username !== "string"
      || !checkpoint || checkpoint.appId !== "authelia" || checkpoint.projectRoot !== context.projectRoot
      || checkpoint.stage !== STAGE) throw new Error("Authelia has no completed owned portal checkpoint");
    await context.secrets.verifyMutableConfigs();
    const saved = await context.secrets.readSessionCookies();
    if (Object.keys(saved).length !== 1 || !privateCookie(saved[COOKIE])
      || !await state(context, status.username, saved[COOKIE])) {
      throw new Error("Authelia saved portal session does not prove its exact one-factor identity");
    }
    return { appId: "authelia", projectRoot: context.projectRoot, stage: STAGE, username: status.username,
      oneFactorIdentityVerified: true, protectedTargetSsoVerified: false, intendedClientDnsTrustVerified: false,
      restartPersistenceVerified: false, apiTokenCreated: false };
  },
  ready(record) { return record.appId === "authelia" && record.stage === STAGE && record.oneFactorIdentityVerified === true; },
  credentialCommand: "app handoff", apiKey: "not-created", healthSource: null, homarrIntegration: null,
};
export default adapter;
