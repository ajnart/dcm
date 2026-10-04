import type { AutheliaConfigurationInput } from "./configuration.ts";

export const AUTHELIA_LOGIN_SOURCE = "https://github.com/authelia/authelia/blob/v4.39.25/internal/handlers/handler_firstfactor_password.go";
export const AUTHELIA_STATE_SOURCE = "https://github.com/authelia/authelia/blob/v4.39.25/internal/handlers/handler_state.go";

export const autheliaLoginContract = {
  method: "POST", path: "/api/firstfactor",
  privateFields: ["username", "password"],
  fixedFields: { keepMeLoggedIn: false },
  readback: { method: "GET", path: "/api/state" },
} as const;

/** The common HTTPS transport must retain the fresh login session privately.
 * Validate its state response; HTTP 200 or display name alone is not identity. */
export function verifyAutheliaLoginState(value: unknown,
  identity: Pick<AutheliaConfigurationInput, "username">): void {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(identity.username)) throw new Error("Authelia authenticated identity is invalid");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Authelia authenticated identity readback differs");
  }
  const response = value as Record<string, unknown>;
  const data = response.data;
  if (response.status !== "OK" || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Authelia authenticated identity readback differs");
  }
  const state = data as Record<string, unknown>;
  if (state.username !== identity.username || state.authentication_level !== 1 || state.factor_knowledge !== true) {
    throw new Error("Authelia authenticated identity readback differs");
  }
}
