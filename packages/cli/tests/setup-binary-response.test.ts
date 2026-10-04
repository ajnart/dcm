import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSetupTransportFacilities } from "../src/control-panel/setup-transport.ts";

const maxResponseBytes = 1024 * 1024;
const binary = Uint8Array.from([0, 255, 254, 128, 195, 40, 13, 10, 0]);
const jsonText = '{"title":"Grüße 世界","count":3}\n';
const root = await mkdtemp(join(tmpdir(), "selfhost-setup-binary-response-"));
const seen: string[] = [];
const server = createServer((request, response) => {
  seen.push(request.url ?? "");
  const origin = `http://${request.headers.host}`;
  const redirects: Record<string, string> = {
    "/redirect-relative": "/api-tokens/1/2/",
    "/redirect-owned": `${origin}/api-tokens/1/2/`,
    "/redirect-foreign": "http://unowned.example/api-tokens/1/2/",
    "/redirect-port": "http://127.0.0.1:1/api-tokens/1/2/",
    "/redirect-userinfo": origin.replace("http://", "http://admin:private@") + "/api-tokens/1/2/",
    "/redirect-query": `${origin}/api-tokens/1/2/?secret=private`,
    "/redirect-hash": `${origin}/api-tokens/1/2/#private`,
    "/redirect-network": "//unowned.example/api-tokens/1/2/",
    "/redirect-owned-network-path": `${origin}//unowned.example/api-tokens/1/2/`,
    "/redirect-backslash": `${origin}/api-tokens\\1/2/`,
  };
  const location = redirects[request.url ?? ""];
  if (location) {
    response.writeHead(302, { Location: location });
    response.end();
    return;
  }
  if (request.url === "/binary") {
    response.writeHead(200, { "Content-Type": "application/octet-stream",
      "Content-Length": String(binary.byteLength),
      "Content-Disposition": "inline; filename*=UTF-8''fixture.bin",
      "Content-Range": "bytes 0-8/9" });
    response.end(binary);
    return;
  }
  if (request.url === "/oversize-download-metadata") {
    response.writeHead(200, { "Content-Disposition": "x".repeat(2049) });
    response.end(binary);
    return;
  }
  if (request.url === "/json") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(jsonText);
    return;
  }
  if (request.url === "/limit") {
    response.end(Buffer.alloc(maxResponseBytes, 255));
    return;
  }
  if (request.url === "/oversize") {
    // Deliberately omit Content-Length: the actual received bytes must be bounded.
    response.writeHead(200, { "Transfer-Encoding": "chunked" });
    response.end(Buffer.alloc(maxResponseBytes + 1, 254));
    return;
  }
  if (request.url === "/challenge") {
    response.writeHead(401, { "WWW-Authenticate": 'Basic realm="Kopia"' });
    response.end();
    return;
  }
  if (request.url === "/oversize-challenge") {
    response.writeHead(401, { "WWW-Authenticate": "x".repeat(2049) });
    response.end();
    return;
  }
  if (request.url === "/malformed") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(`{"password":"synthetic-private-value"${"x".repeat(9000)}`);
    return;
  }
  response.writeHead(404);
  response.end();
});

