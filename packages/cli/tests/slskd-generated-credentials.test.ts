import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/slskd/setup";
import type { SetupCheckpoint, SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup";
import { prepareMultiServiceFiles } from "../src/lib/multi-service-recipe";

const recipe = await Bun.file(new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/slskd/recipe.json", import.meta.url)).json();
const root = await mkdtemp(join(tmpdir(), "slskd-generated-fixture-"));
try {
  const directory = join(root, "project");
  const mediaDirectory = join(root, "media");
  await prepareMultiServiceFiles(recipe, directory, join(directory, "data", "slskd"),
    { "media-data": mediaDirectory }, "slskd");
  const passwordFile = join(directory, "secrets", "slskd", "admin-password");
  const apiKeyFile = join(directory, "secrets", "slskd", "slskd-api-key");
  const password = await readFile(passwordFile, "utf8");
  const key = await readFile(apiKeyFile, "utf8");
  for (const file of [passwordFile, apiKeyFile]) {
    assert.equal((await lstat(file)).mode & 0o777, 0o600);
  }
  assert.match(password, /^[A-Za-z0-9]{65}$/);
  assert.match(key, /^[A-Za-z0-9]{65}$/);
  let checkpoint: SetupCheckpoint | null = null;
  let requests = 0;
  const status = { ownerKind: "shared", command: "app status", appId: "slskd",
    projectRoot: root, status: "applied", mutation: false, runtime: { state: "running" }, passwordFile };
  const context = {
    appId: "slskd", projectRoot: root, installedAppIds: [], inputs: {},
    async status() { return status; },
    secrets: {
      async readAdminPassword() { return password; },
      async readApiKey() { return key; },
      async apiKeyPath() { return apiKeyFile; },
    },
    checkpoint: {
      async read() { return checkpoint; },
      async compareAndSet(update) {
        assert.equal(update.expectedRevision, null);
        checkpoint = { schemaVersion: 1, appId: "slskd", projectRoot: root, revision: 1,
          stage: update.stage, attemptedActions: [], data: update.data ?? {} };
        return checkpoint;
      },
    },
    http: { async request(request) {
      requests += 1;
      if (request.path === "/api/v0/session/enabled") {
        assert.equal(request.method, "GET");
        return Response.json(true);
      }
      assert.equal(request.path, "/api/v0/session");
      if (request.method === "POST") {
        assert.equal(request.approval?.action, "slskd-verify-admin-login");
        assert.deepEqual(JSON.parse(request.body as string), { username: "admin", password });
        return Response.json({ name: "admin", token: "abc.def.ghi" });
      }
      assert.equal(request.method, "GET");
      if (request.headers?.["X-API-Key"] !== undefined) {
        assert.equal(request.headers["X-API-Key"], key);
      } else {
        assert.equal(request.headers?.Authorization, "Bearer abc.def.ghi");
      }
      return Response.json({ name: "admin" });
    } },
  } as SetupContext;
  for (const invalid of ["A".repeat(48), key.slice(1), `${key}A`, `${key.slice(1)}-`]) {
    await assert.rejects(adapter.firstRun({ ...context,
      secrets: { ...context.secrets, async readApiKey() { return invalid; } } }), /generated private primary API key/);
  }
  for (const invalid of ["A".repeat(48), password.slice(1), `${password}A`, `${password.slice(1)}-`]) {
    await assert.rejects(adapter.firstRun({ ...context,
      secrets: { ...context.secrets, async readAdminPassword() { return invalid; } } }), /administrator password is invalid/);
  }
  assert.equal(requests, 0);
  assert.ok(adapter.ready(await adapter.firstRun(context)));
  assert.equal(requests, 4);
  assert.ok(adapter.inspect);
  const inspection = await adapter.inspect(context);
  assert.equal(inspection.loginVerified, false);
  assert.equal(inspection.apiVerified, true);
  assert.equal(inspection.apiKeyFile, apiKeyFile);
  assert.equal(adapter.ready(inspection), false);
  assert.equal(requests, 6);
  await assert.rejects(adapter.inspect({ ...context,
    secrets: { ...context.secrets, async readApiKey() { return "A".repeat(48); } } }), /private primary API key/);
  assert.equal(requests, 6);
  assert.ok(adapter.ready(await adapter.firstRun(context)));
  assert.equal(requests, 10, "Resume must freshly verify the password, not reuse the API-key proof");
} finally {
  await rm(root, { recursive: true, force: true });
}
process.stdout.write("slskd generated credential setup and inspection: pass\n");
