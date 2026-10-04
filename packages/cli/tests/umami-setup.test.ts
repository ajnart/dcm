import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import umami from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/umami/setup.ts";
import type { SetupCheckpoint, SetupCheckpointUpdate, SetupContext, SetupHttpRequest } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { prepareMultiServiceFiles } from "../src/lib/multi-service-recipe.ts";

const root = "/tmp/umami-setup-fixture";
const adminId = "01234567-89ab-cdef-0123-456789abcdef";
async function preparedPassword() {
  const temporary = await mkdtemp(join(tmpdir(), "umami-generated-fixture-"));
  try {
    const recipe = JSON.parse(await readFile(new URL(
      "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/umami/recipe.json", import.meta.url), "utf8"));
    const project = join(temporary, "project");
    await prepareMultiServiceFiles(recipe, project, join(project, "data", "umami"), {}, "umami");
    const value = await readFile(join(project, "secrets", "umami", "admin-password"), "utf8");
    assert.equal(value.length, 65, "the recipe declares entropy bytes, not encoded characters");
    await prepareMultiServiceFiles(recipe, project, join(project, "data", "umami"), {}, "umami");
    assert.equal(await readFile(join(project, "secrets", "umami", "admin-password"), "utf8"), value);
    return value;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
const password = await preparedPassword();
function fixture(loseRotation = false) {
  let checkpoint: SetupCheckpoint | null = null;
  let session: Record<string, string> = {};
  let credential = password;
  let rotated = false;
  let seedLogins = 0;
  let rotations = 0;
  let pending = "";
  const approvals = new Set<string>();
  async function authorize(request: SetupHttpRequest) {
    // Production binds all header values, including the transient bearer.
    pending = createHash("sha256").update(JSON.stringify({ method: request.method,
      path: request.path, headers: request.headers, body: request.body,
      checkpoint, beforeSendCheckpoint: request.beforeSendCheckpoint ?? null })).digest("hex");
    if (!approvals.has(pending)) throw new Error("approval deferred");
    if (request.beforeSendCheckpoint) {
      await context.checkpoint.compareAndSet(request.beforeSendCheckpoint);
      checkpoint!.attemptedActions.push(request.approval!.action);
    }
  }
  function response(status: number, data: unknown = {}) {
    return { status, ok: status === 200, headers: { get() { return null; } },
      async json() { return data; }, async text() { return JSON.stringify(data); },
      async arrayBuffer() { return new TextEncoder().encode(JSON.stringify(data)).buffer; } };
  }
  const context = { appId: "umami", projectRoot: root, inputs: {}, installedAppIds: ["umami"],
    async status() { return { command: "app status", appId: "umami", projectRoot: root,
      mutation: false, status: "applied", runtime: { state: "running" } }; },
    secrets: { async readAdminPassword() { return credential; },
      async readSessionCookies() { return { ...session }; },
      async writeSessionCookies(next: Record<string, string>) { session = { ...next }; } },
    checkpoint: { async read() { return checkpoint; },
      async compareAndSet(next: SetupCheckpointUpdate) {
        assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
        checkpoint = { schemaVersion: 1, appId: "umami", projectRoot: root,
          revision: (checkpoint?.revision ?? 0) + 1, stage: next.stage,
          data: next.data ?? {}, attemptedActions: checkpoint?.attemptedActions ?? [] };
        return checkpoint;
      } },
    http: { async request(request: SetupHttpRequest) {
      await authorize(request);
      if (request.path === "/api/auth/login") {
        const submitted = JSON.parse(request.body as string).password;
        if (submitted === "umami") {
          if (rotated) return response(401);
          seedLogins++;
          return response(200, { token: `seed-token-${seedLogins}`, user: {
            id: adminId, username: "admin", role: "admin", isAdmin: true } });
        }
        if (!rotated || submitted !== password) return response(401);
        return response(200, { token: "rotated-token", user: {
          id: adminId, username: "admin", role: "admin", isAdmin: true } });
      }
      assert.equal(request.path, `/api/users/${adminId}`);
      assert.equal(request.headers?.Authorization, "Bearer seed-token-1");
      assert.equal(rotated, false, "rotation must never be replayed");
      rotations++;
      rotated = true;
      if (loseRotation) throw new Error("rotation response lost");
      return response(200);
    } },
  } as unknown as SetupContext;
  return { context, approve() { approvals.add(pending); },
    get session() { return session; }, get seedLogins() { return seedLogins; },
    get rotations() { return rotations; }, set credential(value: string) { credential = value; } };
}

async function complete(f: ReturnType<typeof fixture>) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try { return await umami.firstRun(f.context); }
    catch (error) {
      assert.match(String(error), /approval deferred|rotation response lost/);
      f.approve();
    }
  }
  throw new Error("Umami exact approvals never converged");
}
for (const lostResponse of [false, true]) {
  const f = fixture(lostResponse);
  const result = await complete(f);
  assert.equal(umami.ready(result), true);
  assert.equal(f.seedLogins, 1, "rotation review must reuse its exact private seeded bearer");
  assert.equal(f.rotations, 1);
  assert.deepEqual(f.session, {});
  assert.equal(umami.ready(await complete(f)), true);
  assert.equal(f.rotations, 1);
  assert.ok(!JSON.stringify(result).includes("seed-token"));
}
const changed = fixture();
await assert.rejects(umami.firstRun(changed.context), /approval deferred/);
changed.approve();
await assert.rejects(umami.firstRun(changed.context), /approval deferred/);
assert.equal(changed.seedLogins, 1);
changed.credential = "b".repeat(48);
await assert.rejects(umami.firstRun(changed.context), /differs from the private owner credential/);
assert.equal(changed.rotations, 0);
