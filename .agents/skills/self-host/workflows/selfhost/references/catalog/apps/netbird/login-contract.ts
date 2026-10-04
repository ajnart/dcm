import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import type { SetupHttpRequest } from "../../types/setup";

export const NETBIRD_LOGIN_SOURCE = "https://github.com/netbirdio/dex/blob/a163de3129e5/server/handlers.go";
export const NETBIRD_OWNER_READBACK_SOURCE = "https://github.com/netbirdio/netbird/blob/v0.80.0/management/server/http/handlers/users/users_handler.go";
export const NETBIRD_PAT_READBACK_SOURCE = "https://github.com/netbirdio/netbird/blob/v0.80.0/management/server/http/handlers/users/pat_handler.go";
type Request = Pick<SetupHttpRequest, "method" | "path" | "headers" | "body">;
type Login = { canonicalOrigin: string; state: string; nonce: string; verifier: string };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("NetBird readback is invalid");
  return value as Record<string, unknown>;
}
function identifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._~+/-]{1,256}$/.test(value)) throw new Error("NetBird identity is invalid");
}
function login(input: Login) {
  let origin: URL;
  try { origin = new URL(input.canonicalOrigin); }
  catch { throw new Error("NetBird login origin is invalid"); }
  if (origin.protocol !== "https:" || origin.origin !== input.canonicalOrigin || origin.port === "0"
    || origin.username || origin.password || !origin.hostname.includes(".")) throw new Error("NetBird login requires the reviewed HTTPS origin");
  for (const value of [input.state, input.nonce]) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(value)) throw new Error("NetBird login needs private random state and nonce");
  }
  if (typeof input.verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier)) throw new Error("NetBird login PKCE verifier is invalid");
  return `${origin.origin}/nb-auth`;
}
function form(path: string, values: Record<string, string>): Request {
  return { method: "POST", path, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values).toString() };
}
function redirect(status: number, location: string, origin: string) {
  if (![302, 303].includes(status) || typeof location !== "string" || /[\r\n\u0000]/.test(location)) throw new Error("NetBird login did not return the expected redirect");
  let url: URL;
  try { url = new URL(location, origin); }
  catch { throw new Error("NetBird login redirect is invalid"); }
  if (url.origin !== origin || url.username || url.password || url.hash) throw new Error("NetBird login redirect left the reviewed origin");
  return url;
}
function single(url: URL, key: string) {
  const values = url.searchParams.getAll(key);
  if (values.length !== 1 || !values[0]) throw new Error("NetBird login redirect parameters are invalid");
  return values[0];
}

/** Pure private-boundary contract only. Use trusted TLS, redirect:manual and a
 * fresh private cookie jar. Never reuse an existing authenticated session.
 * State/nonce/verifier must be independently random, retained for this attempt. */
export function netbirdOwnerLoginRequest(input: Login): Request {
  const redirectUri = login(input);
  const query = new URLSearchParams({ client_id: "netbird-dashboard", redirect_uri: redirectUri,
    response_type: "code", scope: "openid profile email", state: input.state, nonce: input.nonce,
    prompt: "login", code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(input.verifier).digest("base64url") });
  return { method: "GET", path: `/oauth2/auth/local?${query}`, headers: {} };
}

/** The server auth-request state is distinct from the caller's OAuth state.
 * A 200 login page (bad password), MFA or approval redirect fails closed. */
export function netbirdOwnerPasswordRequest(input: Login & { status: number; location: string; email: string; password: string }): Request {
  login(input);
  const url = redirect(input.status, input.location, input.canonicalOrigin);
  if (url.pathname !== "/oauth2/auth/local/login" || [...url.searchParams.keys()].some(key => key !== "state" && key !== "back")) throw new Error("NetBird local password redirect is invalid");
  const state = single(url, "state");
  identifier(state);
  if (typeof input.email !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._+-]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/.test(input.email)
    || input.email.length > 254 || typeof input.password !== "string" || Buffer.byteLength(input.password) < 8
    || Buffer.byteLength(input.password) > 72 || /[\r\n\u0000]/.test(input.password)) throw new Error("NetBird saved owner credentials are invalid");
  return form(`/oauth2/auth/local/login?${new URLSearchParams({ state })}`, { login: input.email, password: input.password });
}

