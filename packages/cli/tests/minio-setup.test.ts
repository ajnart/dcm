import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/minio/setup.ts";
import derived from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/minio/derived-recipe.ts";
import { AISTOR_IMAGE, AISTOR_IMAGE_DIGEST, compileAistorConfiguration } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/minio/configuration.ts";
import { listBucketsHeaders } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/minio/s3-auth.ts";
import { multiServiceManifest, prepareMultiServiceFiles } from "../src/lib/multi-service-recipe.ts";
import { generatedPrivateFileLength } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/private-file.ts";
import type { SetupContext, SetupHttpRequest } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const username = "owner-selected-root-identity";
const compiled = compileAistorConfiguration({ edition: "aistor-licensed", rootUsername: username });
// Exercise the same generated credential contract as a shared install, not a
// hand-authored string that can hide a generator/adapter mismatch.
const privateRoot = await mkdtemp(join(tmpdir(), "minio-generated-credential-"));
let password: string;
try {
  const directory = join(privateRoot, "project");
  await prepareMultiServiceFiles(compiled.recipe, directory, join(directory, "data", "minio"),
    undefined, "minio", { "aistor-license": Buffer.from("synthetic-test-license-not-usable") });
  const path = join(directory, "secrets", "minio", "admin-password");
  password = await readFile(path, "utf8");
  assert.equal(password.length, generatedPrivateFileLength(48, "alphanumeric"));
  assert.equal(password.length, 65);
  await prepareMultiServiceFiles(compiled.recipe, directory, join(directory, "data", "minio"),
    undefined, "minio", { "aistor-license": Buffer.from("synthetic-test-license-not-usable") });
  assert.equal(await readFile(path, "utf8"), password, "Replay must preserve the saved credential");
} finally {
  await rm(privateRoot, { recursive: true, force: true });
}
const projectRoot = "/tmp/minio-synthetic-owner";
const manifest = multiServiceManifest({ recipe: compiled.recipe,
  images: { minio: `${AISTOR_IMAGE}@${AISTOR_IMAGE_DIGEST}` }, projectId: "minio-fixture",
  appsRoot: `${projectRoot}/apps`, projectDirectory: `${projectRoot}/apps/minio-fixture`,
  dataDirectory: `${projectRoot}/data`, dockerContext: "default", port: 19000,
  publishedPorts: { console: 19001 }, uid: 1000, gid: 1000,
  observed: { checkedAt: "2026-10-03T12:00:00.000Z", ports: [], paths: [], networks: [], volumes: [] } });
const service = manifest.services[0];
assert.deepEqual(service.ports.map((port: { hostIp: string; published: number; target: number }) =>
  [port.hostIp, port.published, port.target]), [["127.0.0.1", 19000, 9000], ["127.0.0.1", 19001, 9001]]);
assert.deepEqual(service.environment, [{ name: "MINIO_ROOT_USER", value: username },
  { name: "MINIO_SITE_REGION", value: "us-east-1" }, { name: "MINIO_LICENSE", value: "/run/secrets/aistor-license" },
  { name: "MINIO_ROOT_PASSWORD_FILE", value: "/run/secrets/admin-password" }]);
assert.equal(service.envFilePath, undefined);
assert.deepEqual(service.secretRefs.map((ref: { target: string }) => ref.target), ["aistor-license", "admin-password"]);
assert.deepEqual(service.fileEnvironmentConsumers, [{ name: "MINIO_LICENSE", target: "aistor-license",
  format: "file-path", officialUrl: "https://docs.min.io/aistor/reference/aistor-server/settings/core/", appId: "minio", source: "owner" }]);
let calls = 0;
let successBody = '<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>fixture-owner</ID></Owner><Buckets/></ListAllMyBucketsResult>';
let denialCode = "SignatureDoesNotMatch";
let transportError: Error | null = null;

