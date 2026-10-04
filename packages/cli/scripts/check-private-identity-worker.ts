#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Synthetic, focused installed-runtime fixture; no Docker or private owner files.
const directory = await mkdtemp(join(tmpdir(), "selfhost-private-identity-fixture-"));
try {
  const worker = fileURLToPath(new URL("../src/lib/private-identity-worker.ts", import.meta.url));
  const runtime = fileURLToPath(new URL("../src/lib/private-identity-bun.ts", import.meta.url));
  const source = join(directory, "fixture.ts");
  const installed = join(directory, "installed");
  const privateRuntime = join(installed, "workflows/selfhost/references/mutable-config-runtime/private-identity-bun.ts");
  const adapter = join(installed, "workflows/selfhost/references/catalog/apps/authelia/mutable-config.js");
  await mkdir(join(adapter, ".."), { recursive: true });
  await mkdir(join(privateRuntime, ".."), { recursive: true });
  await writeFile(privateRuntime, await readFile(runtime));
  // An unbound root file must never be chosen as the installed worker.
  await writeFile(join(installed, "private-identity-bun.ts"), 'throw new Error("Unbound root worker executed");');
  await writeFile(source, `
import assert from 'node:assert/strict';
import { privateIdentityHasher, parsePrivateIdentityYaml } from ${JSON.stringify(worker)};
const password = 'Synthetic_identity_password_for_fixture_2026';
const digest = await privateIdentityHasher.hash(password);
assert.match(digest, /^\\$argon2id\\$v=19\\$m=65536,t=3,p=1\\$[A-Za-z0-9+/]{43}\\$[A-Za-z0-9+/]{43}$/);
assert.equal(await privateIdentityHasher.verify(password, digest), true);
assert.equal(await privateIdentityHasher.verify(password + '_different', digest), false);
assert.deepEqual(await parsePrivateIdentityYaml('users:\\n  fixture:\\n    disabled: false\\n    groups: []\\n'),
  { users: { fixture: { disabled: false, groups: [] } } });
assert.deepEqual(await parsePrivateIdentityYaml('{"users":{}}'), { users: {} });
for (const content of ['x: &a [1]\\ny: *a', 'x: !!str 1', 'x: [unterminated', 'x'.repeat(65537)]) {
  await assert.rejects(() => parsePrivateIdentityYaml(content), /child output was suppressed/);
}
await assert.rejects(() => privateIdentityHasher.verify(password, digest.replace('m=65536', 'm=8')),
  /child output was suppressed/);
console.log('Private identity fixture passed');
`);
  const built = spawnSync(process.execPath, ["build", source, "--target=node", `--outfile=${adapter}`], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000,
  });
  if (built.status !== 0) throw new Error("Private identity fixture build failed");
  for (const executable of ["node", "bun"]) {
    const run = spawnSync(executable, [adapter], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000,
      env: { PATH: process.env.PATH }, cwd: installed,
    });
    if (run.status !== 0 || run.stderr !== "" || run.stdout !== "Private identity fixture passed\n") {
      throw new Error(`Private identity installed ${executable} fixture failed; output suppressed`);
    }
  }
  // Reject arbitrary opcodes and discard malformed-parser content on the worker channel.
  for (const input of ['{"operation":"exec","content":"synthetic"}',
    JSON.stringify({ operation: "identity-yaml", content: "secret-marker: [unterminated" })]) {
    const rejected = spawnSync("bun", [privateRuntime], {
      input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000,
      env: { PATH: process.env.PATH },
    });
    if (rejected.status !== 1 || rejected.stdout !== ""
      || rejected.stderr !== "Private identity operation failed\n") {
      throw new Error("Private identity failure suppression fixture failed");
    }
  }
  console.log("Private identity installed Node/Bun fixture passed (synthetic only)");
} finally {
  await rm(directory, { recursive: true, force: true });
}
