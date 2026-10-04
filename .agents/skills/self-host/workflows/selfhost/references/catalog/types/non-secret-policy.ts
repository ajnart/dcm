const credentialLoggingName = /^[A-Z][A-Z0-9_]*_LOG_CREDENTIALS$/;

/** Fixed public OIDC metadata, never AUTH_* credentials or arbitrary exceptions. */
export function isPublicOidcEnvironment(name: unknown, value: unknown): boolean {
  if (typeof value !== "string" || value.length < 1 || value.length > 300
    || /[\x00-\x1f\x7f\\]/.test(value)) return false;
  if (name === "AUTH_CLIENT_ID" || name === "AUTH_AUDIENCE") {
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
  }
  if (name === "AUTH_SUPPORTED_SCOPES") {
    return /^[A-Za-z][A-Za-z0-9._:-]{0,63}(?: [A-Za-z][A-Za-z0-9._:-]{0,63}){0,15}$/.test(value);
  }
  if (name !== "AUTH_AUTHORITY" && name !== "AUTH_REDIRECT_URI" && name !== "AUTH_SILENT_REDIRECT_URI") return false;
  let url: URL;
  try { url = new URL(value, "https://oidc-policy.invalid"); }
  catch { return false; }
  if (url.username || url.password || url.search || url.hash) return false;
  if (name === "AUTH_AUTHORITY") {
    return value.startsWith("https://") && url.protocol === "https:"
      && !!url.hostname && url.port !== "0"
      && (value === `${url.origin}${url.pathname}` || value === url.origin);
  }
  return value.startsWith("/") && !value.includes("//")
    && url.origin === "https://oidc-policy.invalid" && url.pathname === value
    && !/%(?:2f|5c|2e)/i.test(value);
}

/** Server-key subjects are public identity, not key material. Never waive the
 * private/public key paths, fingerprints, passphrases or arbitrary PASSBOLT_ vars. */
export function isPassboltNonSecretIdentity(name: unknown, value: unknown): boolean {
  if (name === "PASSBOLT_SSL_FORCE") return value === "true";
  if (name === "PASSBOLT_KEY_EMAIL") {
    return typeof value === "string" && value.length <= 254
      && /^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/.test(value);
  }
  if (name === "PASSBOLT_KEY_NAME") {
    return typeof value === "string" && value.length <= 200 && !!value.trim()
      && !/[\x00-\x1f\x7f]/.test(value);
  }
  return false;
}

export function isCredentialLoggingPolicy(name: unknown): boolean {
  return typeof name === "string" && credentialLoggingName.test(name);
}

/** The only accepted credential-logging policy disables logging; never a credential payload. */
export function isDisabledCredentialLoggingPolicy(name: unknown, value: unknown): boolean {
  return isCredentialLoggingPolicy(name) && value === "false";
}
