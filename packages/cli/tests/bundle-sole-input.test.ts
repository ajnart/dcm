#!/usr/bin/env bun

import { strict as assert } from "node:assert";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleCommand } from "../src/bundle.ts";

async function privateJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function capture(action: () => Promise<void>): Promise<Record<string, any>> {
  const previous = console.log;
  let output = "";
  console.log = (...values: unknown[]) => { output += `${values.map(String).join(" ")}\n`; };
  try {
    await action();
    return JSON.parse(output);
  } finally {
    console.log = previous;
  }
}

function mediaStatus() {
  const names = ["prowlarr", "radarr", "sonarr", "qbittorrent", "jellyfin", "seerr", "homarr"];
  return {
    schemaVersion: 1,
    kind: "selfhost-media-status",
    provenance: "cli-managed",
    runId: "home-media",
    composeProject: "autostack-home-media",
    services: names.map((service) => ({
      service,
      present: false,
      state: "absent",
      running: false,
      health: "unavailable",
    })),
    summary: {
      expected: 7,
      present: 0,
      running: 0,
      healthy: 0,
      unhealthy: 0,
      starting: 0,
      healthUnavailable: 7,
    },
  };
}

const root = await mkdtemp(join(tmpdir(), "selfhost-bundle-sole-input-"));
try {
  await chmod(root, 0o700);
  const local = join(root, ".selfhost");
  const bundles = join(local, "bundles");
  const home = join(bundles, "home");
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(local, 0o700);
  await chmod(bundles, 0o700);
  await chmod(home, 0o700);

  const files = {
    bundle: join(home, "household-bundle.json"),
    immichInput: join(home, "immich-input.json"),
    immichAccount: join(home, "immich-account.json"),
    docmostInput: join(home, "docmost-input.json"),
    docmostAccount: join(home, "docmost-account.json"),
    vaultwardenInput: join(home, "vaultwarden-input.json"),
    vaultwardenAccount: join(home, "vaultwarden-account.json"),
    vaultwardenHttps: join(home, "vaultwarden-https.json"),
  };
  await privateJson(files.immichInput, { hostIp: "127.0.0.1", publishedPort: 2283 });
  await privateJson(files.immichAccount, { fixture: true });
  await privateJson(files.docmostInput, { hostIp: "127.0.0.1", publishedPort: 3000 });
  await privateJson(files.docmostAccount, { fixture: true });
  await privateJson(files.vaultwardenInput, { fixture: true });
  await privateJson(files.vaultwardenAccount, { fixture: true });
  await privateJson(files.vaultwardenHttps, {
    schemaVersion: 1,
    origin: "https://vault.home.arpa",
    exposure: "private",
    routeStatus: "pending",
    routeOwner: "home-edge",
    tlsOwner: "home-edge",
    clientCertificateTrust: "pending",
    backend: { hostIp: "127.0.0.1", publishedPort: 8080 },
  });
  await privateJson(files.bundle, {
    schemaVersion: 1,
    id: "home",
    projectRoot: root,
    services: {
      media: { runId: "home-media", username: "admin", credentialHandoff: true },
      immich: { input: files.immichInput, runId: "home-immich", accountFile: files.immichAccount },
      docmost: { input: files.docmostInput, runId: "home-docmost", accountFile: files.docmostAccount },
      vaultwarden: {
        input: files.vaultwardenInput,
        runId: "home-vault",
        accountFile: files.vaultwardenAccount,
        httpsPlan: files.vaultwardenHttps,
      },
    },
  });

  const observed: string[] = [];
  const dependencies = {
    media: async (args: string[]) => {
      observed.push(`media:${args[0]}`);
      if (args[0] === "status") console.log(JSON.stringify(mediaStatus()));
      if (args[0] === "info") console.log(JSON.stringify({ services: [] }));
    },
    immich: async (args: string[]) => {
      observed.push(`immich:${args[0]}`);
      if (args[0] === "status") console.log(JSON.stringify({ status: "planned", initialized: null }));
    },
    docmost: async (args: string[]) => {
      observed.push(`docmost:${args[0]}`);
      if (args[0] === "status") console.log("{}");
    },
    vaultwarden: async (args: string[]) => {
      observed.push(`vaultwarden:${args[0]}`);
      throw new Error("Vaultwarden runtime should not be inspected in this fixture");
    },
  };

  const plan = await capture(() => bundleCommand(["plan", "--project-root", root], dependencies));
  assert.equal(plan.kind, "household-bundle-plan");
  const next = await capture(() => bundleCommand(["next", "--project-root", root], dependencies));
  assert.equal(next.kind, "household-bundle-next");
  const run = await capture(() => bundleCommand(["run", "--project-root", root], dependencies));
  assert.equal(run.kind, "household-bundle-run");
  assert.equal(run.executionPerformed, false);
  const status = await capture(() => bundleCommand(["status", "--project-root", root], dependencies));
  assert.equal(status.kind, "household-bundle-status");
  const info = await capture(() => bundleCommand(["info", "--project-root", root], dependencies));
  assert.equal(info.kind, "household-bundle-info");
  assert.equal(observed.some((entry) => !entry.endsWith(":status") && !entry.endsWith(":info")), false);

  const second = join(bundles, "second");
  await mkdir(second, { mode: 0o700 });
  await privateJson(join(second, "household-bundle.json"), { fixture: true });
  await assert.rejects(
    bundleCommand(["plan", "--project-root", root], dependencies),
    /Multiple household bundle inputs/,
  );
  const explicit = await capture(() => bundleCommand([
    "plan", "--project-root", root, "--input", files.bundle,
  ], dependencies));
  assert.equal(explicit.kind, "household-bundle-plan");
  await rm(second, { recursive: true });

  await chmod(files.bundle, 0o644);
  await assert.rejects(
    bundleCommand(["plan", "--project-root", root], dependencies),
    /Unsafe household bundle input/,
  );
  await chmod(files.bundle, 0o600);

  const linkedSource = join(root, "linked-bundle.json");
  await privateJson(linkedSource, { fixture: true });
  await rm(files.bundle);
  await symlink(linkedSource, files.bundle);
  await assert.rejects(
    bundleCommand(["plan", "--project-root", root], dependencies),
    /Unsafe household bundle input/,
  );
  await rm(home, { recursive: true });
  await assert.rejects(
    bundleCommand(["plan", "--project-root", root], dependencies),
    /No safe household bundle input/,
  );

  console.log("PASS sole household bundle discovery stays scoped, owner-only, and approval-safe");
} finally {
  await rm(root, { recursive: true });
}
