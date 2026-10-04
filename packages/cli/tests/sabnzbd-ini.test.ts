import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { assertSabnzbdSetupSafety, SABNZBD_API_KEY_AWK,
  SABNZBD_SETUP_SAFETY_AWK } from "../src/control-panel/sabnzbd-ini.ts";

const key = "a".repeat(32);

function extract(input: string) {
  return spawnSync("awk", [SABNZBD_API_KEY_AWK, "-"], {
    encoding: "utf8", input, maxBuffer: 1024,
  });
}

const valid = extract(`[servers]\napi_key = ${"b".repeat(32)}\n[misc]\nusername = admin\napi_key = ${key}\npassword = not-printed\n[logging]\napi_key = ${"c".repeat(32)}\n`);
assert.equal(valid.status, 0);
assert.equal(valid.stdout, `${key}\n`);
assert.equal(valid.stdout.includes("not-printed"), false);

const missing = extract(`[misc]\nnzb_key = ${key}\n`);
assert.equal(missing.status, 2);
assert.equal(missing.stdout, "");

const duplicate = extract(`[misc]\napi_key = ${key}\napi_key = ${"b".repeat(32)}\n`);
assert.equal(duplicate.status, 2);
assert.equal(duplicate.stdout, "");

process.stdout.write("SABnzbd narrow INI extraction checks passed\n");

function setupSafety(input: string) {
  return spawnSync("awk", [SABNZBD_SETUP_SAFETY_AWK, "-"], {
    encoding: "utf8", input, maxBuffer: 1024,
  });
}

const normalLogging = setupSafety("[misc]\napi_logging = 1\ninet_exposure = 0\nhtml_login = 1\n[logging]\nlog_level = 1\n");
assert.equal(normalLogging.status, 0);
assert.equal(normalLogging.stdout, "1\n1\n0\n1\n");
assert.doesNotThrow(() => assertSabnzbdSetupSafety(normalLogging.stdout));
assert.throws(() => assertSabnzbdSetupSafety("1\n2\n0\n1"), /DEBUG logging/);
assert.throws(() => assertSabnzbdSetupSafety("1\n1\n5\n1"), /private HTML-login defaults/);
assert.throws(() => assertSabnzbdSetupSafety("1\n1\n0\n0"), /private HTML-login defaults/);
assert.throws(() => assertSabnzbdSetupSafety("1\n1\n0"), /could not be verified/);
assert.equal(setupSafety("[misc]\napi_logging = 1\ninet_exposure = 0\nhtml_login = 1\n[logging]\nlog_level = 1\nlog_level = 2\n").status, 2);
assert.equal(setupSafety("[misc]\napi_logging = 1\ninet_exposure = 0\nhtml_login = 1\n[logging]\n").status, 2);
process.stdout.write("SABnzbd setup-safety extraction checks passed\n");
