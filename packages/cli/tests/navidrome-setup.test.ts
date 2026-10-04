import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareMultiServiceFiles } from "../src/lib/multi-service-recipe.ts";
import recipe from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/navidrome/recipe.json";
import navidrome from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/navidrome/setup.ts";
import type { SetupCheckpoint, SetupCheckpointUpdate, SetupContext, SetupHttpResponse } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const projectRoot = await mkdtemp(join(tmpdir(), "navidrome-setup-fixture-"));
try {
  await prepareMultiServiceFiles(recipe, projectRoot, join(projectRoot, "data"), { music: join(projectRoot, "music") });
  const password = (await readFile(join(projectRoot, "secrets/admin-password"), "utf8")).trim();
  let saved: SetupCheckpoint | null = null;
  let created = false;
  let loseCreationResponse = true;
  let creates = 0;
  let logins = 0;
  let userId = "fixture-owner-id";
  let apiReads = 0;
  let apiStatus = 200;
  let apiAdmin = true;
  let apiUserId: string | null = null;
  let token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.fixture-signature";
  let creationUserId: string | null = null;
  let checkpointAtApi: ((current: SetupCheckpoint) => SetupCheckpoint | null) | null = null;
  const update = async (next: SetupCheckpointUpdate): Promise<SetupCheckpoint> => {
    assert.equal(next.expectedRevision, saved?.revision ?? null);
    saved = { schemaVersion: 1, appId: "navidrome", projectRoot, revision: (saved?.revision ?? 0) + 1,
      stage: next.stage, attemptedActions: saved?.attemptedActions ?? [], data: next.data ?? {} };
    return saved;
  };
  const context = { appId: "navidrome", projectRoot,
    async status() { return { command: "app status", appId: "navidrome", projectRoot, status: "applied",
      mutation: false, runtime: { state: "running" } }; },
    secrets: { async readAdminPassword() { return password; }, async writeApiKey() { assert.fail("Login JWT is not a durable key"); } },
    checkpoint: { async read() { return saved; }, compareAndSet: update },
    http: { async request(request) {
      if (request.method === "GET") {
        assert.equal(request.path, `/api/user/${userId}`);
        assert.equal(request.headers?.["X-ND-Authorization"], `Bearer ${token}`);
        assert.equal(request.headers?.Authorization, undefined);
        assert.equal(request.body, undefined);
        apiReads += 1;
        return { status: apiStatus, ok: apiStatus === 200, headers: { get() { return null; } },
          async json() {
            if (checkpointAtApi) saved = checkpointAtApi(saved!);
            return { id: apiUserId ?? userId, userName: "admin", isAdmin: apiAdmin };
          },
        } as SetupHttpResponse;
      }
      assert.deepEqual(JSON.parse(String(request.body)), { username: "admin", password });
      if (request.beforeSendCheckpoint) {
        await update(request.beforeSendCheckpoint);
        saved!.attemptedActions.push(request.approval!.action);
      }
      let status = 200;
      if (request.path === "/auth/createAdmin") {
        assert.equal(request.approval?.once, true);
        assert.equal(created, false);
        creates += 1;
        created = true;
        if (loseCreationResponse) throw new Error("lost creation response");
      } else {
        assert.equal(request.path, "/auth/login");
        logins += 1;
        if (!created) status = 401;
      }
      return { status, ok: status === 200, headers: { get() { return null; } },
        async json() {
          let id = userId;
          if (request.path === "/auth/createAdmin" && creationUserId !== null) id = creationUserId;
          return { username: "admin", isAdmin: true, id, token };
        },
      } as SetupHttpResponse;
    } },
  } as SetupContext;
  await assert.rejects(navidrome.firstRun(context), /lost creation response/);
  assert.equal(saved!.stage, "admin-create-attempted");
  loseCreationResponse = false;
  const recovered = await navidrome.firstRun(context);
  assert.equal(navidrome.ready(recovered), true);
  assert.equal(navidrome.compatibilityResult!(recovered), null,
    "An attempted checkpoint and lost create response cannot prove fresh or resume chronology");
  assert.equal(saved!.data.userId, userId);
  const resumed = await navidrome.firstRun(context);
  assert.equal(navidrome.ready(resumed), true);
  assert.deepEqual(navidrome.compatibilityResult!(resumed), { origin: "resume", credentialReadback: "verified" });
  assert.equal(navidrome.compatibilityResult!({ ...resumed }), null);
  assert.equal(navidrome.compatibilityResult!(JSON.parse(JSON.stringify(resumed))), null);
  assert.equal(navidrome.compatibilityResult!({ ...resumed,
    setupCompatibility: { origin: "fresh", credentialReadback: "verified" } }), null);
  assert.equal(creates, 1);
  assert.equal(logins, 3);
  assert.equal(apiReads, 2);
  assert.equal(navidrome.apiKey, "not-created");
  assert.equal(JSON.stringify(saved).includes(token), false);
  apiStatus = 401;
  await assert.rejects(navidrome.firstRun(context), /protected API/);
  apiStatus = 200;
  apiAdmin = false;
  await assert.rejects(navidrome.firstRun(context), /protected API identity differs/);
  apiAdmin = true;
  apiUserId = "replacement-api-owner";
  await assert.rejects(navidrome.firstRun(context), /protected API identity differs/);
  apiUserId = null;
  const validToken = token;
  token = "not-a-jwt";
  await assert.rejects(navidrome.firstRun(context), /saved administrator credential/);
  token = validToken;
  userId = "replacement-owner-id";
  await assert.rejects(navidrome.firstRun(context), /identity differs/);
  const trusted = saved!;
  saved = { ...trusted, attemptedActions: [] };
  await assert.rejects(navidrome.firstRun(context), /unrecognized first-admin checkpoint/);
  saved = null;
  await assert.rejects(navidrome.firstRun(context), /provenance is missing/);
  assert.equal(creates, 1);
  created = false;
  creationUserId = "different-created-owner";
  await assert.rejects(navidrome.firstRun(context), /newly created administrator/);
  assert.equal(saved!.stage, "admin-create-attempted");
  assert.equal(saved!.data.userId, creationUserId);
  await assert.rejects(navidrome.firstRun(context), /identity differs/);
  saved = null;
  created = false;
  creationUserId = null;
  const fresh = await navidrome.firstRun(context);
  assert.equal(navidrome.ready(fresh), true);
  assert.deepEqual(navidrome.compatibilityResult!(fresh), { origin: "fresh", credentialReadback: "verified" });
  assert.equal(fresh.setupCompatibility, undefined, "Compatibility provenance remains ephemeral");
  assert.equal(navidrome.compatibilityResult!({ ...fresh }), null);
  assert.equal(fresh.authenticatedAdminApiVerified, true);
  assert.equal(navidrome.ready({ ...fresh, authenticatedAdminApiVerified: false }), false);
  assert.equal(saved!.data.userId, userId);
  assert.equal(JSON.stringify(fresh).includes(token), false);
  assert.equal(JSON.stringify(saved).includes(token), false);
  const verifiedCheckpoint = saved!;
  for (const replace of [
    (current: SetupCheckpoint) => ({ ...current, revision: current.revision + 1, data: { userId: "concurrent-owner-id" } }),
    (current: SetupCheckpoint) => ({ ...current, revision: current.revision + 1, stage: "foreign-stage" }),
    (current: SetupCheckpoint) => ({ ...current, revision: current.revision + 1, attemptedActions: [] }),
    () => null,
  ]) {
    saved = verifiedCheckpoint;
    checkpointAtApi = replace;
    await assert.rejects(navidrome.firstRun(context), /checkpoint changed during administrator verification/);
    assert.deepEqual(saved, replace(verifiedCheckpoint), "Concurrent checkpoint must not be overwritten or recreated");
  }
  checkpointAtApi = null;
  saved = verifiedCheckpoint;
  saved = { ...verifiedCheckpoint, data: {} };
  const missingOwner = await navidrome.firstRun(context);
  assert.equal(navidrome.ready(missingOwner), true);
  assert.equal(navidrome.compatibilityResult!(missingOwner), null,
    "A ready stage without a saved owner identity cannot prove resume provenance");
  const provedResume = await navidrome.firstRun(context);
  assert.deepEqual(navidrome.compatibilityResult!(provedResume), { origin: "resume", credentialReadback: "verified" });
  console.log("Navidrome fresh/resumed password login, protected API and owner provenance fixture passed");
} finally {
  await rm(projectRoot, { recursive: true, force: true });
}
