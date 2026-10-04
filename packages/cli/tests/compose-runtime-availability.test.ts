import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComposeRuntimeUnavailableError, createSelfhostComposeOwner } from "../src/lib/selfhost-compose";

const fixture = await mkdtemp(join(tmpdir(), "selfhost-compose-runtime-"));
const originalPath = process.env.PATH;
const privateOutput = "SYNTHETIC_PRIVATE_RUNTIME_DETAIL";
const marker = join(fixture, "owner-invoked");
const manifest = { project: { dockerContext: "default", id: "runtime-fixture", directory: fixture } };

async function fakeBun(version: string, status = 0) {
  await writeFile(join(fixture, "bun"), `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' '${version}'
  printf '%s\\n' '${privateOutput}' >&2
  exit ${status}
fi
printf '%s' 'invoked' > '${marker}'
printf '%s\\n' '{"status":"blocked","conflicts":[{"kind":"network","reason":"ownership-evidence-missing"}],"blockers":[]}'
exit 1
`);
  await chmod(join(fixture, "bun"), 0o700);
}

try {
  process.env.PATH = fixture;
  for (const [version, status] of [[privateOutput, 1], [privateOutput, 0], ["1.3.14", 0], ["1.4.0-preview", 0]] as const) {
    await fakeBun(version, status);
    await assert.rejects(createSelfhostComposeOwner(manifest).plan(), (error: unknown) => {
      assert.ok(error instanceof ComposeRuntimeUnavailableError);
      assert.equal(error.code, "compose-bun-missing");
      assert.match(error.message, /Bun 1\.4\+.*PATH/);
      assert.equal(error.message.includes(privateOutput), false);
      return true;
    });
    await assert.rejects(readFile(marker), { code: "ENOENT" });
  }
  for (const version of ["1.4.0", "1.4.2", "2.0.0"]) {
    await fakeBun(version);
    await assert.rejects(createSelfhostComposeOwner(manifest).plan(), /selfhost-compose plan blocked network:ownership-evidence-missing/);
    assert.equal(await readFile(marker, "utf8"), "invoked");
  }
  await rm(join(fixture, "bun"));
  await assert.rejects(createSelfhostComposeOwner(manifest).plan(), ComposeRuntimeUnavailableError);
  console.log("Compose runtime availability and private child-output checks passed");
} finally {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  await rm(fixture, { recursive: true, force: true });
}
