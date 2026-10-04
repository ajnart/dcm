import assert from "node:assert/strict";
import { mkdtemp, chmod, writeFile, readFile, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gluetunControlConfiguration, GLUETUN_CONTROL_ROUTES, verifyGluetunControl } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/gluetun/control.ts";
import type { SetupHttpReadRequest, SetupHttpResponse } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { preparePrivateConfigs } from "../src/lib/private-config.ts";

const fragment = gluetunControlConfiguration();
assert.deepEqual(fragment, gluetunControlConfiguration());
assert.equal(fragment.deployable, false);
assert.equal(fragment.mountTarget, "/gluetun/auth/config.toml");
assert.ok(GLUETUN_CONTROL_ROUTES.every((route) => route.startsWith("GET /v1/") && !route.includes("restart")));
const directory = await mkdtemp(join(tmpdir(), "gluetun-control-"));
const key = "a1".repeat(32);
try {
  await chmod(directory, 0o700);
  await writeFile(join(directory, "control-api-key"), key, { mode: 0o600 });
  // Exercise the existing common boundary directly, without a dummy recipe.
  await preparePrivateConfigs(fragment, directory);
  const config = await readFile(join(directory, "control-auth"), "utf8");
  assert.equal(config, `[[roles]]\nname = "private-readonly"\nroutes = ["GET /v1/vpn/status","GET /v1/publicip/ip","GET /v1/portforward"]\nauth = "apikey"\napikey = "${key}"\n`);
  assert.equal((await lstat(join(directory, "control-auth"))).mode & 0o777, 0o600);
  await preparePrivateConfigs(fragment, directory);
  await writeFile(join(directory, "control-auth"), config.replace("private-readonly", "changed"));
  await assert.rejects(preparePrivateConfigs(fragment, directory));
} finally { await rm(directory, { recursive: true, force: true }); }

function response(status: number, value: unknown): SetupHttpResponse {
  return { status, ok: status === 200, headers: { get: () => null }, json: async () => value,
    text: async () => JSON.stringify(value), arrayBuffer: async () => new ArrayBuffer(0) };
}
function http(anonymous: number, authenticated: number, value: unknown) {
  const calls: SetupHttpReadRequest[] = [];
  return { calls, request: async (request: SetupHttpReadRequest) => {
    calls.push(request);
    assert.equal(request.method, "GET");
    assert.equal(request.path, "/v1/vpn/status");
    if (!request.headers) return response(anonymous, {});
    assert.deepEqual(request.headers, { "X-API-Key": key });
    return response(authenticated, value);
  } };
}
for (const status of ["running", "stopped"]) {
  const transport = http(401, 200, { status });
  const result = await verifyGluetunControl(transport, key);
  assert.equal(result.controlAuthenticationVerified, true);
  assert.equal(result.vpnStatus, status);
  assert.equal(result.ready, false);
  assert.equal(result.tunnelBreakVerified, false);
  assert.equal(result.writeAuthorizationVerified, false);
  assert.equal(transport.calls.length, 2);
  assert.ok(!JSON.stringify(result).includes(key));
}
const publicAccess = http(200, 200, { status: "running" });
await assert.rejects(verifyGluetunControl(publicAccess, key));
assert.equal(publicAccess.calls.length, 1);
await assert.rejects(verifyGluetunControl(http(401, 401, {}), key));
for (const value of [{ status: "unknown" }, { status: "running", extra: key }, null, [], "running"]) {
  await assert.rejects(verifyGluetunControl(http(401, 200, value), key));
}
const unused = http(401, 200, { status: "running" });
for (const invalid of ["", key + "\n", key.toUpperCase(), "a".repeat(63), '"' + key]) {
  await assert.rejects(verifyGluetunControl(unused, invalid));
}
assert.equal(unused.calls.length, 0);
console.log("gluetun-control: focused private-config and read-only verification fixture passed");
