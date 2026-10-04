import { isIP } from "node:net";

export const PASSBOLT_REGISTER_SOURCE = "https://github.com/passbolt/passbolt_api/blob/v5.16.0/src/Command/RegisterUserCommand.php";
export const PASSBOLT_USERS_INDEX_SOURCE = "https://github.com/passbolt/passbolt_api/blob/v5.16.0/src/Command/UsersIndexCommand.php";
export const PASSBOLT_ENVIRONMENT_SOURCE = "https://www.passbolt.com/docs/hosting/configure/environment-reference/";

export type PassboltFirstStartInput = {
  canonicalOrigin: string;
  smtp: { host: string; port: number; fromEmail: string; fromName: string; transport: "starttls" };
  serverKey: { email: string; name: string };
};

function emailIdentity(value: string): boolean {
  return typeof value === "string" && value.length <= 254
    && /^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/.test(value);
}

function displayName(value: string): boolean {
  return typeof value === "string" && value.length <= 200 && !!value.trim()
    && !/[\x00-\x1f\x7f]/.test(value);
}

function exactKeys(value: unknown, keys: string): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === keys;
}

/** Pure pre-start choices, not a recipe or SMTP credential transport. Existing
 * server keys must be reused; changing these subjects never authorizes rotation.
 * STARTTLS only: implicit TLS and owner authentication need separate sourced inputs. */
export function compilePassboltFirstStartEnvironment(input: PassboltFirstStartInput) {
  if (!exactKeys(input, "canonicalOrigin,serverKey,smtp")
    || !exactKeys(input.smtp, "fromEmail,fromName,host,port,transport")
    || !exactKeys(input.serverKey, "email,name")) {
    throw new Error("Passbolt first-start settings must contain only declared non-secret choices");
  }
  const environment = deriveCanonicalEnvironment(input.canonicalOrigin);
  const smtp = input.smtp;
  const hostname = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (typeof smtp.host !== "string" || (!hostname.test(smtp.host) && !isIP(smtp.host))
    || !Number.isInteger(smtp.port) || smtp.port < 1 || smtp.port > 65535
    || smtp.transport !== "starttls" || !emailIdentity(smtp.fromEmail) || !displayName(smtp.fromName)
    || !emailIdentity(input.serverKey.email) || !displayName(input.serverKey.name)) {
    throw new Error("Passbolt needs owner-selected SMTP STARTTLS and server-key identities");
  }
  environment.push(
    { name: "PASSBOLT_SSL_FORCE", value: "true" },
    { name: "EMAIL_DEFAULT_FROM", value: smtp.fromEmail },
    { name: "EMAIL_DEFAULT_FROM_NAME", value: smtp.fromName },
    { name: "EMAIL_TRANSPORT_DEFAULT_HOST", value: smtp.host },
    { name: "EMAIL_TRANSPORT_DEFAULT_PORT", value: String(smtp.port) },
    { name: "EMAIL_TRANSPORT_DEFAULT_TLS", value: "true" },
    { name: "PASSBOLT_KEY_EMAIL", value: input.serverKey.email },
    { name: "PASSBOLT_KEY_NAME", value: input.serverKey.name },
  );
  return environment;
}

export function deriveCanonicalEnvironment(origin: string): Array<{ name: string; value: string }> {
  let url: URL;
  try { url = new URL(origin); }
  catch { throw new Error("Passbolt needs an exact approved HTTPS origin"); }
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash
    || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(url.hostname)) {
    throw new Error("Passbolt needs an exact approved HTTPS origin");
  }
  return [{ name: "APP_FULL_BASE_URL", value: origin }];
}

export type PassboltFirstUser = { email: string; firstName: string; lastName: string };

/** Fixed upstream argv, not su -c interpolation. Core must execute under this
 * exact app's approved www-data runtime profile after checkpointing creation. */
export function compilePassboltRegistration(user: PassboltFirstUser, canonicalOrigin: string) {
  deriveCanonicalEnvironment(canonicalOrigin);
  if (!emailIdentity(user.email) || !displayName(user.firstName) || !displayName(user.lastName)) {
    throw new Error("Passbolt needs the owner-selected first-user email and names");
  }
  return { user: "www-data", argv: ["/usr/share/php/passbolt/bin/cake", "passbolt", "register_user",
    "-u", user.email, "-f", user.firstName, "-l", user.lastName, "-r", "admin"],
    freshnessArgv: ["/usr/share/php/passbolt/bin/cake", "passbolt", "users_index"],
    freshnessSource: PASSBOLT_USERS_INDEX_SOURCE,
    officialUrl: PASSBOLT_REGISTER_SOURCE, canonicalOrigin,
    outputCustody: "private-enrollment-link", expectedRole: "admin", expectedEmail: user.email };
}

/** Fail closed on any user table, localized result, warning or unknown output.
 * The pinned command lists all non-guest users, including deleted identities.
 * No private user-list content is returned to the caller or included in errors. */
export function assertPassboltEmptyOrganization(stdout: string): void {
  const failure = "Passbolt first-admin registration requires a verified empty organization; inspect the existing owner privately";
  if (stdout.length > 16384 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(stdout)) throw new Error(failure);
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.pop() !== "This organization has no registered users.") throw new Error(failure);
  if (lines.length === 0) return;
  const banner = [
    "____                  __          ____",
    String.raw`/ __ \____  _____ ____/ /_  ____  / / /_`,
    "/ /_/ / __ `/ ___/ ___/ __ \\/ __ \\/ / __/",
    "/ ____/ /_/ (__  |__  ) /_/ / /_/ / / /",
    String.raw`/_/    \__,_/____/____/_.___/\____/_/\__/`,
    "Open source password manager for teams",
  ];
  if (lines.length !== banner.length + 1 || !/^-{3,120}$/.test(lines.at(-1)!)
    || banner.some((line, index) => lines[index] !== line)) throw new Error(failure);
}

/** PRIVATE parser, called before any stdout logging. Returns an enrollment
 * credential, never an administrator password, API key or active-user proof. */
export function parsePassboltEnrollmentOutput(stdout: string, canonicalOrigin: string) {
  deriveCanonicalEnvironment(canonicalOrigin);
  if (stdout.length > 16384 || /[\x00\x1b]/.test(stdout)) throw new Error("Passbolt enrollment output is invalid");
  const urls = stdout.match(/https?:\/\/[^\s<>"']+/g) ?? [];
  if (urls.length !== 1) throw new Error("Passbolt needs one private enrollment URL");
  let url: URL;
  try { url = new URL(urls[0]!); }
  catch { throw new Error("Passbolt enrollment URL is invalid"); }
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const path = new RegExp(`^/setup/start/(${uuid})/(${uuid})$`).exec(url.pathname);
  if (url.origin !== canonicalOrigin || url.username || url.password || url.search || url.hash
    || !path || url.href !== urls[0]) throw new Error("Passbolt enrollment URL does not match the exact reviewed origin and path");
  return { enrollmentUrl: url.href, userId: path[1]! };
}
