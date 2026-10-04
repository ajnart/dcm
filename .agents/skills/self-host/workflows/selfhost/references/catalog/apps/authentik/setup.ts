import { createHash } from "node:crypto";

import {
  appliedStatus,
  setupRecord,
  type SetupAdapter,
  type SetupContext,
  type SetupInspectionContext,
  type SetupHttpResponse,
  type SetupRecord,
} from "../../types/setup";

const APP_ID = "authentik";
const USERNAME = "akadmin";
const PATH = "/api/v3/core/users/me/";
const FLOW = "/api/v3/flows/executor/default-authentication-flow/";
const VERIFIED = "admin-password-and-token-verified";

function currentUser(response: unknown): boolean {
  const result = setupRecord(response, "authentik current user");
  const user = setupRecord(result.user, "authentik current user identity");
  return user.username === USERNAME && user.is_superuser === true;
}

function addCookies(jar: Map<string, string>, response: SetupHttpResponse): void {
  const cookies = response.headers.getSetCookie?.() ?? [];
  for (const header of cookies) {
    const pair = header.split(";", 1)[0];
    if (!pair) continue;
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) || /[\r\n;]/.test(value) || value.length > 4096) {
      throw new Error("authentik returned an invalid session cookie");
    }
    if (jar.size >= 16 && !jar.has(name)) throw new Error("authentik returned too many session cookies");
    jar.set(name, value);
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function followFlow(context: SetupInspectionContext, jar: Map<string, string>,
  initial: SetupHttpResponse): Promise<SetupRecord> {
  let response = initial;
  for (let redirectCount = 0; redirectCount < 4 && response.status >= 300 && response.status < 400; redirectCount++) {
    const location = response.headers.get("location");
    if (!location) throw new Error("authentik flow redirect omitted a safe local location");
    const parsed = new URL(location, "http://127.0.0.1");
    if (parsed.origin !== "http://127.0.0.1" || parsed.pathname !== FLOW || parsed.hash) {
      throw new Error("authentik flow redirected outside the expected executor");
    }
    const query: Record<string, string> = {};
    for (const [key, value] of parsed.searchParams) {
      if (Object.hasOwn(query, key)) throw new Error("authentik flow returned duplicate query keys");
      query[key] = value;
    }
    response = await context.http.request({ method: "GET", path: FLOW, query,
      headers: { Accept: "application/json", Cookie: cookieHeader(jar) } });
    addCookies(jar, response);
  }
  if (response.status !== 200) throw new Error("authentik flow did not return a challenge");
  return setupRecord(await response.json(), "authentik flow challenge");
}

async function verifyPassword(context: SetupContext, password: string): Promise<void> {
  const jar = new Map<string, string>();
  const digest = createHash("sha256").update(password).digest("hex");
  const saved = await context.secrets.readSessionCookies();
  let component = saved.component;
  if (Object.keys(saved).length > 0) {
    if (saved.password_digest !== digest
      || !["ak-stage-identification", "ak-stage-password", "xak-flow-redirect"].includes(component)
      || Object.keys(saved).some((key) => !["component", "password_digest"].includes(key)
        && !/^cookie_[A-Za-z0-9_-]{1,64}$/.test(key))) {
      throw new Error("authentik saved flow differs from the private administrator credential");
    }
    for (const [key, value] of Object.entries(saved)) {
      if (key.startsWith("cookie_")) jar.set(key.slice(7), value);
    }
    if (jar.size === 0 || jar.size > 16 || [...jar.values()].some((value) =>
      value.length > 4096 || /[\r\n;]/.test(value))) {
      throw new Error("authentik saved flow has invalid session cookies");
    }
  }
  async function saveChallenge(challenge: SetupRecord): Promise<void> {
    const errors = challenge.response_errors;
    if ((errors !== undefined && (!errors || typeof errors !== "object"
      || Array.isArray(errors) || Object.keys(errors).length > 0))
      || typeof challenge.component !== "string"
      || !["ak-stage-identification", "ak-stage-password", "xak-flow-redirect"].includes(challenge.component)) {
      throw new Error("authentik requires an unsupported or rejected login stage");
    }
    component = challenge.component;
    await context.secrets.writeSessionCookies({ component, password_digest: digest,
      ...Object.fromEntries([...jar].map(([name, value]) => [`cookie_${name}`, value])) });
  }
  if (!component) {
    const initial = await context.http.request({ method: "GET", path: FLOW,
      headers: { Accept: "application/json" } });
    addCookies(jar, initial);
    const challenge = await followFlow(context, jar, initial);
    if (challenge.component !== "ak-stage-identification") {
      throw new Error("authentik did not begin with the expected identification stage");
    }
    await saveChallenge(challenge);
  }
  for (const expected of ["ak-stage-identification", "ak-stage-password"] as const) {
    if (component === "xak-flow-redirect") break;
    if (expected === "ak-stage-identification" && component === "ak-stage-password") continue;
    if (component !== expected) {
      throw new Error(`authentik requires an unsupported or rejected login stage before ${component}`);
    }
    let body: Record<string, string> = { component: expected, password };
    if (expected === "ak-stage-identification") body = { component: expected, uid_field: USERNAME };
    const response = await context.http.request({ method: "POST", path: FLOW,
      headers: { Accept: "application/json", "Content-Type": "application/json", Cookie: cookieHeader(jar) },
      body: JSON.stringify(body),
      approval: { action: "authentik-verify-password-login", progress: "Verify the saved authentik administrator password" } });
    addCookies(jar, response);
    const challenge = await followFlow(context, jar, response);
    let next = "xak-flow-redirect";
    if (expected === "ak-stage-identification") next = "ak-stage-password";
    if (challenge.component !== next) {
      throw new Error("authentik login needs another or rejected stage; inspect the protected flow");
    }
    await saveChallenge(challenge);
  }
  if (component !== "xak-flow-redirect") {
    throw new Error("authentik login needs another stage; use the protected browser flow");
  }
  const verified = await context.http.request({ method: "GET", path: PATH,
    headers: { Accept: "application/json", Cookie: cookieHeader(jar) } });
  if (verified.status === 401) {
    await context.secrets.writeSessionCookies({});
    throw new Error("authentik saved session expired; review a new password flow on the next run");
  }
  if (verified.status !== 200 || !currentUser(await verified.json())) {
    throw new Error("authentik password flow did not establish the expected administrator session");
  }
  // Preserve the session through deferred steps, but start a fresh password
  // flow after a completed run instead of treating a cached session as login.
  await context.secrets.writeSessionCookies({});
}

