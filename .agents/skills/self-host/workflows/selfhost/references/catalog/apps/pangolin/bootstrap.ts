import type { SetupHttpRequest } from "../../types/setup";

export const PANGOLIN_BOOTSTRAP_SOURCE = "https://raw.githubusercontent.com/fosrl/pangolin/1.24.0/server/routers/auth/setServerAdmin.ts";
const headers = { "Content-Type": "application/json", "x-csrf-token": "x-csrf-protection" };
const id = /^[a-z0-9]{15}$/;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Pangolin response is invalid");
  return value as Record<string, unknown>;
}

function data(value: unknown, httpStatus: number, expectedStatus = 200): unknown {
  const envelope = object(value);
  if (httpStatus !== expectedStatus || envelope.status !== httpStatus || envelope.success !== true
    || envelope.error !== false || typeof envelope.message !== "string" || !("data" in envelope)) {
    throw new Error("Pangolin response is not the expected successful envelope");
  }
  return envelope.data;
}

function credentials(email: string, password: string) {
  if (typeof email !== "string" || email !== email.toLowerCase() || email.length > 254
    || !/^[A-Za-z0-9][A-Za-z0-9._+-]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/.test(email)
    || typeof password !== "string" || password.length < 8 || password.length > 128
    || /[\r\n\u0000]/.test(password)
    || !/^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[~!`@#$%^&*()_\-+={}[\]|\\:;"'<>,.\/?]).*$/.test(password)) {
    throw new Error("Pangolin saved administrator credentials are invalid");
  }
}

function token(value: string) {
  if (typeof value !== "string" || !/^[a-z0-9]{32}$/.test(value)) throw new Error("Pangolin private setup token is invalid");
}

function revision(value: number | null) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new Error("Pangolin checkpoint revision is invalid");
}

/** Pure app-local helpers only: no log capture, recipe, setup adapter or readiness claim.
 * The caller must bind approved HTTPS transport/config and an exact owned service,
 * inspect fresh persistent state, retain secrets privately, and enforce checkpoint CAS.
 * A current-start token log is NOT proof that the persistent state is fresh. */
export function pangolinSetupComplete(value: unknown, httpStatus: number): boolean {
  const result = object(data(value, httpStatus));
  if (typeof result.complete !== "boolean") throw new Error("Pangolin setup completion is invalid");
  return result.complete;
}

export function pangolinTokenValidationRequest(setupToken: string): SetupHttpRequest {
  token(setupToken);
  return { method: "POST", path: "/api/v1/auth/validate-setup-token", headers,
    body: JSON.stringify({ token: setupToken }),
    approval: { action: "validate-setup-token", progress: "Validate the private Pangolin setup capability" } };
}

export function pangolinTokenValid(value: unknown, httpStatus: number): boolean {
  const result = object(data(value, httpStatus));
  if (typeof result.valid !== "boolean" || typeof result.message !== "string") throw new Error("Pangolin token validation is invalid");
  return result.valid;
}

export function pangolinFirstAdminRequest(input: {
  setupComplete: boolean; tokenValid: boolean; freshStateVerified: boolean;
  attempted: boolean; expectedRevision: number | null; email: string; password: string; setupToken: string;
}): SetupHttpRequest {
  if (input.setupComplete !== false || input.tokenValid !== true || input.freshStateVerified !== true
    || typeof input.attempted !== "boolean") throw new Error("Pangolin fresh-owner preconditions are not verified");
  if (input.attempted) throw new Error("Pangolin administrator creation was attempted; inspect and login without replaying");
  revision(input.expectedRevision);
  credentials(input.email, input.password);
  token(input.setupToken);
  return { method: "PUT", path: "/api/v1/auth/set-server-admin", headers,
    body: JSON.stringify({ email: input.email, password: input.password, setupToken: input.setupToken }),
    approval: { action: "create-server-admin", progress: "Create the saved Pangolin administrator once", once: true },
    beforeSendCheckpoint: { expectedRevision: input.expectedRevision, stage: "admin-attempted", data: { email: input.email } } };
}

/** Successful creation output is not identity proof; login and GET /user are required. */
export function pangolinFirstAdminResponse(value: unknown, httpStatus: number): void {
  if (data(value, httpStatus) !== null) throw new Error("Pangolin administrator creation response is invalid; do not replay");
}

export function pangolinLoginRequest(email: string, password: string): SetupHttpRequest {
  credentials(email, password);
  // Do not attach a saved cookie: even forceLogin=true accepts recent sessions.
  return { method: "POST", path: "/api/v1/auth/login", headers,
    body: JSON.stringify({ email, password }),
    approval: { action: "login-server-admin", progress: "Verify the saved Pangolin administrator login" } };
}

/** Caller retains Set-Cookie only in the transport's private origin-bound cookie jar.
 * Reject MFA/email branches (including HTTP 202); null data alone never proves identity. */
export function pangolinLoginResponse(value: unknown, httpStatus: number): void {
  if (data(value, httpStatus) !== null) throw new Error("Pangolin login requires additional authentication");
  if (object(value).message !== "Logged in successfully") throw new Error("Pangolin login did not verify the saved password");
}

export function pangolinOwnedAdminReadback(value: unknown, httpStatus: number, expectedEmail: string, expectedUserId?: string) {
  const user = object(data(value, httpStatus));
  if (typeof expectedEmail !== "string" || expectedEmail !== expectedEmail.toLowerCase()
    || user.email !== expectedEmail || user.username !== expectedEmail
    || typeof user.userId !== "string" || !id.test(user.userId)
    || user.type !== "internal" || user.serverAdmin !== true || user.emailVerified !== true
    || (expectedUserId !== undefined && user.userId !== expectedUserId)) {
    throw new Error("Pangolin authenticated administrator does not match the saved owner");
  }
  return { userId: user.userId, email: expectedEmail, serverAdmin: true as const };
}

/** Root keys are global authority, require separate explicit review and an OSS server.
 * No organization is created here. Once attempted, missing output requires inspection,
 * never another key creation. Save private secret output BEFORE metadata/network reads. */
export function pangolinRootKeyRequest(input: {
  ownedAdmin: ReturnType<typeof pangolinOwnedAdminReadback>; rootKeyApproved: boolean;
  attempted: boolean; expectedRevision: number | null; savedKeyPresent: boolean; name: string;
}): SetupHttpRequest {
  if (!input.ownedAdmin || input.ownedAdmin.serverAdmin !== true || !id.test(input.ownedAdmin.userId)
    || input.rootKeyApproved !== true || typeof input.attempted !== "boolean"
    || typeof input.savedKeyPresent !== "boolean") throw new Error("Pangolin root-key preconditions are not verified");
  if (input.attempted || input.savedKeyPresent) throw new Error("Pangolin root-key creation cannot be replayed; verify the saved key or reconcile privately");
  revision(input.expectedRevision);
  if (typeof input.name !== "string" || input.name.length < 1 || input.name.length > 255 || /[\r\n\u0000]/.test(input.name)) {
    throw new Error("Pangolin root-key name is invalid");
  }
  return { method: "PUT", path: "/api/v1/api-key", headers, body: JSON.stringify({ name: input.name }),
    approval: { action: "create-root-api-key", progress: "Create the approved Pangolin root integration key once", once: true },
    beforeSendCheckpoint: { expectedRevision: input.expectedRevision, stage: "root-key-attempted", data: { email: input.ownedAdmin.email } } };
}

export function pangolinRootKeyResponse(value: unknown, httpStatus: number, expectedName: string) {
  const key = object(data(value, httpStatus, 201));
  if (typeof key.apiKeyId !== "string" || !id.test(key.apiKeyId) || key.name !== expectedName
    || typeof key.apiKey !== "string" || !/^[a-z2-7]{40}$/.test(key.apiKey)
    || key.lastChars !== key.apiKey.slice(-4) || typeof key.createdAt !== "string" || !Number.isFinite(Date.parse(key.createdAt))) {
    throw new Error("Pangolin root-key output is invalid; do not replay creation");
  }
  return { apiKeyId: key.apiKeyId, apiKey: key.apiKey, lastChars: key.lastChars as string,
    createdAt: key.createdAt, name: expectedName };
}

/** Metadata persistence only, NOT proof the secret authenticates or has any actions. */
export function pangolinRootKeyReadback(value: unknown, httpStatus: number,
  saved: Omit<ReturnType<typeof pangolinRootKeyResponse>, "apiKey">): void {
  const key = object(data(value, httpStatus));
  if (key.apiKeyId !== saved.apiKeyId || key.lastChars !== saved.lastChars || key.name !== saved.name
    || key.createdAt !== saved.createdAt || key.isRoot !== true) throw new Error("Pangolin saved root-key metadata does not match");
}
