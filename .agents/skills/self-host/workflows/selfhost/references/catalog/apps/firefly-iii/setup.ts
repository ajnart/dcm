import { isAbsolute } from "node:path";
import { createHash } from "node:crypto";

import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext,
  type SetupHttpResponse, type SetupInspectionContext, type SetupRecord } from "../../types/setup";

const APP_ID = "firefly-iii";
const EMAIL = "admin@example.test";
const TOKEN_NAME = "selfhost-managed";
const VERIFIED = "owner-and-token-verified";

function addCookies(jar: Map<string, string>, response: SetupHttpResponse): void {
  for (const header of response.headers.getSetCookie?.() ?? []) {
    const pair = header.split(";", 1)[0] ?? "";
    const separator = pair.indexOf("=");
    if (separator < 1) throw new Error("Firefly III returned an invalid session cookie");
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) || /[\r\n;]/.test(value) || value.length > 4096
      || (jar.size >= 16 && !jar.has(name))) {
      throw new Error("Firefly III returned an unsafe session cookie");
    }
    jar.set(name, value);
  }
}

function cookies(jar: Map<string, string>): string {
  if (jar.size === 0) throw new Error("Firefly III supplied no private web session");
  if (jar.size > 16 || [...jar.values()].some((value) => value.length > 4096 || /[\r\n;]/.test(value))) {
    throw new Error("Firefly III saved cookies exceed the private session bounds");
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function csrf(page: string): string {
  const token = page.match(/<input\s+[^>]*name="_token"[^>]*value="([A-Za-z0-9]+)"/i)?.[1];
  if (!token || token.length < 20 || token.length > 256) {
    throw new Error("Firefly III's pinned form did not supply a CSRF token");
  }
  return token;
}

type WebSession = { step: "register-pending" | "login-pending" | "authenticated";
  jar: Map<string, string>; csrfToken: string };

async function readSession(context: SetupContext, password: string): Promise<WebSession | null> {
  const saved = await context.secrets.readSessionCookies();
  if (Object.keys(saved).length === 0) return null;
  const digest = createHash("sha256").update(`${EMAIL}\0${password}`).digest("hex");
  if (saved.password_digest !== digest || !["register-pending", "login-pending", "authenticated"].includes(saved.step ?? "")
    || !/^[A-Za-z0-9]{20,256}$/.test(saved.csrf_token ?? "")
    || Object.keys(saved).some((key) => !["password_digest", "csrf_token", "step"].includes(key)
      && !/^cookie_[A-Za-z0-9_-]{1,64}$/.test(key))) {
    throw new Error("Firefly III saved web session differs from the private owner credential");
  }
  const jar = new Map<string, string>();
  for (const [key, value] of Object.entries(saved)) {
    if (key.startsWith("cookie_")) jar.set(key.slice(7), value);
  }
  cookies(jar);
  return { step: saved.step as WebSession["step"], jar, csrfToken: saved.csrf_token! };
}

async function saveSession(context: SetupContext, password: string, session: WebSession): Promise<void> {
  cookies(session.jar);
  await context.secrets.writeSessionCookies({
    password_digest: createHash("sha256").update(`${EMAIL}\0${password}`).digest("hex"),
    step: session.step, csrf_token: session.csrfToken,
    ...Object.fromEntries([...session.jar].map(([name, value]) => [`cookie_${name}`, value])),
  });
}

async function register(context: SetupContext, password: string,
  status: SetupRecord): Promise<void> {
  let session = await readSession(context, password);
  if (session && session.step !== "register-pending") {
    throw new Error("Firefly III has a session without this setup's first-owner checkpoint");
  }
  if (!session) {
    const jar = new Map<string, string>();
    const page = await context.http.request({ method: "GET", path: "/register",
      headers: { Accept: "text/html" } });
    addCookies(jar, page);
    if (page.status !== 200) throw new Error("Firefly III registration page is unavailable");
    const html = await page.text();
    if (!/<form\b[^>]*method="post"/i.test(html) || !/name="password_confirmation"/.test(html)) {
      throw new Error("Firefly III already has an owner or registration is unavailable; do not adopt it");
    }
    session = { step: "register-pending", jar, csrfToken: csrf(html) };
    await saveSession(context, password, session);
  }
  const body = new URLSearchParams({ _token: session.csrfToken, invite_code: "", email: EMAIL,
    password, password_confirmation: password }).toString();
  const response = await context.http.request({ method: "POST", path: "/register",
    headers: { Accept: "text/html", "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies(session.jar) }, body,
    approval: { action: "firefly-iii-create-first-owner", once: true,
      progress: "Register the private Firefly III first owner with the saved password" },
    beforeSendCheckpoint: { expectedRevision: null, stage: "signup-attempted",
      data: { email: EMAIL, credentialRef: status.passwordFile as string,
        ownerManifestHash: status.manifestHash as string } } });
  if (response.status !== 302) {
    throw new Error("Firefly III first-owner outcome is uncertain; inspect before retrying");
  }
  await context.secrets.writeSessionCookies({});
}

async function login(context: SetupContext, password: string, freshRequired = false): Promise<{
  jar: Map<string, string>; csrfToken: string; passwordLoginVerified: boolean;
}> {
  let session = await readSession(context, password);
  // Reconcile registration by independent login, never by resubmitting signup.
  // Fresh proof uses a guest session: an authenticated /login may bypass the
  // password. Persist its pending form across approvals, not the old cookie.
  if (session?.step === "register-pending" || (freshRequired && session?.step === "authenticated")) {
    await context.secrets.writeSessionCookies({});
    session = null;
  }
  if (!session) {
    const jar = new Map<string, string>();
    const page = await context.http.request({ method: "GET", path: "/login",
      headers: { Accept: "text/html" } });
    addCookies(jar, page);
    if (page.status !== 200) throw new Error("Firefly III login form is unavailable");
    const html = await page.text();
    if (!/<form\b[^>]*method="post"/i.test(html) || !/name="password"/.test(html)) {
      throw new Error("Firefly III did not show its pinned web login form");
    }
    session = { step: "login-pending", jar, csrfToken: csrf(html) };
    await saveSession(context, password, session);
  }
  let passwordLoginVerified = false;
  if (session.step === "login-pending") {
    const body = new URLSearchParams({ _token: session.csrfToken, email: EMAIL, password }).toString();
    const response = await context.http.request({ method: "POST", path: "/login",
      headers: { Accept: "text/html", "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookies(session.jar) }, body,
      approval: { action: "firefly-iii-verify-saved-login",
        progress: "Verify the saved Firefly III owner password" } });
    addCookies(session.jar, response);
    if (response.status === 419) {
      await context.secrets.writeSessionCookies({});
      throw new Error("Firefly III saved login form expired; review a new form on the next setup run");
    }
    if (response.status !== 302) throw new Error("Firefly III did not establish a web login");
    passwordLoginVerified = true;
  }
  const profile = await context.http.request({ method: "GET", path: "/profile/change-email",
    headers: { Accept: "text/html", Cookie: cookies(session.jar) } });
  addCookies(session.jar, profile);
  if ([302, 401, 419].includes(profile.status)) {
    await context.secrets.writeSessionCookies({});
    throw new Error("Firefly III saved session was rejected; review a new login on the next setup run");
  }
  if (profile.status !== 200) throw new Error("Firefly III saved login cannot open its owner profile");
  const profileHtml = await profile.text();
  const emailInput = profileHtml.match(/<input\b(?=[^>]*\bid="email")[^>]*>/i)?.[0] ?? "";
  if (!emailInput.includes(`value="${EMAIL}"`)) {
    throw new Error("Firefly III saved login did not identify the managed owner email");
  }
  session = { step: "authenticated", jar: session.jar, csrfToken: csrf(profileHtml) };
  await saveSession(context, password, session);
  return { jar: session.jar, csrfToken: session.csrfToken, passwordLoginVerified };
}

async function initializePersonalGrant(context: SetupContext,
  jar: Map<string, string>): Promise<void> {
  // The pinned OAuthController::index creates the personal-access client when absent.
  // Treat this GET as a write; its upstream count check makes a lost response replayable.
  const response = await context.http.request({ method: "GET", path: "/profile/oauth",
    headers: { Accept: "text/html", Cookie: cookies(jar) },
    approval: { action: "firefly-iii-initialize-personal-grant",
      progress: "Initialize Firefly III's personal-token client if it does not exist" } });
  addCookies(jar, response);
  if (response.status !== 200) {
    throw new Error("Firefly III did not initialize its personal-token client");
  }
}

async function verifyToken(context: SetupContext | SetupInspectionContext): Promise<string> {
  const token = await context.secrets.readApiKey();
  const path = await context.secrets.apiKeyPath();
  if (!token || !path || !isAbsolute(path)) throw new Error("Firefly III has no saved personal token");
  const anonymous = await context.http.request({ method: "GET", path: "/api/v1/about/user",
    headers: { Accept: "application/json" } });
  if (anonymous.status !== 401 && anonymous.status !== 403) {
    throw new Error("Firefly III user API did not deny an anonymous request");
  }
  const response = await context.http.request({ method: "GET", path: "/api/v1/about/user",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
  if (response.status !== 200) throw new Error("Saved Firefly III token cannot read the owner");
  const body = setupRecord(await response.json(), "Firefly III token readback");
  const data = setupRecord(body.data, "Firefly III token user data");
  const attributes = setupRecord(data.attributes, "Firefly III token user");
  if (attributes.email !== EMAIL || attributes.role !== "owner") {
    throw new Error("Saved Firefly III token does not identify the first owner");
  }
  return path;
}

async function registrationClosed(context: SetupContext): Promise<void> {
  const response = await context.http.request({ method: "GET", path: "/register",
    headers: { Accept: "text/html" } });
  if (response.status !== 200) throw new Error("Firefly III registration closure is unproven");
  const html = await response.text();
  if (/name="password_confirmation"/.test(html)
    || !html.includes("Registration is currently not available")) {
    throw new Error("Firefly III still offers public registration or closure is unproven");
  }
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: null,
  ready(record) {
    return record.appId === APP_ID && record.stage === VERIFIED
      && record.email === EMAIL && record.ownerRoleVerified === true
      && record.passwordLoginVerified === true
      && record.registrationClosed === true && typeof record.credentialRef === "string"
      && isAbsolute(record.credentialRef) && typeof record.apiKeyFile === "string"
      && isAbsolute(record.apiKeyFile);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("Firefly III setup received another app");
    const status = appliedStatus(context, await context.status());
    if (status.ownerKind !== "shared" || status.username !== EMAIL
      || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)
      || typeof status.manifestHash !== "string") {
      throw new Error("Firefly III has no exact saved email and password owner");
    }
    const password = await context.secrets.readAdminPassword();
    if (password.length < 16 || password.length > 1024 || /[\r\n\0]/.test(password)) {
      throw new Error("Firefly III saved password is invalid");
    }
    let checkpoint = await context.checkpoint.read();
    if (checkpoint && (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || !["signup-attempted", "token-attempted", VERIFIED].includes(checkpoint.stage)
      || checkpoint.data.email !== EMAIL || checkpoint.data.credentialRef !== status.passwordFile
      || checkpoint.data.ownerManifestHash !== status.manifestHash)) {
      throw new Error("Firefly III first-run checkpoint differs from this owner");
    }
    if (!checkpoint) {
      await register(context, password, status);
      checkpoint = await context.checkpoint.read();
    }
    if (!checkpoint) throw new Error("Firefly III has no saved signup attempt");
    if (checkpoint.stage === "token-attempted" && await context.secrets.readApiKey() === null) {
      throw new Error("Firefly III personal-token result was lost; inspect before retrying");
    }
    // Keep the original authenticated cookie stable while approving the one-time
    // token write. After capture, readiness requires a new password login.
    let session = await login(context, password, checkpoint.stage !== "signup-attempted");
    if (checkpoint.stage === "signup-attempted") {
      await initializePersonalGrant(context, session.jar);
      await saveSession(context, password, { step: "authenticated", jar: session.jar, csrfToken: session.csrfToken });
      const tokenList = await context.http.request({ method: "GET",
        path: "/oauth/personal-access-tokens",
        headers: { Accept: "application/json", Cookie: cookies(session.jar) } });
      if (tokenList.status !== 200) throw new Error("Firefly III token list is unavailable");
      const listed = await tokenList.json();
      if (!Array.isArray(listed) || listed.some((item) =>
        item && typeof item === "object" && (item as Record<string, unknown>).name === TOKEN_NAME)) {
        throw new Error("Firefly III already has a managed token; inspect before creating another");
      }
      const created = await context.http.request({ method: "POST",
        path: "/oauth/personal-access-tokens",
        headers: { Accept: "application/json", "Content-Type": "application/json",
          "X-CSRF-TOKEN": session.csrfToken, Cookie: cookies(session.jar) },
        body: JSON.stringify({ name: TOKEN_NAME }),
        approval: { action: "firefly-iii-create-personal-token", once: true,
          progress: "Create and privately save one Firefly III personal token" },
        beforeSendCheckpoint: { expectedRevision: checkpoint.revision, stage: "token-attempted",
          data: checkpoint.data } });
      if (created.status !== 200) {
        throw new Error("Firefly III token creation outcome is uncertain; inspect before retrying");
      }
      const result = setupRecord(await created.json(), "Firefly III personal token");
      if (typeof result.accessToken !== "string" || result.accessToken.length < 40
        || result.accessToken.length > 8192 || /[\r\n\0]/.test(result.accessToken)) {
        throw new Error("Firefly III returned no usable one-time personal token");
      }
      await context.secrets.writeApiKey(result.accessToken);
      checkpoint = await context.checkpoint.read();
    }
    if (!checkpoint || (checkpoint.stage === "token-attempted"
      && await context.secrets.readApiKey() === null)) {
      throw new Error("Firefly III personal-token result was lost; inspect before retrying");
    }
    if (!session.passwordLoginVerified) session = await login(context, password, true);
    const apiKeyFile = await verifyToken(context);
    await registrationClosed(context);
    if (checkpoint.stage !== VERIFIED) {
      await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
        stage: VERIFIED, data: checkpoint.data });
    }
    return { appId: APP_ID, projectRoot: context.projectRoot, stage: VERIFIED,
      email: EMAIL, credentialRef: status.passwordFile, apiKeyFile,
      ownerRoleVerified: true, registrationClosed: true,
      passwordLoginVerified: session.passwordLoginVerified, passwordLoginPreviouslyVerified: true };
  },
};

export default adapter;
