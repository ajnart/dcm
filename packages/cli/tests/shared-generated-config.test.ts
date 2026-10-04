import assert from "node:assert/strict";
import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareMultiServiceFiles, verifySharedGeneratedConfigFiles } from "../src/lib/multi-service-recipe.ts";

const root = await mkdtemp(join(tmpdir(), "selfhost-generated-config-"));
const data = join(root, "data", "fixture");
const target = join(data, "config-files", "settings");
const recipe = { schemaVersion: 2, appId: "fixture", privateFiles: [],
  configFiles: [{ id: "settings", content: "enabled: true\n" }],
  services: [{ id: "fixture", mounts: [{ kind: "generated-file", fileId: "settings", name: "settings",
    target: "/etc/fixture.yaml" }], fileEnvironment: [], secretEnvironment: [] }] };
try {
  await assert.rejects(verifySharedGeneratedConfigFiles(recipe, root), /ENOENT/);
  assert.equal(await readFile(target).catch(() => null), null, "read-only verification does not prepare files");
  await prepareMultiServiceFiles(recipe, root, data, undefined, "fixture");
  await verifySharedGeneratedConfigFiles(recipe, root);
  const content = await readFile(target, "utf8");
  await writeFile(target, "enabled: fake\n");
  await assert.rejects(verifySharedGeneratedConfigFiles(recipe, root), /differs|intact/);
  assert.equal(await readFile(target, "utf8"), "enabled: fake\n", "verification never repairs drift");
  await writeFile(target, content);
  await chmod(target, 0o644);
  await assert.rejects(verifySharedGeneratedConfigFiles(recipe, root), /readability/);
  await chmod(target, 0o600);
  await link(target, join(data, "second-link"));
  await assert.rejects(verifySharedGeneratedConfigFiles(recipe, root), /readability/);
  await rm(join(data, "second-link"));
  await rm(target);
  await writeFile(join(data, "other"), content, { mode: 0o600 });
  await symlink(join(data, "other"), target);
  await assert.rejects(verifySharedGeneratedConfigFiles(recipe, root), /readability/);
  await rm(target);
  await writeFile(target, content, { mode: 0o600 });
  await chmod(data, 0o755);
  await assert.rejects(verifySharedGeneratedConfigFiles(recipe, root), /owner-only directories/);
  await chmod(data, 0o700);
  await verifySharedGeneratedConfigFiles(recipe, root);
  await mkdir(join(root, "unrelated"));
  await verifySharedGeneratedConfigFiles({ ...recipe, configFiles: undefined }, join(root, "unrelated"));
} finally { await rm(root, { recursive: true, force: true }); }
console.log("Read-only shared generated-config verification and drift rejection: pass");
