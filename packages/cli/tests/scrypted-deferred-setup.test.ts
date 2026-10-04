import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/scrypted/setup";
import type { SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup";
import { createSetupTransportFacilities, SetupTransportDeferred } from "../src/control-panel/setup-transport";
import { prepareMultiServiceFiles } from "../src/lib/multi-service-recipe";

const recipe = await Bun.file(new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/scrypted/recipe.json", import.meta.url)).json();
const SYNTHETIC_DURABLE_KEY = "b".repeat(32);

async function scenario(loseCreateResponse: boolean): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "scrypted-deferred-fixture-"));
  const projectId = "scrypted_fixture";
  const directory = join(root, ".selfhost", "shared", projectId);
  const privateFiles = join(directory, "secrets", "scrypted");
  const passwordFile = join(privateFiles, "admin-password");
  await mkdir(join(root, ".selfhost", "shared"), { recursive: true, mode: 0o700 });
  await prepareMultiServiceFiles(recipe, directory, join(directory, "data", "scrypted"), undefined, "scrypted");
  const generatedPassword = await readFile(passwordFile, "utf8");
  assert.match(generatedPassword, /^[A-Za-z0-9]{65}$/);
  let created = false;
  let creates = 0;
  let logins = 0;
  let sessionAuthorization = "";
  const sessions = new Set<string>();
  let passwordAccepted = true;
  let tokenStatus = 200;
  let tokenError: string | null = null;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    assert.equal(new URL(request.url).pathname, "/login");
    if (request.method === "POST") {
      const body = await request.json();
      if (body.username === "") {
        return Response.json({ hasLogin: created, error: "Username and password must not be empty." });
      }
      assert.equal(body.username, "admin");
      assert.equal(body.password, generatedPassword);
      if (!passwordAccepted) return Response.json({ error: "Incorrect password." });
      const first = !created;
      if (first) { creates += 1; created = true; }
      else logins += 1;
      sessionAuthorization = `Bearer ${"a".repeat(64)}#${JSON.stringify({ u: "admin", t: Date.now() + logins, d: 86400000 })}`;
      sessions.add(sessionAuthorization);
      if (first && loseCreateResponse) return new Response(null, { status: 502 });
      const result: Record<string, unknown> = { username: "admin", authorization: sessionAuthorization };
      if (first) result.token = SYNTHETIC_DURABLE_KEY;
      return Response.json(result);
    }
    assert.equal(request.method, "GET");
    const authorization = request.headers.get("authorization");
    assert.ok((authorization !== null && sessions.has(authorization)) || authorization === `Bearer ${SYNTHETIC_DURABLE_KEY}`);
    if (tokenStatus !== 200) return new Response(null, { status: tokenStatus });
    if (tokenError !== null) return Response.json({ error: tokenError, hasLogin: true });
    return Response.json({ username: "admin", authorization: sessionAuthorization, token: SYNTHETIC_DURABLE_KEY });
  } });
  try {
    const status = { command: "app status", ownerKind: "shared", appId: "scrypted", projectRoot: root,
      mutation: false, status: "applied", runtime: { state: "running" }, projectId, dockerContext: "default",
      port: server.port, url: `http://127.0.0.1:${server.port}`, composeTarget: join(directory, "compose.aaaaaaaaaaaaaaaa.yaml"),
      applyApproval: `SHARED-APPLY:${projectId}:${"a".repeat(64)}`, ownerRevision: 1,
      manifestHash: "b".repeat(64), selectionFingerprint: "c".repeat(64), privateFiles, passwordFile, username: "admin" };
    const approvals = new Set<string>();
    let review: { action: string; token: string } | undefined;
    function invocation(): SetupContext {
      const facilities = createSetupTransportFacilities({ appId: "scrypted", projectRoot: root,
        async readStatus() { return status; }, async readHandoff() { throw new Error("Unexpected handoff"); },
        async approve(action, token) { review = { action, token }; return approvals.has(token); },
        approvalQueue: { tail: Promise.resolve() }, registerSecret() {}, redact(value) { return value; } });
      return { ...facilities, appId: "scrypted", projectRoot: root, installedAppIds: [], inputs: {},
        async status() { return status; },
        // Only the reset-marker filesystem observation is synthetic. All HTTP
        // approval hashes, checkpoints and private file handling are real.
        container: { async exec(command) {
          assert.deepEqual(command.argv, ["test", "!", "-e", "/server/volume/reset-login"]);
          return { exitCode: 0, stdout: "" };
        } },
      } as SetupContext;
    }
    async function deferred(): Promise<{ action: string; token: string }> {
      await assert.rejects(adapter.firstRun(invocation()), (error) => error instanceof SetupTransportDeferred);
      assert.ok(review);
      return review;
    }
    async function reviewFor(action: string): Promise<{ action: string; token: string }> {
      for (let count = 0; count < 16; count += 1) {
        const next = await deferred();
        if (next.action === action) return next;
        approvals.add(next.token);
      }
      throw new Error("Synthetic setup did not reach the requested approval");
    }
    for (const invalidPassword of ["A".repeat(48), generatedPassword.slice(1), `${generatedPassword}A`, `${generatedPassword.slice(1)}-`]) {
      const context = invocation();
      context.secrets.readAdminPassword = async () => invalidPassword;
      await assert.rejects(adapter.firstRun(context), /saved password is invalid/);
    }
    approvals.add((await deferred()).token); // Empty first-run inspection.
    approvals.add((await deferred()).token); // First administrator creation.
    if (loseCreateResponse) {
      await assert.rejects(adapter.firstRun(invocation()), /outcome is unresolved/);
      assert.equal(creates, 1);
      approvals.add((await deferred()).token); // Existing-account inspection under the attempted checkpoint.
      const loginReview = await deferred();
      assert.equal(loginReview.action, "scrypted-verify-admin-login");
      approvals.add(loginReview.token); // Saved password login only.
    }
    const readReview = await reviewFor("scrypted-read-durable-token");
    assert.equal(readReview.action, "scrypted-read-durable-token");
    assert.equal((await reviewFor("scrypted-read-durable-token")).token, readReview.token);
    assert.equal((await reviewFor("scrypted-read-durable-token")).token, readReview.token);
    assert.equal(creates, 1);
    assert.ok(logins > Number(loseCreateResponse), "Resume rechecks the saved password");
    const session = await invocation().secrets.readSessionCookies();
    assert.deepEqual(Object.keys(session).sort(), ["authorization-base64", "password-digest"]);
    assert.equal((await lstat(join(privateFiles, "session-cookies.json"))).mode & 0o777, 0o600);
    passwordAccepted = false;
    await assert.rejects(adapter.firstRun(invocation()), /did not authenticate/);
    assert.deepEqual(await invocation().secrets.readSessionCookies(), session);
    assert.equal(creates, 1, "A stale password cannot recreate the account");
    passwordAccepted = true;
    approvals.add(readReview.token);
    tokenStatus = 500;
    await assert.rejects(adapter.firstRun(invocation()), /readback failed/);
    assert.deepEqual(await invocation().secrets.readSessionCookies(), session);
    tokenStatus = 200;
    // Recovery can require the distinct stable durable-key readback approval.
    let record;
    for (let count = 0; count < 3; count += 1) {
      try { record = await adapter.firstRun(invocation()); break; }
      catch (error) {
        if (!(error instanceof SetupTransportDeferred) || !review) throw error;
        approvals.add(review.token);
      }
    }
    assert.ok(record && adapter.ready(record));
    assert.equal(await invocation().secrets.readApiKey(), SYNTHETIC_DURABLE_KEY);
    assert.equal(creates, 1);
    // The completed checkpoint is a new exact approval subject once. Further
    // completed replays must not increment it and invalidate that approval.
    for (let count = 0; count < 16; count += 1) {
      try {
        assert.ok(adapter.ready(await adapter.firstRun(invocation())));
        break;
      } catch (error) {
        if (!(error instanceof SetupTransportDeferred) || !review || count === 15) throw error;
        approvals.add(review.token);
      }
    }
    const completed = await invocation().checkpoint.read();
    assert.ok(adapter.ready(await adapter.firstRun(invocation())));
    assert.deepEqual(await invocation().checkpoint.read(), completed);
    assert.ok(logins > 1, "Completed replay also rechecks the saved password");
    tokenStatus = 403;
    await assert.rejects(adapter.firstRun(invocation()), /readback failed/);
    assert.deepEqual(await invocation().secrets.readSessionCookies(), session);
    tokenStatus = 200;
    tokenError = "Unknown Error.";
    await assert.rejects(adapter.firstRun(invocation()), /did not authenticate/);
    assert.deepEqual(await invocation().secrets.readSessionCookies(), session);
    tokenError = "Not logged in.";
    await assert.rejects(adapter.firstRun(invocation()), /session is unauthorized/);
    assert.deepEqual(Object.keys(await invocation().secrets.readSessionCookies()), []);
    assert.equal(await invocation().secrets.readApiKey(), SYNTHETIC_DURABLE_KEY);
    assert.equal(creates, 1);
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}

await scenario(false);
await scenario(true);
process.stdout.write("Scrypted real-transport deferred approval and lost-create recovery: pass\n");
