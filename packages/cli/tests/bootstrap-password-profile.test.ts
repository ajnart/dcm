import assert from "node:assert/strict";
import { bootstrapPasswordProfile, decodeBootstrapPasswordProfile, parseBootstrapPassword }
  from "../src/lib/bootstrap-password-profile.ts";

// Pure synthetic lines, after the transport's timestamp normalization; no Docker or private files.
const qbit = bootstrapPasswordProfile("qbittorrent")!;
const frigate = bootstrapPasswordProfile("frigate")!;
assert.equal(qbit.format, "one-line-suffix");
assert.equal(frigate.format, "exact-block");
assert.equal(bootstrapPasswordProfile("sonarr"), null);
assert.equal(bootstrapPasswordProfile("../frigate"), null);
const qbitPassword = "syntheticQbt123";
const frigatePassword = "a".repeat(32);
const registered: string[] = [];
const register = (value: string) => { registered.push(value); };
function rejects(profile: typeof qbit, lines: string[]) {
  registered.length = 0;
  assert.throws(() => parseBootstrapPassword(profile, lines, register), (error: unknown) => {
    assert.ok(error instanceof Error);
    for (const secret of [qbitPassword, frigatePassword, "b".repeat(32)]) {
      assert.equal(error.message.includes(secret), false);
    }
    return true;
  });
}
assert.equal(parseBootstrapPassword(qbit, [
  `The WebUI administrator password was not set. A TEMPORARY PASSWORD IS PROVIDED FOR THIS SESSION: ${qbitPassword}`,
], register), qbitPassword);
assert.deepEqual(registered, [qbitPassword]);
rejects(qbit, [`temporary password is provided for this session: ${qbitPassword}\r`]);
for (const line of ["unrelated password", `temporary password is provided for this session: ${qbitPassword} trailing`,
  "temporary password is provided for this session: "]) rejects(qbit, [line]);
rejects(qbit, [`temporary password is provided for this session: ${qbitPassword}`,
  "temporary password is provided for this session: otherSynthetic"]);
assert.deepEqual(registered, [qbitPassword, "otherSynthetic"]);
rejects(qbit, ["temporary password is provided for this session: abc",
  `temporary password is provided for this session: ${qbitPassword}`]);
assert.deepEqual(registered, ["abc", qbitPassword]);
rejects(qbit, [`temporary password is provided for this session: ${"x".repeat(8193)}`]);
assert.equal(registered[0]?.length, 8193);

if (frigate.format !== "exact-block") throw new Error("Wrong fixture profile");
const block = [...frigate.beforePassword, `${frigate.passwordPrefix}${frigatePassword}${frigate.passwordSuffix}`,
  ...frigate.afterPassword];
const prefixed = block.map((line) => `[2026-10-03 12:00:00] frigate.app INFO : ${line}`);
registered.length = 0;
assert.equal(parseBootstrapPassword(frigate, prefixed, register), frigatePassword);
assert.deepEqual(registered, [frigatePassword]);
rejects(frigate, prefixed.map((line) => `${line}\r`));
rejects(frigate, [...block, ...block]);
assert.deepEqual(registered, [frigatePassword, frigatePassword]);
rejects(frigate, [...block, "***    Reset admin password set in the config.       ***"]);
assert.deepEqual(registered, [frigatePassword]);
rejects(frigate, [...block, `${frigate.passwordPrefix}${"b".repeat(32)}${frigate.passwordSuffix}`]);
assert.deepEqual(registered, [frigatePassword, "b".repeat(32)]);
for (let index = 0; index < block.length; index++) {
  rejects(frigate, block.filter((_, at) => at !== index));
}
for (const password of ["A".repeat(32), "a".repeat(31), `${frigatePassword} trailing`]) {
  rejects(frigate, block.map((line) => line.replace(frigatePassword, password)));
}
rejects(frigate, block.map((line) => line.replace("User: admin", "User: other")));
rejects(frigate, [block[5]!]);

for (const descriptor of [
  { ...qbit, regex: ".*" }, { ...qbit, message: "" }, { ...qbit, message: " \n" },
  { ...qbit, caseInsensitive: false }, { ...qbit, passwordFormat: "any" },
  { ...qbit, source: "https://github.com/qbittorrent/qBittorrent/blob/master/src/app/application.cpp" },
  { ...qbit, appId: "frigate" }, { ...qbit, version: 2 },
]) {
  assert.throws(() => decodeBootstrapPasswordProfile(descriptor, qbit.appId), /profile is invalid/);
}
for (const descriptor of [
  { ...frigate, markerStart: " " }, { ...frigate, passwordSuffix: "" },
  { ...frigate, beforePassword: ["***", "***", "***"] },
  { ...frigate, afterPassword: Array(9).fill("***") },
  { ...frigate, resetContains: "Reset\u0000" }, { ...frigate, arbitraryRegex: ".*" },
]) {
  assert.throws(() => decodeBootstrapPasswordProfile(descriptor, frigate.appId), /profile is invalid/);
}
console.log("Bootstrap profiles: exact app-owned formats, preserved capture/reset/ambiguity rules and fail-closed decoding passed");
