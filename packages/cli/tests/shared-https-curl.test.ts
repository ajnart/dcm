import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:https";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateCurlResponse } from "../src/control-panel/setup-private-curl.ts";
import type { SharedHttpsTarget } from "../src/lib/shared-https-target.ts";
import { createSetupTransportFacilities } from "../src/control-panel/setup-transport.ts";

const directory = await mkdtemp(join(tmpdir(), "shared-https-curl-"));
const serverRequests: Array<{ host: string | undefined; sni: string; cookie: string | undefined; body: string }> = [];
let server: ReturnType<typeof createServer> | undefined;
try {
  // Local generated certificates only: no Docker, installed trust, or external endpoints.
  function openssl(args: string[]) {
    const result = spawnSync("openssl", args, { cwd: directory, stdio: "ignore" });
    assert.equal(result.status, 0, "local certificate fixture generation");
  }
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "root.key", "-out", "private-https-root.crt",
    "-days", "1", "-subj", "/CN=Fixture root", "-addext", "basicConstraints=critical,CA:TRUE"]);
  openssl(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "server.key", "-out", "server.csr",
    "-subj", "/CN=alpha.localhost", "-addext", "subjectAltName=DNS:alpha.localhost"]);
  openssl(["x509", "-req", "-in", "server.csr", "-CA", "private-https-root.crt", "-CAkey", "root.key",
    "-CAcreateserial", "-out", "server.crt", "-days", "1", "-copy_extensions", "copy"]);
  const caPath = join(directory, "private-https-root.crt");
  await chmod(caPath, 0o600);
  server = createServer({ key: await readFile(join(directory, "server.key")),
    cert: await readFile(join(directory, "server.crt")) }, async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    serverRequests.push({ host: request.headers.host, sni: (request.socket as any).servername,
      cookie: request.headers.cookie, body: Buffer.concat(chunks).toString() });
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "https://unowned.example/", "set-cookie": ["a=one; Secure", "b=two; Secure"] });
      response.end();
      return;
    }
    if (request.url === "/owned-redirect") {
      response.writeHead(302, { location: `https://${request.headers.host}/api-tokens/1/2/` });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json", "x-api-key": "synthetic-response-token",
      "set-cookie": "private=synthetic-response-cookie; Secure" });
    response.end(JSON.stringify({ ready: true }));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const target: SharedHttpsTarget = { schemaVersion: 1, kind: "shared-private-https-target", appId: "alpha",
    projectId: "fixture", ownerRevision: 1, ownerRecordHash: "a".repeat(64), manifestHash: "b".repeat(64),
    bindingHash: "c".repeat(64), hostname: "alpha.localhost", port: address.port,
    origin: `https://alpha.localhost:${address.port}`, resolveAddress: "127.0.0.1", caPath,
    caSha256: createHash("sha256").update(await readFile(caPath)).digest("hex") };
  const initialFiles = (await readdir(directory)).sort();
  let preflights = 0;
  const revalidate = async () => { preflights++; };
  const result = await privateCurlResponse(target, "POST", "/setup", { "Content-Type": "application/json",
    Cookie: "private=fixture-value" }, Buffer.from('{"password":"fixture-only"}'), directory, 5000, revalidate);
  assert.equal(preflights, 2);
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.bytes.toString()), { ready: true });
  assert.deepEqual(serverRequests[0], { host: `alpha.localhost:${address.port}`, sni: "alpha.localhost",
    cookie: "private=fixture-value", body: '{"password":"fixture-only"}' });
  const redirect = await privateCurlResponse(target, "GET", "/redirect", {}, undefined, directory, 5000, revalidate);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers["set-cookie"]?.length, 2);
  assert.equal(serverRequests.length, 2, "redirect must never be followed");
  const wrongName = { ...target, hostname: "other.localhost", origin: `https://other.localhost:${address.port}` };
  await assert.rejects(privateCurlResponse(wrongName, "GET", "/", {}, undefined, directory, 5000, revalidate), /payload withheld/);
  assert.equal(serverRequests.length, 2, "wrong certificate identity sends no HTTP request");
  await assert.rejects(privateCurlResponse({ ...target, caSha256: "d".repeat(64) }, "GET", "/", {}, undefined, directory, 5000, revalidate), /exact owner/);
  await assert.rejects(privateCurlResponse(target, "GET", "//unowned.example/", {}, undefined, directory, 5000, revalidate), /payload withheld/);
  await assert.rejects(privateCurlResponse(target, "GET", "/", { Host: "unowned.example" }, undefined, directory, 5000, revalidate), /payload withheld/);
  let checks = 0;
  await assert.rejects(privateCurlResponse(target, "POST", "/setup", {}, Buffer.from("private"), directory, 5000,
    async () => { if (++checks === 2) throw new Error("owner changed"); }), /owner changed/);
  assert.equal(serverRequests.length, 2, "changed owner before send must not receive credentials");
  assert.deepEqual((await readdir(directory)).sort(), initialFiles, "temporary payloads are removed on success and failure");
  const projectDirectory = join(directory, ".selfhost", "shared", "fixture");
  const privateFiles = join(projectDirectory, "secrets", "alpha");
  await mkdir(privateFiles, { recursive: true, mode: 0o700 });
  await writeFile(join(privateFiles, "admin-password"), "synthetic-owner-password", { mode: 0o600 });
  await writeFile(join(projectDirectory, "private-https-root.crt"), await readFile(caPath), { mode: 0o600 });
  const savedTarget = { ...target, caPath: join(projectDirectory, "private-https-root.crt") };
  let currentTarget: SharedHttpsTarget | null = savedTarget;
  const secrets: string[] = [];
  const tokens: string[] = [];
  let approve = false;
  let drift = false;
  const status = { command: "app status", ownerKind: "shared", appId: "alpha", projectRoot: directory,
    mutation: false, status: "applied", runtime: { state: "running" }, projectId: "fixture",
    dockerContext: "default", port: 18989, url: "http://127.0.0.1:18989",
    composeTarget: join(projectDirectory, "compose.aaaaaaaaaaaaaaaa.yaml"),
    applyApproval: `SHARED-APPLY:fixture:${"a".repeat(64)}`, ownerRevision: 1, manifestHash: "b".repeat(64),
    privateFiles, passwordFile: join(privateFiles, "admin-password") };
  const facilities = createSetupTransportFacilities({ appId: "alpha", projectRoot: directory,
    async readStatus() { return status; }, async readHandoff() { throw new Error("unexpected handoff"); },
    async resolveHttpsTarget() { return currentTarget; },
    async approve(_action, token) {
      tokens.push(token);
      if (drift) currentTarget = { ...savedTarget, bindingHash: "e".repeat(64) };
      return approve;
    }, approvalQueue: { tail: Promise.resolve() },
    registerSecret(value) { secrets.push(value); }, redact(value) { return value; } });
  const request = { method: "POST" as const, path: "/setup", body: '{"password":"synthetic-owner-password"}',
    approval: { action: "fixture-write", progress: "Review protected fixture" } };
  const beforeReview = serverRequests.length;
  await assert.rejects(facilities.http.request(request), /approval was declined/);
  const firstToken = tokens.at(-1);
  await assert.rejects(facilities.http.request({ ...request, requireHttps: true }), /approval was declined/);
  assert.notEqual(tokens.at(-1), firstToken, "review binds mandatory HTTPS versus optional transport");
  currentTarget = null;
  const secretCount = secrets.length;
  const reviewCount = tokens.length;
  for (const input of [{ method: "GET" as const, path: "/read", requireHttps: true as const },
    { ...request, requireHttps: true as const, approval: { ...request.approval, once: true },
      beforeSendCheckpoint: { expectedRevision: null, stage: "must-not-write" } }]) {
    await assert.rejects(facilities.http.request(input), /HTTP fallback is forbidden/);
  }
  assert.equal(secrets.length, secretCount, "missing required HTTPS is rejected before payload registration");
  assert.equal(tokens.length, reviewCount, "missing required HTTPS requests no mutation approval");
  assert.equal(await facilities.checkpoint.read(), null, "missing required HTTPS writes no checkpoint");
  assert.equal(serverRequests.length, beforeReview, "missing required HTTPS sends no request");
  await assert.rejects(facilities.http.request({ method: "GET", path: "/read", requireHttps: false } as never),
    /HTTPS requirement must be true/);
  currentTarget = { ...savedTarget, bindingHash: "e".repeat(64) };
  await assert.rejects(facilities.http.request(request), /approval was declined/);
  assert.notEqual(tokens.at(-1), firstToken, "review token binds TLS route identity");
  currentTarget = { ...savedTarget, ownerRecordHash: "f".repeat(64) };
  await assert.rejects(facilities.http.request(request), /approval was declined/);
  assert.notEqual(tokens.at(-1), firstToken, "review token binds exact owner identity");
  currentTarget = savedTarget;
  approve = true;
  drift = true;
  await assert.rejects(facilities.http.request(request), /identity changed during approval/);
  assert.equal(serverRequests.length, beforeReview, "stale TLS approval sends no request");
  currentTarget = savedTarget;
  drift = false;
  const protectedResult = await facilities.http.request({ ...request, requireHttps: true });
  assert.equal(protectedResult.status, 200);
  assert.equal(protectedResult.headers.get("x-api-key"), null, "sensitive response headers remain private");
  assert.ok(secrets.includes("synthetic-response-token"));
  assert.ok(secrets.includes("private=synthetic-response-cookie; Secure"));
  assert.equal((await facilities.http.request({ method: "GET", path: "/read", requireHttps: true })).status, 200);
  const protectedRedirect = await facilities.http.request({ method: "GET", path: "/redirect" });
  assert.equal(protectedRedirect.headers.get("location"), null, "shared policy withholds external locations");
  assert.equal(protectedRedirect.headers.get("set-cookie"), null, "multiple cookies do not collapse into one header");
  assert.deepEqual(protectedRedirect.headers.getSetCookie?.(), ["a=one; Secure", "b=two; Secure"]);
  assert.ok(secrets.includes("a=one; Secure"));
  const beforeOwnedRedirect = serverRequests.length;
  const ownedRedirect = await facilities.http.request({ method: "GET", path: "/owned-redirect" });
  assert.equal(ownedRedirect.headers.get("location"), "/api-tokens/1/2/",
    "shared policy exposes only the exact pinned HTTPS origin's path");
  assert.equal(serverRequests.length, beforeOwnedRedirect + 1, "owned redirect must not be followed");
  await facilities.secrets.writeSessionCookies({ session: "synthetic-session" });
  currentTarget = { ...savedTarget, bindingHash: "e".repeat(64) };
  await assert.rejects(facilities.secrets.readSessionCookies(), /different app owner or origin/);
  currentTarget = savedTarget;
  drift = true;
  // Losing an already-approved HTTPS target cannot downgrade this operation to backend HTTP.
  const downgrade = createSetupTransportFacilities({ appId: "alpha", projectRoot: directory,
    async readStatus() { return status; }, async readHandoff() { throw new Error("unexpected handoff"); },
    async resolveHttpsTarget() { return currentTarget; }, async approve() { currentTarget = null; return true; },
    approvalQueue: { tail: Promise.resolve() }, registerSecret() {}, redact(value) { return value; } });
  await assert.rejects(downgrade.http.request(request), /identity changed during approval/);
  currentTarget = savedTarget;
  const beforeDowngrade = serverRequests.length;
  await assert.rejects(downgrade.http.request({ ...request, requireHttps: true }), /HTTP fallback is forbidden/);
  assert.equal(serverRequests.length, beforeDowngrade, "required HTTPS lost during review sends no request");
  console.log("shared HTTPS curl fixture passed (local generated TLS only; no Docker or trust-store changes)");
} finally {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
}
