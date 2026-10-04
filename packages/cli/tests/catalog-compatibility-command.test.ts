import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogCompatibilityCommand, formatCatalogCompatibility, loadCatalogCompatibility } from "../src/catalog-compatibility.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const workflow = join(root, ".agents/skills/self-host/workflows/selfhost");
const selected = await loadCatalogCompatibility("2026-10-03", "wud");
assert.equal(selected.appCount, 94);
assert.equal(selected.possiblePoints, 9400);
assert.equal(selected.shownAppCount, 1);
assert.equal(selected.aggregate, 0);
assert.equal(selected.mutation, false);
assert.equal(selected.apps[0].appId, "wud");
assert.equal(selected.apps[0].label, "unverified");
assert.equal(selected.apps[0].dimensions.find((row) => row.dimension === "compose")?.level, "declared",
  "A strictly declared derived recipe is implementation coverage, never live credit");
assert.match(selected.apps[0].dimensions.find((row) => row.dimension === "compose")!.reason,
  /exact reviewed inputs/);
assert.match(selected.apps[0].dimensions.find((row) => row.dimension === "compose")!.reason,
  /Project receipt binding for derived recipes remains unavailable/);
assert.equal(selected.apps[0].source?.recipeSha256, null);
assert.deepEqual(selected.apps[0].source?.imageTags, {});
assert.match(selected.apps[0].source?.derivedRecipeDeclarationSha256, /^[a-f0-9]{64}$/);
assert.equal(selected.implementationCoverage.derivedRecipes, 4);
for (const appId of ["haproxy", "headscale", "minio"]) {
  const derived = await loadCatalogCompatibility("2026-10-03", appId);
  assert.equal(derived.apps[0].dimensions.find((row) => row.dimension === "compose")?.level, "declared");
  assert.equal(derived.apps[0].source?.recipeSha256, null);
  assert.equal(derived.aggregate, 0);
}
assert.match(formatCatalogCompatibility(selected), /across all 94 apps/);
assert.match(formatCatalogCompatibility(selected), /Unverified is not failed/);
assert.match(formatCatalogCompatibility(selected), /Next liveRestart: application-health, core-round-trip, restart-persistence/);
const tile = await loadCatalogCompatibility("2026-10-03", "docmost");
assert.equal(tile.apps[0].homarrMode, "tile-only");
assert.match(tile.apps[0].source?.recipeSha256, /^[a-f0-9]{64}$/);
assert.match(tile.apps[0].source?.setupSha256, /^[a-f0-9]{64}$/);
await assert.rejects(() => loadCatalogCompatibility("2026-10-03", "not-a-real-app"), /Unknown catalog/);
await assert.rejects(() => catalogCompatibilityCommand(["--evidence", "/tmp/receipt.json"]), /No live receipt import/);
let output = "";
await catalogCompatibilityCommand(["wud", "--json"], (value) => { output += value; });
assert.equal(JSON.parse(output).appCount, 94);

// Build only this command and its canonical catalog owner, then invoke the actual bin route.
const temporary = await mkdtemp(join(tmpdir(), "selfhost-compatibility-command-"));
try {
  const packageRoot = join(temporary, "cli");
  const dist = join(packageRoot, "dist");
  const catalogScripts = join(dist, "workflows/selfhost/scripts");
  await mkdir(catalogScripts, { recursive: true });
  await mkdir(join(packageRoot, "bin"));
  await cp(join(root, "packages/cli/bin/selfhost.mjs"), join(packageRoot, "bin/selfhost.mjs"));
  await cp(join(workflow, "references/catalog"), join(dist, "workflows/selfhost/references/catalog"), { recursive: true });
  for (const [entry, target] of [
    [join(root, "packages/cli/src/catalog-compatibility.ts"), join(dist, "catalog-compatibility.js")],
    [join(workflow, "scripts/catalog.ts"), join(catalogScripts, "catalog.js")],
  ]) {
    const built = spawnSync(process.execPath, ["build", entry, "--target=node", `--outfile=${target}`], { encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
  }
  // File-backed stdout also verifies the actual bin's asynchronous writer when
  // the host runtime cannot flush a child pipe reliably.
  const reportPath = join(temporary, "packaged-report.json");
  const reportFd = openSync(reportPath, "wx", 0o600);
  try {
    const called = spawnSync("node", [join(packageRoot, "bin/selfhost.mjs"), "catalog", "compatibility", "wud", "--json"], {
      encoding: "utf8", timeout: 15000, stdio: ["ignore", reportFd, "pipe"],
    });
    assert.equal(called.status, 0, called.stderr);
  } finally { closeSync(reportFd); }
  const report = await readFile(reportPath, "utf8");
  assert.notEqual(report, "", "Packaged compatibility command must emit its report.");
  const packaged = JSON.parse(report);
  assert.equal(packaged.appCount, 94);
  assert.equal(packaged.shownAppCount, 1);
  assert.equal(packaged.aggregate, 0);
  assert.equal(packaged.mutation, false);
  assert.equal(packaged.implementationCoverage.derivedRecipes, 4);
  assert.equal(packaged.apps[0].source.recipeSha256, null);
  assert.equal(packaged.apps[0].source.derivedRecipeDeclarationSha256, selected.apps[0].source?.derivedRecipeDeclarationSha256);
  assert.equal(packaged.apps[0].dimensions.find((row: { dimension: string }) => row.dimension === "compose")?.level, "declared");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

process.stdout.write("catalog compatibility command checks passed\n");
