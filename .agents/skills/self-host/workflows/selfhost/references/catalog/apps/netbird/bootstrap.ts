import { Buffer } from "node:buffer";
import { NETBIRD_SETUP_SOURCE } from "./configuration";
import type { SetupHttpRequest } from "../../types/setup";

export const NETBIRD_BOOTSTRAP_SCHEMA_SOURCE = "https://raw.githubusercontent.com/netbirdio/netbird/v0.80.0/shared/management/http/api/types.gen.go";
export const NETBIRD_BOOTSTRAP_SOURCE = NETBIRD_SETUP_SOURCE;

// Resume uses the saved password, not another setup POST or PAT creation.
// The setup adapter consumes these contracts through the exact saved HTTPS owner.
export { netbirdOwnerLoginRequest, netbirdOwnerPasswordRequest, netbirdOwnerTokenRequest,
  netbirdOwnerTokenResponse, netbirdOwnerReadbackRequests, netbirdOwnerReadback,
  netbirdSetupPatReadback } from "./login-contract";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("NetBird bootstrap response is invalid");
  return value as Record<string, unknown>;
}

/** Private-boundary request helper, not an independent readiness claim.
 * Caller must bind a reviewed configuration/owner, checkpoint before send, and
 * retain the same request for approval. Attempted writes are never replayed. */
export function netbirdFirstOwnerRequest(input: {
  instance: unknown; attempted: boolean; email: string; password: string; setupPatEnabled: boolean;
}): Pick<SetupHttpRequest, "method" | "path" | "headers" | "body"> {
  const instance = object(input.instance);
  if (typeof input.attempted !== "boolean" || typeof instance.setup_required !== "boolean"
    || typeof input.setupPatEnabled !== "boolean") throw new Error("NetBird bootstrap preconditions are invalid");
  if (input.attempted) throw new Error("NetBird owner creation was attempted; inspect without replaying");
  if (!instance.setup_required) throw new Error("NetBird already has an owner; verify saved credentials instead");
  if (typeof input.email !== "string" || input.email.length > 254
    || !/^[A-Za-z0-9][A-Za-z0-9._+-]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/.test(input.email)
    || typeof input.password !== "string" || Buffer.byteLength(input.password, "utf8") < 8
    || Buffer.byteLength(input.password, "utf8") > 72
    || /[\r\n\u0000]/.test(input.password)) throw new Error("NetBird saved owner credentials are invalid");
  const json: Record<string, string | boolean | number> = { email: input.email, password: input.password, name: input.email };
  if (input.setupPatEnabled) { json.create_pat = true; json.pat_expire_in = 1; }
  return { method: "POST", path: "/api/setup", headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) };
}

/** Secret-bearing return value: save PAT privately BEFORE any network readback.
 * Matching creation output is not authenticated login or administrator proof. */
export function netbirdFirstOwnerResponse(value: unknown, expectedEmail: string, expectPat: boolean) {
  const response = object(value);
  if (typeof expectPat !== "boolean" || typeof expectedEmail !== "string") throw new Error("NetBird bootstrap expected identity is invalid");
  if (response.email !== expectedEmail || typeof response.user_id !== "string"
    || response.user_id.length < 1 || response.user_id.length > 256 || /[\s\u0000]/.test(response.user_id)) {
    throw new Error("NetBird bootstrap owner response does not match the saved identity");
  }
  let personalAccessToken: string | null = null;
  if (expectPat) {
    if (typeof response.personal_access_token !== "string" || response.personal_access_token.length < 1
      || response.personal_access_token.length > 4096 || /[\s\u0000]/.test(response.personal_access_token)) {
      throw new Error("NetBird requested setup PAT was not returned; do not replay owner creation");
    }
    personalAccessToken = response.personal_access_token;
  } else if (response.personal_access_token !== undefined && response.personal_access_token !== null) {
    throw new Error("NetBird returned an unexpected setup PAT; private reconciliation is required");
  }
  return { userId: response.user_id, email: expectedEmail, personalAccessToken };
}