// Independent verifier computes the signature from actual wire Host and header values.
const server = createServer((req, res) => {
  calls += 1;
  assert.equal(req.method, "GET");
  assert.equal(req.url, "/");
  const auth = req.headers.authorization;
  if (!auth) { res.writeHead(403); res.end("<Error><Code>AccessDenied</Code></Error>"); return; }
  const timestamp = String(req.headers["x-amz-date"]);
  const date = timestamp.slice(0, 8);
  const payload = createHash("sha256").update("").digest("hex");
  assert.equal(req.headers["x-amz-content-sha256"], payload);
  const scope = [date, "us-east-1", "s3", "aws4_request"].join("/");
  const signed = "host;x-amz-content-sha256;x-amz-date";
  const fields = ["host", "x-amz-content-sha256", "x-amz-date"];
  const headerBlock = fields.map((name) => `${name}:${req.headers[name]}\n`).join("");
  const canonical = ["GET", "/", "", headerBlock, signed, payload].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", timestamp, scope,
    createHash("sha256").update(canonical).digest("hex")].join("\n");
  let signingKey: Buffer = Buffer.from(`AWS4${password}`);
  for (const part of [date, "us-east-1", "s3", "aws4_request"]) {
    signingKey = createHmac("sha256", signingKey).update(part).digest();
  }
  const expected = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const expectedHeader = `AWS4-HMAC-SHA256 Credential=${username}/${scope}, SignedHeaders=${signed}, Signature=${expected}`;
  if (auth !== expectedHeader) { res.writeHead(403); res.end(`<Error><Code>${denialCode}</Code></Error>`); return; }
  res.writeHead(200); res.end(successBody);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const status = { command: "app status", appId: "minio", projectRoot, status: "applied", mutation: false,
  runtime: { state: "running" }, username, passwordFile: `${projectRoot}/admin-password`, url: origin,
  derivedRecipe: { appId: "minio", configuration: compiled.binding, configurationFilesVerified: true } };
const context = { appId: "minio", projectRoot, async status() { return status; },
  secrets: { async readAdminPassword() { return password; } },
  http: { async request(input: SetupHttpRequest) {
    if (transportError) throw transportError;
    assert.equal(input.approval, undefined);
    assert.equal(input.body, undefined);
    assert.equal(input.headers?.Host, undefined);
    return await new Promise((resolve, reject) => {
      const outgoing = request(new URL(input.path, origin), { method: input.method, headers: input.headers }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({ status: response.statusCode, ok: response.statusCode === 200,
            headers: { get() { return null; } }, async text() { return body.toString(); },
            async json() { throw new Error("S3 is XML, not JSON"); }, async arrayBuffer() { return Uint8Array.from(body).buffer; } });
        });
      });
      outgoing.on("error", reject); outgoing.end();
    });
  } },
} as unknown as SetupContext;
try {
  const first = await adapter.firstRun(context);
  assert.equal(adapter.ready(first), true);
  assert.deepEqual(await adapter.firstRun(context), first);
  assert.deepEqual(await adapter.inspect!(context), first);
  assert.equal(calls, 9);
  assert.equal(first.licenseVerified, false);
  assert.equal(first.storageWriteVerified, false);
  assert.equal(first.scopedAccessKeyCreated, false);
  assert.equal(first.backupVerified, false);
  assert.equal(adapter.apiKey, "not-created");
  assert.equal(JSON.stringify(first).includes(password), false);
  successBody = "<html>healthy</html>";
  await assert.rejects(adapter.firstRun(context), /saved S3 root credentials/);
  successBody = "<!DOCTYPE x><ListAllMyBucketsResult><Owner><ID>x</ID></Owner><Buckets/></ListAllMyBucketsResult>";
  await assert.rejects(adapter.firstRun(context), /saved S3 root credentials/);
  denialCode = "AccessDenied";
  await assert.rejects(adapter.firstRun(context), /incorrect S3 root signature/);
  transportError = new Error("fixture transport failure");
  await assert.rejects(adapter.firstRun(context), (error) => error === transportError);
  transportError = null;
  status.derivedRecipe.configuration.configurationFingerprint = "0".repeat(64);
  const previousCalls = calls;
  await assert.rejects(adapter.firstRun(context), /licensed-product/);
  assert.equal(calls, previousCalls);
  for (const invalidOrigin of ["http://localhost:9000", "http://127.0.0.1:9000/bucket", "https://127.0.0.1:9000", "http://user@127.0.0.1:9000"]) {
    assert.throws(() => listBucketsHeaders(invalidOrigin, username, password));
  }
  const derivedResult = derived.derive({} as never, { edition: "aistor-licensed", "root-username": username });
  assert.deepEqual(derivedResult.recipe, compiled.recipe);
  assert.deepEqual(derivedResult.peerAppIds, []);
  assert.throws(() => derived.derive({} as never, { edition: "community", "root-username": username }));
  assert.equal(compiled.recipe.services[0].secretEnvironment, undefined);
  assert.equal(compiled.recipe.onboarding.kind, "initial-admin-from-file");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve(); }));
}
console.log("MinIO licensed-selection/read-only S3 fixture passed (synthetic server; no AIStor runtime acceptance)");
