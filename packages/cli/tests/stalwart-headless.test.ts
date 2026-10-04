import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapStalwart, createStalwartApiKey, type StalwartContext, type StalwartJournal,
  type StalwartApiKeyContext, type StalwartApiKeyJournal } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/stalwart-mail/headless.ts";

const intent = { hostname: "mail.example.test", domain: "example.test", httpsOrigin: "https://mail.example.test",
  dataPath: "/var/lib/stalwart/", logPath: "/var/log/stalwart/" };
const password = "SyntheticAdmin12";
const root = mkdtempSync(join(tmpdir(), "stalwart-headless-fixture-"));
type Scenario = { loseBootstrap?: boolean; failCaptureJournal?: boolean; failVerify?: boolean;
  wrongRole?: boolean; wrongHostname?: boolean; recoveryAccepted?: boolean; failCleanup?: boolean;
  nativeMailListener?: boolean; noListeners?: boolean; invalidListenerBind?: boolean };
function fixture(directory: string, scenario: Scenario = {}) {
  let journal: StalwartJournal | null = null;
  let bootstraps = 0;
  let removed = false;
  let starts = 0;
  const registered: string[] = [];
  const calls: string[] = [];
  const context: StalwartContext = {
    privateDirectory: directory, registerSecret(value) { registered.push(value); },
    async inspectPrerequisites() {},
    journal: { async read() { return journal; }, async save(next) {
      if (next.phase === "captured" && scenario.failCaptureJournal) throw new Error("synthetic journal failure");
      journal = next;
    } },
    async startFreshRecovery(input) {
      starts++;
      assert.equal(input.configMustBeAbsent, true);
      assert.equal(statSync(input.envFile).mode & 0o777, 0o600);
      const env = readFileSync(input.envFile, "utf8");
      assert.match(env, /^STALWART_RECOVERY_MODE=1\nSTALWART_RECOVERY_ADMIN=recovery:[0-9a-f]{64}\n$/);
    },
    async waitForRecovery() { assert.equal(readFileSync(join(directory, "permanent-admin-password"), "utf8"), password); },
    async removeRecoveryAndRestart(beforeSend) {
      await beforeSend();
      if (scenario.failCleanup) throw new Error("synthetic ambiguous restart");
      removed = true;
      unlinkSync(join(directory, "recovery.env"));
    },
    async request(input) {
      assert.equal(input.path, "/api");
      assert.equal(input.origin, intent.httpsOrigin);
      const body = JSON.parse(input.body);
      assert.deepEqual(body.using, ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"]);
      const [method, args, id] = body.methodCalls[0];
      assert.equal(id, "c1");
      calls.push(method);
      const auth = Buffer.from(input.authorization.slice(6), "base64").toString("utf8");
      const response = (value: unknown) => ({ status: 200, json: { methodResponses: [[method, value, id]] } });
      if (method === "x:Bootstrap/get") return response({ list: [{ id: "singleton" }], notFound: [] });
      if (method === "x:Bootstrap/set") {
        assert.equal(input.effect, "write");
        assert.ok(input.beforeSend);
        await input.beforeSend();
        assert.equal(journal?.phase, "bootstrap-attempted");
        assert.deepEqual(args.update.singleton.directory, { "@type": "Internal" });
        assert.deepEqual(args.update.singleton.dnsServer, { "@type": "Manual" });
        assert.equal(args.update.singleton.requestTlsCertificate, false);
        assert.equal(args.update.singleton.generateDkimKeys, false);
        bootstraps++;
        if (scenario.loseBootstrap) throw new Error("synthetic lost response");
        return response({ updated: { singleton: { username: `admin@${intent.domain}`, secret: password } } });
      }
      assert.equal(input.effect, "read");
      assert.equal(readFileSync(join(directory, "permanent-admin-password"), "utf8"), password);
      assert.equal(statSync(join(directory, "permanent-admin-password")).mode & 0o777, 0o600);
      if (auth === `admin@${intent.domain}:${password}-invalid`) return { status: 401, json: null };
      if (auth.startsWith("recovery:")) {
        if (!removed && !scenario.failCleanup) throw new Error("Recovery must only be tested after removal");
        if (scenario.recoveryAccepted) return response({ list: [] });
        return { status: 401, json: null };
      }
      assert.equal(auth, `admin@${intent.domain}:${password}`);
      if (scenario.failVerify) throw new Error("synthetic verification failure");
      if (method === "x:SystemSettings/get") return response({ list: [{ id: "singleton",
        defaultHostname: scenario.wrongHostname ? "wrong.example.test" : intent.hostname, defaultDomainId: "d" }] });
      if (method === "x:Domain/get") return response({ list: [{ id: "d", name: intent.domain, isEnabled: true }] });
      if (method === "x:Account/get") return response({ list: [{ id: "a", "@type": "User", name: "admin",
        emailAddress: `admin@${intent.domain}`, domainId: "d", roles: { "@type": scenario.wrongRole ? "User" : "Admin" } }] });
      if (method === "x:NetworkListener/get") {
        assert.deepEqual(args, { ids: null, properties: ["id", "name", "protocol", "bind"] });
        let listeners: Array<{ id: string; name: string; protocol: string; bind: Record<string, boolean> }> =
          [{ id: "management", name: "https", protocol: "http", bind: { "[::]:443": true } }];
        if (scenario.nativeMailListener) listeners.push({ id: "smtp", name: "smtp", protocol: "smtp", bind: { "[::]:25": true } });
        if (scenario.noListeners) listeners = [];
        if (scenario.invalidListenerBind) listeners[0].bind = {};
        return response({ list: listeners, notFound: [] });
      }
      throw new Error("Unexpected method");
    },
  };
  return { context, scenario, registered, calls, state: () => ({ journal, bootstraps, removed, starts }) };
}
try {
  const { mkdirSync } = await import("node:fs");
  const create = (name: string, scenario: Scenario = {}) => {
    const directory = join(root, name);
    mkdirSync(directory, { mode: 0o700 });
    return fixture(directory, scenario);
  };
  const happy = create("happy");
  const result = await bootstrapStalwart(happy.context, intent);
  assert.equal((result as any).status, "administrator-verified");
  assert.equal((result as any).mailDelivery, "not-verified");
  assert.equal(JSON.stringify(result).includes(password), false);
  assert.ok(happy.registered.includes(password));
  await bootstrapStalwart(happy.context, intent);
  assert.equal(happy.state().bootstraps, 1);
  assert.equal(happy.state().starts, 1);

  const lost = create("lost", { loseBootstrap: true });
  await assert.rejects(bootstrapStalwart(lost.context, intent), /lost response/);
  await assert.rejects(bootstrapStalwart(lost.context, intent), /never replay/);
  assert.equal(lost.state().bootstraps, 1);

  for (const key of ["failCaptureJournal", "failVerify", "wrongRole", "wrongHostname", "recoveryAccepted", "failCleanup",
    "nativeMailListener", "noListeners", "invalidListenerBind"] as const) {
    const f = create(key, { [key]: true });
    await assert.rejects(bootstrapStalwart(f.context, intent));
    assert.equal(readFileSync(join(f.context.privateDirectory, "permanent-admin-password"), "utf8"), password);
    if (["wrongRole", "wrongHostname", "failVerify", "failCaptureJournal", "nativeMailListener", "noListeners",
      "invalidListenerBind"].includes(key)) assert.equal(f.state().removed, false);
    f.scenario[key] = false;
    // An ambiguous cleanup is observed, never automatically replayed.
    if (key === "failCleanup") continue;
    await bootstrapStalwart(f.context, intent);
    assert.equal(f.state().bootstraps, 1);
  }
  const invalid = create("invalid");
  await assert.rejects(bootstrapStalwart(invalid.context, { ...intent, httpsOrigin: "http://127.0.0.1:8080" }), /HTTPS/);
  assert.equal(invalid.calls.length, 0);
  await assert.rejects(bootstrapStalwart(happy.context, { ...intent, domain: "other.test" }), /intent changed/);

  for (const scenario of ["happy", "lost", "capture-journal", "verify"] as const) {
    const f = create(`api-${scenario}`);
    await bootstrapStalwart(f.context, intent);
    let keyJournal: StalwartApiKeyJournal | null = null;
    let creates = 0;
    let failJournal = scenario === "capture-journal";
    let failVerify = scenario === "verify";
    const key = `API_${Buffer.alloc(28, 1).toString("base64url")}`;
    const inheritedRequest = f.context.request;
    const context: StalwartApiKeyContext = { ...f.context,
      apiKeyJournal: { async read() { return keyJournal; }, async save(next) {
        if (next.phase === "captured" && failJournal) throw new Error("synthetic key journal failure");
        keyJournal = next;
      } },
      async request(input) {
        const [method, args, id] = JSON.parse(input.body).methodCalls[0];
        const response = (value: unknown) => ({ status: 200, json: { methodResponses: [[method, value, id]] } });
        if (method === "x:ApiKey/set") {
          assert.equal(f.state().removed, true);
          assert.deepEqual(args.create.selfhost.permissions, { "@type": "Inherit" });
          await input.beforeSend!();
          assert.equal(keyJournal?.phase, "attempted");
          creates++;
          if (scenario === "lost") throw new Error("synthetic lost API key response");
          return response({ created: { selfhost: { id: "key1", secret: key } } });
        }
        if (method === "x:ApiKey/get") {
          if (input.authorization.startsWith("Basic ")) return response({ list: [] });
          // Capture must precede this first request, even when its journal write failed.
          const captured = JSON.parse(readFileSync(join(context.privateDirectory, "management-api-key.json"), "utf8"));
          assert.equal(captured.secret, key);
          assert.equal(statSync(join(context.privateDirectory, "management-api-key.json")).mode & 0o777, 0o600);
          assert.equal(input.authorization, `Bearer ${key}`);
          assert.deepEqual(args.ids, ["key1"]);
          if (failVerify) throw new Error("synthetic key verification failure");
          return response({ list: [{ id: "key1", description: "selfhost shared-owner management",
            permissions: { "@type": "Inherit" }, allowedIps: {} }] });
        }
        return inheritedRequest(input);
      },
    };
    if (scenario === "happy") {
      const result = await createStalwartApiKey(context, intent);
      assert.equal((result as any).status, "management-api-key-verified");
      assert.equal(JSON.stringify(result).includes(key), false);
      await createStalwartApiKey(context, intent);
    } else {
      await assert.rejects(createStalwartApiKey(context, intent));
      if (scenario === "lost") {
        await assert.rejects(createStalwartApiKey(context, intent), /never replay/);
      } else {
        failJournal = false;
        failVerify = false;
        await createStalwartApiKey(context, intent);
      }
    }
    assert.equal(creates, 1);
  }
} finally { rmSync(root, { recursive: true }); }
console.log("Stalwart headless: private capture-before-followup, no-replay, permanent identity, recovery removal and HTTPS intent fixture passed");
