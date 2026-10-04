import assert from "node:assert/strict";
import { compileAutheliaConfiguration } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/authelia/configuration.ts";
import { compileAutheliaUserDatabase, prepareAutheliaUserDatabase, verifyAutheliaUserDatabase } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/authelia/bootstrap.ts";
import { autheliaLoginContract, verifyAutheliaLoginState } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/authelia/login-contract.ts";

const input = { canonicalOrigin: "https://auth.example.net", cookieDomain: "example.net",
  protectedOrigin: "https://photos.example.net", username: "owner", displayName: "Selected Owner",
  email: "owner@example.net", notifier: "filesystem" as const };
// Classifier is injected by the shared owner, not an application-specific PSL approximation.
const suffix = (domain: string) => ["co.uk", "duckdns.org"].includes(domain);
const config = compileAutheliaConfiguration(input, suffix);
assert.match(config.content, /default_policy: deny/);
assert.match(config.content, /subject: "user:owner"/);
assert.match(config.content, /authelia_url: "https:\/\/auth.example.net"/);
assert.equal(config.fileEnvironment.length, 3);
assert.equal(config.writableUserDatabase.target, "/var/lib/authelia-users/users_database.yml");
assert.ok(config.fileEnvironment.some((binding) => binding.name === "AUTHELIA_STORAGE_ENCRYPTION_KEY_FILE"));
assert.throws(() => compileAutheliaConfiguration(input, (() => undefined) as any));
assert.throws(() => compileAutheliaConfiguration(input, undefined as any));
for (const patch of [{ canonicalOrigin: "http://auth.example.net" }, { canonicalOrigin: `${input.canonicalOrigin}/` },
  { cookieDomain: "localhost", canonicalOrigin: "https://auth.localhost" },
  { cookieDomain: "duckdns.org", canonicalOrigin: "https://auth.duckdns.org", protectedOrigin: "https://photos.duckdns.org" },
  { cookieDomain: "co.uk", canonicalOrigin: "https://auth.co.uk", protectedOrigin: "https://photos.co.uk" },
  { cookieDomain: "other.net" }, { protectedOrigin: input.canonicalOrigin },
  { protectedOrigin: "https://photos.other.net" }, { email: "" }, { username: "owner\nadmin" }]) {
  assert.throws(() => compileAutheliaConfiguration({ ...input, ...patch }, suffix));
}
// Synthetic injected hasher exercises private compile/resume contracts, not cryptographic implementation.
const password = "a".repeat(48);
const digest = `$argon2id$v=19$m=65536,t=3,p=4$${"A".repeat(22)}$${"B".repeat(43)}`;
const hasher = { async hash(value: string) { assert.equal(value, password); return digest; },
  async verify(value: string, hash: string) { return value === password && hash === digest; } };
const content = await compileAutheliaUserDatabase(input, password, hasher);
const fresh = await prepareAutheliaUserDatabase({ kind: "absent" }, input, password, hasher);
assert.equal(fresh.action, "create");
assert.ok("privateContent" in fresh && fresh.privateContent === content);
const neverHash = { ...hasher, async hash(): Promise<string> { throw new Error("must not reseed"); } };
const installed = JSON.parse(content);
const before = JSON.stringify(installed);
assert.deepEqual(await prepareAutheliaUserDatabase({ kind: "present", parsed: installed },
  input, password, neverHash), { action: "reuse" });
assert.equal(JSON.stringify(installed), before);
for (const parsed of [null, undefined, {}, { users: {} }, { users: { ...installed.users, other: installed.users.owner } }]) {
  await assert.rejects(prepareAutheliaUserDatabase({ kind: "present", parsed }, input, password, neverHash));
}
await assert.rejects(prepareAutheliaUserDatabase({ kind: "present", parsed: installed },
  input, "b".repeat(48), neverHash), /never reseed/);
for (const observation of [undefined, null, {}, { kind: "absent", parsed: installed }, { kind: "present" }]) {
  await assert.rejects(prepareAutheliaUserDatabase(observation as any, input, password, neverHash));
}
assert.equal(content.includes(password), false);
assert.equal(config.content.includes(digest), false);
await verifyAutheliaUserDatabase(JSON.parse(content), input, password, hasher);
// Pinned upstream YAML Write adds empty profile fields, null address and empty extra.
const rewritten = JSON.parse(content);
Object.assign(rewritten.users.owner, { given_name: "", middle_name: "", family_name: "", nickname: "",
  gender: "", birthdate: "", website: "", profile: "", picture: "", zoneinfo: "", locale: "",
  phone_number: "", phone_extension: "", address: null, extra: {} });
await verifyAutheliaUserDatabase(rewritten, input, password, hasher);
assert.equal(rewritten.users.owner.password, digest);
for (const change of [{ given_name: "Changed" }, { address: {} }, { extra: { permission: "admin" } }, { unknown: "" }]) {
  const database = structuredClone(rewritten);
  Object.assign(database.users.owner, change);
  await assert.rejects(verifyAutheliaUserDatabase(database, input, password, hasher));
}
await assert.rejects(verifyAutheliaUserDatabase(JSON.parse(content), input, "b".repeat(48), hasher), /never reseed/);
for (const change of [{ email: "other@example.net" }, { disabled: true }, { groups: ["admins"] },
  { password: "$argon2id$v=19$m=1,t=1,p=1$bad$bad" }]) {
  const database = JSON.parse(content);
  Object.assign(database.users.owner, change);
  await assert.rejects(verifyAutheliaUserDatabase(database, input, password, hasher));
}
await assert.rejects(compileAutheliaUserDatabase(input, password,
  { ...hasher, async verify() { return false; } }), /verification failed/);
assert.equal(autheliaLoginContract.path, "/api/firstfactor");
assert.equal(autheliaLoginContract.readback.path, "/api/state");
const state = { status: "OK", data: { username: input.username, authentication_level: 1, factor_knowledge: true } };
verifyAutheliaLoginState(state, input);
for (const patch of [{ username: "other" }, { authentication_level: 0 }, { authentication_level: "1" },
  { factor_knowledge: false }, { username: undefined, display_name: input.displayName }]) {
  assert.throws(() => verifyAutheliaLoginState({ ...state, data: { ...state.data, ...patch } }, input));
}
assert.throws(() => verifyAutheliaLoginState({ ...state, status: "KO" }, input));
console.log("Authelia source-only identity compiler/resume contract: pass");
