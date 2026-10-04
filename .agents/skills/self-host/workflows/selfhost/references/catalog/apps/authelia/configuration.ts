import { createHash } from "node:crypto";

export const AUTHELIA_IMAGE = "docker.io/authelia/authelia:4.39.25@sha256:a039d87fb842f0af4f83c03434f5fb6ec45d4b46e86b8b3ac571cc104bbe6e6d";
export const AUTHELIA_SESSION_SOURCE = "https://github.com/authelia/authelia/blob/v4.39.25/internal/configuration/validator/session.go";
export const AUTHELIA_USER_DATABASE_SOURCE = "https://github.com/authelia/authelia/blob/v4.39.25/internal/authentication/file_user_provider_database.go";
const fqdn = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const quote = JSON.stringify;

function httpsOrigin(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Authelia needs an exact approved HTTPS origin"); }
  if (url.protocol !== "https:" || url.origin !== value || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash || !fqdn.test(url.hostname)) {
    throw new Error("Authelia needs an exact approved HTTPS origin");
  }
  return url;
}

export type AutheliaConfigurationInput = {
  canonicalOrigin: string;
  cookieDomain: string;
  protectedOrigin: string;
  username: string;
  displayName: string;
  email: string;
  /** Explicit local notifier choice; notification contents require private custody. */
  notifier: "filesystem";
};

export function validateAutheliaIdentity(input: Pick<AutheliaConfigurationInput,
  "username" | "displayName" | "email">): void {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(input.username)
    || !input.displayName.trim() || input.displayName.length > 200 || /[\x00-\x1f\x7f]/.test(input.displayName)
    || !/^[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+$/.test(input.email)
    || input.email.length > 254) throw new Error("Authelia needs the owner-selected bounded user identity");
}

/** Pure compiler, not TLS provisioning. The caller must supply a real PSL/special-use
 * classifier; an owner assertion or small handcrafted suffix list is insufficient. */
export function compileAutheliaConfiguration(input: AutheliaConfigurationInput,
  isPublicOrSpecialSuffix: (domain: string) => boolean) {
  const portal = httpsOrigin(input.canonicalOrigin);
  const target = httpsOrigin(input.protectedOrigin);
  const domain = input.cookieDomain;
  validateAutheliaIdentity(input);
  if (typeof isPublicOrSpecialSuffix !== "function") {
    throw new Error("Authelia needs a real PSL/special-use classifier");
  }
  const excludedDomain = isPublicOrSpecialSuffix(domain);
  if (!fqdn.test(domain) || domain === "localhost" || domain.endsWith(".localhost")
    || typeof excludedDomain !== "boolean" || excludedDomain
    || !(portal.hostname === domain || portal.hostname.endsWith(`.${domain}`))
    || !(target.hostname === domain || target.hostname.endsWith(`.${domain}`))
    || portal.hostname === target.hostname || input.notifier !== "filesystem") {
    throw new Error("Authelia needs an eligible cookie domain, distinct protected target and explicit notifier");
  }
  const content = `server:
  address: tcp://0.0.0.0:9091/
log:
  level: info
authentication_backend:
  file:
    path: /var/lib/authelia-users/users_database.yml
access_control:
  default_policy: deny
  rules:
    - domain: ${quote(target.hostname)}
      subject: ${quote(`user:${input.username}`)}
      policy: one_factor
session:
  cookies:
    - domain: ${quote(domain)}
      authelia_url: ${quote(input.canonicalOrigin)}
      default_redirection_url: ${quote(input.protectedOrigin)}
storage:
  local:
    path: /var/lib/authelia/db.sqlite3
notifier:
  filesystem:
    filename: /var/lib/authelia/notification.txt
`;
  const fileEnvironment = [
    { name: "AUTHELIA_SESSION_SECRET_FILE", fileId: "session-secret" },
    { name: "AUTHELIA_STORAGE_ENCRYPTION_KEY_FILE", fileId: "storage-key" },
    { name: "AUTHELIA_IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET_FILE", fileId: "reset-secret" },
  ];
  return { content, fileEnvironment, canonicalOrigin: input.canonicalOrigin,
    protectedOrigin: input.protectedOrigin, cookieDomain: domain,
    configSha256: createHash("sha256").update(content).digest("hex"),
    writableUserDatabase: { target: "/var/lib/authelia-users/users_database.yml", source: AUTHELIA_USER_DATABASE_SOURCE },
    notifierCustody: "private-filesystem", readiness: "login-and-protected-route-unverified" };
}
