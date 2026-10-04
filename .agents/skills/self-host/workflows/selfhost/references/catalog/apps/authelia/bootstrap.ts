import { validateAutheliaIdentity, type AutheliaConfigurationInput } from "./configuration.ts";

type Identity = Pick<AutheliaConfigurationInput, "username" | "displayName" | "email">;
export type AutheliaPasswordHasher = {
  hash(password: string): Promise<string>;
  verify(password: string, digest: string): Promise<boolean>;
};

export type AutheliaUserDatabaseObservation =
  | { kind: "absent" }
  | { kind: "present"; parsed: unknown };

export type AutheliaUserDatabasePreparation =
  | { action: "create"; privateContent: string }
  | { action: "reuse" };

/** App-owned decision only. The shared owner must prove absence/ownership,
 * checkpoint and create exclusively; unreadable or invalid files are present,
 * never absence. Existing files return no replacement bytes, even after reset. */
export async function prepareAutheliaUserDatabase(observation: AutheliaUserDatabaseObservation,
  identity: Identity, password: string, hasher: AutheliaPasswordHasher): Promise<AutheliaUserDatabasePreparation> {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
    throw new Error("Authelia needs an explicit owned user database observation");
  }
  const keys = Object.keys(observation).sort().join(",");
  if (observation.kind === "present" && keys === "kind,parsed") {
    await verifyAutheliaUserDatabase(observation.parsed, identity, password, hasher);
    return { action: "reuse" };
  }
  if (observation.kind !== "absent" || keys !== "kind") {
    throw new Error("Authelia needs an explicit owned user database observation");
  }
  return { action: "create", privateContent: await compileAutheliaUserDatabase(identity, password, hasher) };
}

function validateDigest(digest: string): void {
  // Exact bounded Argon2id PHC shape; algorithm execution stays inside the private owner.
  if (!/^\$argon2id\$v=19\$m=65536,t=3,p=[1-4]\$(?:[A-Za-z0-9+/]{22}|[A-Za-z0-9+/]{43})\$[A-Za-z0-9+/]{43}$/.test(digest)) {
    throw new Error("Authelia user digest must use the supported Argon2id parameters");
  }
}

const emptyProfileFields = ["given_name", "middle_name", "family_name", "nickname", "gender",
  "birthdate", "website", "profile", "picture", "zoneinfo", "locale", "phone_number", "phone_extension"];

function unchangedUserFields(user: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(user)) {
    if (["disabled", "displayname", "email", "password", "groups"].includes(key)) continue;
    // Upstream Write serializes these zero-valued fields without omitempty.
    if (emptyProfileFields.includes(key) && value === "") continue;
    if (key === "address" && value === null) continue;
    if (key === "extra" && (value === null || (typeof value === "object"
      && !Array.isArray(value) && Object.keys(value).length === 0))) continue;
    return false;
  }
  return true;
}

/** Returns PRIVATE contents only, never a recipe, status record or checkpoint.
 * Core must create once with proven image-user write access and refuse reseeding. */
export async function compileAutheliaUserDatabase(identity: Identity, password: string,
  hasher: AutheliaPasswordHasher): Promise<string> {
  validateAutheliaIdentity(identity);
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(password)) {
    throw new Error("Authelia needs its exact private generated password");
  }
  const digest = await hasher.hash(password);
  validateDigest(digest);
  if (!await hasher.verify(password, digest)) throw new Error("Authelia password digest verification failed");
  // JSON is a YAML subset. On resume the owner must parse the installed YAML, as
  // upstream password resets can rewrite its format and contents legitimately.
  return JSON.stringify({ users: { [identity.username]: { disabled: false,
    displayname: identity.displayName, password: digest, email: identity.email, groups: [] } } }, null, 2) + "\n";
}

/** Verify parsed installed YAML without ever rewriting it. A reset mismatch stops. */
export async function verifyAutheliaUserDatabase(value: unknown, identity: Identity,
  password: string, hasher: AutheliaPasswordHasher): Promise<void> {
  validateAutheliaIdentity(identity);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).join(",") !== "users") throw new Error("Authelia user database differs");
  const users = (value as Record<string, unknown>).users;
  if (!users || typeof users !== "object" || Array.isArray(users)
    || Object.keys(users).length !== 1) throw new Error("Authelia user database differs");
  const user = (users as Record<string, any>)[identity.username];
  if (!user || typeof user !== "object" || Array.isArray(user) || user.disabled !== false
    || user.displayname !== identity.displayName || user.email !== identity.email
    || !Array.isArray(user.groups) || user.groups.length !== 0 || typeof user.password !== "string"
    || !unchangedUserFields(user)) {
    throw new Error("Authelia user database differs; never reseed changed users");
  }
  validateDigest(user.password);
  if (!await hasher.verify(password, user.password)) {
    throw new Error("Authelia saved password differs from the installed digest; never reseed after reset");
  }
}
