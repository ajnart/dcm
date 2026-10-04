import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { bootstrapPasswordProfile } from "../src/lib/bootstrap-password-profile.ts";

// Compile only this pure module into a disposable package. No Docker/private runtime state.
const root = await mkdtemp(join(tmpdir(), "selfhost-bootstrap-profile-loader-"));
try {
  const compiled = join(root, "project/packages/cli/src/lib");
  const result = await Bun.build({ entrypoints: [join(import.meta.dir, "../src/lib/bootstrap-password-profile.ts")],
    outdir: compiled, target: "bun" });
  assert.equal(result.success, true);
  const module = await import(pathToFileURL(join(compiled, "bootstrap-password-profile.js")).href);
  const sourceProfile = bootstrapPasswordProfile("qbittorrent")!;
  const json = JSON.stringify(sourceProfile);
  const canonical = join(root, "project/.agents/skills/self-host/workflows/selfhost/references/catalog/apps/qbittorrent/bootstrap-password.json");
  await mkdir(dirname(canonical), { recursive: true });
  await writeFile(canonical, json, { mode: 0o644 });
  // Missing package data never falls back to the source checkout beside that package.
  assert.equal(module.bootstrapPasswordProfile("qbittorrent"), null);
  const packaged = join(compiled, "workflows/selfhost/references/catalog/apps/qbittorrent/bootstrap-password.json");
  await mkdir(dirname(packaged), { recursive: true });
  await writeFile(packaged, json, { mode: 0o644 });
  assert.deepEqual(module.bootstrapPasswordProfile("qbittorrent"), sourceProfile);
  const rejects = () => assert.throws(() => module.bootstrapPasswordProfile("qbittorrent"),
    /Catalog bootstrap-password profile could not be read/);
  await rm(packaged);
  await symlink(canonical, packaged);
  rejects();
  await rm(packaged);
  await link(canonical, packaged);
  rejects();
  await rm(packaged);
  await mkdir(packaged);
  rejects();
  await rm(packaged, { recursive: true });
  const fifo = spawnSync("mkfifo", [packaged], { encoding: "utf8", timeout: 5000 });
  assert.equal(fifo.status, 0);
  rejects(); // O_NONBLOCK prevents opening a FIFO from hanging this fixture.
  await rm(packaged);
  await writeFile(packaged, json, { mode: 0o644 });
  await chmod(packaged, 0o666);
  rejects();
  await chmod(packaged, 0o644);
  await writeFile(packaged, "x".repeat(4097));
  rejects();
  await writeFile(packaged, "{}");
  rejects();
  await writeFile(packaged, json);
  assert.deepEqual(module.bootstrapPasswordProfile("qbittorrent"), sourceProfile);
  // An intermediate catalog-directory symlink is also refused, even with a regular leaf.
  const app = dirname(packaged);
  await rm(packaged);
  await rm(app, { recursive: true });
  await symlink(dirname(canonical), app);
  rejects();
} finally {
  await rm(root, { recursive: true });
}
console.log("Bootstrap profile loader: compiled root isolation and symlink/FIFO/hardlink/size/mode refusal passed");
