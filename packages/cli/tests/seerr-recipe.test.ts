import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";

const recipePath = join(import.meta.dir,
  "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/seerr/recipe.json");
const recipe = JSON.parse(await readFile(recipePath, "utf8"));
const jellyfinRecipe = JSON.parse(await readFile(join(import.meta.dir,
  "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/jellyfin/recipe.json"), "utf8"));
assert.equal(recipe.onboarding.kind, "external-first-admin");
assert.equal(recipe.onboarding.providerAppId, "jellyfin");
assert.deepEqual(recipe.privateFiles, []);
assert.equal(recipe.services[0].init, true);
assert.equal(recipe.services[0].healthcheck, undefined);

const root = await mkdtemp(join(tmpdir(), "selfhost-seerr-recipe-"));
try {
  const mediaPath = join(root, ".selfhost", "shared", "seerr-recipe-test", "data", "shared");
  const seerr = { appId: "seerr", recipe, port: 15055,
    images: { seerr: `${recipe.services[0].imageTag}@sha256:${"a".repeat(64)}` } };
  const input = { projectRoot: root, projectId: "seerr-recipe-test",
    dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC",
    observed: { checkedAt: "2026-09-29T12:00:00Z", ports: [], paths: [], networks: [], volumes: [] } };
  assert.throws(() => sharedProjectCandidate({ ...input, apps: [seerr] }),
    /seerr first-admin setup requires its selected Compose provider/);
  const candidate = sharedProjectCandidate({ ...input, apps: [seerr,
    { appId: "jellyfin", recipe: jellyfinRecipe, port: 18096,
      images: { jellyfin: `${jellyfinRecipe.services[0].imageTag}@sha256:${"b".repeat(64)}` },
      hostPaths: { "media-library": mediaPath } }] });
  const seerrService = candidate.manifest.services.find((service: { id: string }) => service.id === "seerr");
  assert.equal(seerrService.init, true);
  assert.deepEqual(seerrService.networks, ["front", "seerr-private"]);
  assert.ok(candidate.manifest.services.find((service: { id: string }) => service.id === "jellyfin")?.networks.includes("front"));
  const owner = createSelfhostComposeOwner(candidate.manifest);
  const plan = await owner.plan();
  assert.equal(plan.status, "pass");
  assert.equal(plan.claims.services.find((service: { id: string }) => service.id === "seerr")?.init, true);
  await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
  const rendered = await readFile(await owner.render(plan), "utf8");
  assert.match(rendered, /^    init: true$/m);
  assert.match(rendered, /\/app\/config/);
  assert.doesNotMatch(rendered, /healthcheck:/);
  assert.doesNotMatch(rendered, /PUID|PGID/);
} finally {
  await rm(root, { recursive: true });
}

process.stdout.write("Seerr recipe checks passed\n");