try {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const projectId = "binary-response-test";
  const appDirectory = join(root, ".selfhost", "apps", projectId);
  const privateFiles = join(appDirectory, "secrets");
  await mkdir(privateFiles, { recursive: true, mode: 0o700 });
  const facilities = createSetupTransportFacilities({
    appId: "jellyfin", projectRoot: root,
    async readStatus() {
      return {
        command: "app status", appId: "jellyfin", projectRoot: root,
        status: "applied", mutation: false, runtime: { state: "running" },
        projectId, port: address.port, dockerContext: "default",
        composeTarget: join(appDirectory, "compose.aaaaaaaaaaaaaaaa.yaml"),
        applyApproval: `APP-APPLY:jellyfin:${"a".repeat(64)}`,
        url: `http://127.0.0.1:${address.port}`, privateFiles,
        // Reference only: no credential file is created or read by this fixture.
        passwordFile: join(privateFiles, "admin-password"),
      };
    },
    async readHandoff() { throw new Error("Unexpected handoff read"); },
    async approve() { throw new Error("Read-only fixture must not request approval"); },
    approvalQueue: { tail: Promise.resolve() },
    registerSecret() {},
    redact(value) { return value; },
  });

  const response = await facilities.http.request({ method: "GET", path: "/binary" });
  assert.equal(response.status, 200);
  assert.equal(response.ok, true);
  assert.equal(response.headers.get("Content-Disposition"), "inline; filename*=UTF-8''fixture.bin");
  assert.equal(response.headers.get("CONTENT-LENGTH"), String(binary.byteLength));
  assert.equal(response.headers.get("content-range"), "bytes 0-8/9");
  assert.equal(response.headers.get("x-unreviewed-header"), null);
  const first = await response.arrayBuffer();
  assert.ok(first instanceof ArrayBuffer);
  assert.equal(first.byteLength, binary.byteLength);
  assert.deepEqual(new Uint8Array(first), binary);
  new Uint8Array(first).fill(42);
  const second = await response.arrayBuffer();
  assert.notEqual(first, second);
  assert.deepEqual(new Uint8Array(second), binary);
  assert.equal(await response.text(), Buffer.from(binary).toString("utf8"));

  const json = await facilities.http.request({ method: "GET", path: "/json" });
  assert.equal(await json.text(), jsonText);
  assert.deepEqual(await json.json(), { title: "Grüße 世界", count: 3 });
  const jsonBytes = await json.arrayBuffer();
  assert.deepEqual(new Uint8Array(jsonBytes), new TextEncoder().encode(jsonText));
  new Uint8Array(jsonBytes).fill(0);
  assert.equal(await json.text(), jsonText);
  assert.deepEqual(await json.json(), { title: "Grüße 世界", count: 3 });

  const atLimit = await facilities.http.request({ method: "GET", path: "/limit" });
  assert.deepEqual(new Uint8Array(await atLimit.arrayBuffer()),
    new Uint8Array(maxResponseBytes).fill(255));
  await assert.rejects(facilities.http.request({ method: "GET", path: "/oversize" }),
    { message: "Local setup response exceeded the bounded size; inspect its checkpoint" });
  await assert.rejects(facilities.http.request({ method: "GET", path: "/oversize-download-metadata" }),
    { message: "Local setup download metadata was invalid; payload withheld" });
  const challenge = await facilities.http.request({ method: "GET", path: "/challenge" });
  assert.equal(challenge.headers.get("www-authenticate"), 'Basic realm="Kopia"');
  const oversized = await facilities.http.request({ method: "GET", path: "/oversize-challenge" });
  assert.equal(oversized.headers.get("WWW-Authenticate"), null);
  const malformed = await facilities.http.request({ method: "GET", path: "/malformed" });
  await assert.rejects(malformed.json(), { message: "Local setup response was not valid JSON; payload withheld" });
  const redirectPaths = ["/redirect-relative", "/redirect-owned", "/redirect-foreign", "/redirect-port",
    "/redirect-userinfo", "/redirect-query", "/redirect-hash", "/redirect-network", "/redirect-owned-network-path", "/redirect-backslash"];
  for (const path of redirectPaths) {
    const redirect = await facilities.http.request({ method: "GET", path });
    assert.equal(redirect.status, 302);
    let expected: string | null = null;
    if (path === "/redirect-relative" || path === "/redirect-owned") expected = "/api-tokens/1/2/";
    assert.equal(redirect.headers.get("location"), expected);
  }
  assert.deepEqual(seen, ["/binary", "/json", "/limit", "/oversize", "/oversize-download-metadata", "/challenge", "/oversize-challenge", "/malformed", ...redirectPaths],
    "redirect metadata must not automatically dispatch another request");
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true });
}

process.stdout.write("setup binary response checks passed\n");
