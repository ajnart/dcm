import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSetupTransportFacilities } from "../src/control-panel/setup-transport.ts";
import { compileStalwartRecipe, imageTag, setupStalwartPrivateAdministration,
  type StalwartOwnerBridge } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/stalwart-mail/recipe.ts";

const input = {
  projectDirectory: "/tmp/stalwart-private-recipe", image: `${imageTag}@sha256:${"a".repeat(64)}`,
  managementPort: 18080, privateNetwork: "private",
  intent: { hostname: "mail.example.test", domain: "example.test", httpsOrigin: "https://mail.example.test",
    dataPath: "/var/lib/stalwart/", logPath: "/var/lib/stalwart/logs/" },
};

describe("Stalwart staged private-administration recipe", () => {
  test("common JMAP transport sends strict reads and approved checkpointed writes without replay or HTTPS downgrade", async () => {
    const root = await mkdtemp(join(tmpdir(), "stalwart-jmap-fixture-"));
    const projectId = "stalwart_fixture";
    const directory = join(root, ".selfhost", "shared", projectId);
    const privateFiles = join(directory, "secrets", "stalwart-mail");
    await mkdir(privateFiles, { recursive: true, mode: 0o700 });
    const passwordFile = join(privateFiles, "admin-password");
    await writeFile(passwordFile, "synthetic-password", { mode: 0o600 });
    let sends = 0;
    let checkpointed = false;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      sends++;
      const call = (await request.json()).methodCalls[0];
      if (call[0].endsWith("/set")) expect(checkpointed).toBe(true);
      return Response.json({ methodResponses: [[call[0], { list: [] }, "c1"]] });
    } });
    try {
      const status = { command: "app status", ownerKind: "shared", appId: "stalwart-mail", projectRoot: root,
        mutation: false, status: "applied", runtime: { state: "running" }, projectId,
        dockerContext: "default", port: server.port, url: `http://127.0.0.1:${server.port}`,
        composeTarget: join(directory, "compose.aaaaaaaaaaaaaaaa.yaml"),
        applyApproval: `SHARED-APPLY:${projectId}:${"a".repeat(64)}`, ownerRevision: 1,
        manifestHash: "b".repeat(64), ownerPhase: "completed", privateFiles, passwordFile };
      let approvals = 0;
      let accept = false;
      const transport = createSetupTransportFacilities({ appId: "stalwart-mail", projectRoot: root,
        async readStatus() { return status; }, async readHandoff() { throw new Error("unexpected handoff"); },
        async approve(_action, token) { approvals++; expect(token).toMatch(/^APP-SETUP-STALWART-BOOTSTRAP:/); return accept; },
        approvalQueue: { tail: Promise.resolve() }, registerSecret() {}, redact(value) { return value; } });
      const read = { endpoint: "recovery" as const, path: "/api" as const, effect: "read" as const,
        authorization: "Basic c3ludGhldGljOnBhc3N3b3Jk", body: JSON.stringify({
          using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],
          methodCalls: [["x:Bootstrap/get", { ids: ["singleton"] }, "c1"]] }) };
      expect((await transport.jmap.request(read)).status).toBe(200);
      expect(approvals).toBe(0);
      await expect(transport.jmap.request({ ...read, endpoint: "https", origin: "https://mail.localhost:4443" }))
        .rejects.toThrow("canonical HTTPS origin");
      const write = { ...read, effect: "write" as const, body: read.body.replace("Bootstrap/get", "Bootstrap/set"),
        async beforeSend() {
          expect((await transport.checkpoint.read())?.attemptedActions).toContain("stalwart-bootstrap");
          checkpointed = true;
        } };
      await expect(transport.jmap.request({ ...write, effect: "read" })).rejects.toThrow("method effect");
      await expect(transport.jmap.request({ ...read, body: read.body.replace("Bootstrap/get", "Unknown/get") }))
        .rejects.toThrow("method effect");
      await expect(transport.jmap.request({ ...write, beforeSend: undefined })).rejects.toThrow("pre-send checkpoint");
      await expect(transport.jmap.request(write)).rejects.toThrow("approval was declined");
      expect(sends).toBe(1);
      expect(await transport.checkpoint.read()).toBeNull();
      accept = true;
      expect((await transport.jmap.request(write)).status).toBe(200);
      expect(sends).toBe(2);
      await expect(transport.jmap.request(write)).rejects.toThrow("already attempted");
      expect(sends).toBe(2);
    } finally { server.stop(true); await rm(root, { recursive: true, force: true }); }
  });
  test("immutable image, no config prewrite, private management only and exact recovery closure", () => {
    const recipe = compileStalwartRecipe(input);
    expect(recipe.service.image).toBe(input.image);
    expect(recipe.service.ports).toEqual([{ hostIp: "127.0.0.1", published: 18080, target: 8080,
      protocol: "tcp", purpose: "application", publicApproved: false }]);
    expect(recipe.service.envFilePath).toBe("/tmp/stalwart-private-recipe/secrets/stalwart-mail/recovery.env");
    expect(recipe.service.environment).toEqual([{ name: "STALWART_PUBLIC_URL", value: input.intent.httpsOrigin }]);
    expect(recipe.service.mounts.map((mount) => mount.target)).toEqual(["/etc/stalwart", "/var/lib/stalwart"]);
    expect(recipe.config).toEqual({ mustBeAbsentAtFreshStart: "/etc/stalwart/config.json", writer: "x:Bootstrap/set",
      directory: "Internal", dataStore: "RocksDb", dns: "Manual", acme: false, dkim: false });
    expect(recipe.recoveryClosure.names).toEqual(["STALWART_RECOVERY_MODE", "STALWART_RECOVERY_ADMIN"]);
    expect(recipe.recoveryClosure.requireSavedAndLiveAbsence).toBe(true);
    expect(recipe.status).toBe("staged-owner-facilities-required");
    expect(JSON.stringify(recipe)).not.toContain("recovery:");
  });
  test("preserves the exact private high-port advertised origin", () => {
    const origin = "https://mail.localhost:4443";
    const recipe = compileStalwartRecipe({ ...input,
      intent: { ...input.intent, hostname: "mail.localhost", httpsOrigin: origin } });
    expect(recipe.service.environment).toEqual([{ name: "STALWART_PUBLIC_URL", value: origin }]);
    expect(recipe.status).toBe("staged-owner-facilities-required");
    expect(recipe.recoveryClosure.names).toEqual(["STALWART_RECOVERY_MODE", "STALWART_RECOVERY_ADMIN"]);
  });
  test("rejects mutable images, alternate config/storage identity and unsafe selections", () => {
    for (const change of [{ image: imageTag }, { image: `${imageTag}@sha256:short` },
      { image: `stalwartlabs/stalwart:latest@sha256:${"a".repeat(64)}` },
      { projectDirectory: "/tmp/../private" }, { managementPort: 25 }, { privateNetwork: "${NETWORK}" },
      { intent: { ...input.intent, httpsOrigin: "http://mail.example.test" } },
      { intent: { ...input.intent, httpsOrigin: "https://other.example.test" } },
      { intent: { ...input.intent, dataPath: "/elsewhere/" } }]) {
      expect(() => compileStalwartRecipe({ ...input, ...change })).toThrow();
    }
  });
  test("bridge acquires exclusive owner lease and fails closed before secret access", async () => {
    const calls: string[] = [];
    const owner: StalwartOwnerBridge = {
      async withExclusiveSetupLease(recipe, run) {
        expect(recipe.appId).toBe("stalwart-mail"); calls.push("lease");
        try { return await run(); } finally { calls.push("release"); }
      },
      async inspect() { calls.push("inspect"); throw new Error("checked owner facility unavailable"); },
      context: {
        registerSecret() { throw new Error("unexpected private read"); },
        journal: { async read() { throw new Error("unexpected journal read"); }, async save() {} },
        apiKeyJournal: { async read() { throw new Error("unexpected key read"); }, async save() {} },
      },
      transport: { jmap: { async request() { throw new Error("unexpected API"); } } },
      async startFreshRecovery() { throw new Error("unexpected start"); },
      async waitForRecovery() { throw new Error("unexpected wait"); },
      async applyRecoveryTransition() { throw new Error("unexpected transition"); },
    };
    await expect(setupStalwartPrivateAdministration(input, owner)).rejects.toThrow("checked owner facility unavailable");
    expect(calls).toEqual(["lease", "inspect", "release"]);
  });
});