/** One-use code exchange. On lost output start a NEW login, not owner/PAT creation. */
export function netbirdOwnerTokenRequest(input: Login & { status: number; location: string }): Request {
  const redirectUri = login(input);
  const url = redirect(input.status, input.location, input.canonicalOrigin);
  if (url.pathname !== "/nb-auth" || [...url.searchParams.keys()].some(key => key !== "state" && key !== "code")
    || single(url, "state") !== input.state) throw new Error("NetBird owner login callback does not match this attempt");
  const code = single(url, "code");
  identifier(code);
  return form("/oauth2/token", { grant_type: "authorization_code", client_id: "netbird-dashboard",
    redirect_uri: redirectUri, code, code_verifier: input.verifier });
}

/** Shape validation only, NOT JWT signature verification or identity proof.
 * Do not persist/report this temporary token. Management readback must accept
 * it, and callers needing OIDC claims must independently validate the ID token. */
export function netbirdOwnerTokenResponse(value: unknown) {
  const response = record(value);
  if (response.token_type !== "bearer" || !Number.isSafeInteger(response.expires_in)
    || (response.expires_in as number) <= 0 || typeof response.access_token !== "string"
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(response.access_token)
    || response.access_token.length > 16384) throw new Error("NetBird owner login token response is invalid");
  return { accessToken: response.access_token, expiresIn: response.expires_in as number };
}

export function netbirdOwnerReadbackRequests(input: { authorization: "Bearer" | "Token"; token: string; userId: string }): Request[] {
  identifier(input.userId);
  if (!["Bearer", "Token"].includes(input.authorization) || typeof input.token !== "string"
    || input.token.length < 1 || input.token.length > 16384 || /[\s\u0000]/.test(input.token)) throw new Error("NetBird private authorization is invalid");
  const headers = { Authorization: `${input.authorization} ${input.token}` };
  return [{ method: "GET", path: "/api/users/current", headers },
    { method: "GET", path: `/api/users/${encodeURIComponent(input.userId)}/tokens`, headers }];
}

/** Only pass an authenticated successful management response. After lost setup
 * output, a fresh saved-password login can recover identity, never the lost PAT. */
export function netbirdOwnerReadback(value: unknown, expected: { email: string; userId?: string }) {
  const user = record(value);
  identifier(user.id);
  if (typeof expected.email !== "string" || user.email !== expected.email
    || (expected.userId !== undefined && user.id !== expected.userId) || user.role !== "owner"
    || user.status !== "active" || user.is_current !== true || user.is_blocked !== false
    || user.is_service_user !== false || user.pending_approval !== false || user.idp_id !== "local") throw new Error("NetBird authenticated owner identity does not match");
  return { userId: user.id, email: expected.email, role: "owner", patScope: "inherits-owner-permissions" };
}

/** Metadata is not a recoverable secret or cryptographic association with the
 * presented PAT. Require the retained bootstrap time window and unique result;
 * save the ID for later readback. Missing/expired output NEVER requests a new PAT. */
export function netbirdSetupPatReadback(value: unknown, expected: { userId: string; attemptedAt: number; completedAt: number; now: number; tokenId?: string }) {
  identifier(expected.userId);
  if (!Array.isArray(value) || ![expected.attemptedAt, expected.completedAt, expected.now].every(Number.isSafeInteger)
    || expected.attemptedAt > expected.completedAt || expected.completedAt > expected.now) throw new Error("NetBird setup PAT evidence window is invalid");
  const matches = value.map(record).filter(pat => pat.name === "setup-token" && pat.created_by === expected.userId);
  if (matches.length !== 1) throw new Error("NetBird setup PAT metadata is missing or ambiguous; do not create another token");
  const pat = matches[0];
  identifier(pat.id);
  const timestamp = (value: unknown) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
    return Date.parse(value);
  };
  const created = timestamp(pat.created_at);
  const expires = timestamp(pat.expiration_date);
  // AddDate uses the server's local calendar: one day may cross DST (23/25h).
  if (!Number.isFinite(created) || !Number.isFinite(expires) || created < expected.attemptedAt
    || created > expected.completedAt || expires <= expected.now || expires - created < 23 * 3600000
    || expires - created > 25 * 3600000 || (expected.tokenId !== undefined && pat.id !== expected.tokenId)) throw new Error("NetBird setup PAT identity or one-day expiry does not match; do not create another token");
  return { tokenId: pat.id, createdAt: pat.created_at as string, expirationDate: pat.expiration_date as string,
    scope: "inherits-owner-permissions", secretRecoverable: false };
}