async function probe(context: SetupInspectionContext): Promise<SetupRecord> {
  const token = await context.secrets.readApiKey();
  const apiKeyFile = await context.secrets.apiKeyPath();
  if (!token || !/^[A-Za-z0-9]{48,128}$/.test(token) || !apiKeyFile) {
    throw new Error("authentik has no saved bootstrap API token");
  }
  const anonymous = await context.http.request({ method: "GET", path: PATH });
  if (anonymous.status === 200) {
    const identity = setupRecord(await anonymous.json(), "authentik anonymous session");
    const user = setupRecord(identity.user, "authentik anonymous identity");
    if (user.username === USERNAME || user.is_superuser === true) {
      throw new Error("authentik anonymous request has administrator identity");
    }
  } else if (anonymous.status !== 401 && anonymous.status !== 403) {
    throw new Error("authentik anonymous current-user response is unexpected");
  }
  const authenticated = await context.http.request({
    method: "GET", path: PATH, headers: { Authorization: `Bearer ${token}` },
  });
  if (authenticated.status !== 200) {
    throw new Error("authentik did not authenticate the saved bootstrap token");
  }
  if (!currentUser(await authenticated.json())) {
    throw new Error("authentik token does not identify the expected administrator");
  }
  return {
    appId: APP_ID, projectRoot: context.projectRoot,
    stage: "bootstrap-token-verified", adminUsername: USERNAME,
    apiKeyFile, anonymousNotAdmin: true, tokenVerified: true,
    passwordLoginVerified: false,
  };
}

async function inspect(context: SetupInspectionContext): Promise<SetupRecord> {
  const token = await probe(context);
  const checkpoint = await context.checkpoint.read();
  if (checkpoint?.stage !== VERIFIED || checkpoint.data.apiKeyFile !== token.apiKeyFile) {
    throw new Error("authentik has no matching saved password-login proof");
  }
  // The checkpoint proves a past login, not that the current saved password
  // still works. The read-only inspection interface cannot repeat the flow's
  // POST challenges; a new approved setup run must do that verification.
  return { ...token, passwordLoginPreviouslyVerified: true };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  async firstRun(context) {
    appliedStatus(context, await context.status());
    const token = await probe(context);
    const password = await context.secrets.readAdminPassword();
    if (!/^[A-Za-z0-9]{48,128}$/.test(password)) {
      throw new Error("authentik has no saved administrator password");
    }
    await verifyPassword(context, password);
    const previous = await context.checkpoint.read();
    if (previous && (previous.stage !== VERIFIED || previous.data.apiKeyFile !== token.apiKeyFile)) {
      throw new Error("authentik saved login checkpoint differs from the current token");
    }
    if (!previous) {
      await context.checkpoint.compareAndSet({ expectedRevision: null, stage: VERIFIED,
        data: { apiKeyFile: token.apiKeyFile as string } });
    }
    return { ...token, stage: VERIFIED, passwordLoginVerified: true };
  },
  inspect,
  ready(status) {
    return status.appId === APP_ID && status.stage === VERIFIED
      && status.adminUsername === USERNAME && status.anonymousNotAdmin === true
      && status.tokenVerified === true && status.passwordLoginVerified === true;
  },
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: null,
};

export default adapter;
