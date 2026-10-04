#!/usr/bin/env bun

import { strict as assert } from "node:assert";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { command } from "../src/command.ts";

const root = await mkdtemp(join(tmpdir(), "selfhost-command-household-"));
const mediaRoot = await mkdtemp(join(tmpdir(), "selfhost-command-media-"));
const calls: string[][] = [];
const unexpected = async () => { throw new Error("Media-only adapter was called"); };
const bundle = async (args: string[]) => { calls.push(args); };

try {
  await chmod(root, 0o700);
  const local = join(root, ".selfhost");
  const bundles = join(local, "bundles");
  const home = join(bundles, "home");
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(local, 0o700);
  await chmod(bundles, 0o700);
  const input = join(home, "household-bundle.json");
  await writeFile(input, "{}\n", { mode: 0o600 });

  await command(["status", "--project-root", root], unexpected, unexpected, unexpected, unexpected, unexpected, bundle);
  assert.deepEqual(calls.pop(), ["status", "--project-root", root, "--input", input]);
  await command(["info", "--project-root", root], unexpected, unexpected, unexpected, unexpected, unexpected, bundle);
  assert.deepEqual(calls.pop(), ["info", "--project-root", root, "--input", input]);

  await assert.rejects(
    command(["down", "--project-root", root], unexpected, unexpected, unexpected, unexpected, unexpected, bundle),
    /Use self-host down .*--input .*household-bundle\.json --approve TOKEN/,
  );
  assert.equal(calls.length, 0);

  await command(["down", "--project-root", root, "--input", input, "--approve", "reviewed",
    "--local-https-input", join(root, "caddy.json"), "--local-https-run-id", "home-edge"],
  unexpected, unexpected, unexpected, unexpected, unexpected, bundle);
  assert.deepEqual(calls.pop(), ["down", "--project-root", root, "--input", input,
    "--approve", "reviewed", "--local-https-input", join(root, "caddy.json"),
    "--local-https-run-id", "home-edge"]);

  await assert.rejects(
    command(["resume", "--project-root", root], unexpected, unexpected, unexpected, unexpected, unexpected, bundle),
    /bundle next/,
  );
  await assert.rejects(
    command(["status", "--project-root", root, "--profile", "media"],
      unexpected, unexpected, unexpected, unexpected, unexpected, bundle),
    /No CLI config/,
  );

  const second = join(bundles, "second");
  await mkdir(second, { mode: 0o700 });
  await writeFile(join(second, "household-bundle.json"), "{}\n", { mode: 0o600 });
  await assert.rejects(
    command(["status", "--project-root", root], unexpected, unexpected, unexpected, unexpected, unexpected, bundle),
    /multiple household bundles/,
  );
  await command(["status", "--project-root", root, "--input", input],
    unexpected, unexpected, unexpected, unexpected, unexpected, bundle);
  assert.deepEqual(calls.pop(), ["status", "--project-root", root, "--input", input]);

  await chmod(mediaRoot, 0o700);
  const mediaLocal = join(mediaRoot, ".selfhost");
  await mkdir(join(mediaLocal, "media-harness", ".sessions", "media-run"), { recursive: true, mode: 0o700 });
  await chmod(mediaLocal, 0o700);
  await writeFile(join(mediaLocal, "cli.json"), `${JSON.stringify({
    schemaVersion: 1,
    profile: "media",
    runId: "media-run",
    username: "admin",
    credentialHandoff: false,
  })}\n`, { mode: 0o600 });
  const mediaCalls: string[][] = [];
  const media = async (args: string[]) => { mediaCalls.push(args); };
  const digest = "a".repeat(64);
  await command(["up", "--project-root", mediaRoot, "--approve", digest, "--defer-indexer"],
    media, unexpected, unexpected, unexpected, unexpected, unexpected);
  assert.deepEqual(mediaCalls.pop(), ["apply", "--project-root", mediaRoot, "--run-id", "media-run",
    "--approve", digest, "--defer-indexer"]);
  await command(["resume", "--project-root", mediaRoot, "--approve", digest, "--from", "verify", "--defer-indexer"],
    media, unexpected, unexpected, unexpected, unexpected, unexpected);
  assert.deepEqual(mediaCalls.pop(), ["resume", "--project-root", mediaRoot, "--run-id", "media-run",
    "--approve", digest, "--from", "verify", "--defer-indexer"]);
  await assert.rejects(
    command(["status", "--project-root", mediaRoot, "--defer-indexer"],
      media, unexpected, unexpected, unexpected, unexpected, unexpected),
    /applies only/,
  );

  console.log("PASS household routing and explicit media indexer deferral stay scoped");
} finally {
  await rm(root, { recursive: true });
  await rm(mediaRoot, { recursive: true });
}
