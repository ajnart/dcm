import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSetupTransportFacilities } from "../src/control-panel/setup-transport.ts";
import { decodeBootstrapPasswordProfile, parseBootstrapPassword } from "../src/lib/bootstrap-password-profile.ts";
import { prepareMultiServiceFiles } from "../src/lib/multi-service-recipe.ts";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/stalwart-mail/setup.ts";
import derived from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/stalwart-mail/derived-recipe.ts";
import profile from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/stalwart-mail/bootstrap-password.json";
import type { SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const password = "PermanentSecret1";
const key = `API_${"k".repeat(38)}`;
test("Stalwart exact native bootstrap block and explicit administration-only recipe", () => {
  const parsed = decodeBootstrapPasswordProfile(profile, "stalwart-mail");
  const lines = ["🔑 Stalwart bootstrap mode - temporary administrator account", "", "   username: admin", "   password: TemporarySecret1"];
  expect(parseBootstrapPassword(parsed, lines, () => {})).toBe("TemporarySecret1");
  expect(() => parseBootstrapPassword(parsed, [...lines, ...lines], () => {})).toThrow("unique");
  const selected = derived.derive({} as any, { hostname: "mail.example.test", domain: "example.test", scope: "administration-only" });
  expect(selected.recipe.services[0].environment).toContainEqual({ name: "STALWART_RECOVERY_MODE", value: "1" });
  expect(selected.recipe.services[0].environment.some((item: any) => item.name === "STALWART_RECOVERY_ADMIN")).toBe(false);
  expect(selected.recipe.services[0].publishTargetPort).toBe(8080);
  expect(selected.configuration.mailDelivery).toBe("pending");
  expect(() => derived.derive({} as any, { hostname: "mail.example.test", domain: "example.test", scope: "mail-ready" })).toThrow("administration-only");
});

test("Consumed shared adapter captures once-returned admin/key before readback, resumes without writes and leaves mail pending", async () => {
  const root = await mkdtemp(join(tmpdir(), "stalwart-shared-source-fixture-"));
  const projectId = "stalwart_fixture";
  const directory = join(root, ".selfhost", "shared", projectId);
  const privateFiles = join(directory, "secrets", "stalwart-mail");
  await mkdir(privateFiles, { recursive: true, mode: 0o700 });
  const passwordFile = join(privateFiles, "admin-password");
  await writeFile(passwordFile, "synthetic-private-placeholder", { mode: 0o600 });
  let bootstraps = 0;
  let keyCreates = 0;
  let activated = false;
  let failReadback = true;
  let transport: ReturnType<typeof createSetupTransportFacilities>;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const [method, args] = (await request.json()).methodCalls[0];
    const authorization = request.headers.get("authorization")!;
    if (authorization === `Basic ${Buffer.from(`admin@example.test:${password}-invalid`).toString("base64")}`) return new Response("", { status: 401 });
    let data: any;
    if (method === "x:Bootstrap/get") data = { list: [{ id: "singleton" }], notFound: [] };
    else if (method === "x:Bootstrap/set") {
      bootstraps++;
      expect((await transport.checkpoint.read())?.attemptedActions).toContain("stalwart-bootstrap");
      data = { updated: { singleton: { username: "admin@example.test", secret: password } }, notUpdated: {} };
    } else {
      expect(activated).toBe(true);
      expect(await readFile(passwordFile, "utf8")).toBe(password);
      if (method === "x:SystemSettings/get") data = { list: [{ id: "singleton", defaultHostname: "mail.example.test", defaultDomainId: "d1" }] };
      else if (method === "x:Domain/get") data = { list: [{ id: "d1", name: "example.test", isEnabled: true }] };
      else if (method === "x:Account/get") data = { list: [{ id: "u1", "@type": "User", name: "admin", emailAddress: "admin@example.test", domainId: "d1", roles: { "@type": "Admin" } }] };
      else if (method === "x:ApiKey/set") {
        keyCreates++;
        expect((await transport.checkpoint.read())?.attemptedActions).toContain("stalwart-management-key");
        data = { created: { selfhost: { id: "k1", secret: key } }, notCreated: {} };
      } else if (method === "x:ApiKey/get") {
        if (authorization === `Bearer ${key}`) {
          expect(await readFile(join(privateFiles, "stalwart-mail-api-key"), "utf8")).toBe(key);
          if (failReadback) { failReadback = false; return new Response("", { status: 503 }); }
          data = { list: [{ id: "k1", description: "selfhost shared-owner management", permissions: { "@type": "Inherit" }, allowedIps: {} }] };
        } else data = { list: [] };
      } else throw new Error("Unexpected fixture method");
    }
    return Response.json({ methodResponses: [[method, data, "c1"]] });
  } });
  try {
    const status = { command: "app status", ownerKind: "shared", appId: "stalwart-mail", projectRoot: root,
      mutation: false, status: "applied", runtime: { state: "running" }, projectId, username: "admin@example.test",
      dockerContext: "default", port: server.port, url: `http://127.0.0.1:${server.port}`,
      composeTarget: join(directory, "compose.aaaaaaaaaaaaaaaa.yaml"),
      applyApproval: `SHARED-APPLY:${projectId}:${"a".repeat(64)}`, ownerRevision: 1,
      selectionFingerprint: "c".repeat(64),
      manifestHash: "b".repeat(64), ownerPhase: "completed", privateFiles, passwordFile };
    transport = createSetupTransportFacilities({ appId: "stalwart-mail", projectRoot: root,
      async readStatus() { return status; }, async readHandoff() { throw new Error("unexpected handoff"); },
      async approve() { return true; }, approvalQueue: { tail: Promise.resolve() }, registerSecret() {}, redact(value) { return value; } });
    const context = { appId: "stalwart-mail", projectRoot: root, installedAppIds: ["stalwart-mail"],
      inputs: { hostname: "mail.example.test", domain: "example.test" }, async status() { return status; },
      ...transport,
      checkpoint: { ...transport.checkpoint, async read() {
        const current = await transport.checkpoint.read();
        if (current && activated) return { ...current, attemptedActions: [...current.attemptedActions, "stalwart-activate-captured-administrator"] };
        return current;
      } },
      container: { async exec() { return { exitCode: 0, stdout: "" }; } },
      jmap: { ...transport.jmap, async restartBootstrap() {
        expect(await transport.jmap.captured()).toEqual({ administrator: true, managementKeyId: null });
        activated = true;
      } },
      secrets: { ...transport.secrets, async readBootstrapPassword() { return "TemporarySecret1"; } },
    } as SetupContext;
    await expect(adapter.firstRun(context)).rejects.toThrow("Stalwart");
    expect(await transport.jmap.captured()).toEqual({ administrator: true, managementKeyId: "k1" });
    const result = await adapter.firstRun(context);
    expect(adapter.ready(result)).toBe(true);
    expect(result.recoveryClosure).toBe("pending-native-listener-policy");
    expect(result.mailDelivery).toBe("pending");
    expect(bootstraps).toBe(1);
    expect(keyCreates).toBe(1);
    expect((await adapter.inspect!(context)).stage).toBe("administration-verified");
    // An unrelated owner revision changes its apply token, not this app's exact selection.
    status.ownerRevision = 2;
    status.applyApproval = `SHARED-APPLY:${projectId}:${"d".repeat(64)}`;
    expect(await transport.jmap.captured()).toEqual({ administrator: true, managementKeyId: "k1" });
    expect((await adapter.firstRun(context)).stage).toBe("administration-verified");
    expect(bootstraps).toBe(1);
    expect(keyCreates).toBe(1);
    status.selectionFingerprint = "e".repeat(64);
    await expect(transport.jmap.captured()).rejects.toThrow("selection owner");
    status.selectionFingerprint = "c".repeat(64);
    const selected = derived.derive({} as any, { hostname: "mail.example.test", domain: "example.test", scope: "administration-only" });
    await prepareMultiServiceFiles(selected.recipe, directory, join(directory, "data", "stalwart-mail"), {}, "stalwart-mail");
    expect(await readFile(passwordFile, "utf8")).toBe(password);
    const changedIdentity = structuredClone(selected.recipe);
    changedIdentity.onboarding.email = "admin@different.test";
    await expect(prepareMultiServiceFiles(changedIdentity, directory, join(directory, "data", "stalwart-mail"), {}, "stalwart-mail")).rejects.toThrow("receipt differs");
    const response = { endpoint: "recovery" as const, path: "/api" as const, effect: "write" as const, capture: "administrator" as const,
      authorization: "Basic YTpi", beforeSend: async () => {}, body: JSON.stringify({ using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],
        methodCalls: [["x:Bootstrap/set", { update: { singleton: { defaultDomain: "example.test" } } }, "c1"]] }) };
    await expect(transport.jmap.request(response)).rejects.toThrow("already captured");
  } finally { server.stop(true); await rm(root, { recursive: true, force: true }); }
});
