import assert from "node:assert/strict";
import { COMPATIBILITY_DIMENSIONS, requiredCompatibilityChecks, scoreCatalogCompatibility,
  type CompatibilityAppInput, type CompatibilityDimension, type CompatibilityEvidence } from "../src/lib/catalog-compatibility.ts";

const hash = "a".repeat(64);
const subject = "b".repeat(64);
const image = `example.invalid/app:1@sha256:${"c".repeat(64)}`;
const app: CompatibilityAppInput = {
  appId: "example-app", name: "Example", recipeSha256: hash,
  imageTags: { app: "example.invalid/app:1", db: "example.invalid/db:2" }, homarrMode: "tile-only",
  dimensions: Object.fromEntries(COMPATIBILITY_DIMENSIONS.map((dimension) => [dimension,
    { state: "declared", subjectSha256: subject, reason: "Source implementation available; live acceptance unknown." }])),
};
const options = { checkedAt: "2026-10-03" };
function receipt(dimension: CompatibilityDimension, kind: CompatibilityEvidence["kind"] = "live"): CompatibilityEvidence {
  let images: Record<string, string> = { ...app.imageTags };
  if (kind === "live") images = { app: image, db: `example.invalid/db:2@sha256:${"d".repeat(64)}` };
  return { schemaVersion: 1, appId: app.appId, dimension, kind, result: "pass",
    checkedAt: "2026-10-02", runId: "isolated-check-1", recipeSha256: hash, subjectSha256: subject,
    images, checks: requiredCompatibilityChecks(dimension, app.homarrMode),
    artifact: { path: "evidence/example-app/acceptance.json", sha256: "e".repeat(64) } };
}
function score(evidence: CompatibilityEvidence[], selected = app) {
  return scoreCatalogCompatibility([selected], { ...options, evidence });
}

assert.equal(score([]).aggregate, 0, "Files and manifest declarations are not live compatibility.");
assert.equal(score([receipt("setup", "fixture")]).apps[0].dimensions[1].level, "fixture-verified");
assert.equal(score([receipt("setup", "fixture")]).aggregate, 0, "Fixtures never become live acceptance.");
assert.equal(score([receipt("compose", "source")]).apps[0].dimensions[0].level, "source-verified");
assert.equal(score([receipt("compose", "source")]).aggregate, 0);
assert.equal(score([receipt("compose")]).aggregate, 20);
const fullyVerified = COMPATIBILITY_DIMENSIONS.map((dimension) => receipt(dimension));
assert.equal(score(fullyVerified).aggregate, 100);
assert.equal(score(fullyVerified).goalMet, true);
assert.equal(score(fullyVerified.slice(0, 3)).goalMet, false);

// Missing/difficult apps remain in the full inventory, not a hand-picked supported subset.
const inventory = [app.appId, ...Array.from({ length: 93 }, (_, index) => `missing-${index}`)];
const fullCatalog = scoreCatalogCompatibility([app], { ...options, evidence: fullyVerified, expectedAppIds: inventory });
assert.equal(fullCatalog.appCount, 94);
assert.equal(fullCatalog.possiblePoints, 9400);
assert.equal(fullCatalog.aggregate, 1.06);
assert.equal(fullCatalog.apps.find((item) => item.appId === "missing-0")?.score, 0);

// Every bound provenance field matters; no partial-service or other-version receipts.
const good = receipt("compose");
for (const bad of [
  { ...good, appId: "different" },
  { ...good, recipeSha256: "f".repeat(64) },
  { ...good, subjectSha256: "f".repeat(64) },
  { ...good, images: { app: image } },
  { ...good, images: { ...good.images, db: "example.invalid/db:3@sha256:" + "d".repeat(64) } },
  { ...good, images: { ...app.imageTags } },
  { ...good, checks: ["fresh-compose-apply"] },
  { ...good, checkedAt: "2026-10-04" },
  { ...good, checkedAt: "2026-01-01" },
  { ...good, checkedAt: "2026-02-30" },
  { ...good, artifact: { ...good.artifact, path: "evidence/../private.json" } },
  { ...good, artifact: { ...good.artifact, path: "evidence/private-handoff.json" } },
]) assert.equal(score([bad]).aggregate, 0);

assert.equal(score([{ ...good, result: "fail" }]).apps[0].dimensions[0].level, "failed");
assert.equal(score([{ ...good, checkedAt: "2026-10-01" },
  { ...good, result: "fail", checkedAt: "2026-10-02" }]).aggregate, 0);
assert.equal(score([{ ...good, checkedAt: "2026-10-01", result: "fail" },
  { ...good, checkedAt: "2026-10-02" }]).aggregate, 20);
assert.equal(score([good, { ...good, result: "fail" }]).aggregate, 0, "A tied failure wins.");
const partialFailure: CompatibilityEvidence = { ...good, result: "fail", checks: ["private-exposure"] };
const olderPass = { ...good, checkedAt: "2026-10-01" };
const invalidated = score([olderPass, partialFailure]);
assert.equal(invalidated.aggregate, 0, "A newer matching partial live failure invalidates an older complete pass.");
assert.equal(invalidated.apps[0].dimensions[0].level, "failed");
assert.equal(invalidated.apps[0].rating, "broken");
assert.equal(invalidated.apps[0].dimensions[0].evidence, partialFailure);
assert.equal(score([{ ...partialFailure, checkedAt: "2026-10-01" }, good]).aggregate, 20,
  "A newer complete pass supersedes an older matching partial failure.");
assert.equal(score([good, partialFailure]).aggregate, 0, "A tied partial live failure wins.");
assert.equal(score([{ ...partialFailure, result: "pass" }]).aggregate, 0,
  "Partial passing coverage still earns no compatibility points.");
const sourceImages = { ...app.imageTags };
for (const kind of ["source", "fixture"] as const) {
  assert.equal(score([{ ...partialFailure, kind, images: sourceImages }]).apps[0].dimensions[0].level, "declared",
    "Partial non-live failures are not promoted to a verified live failure.");
}
for (const invalidFailure of [
  { ...partialFailure, recipeSha256: "f".repeat(64) },
  { ...partialFailure, subjectSha256: "f".repeat(64) },
  { ...partialFailure, appId: "different" },
  { ...partialFailure, images: { app: image } },
  { ...partialFailure, images: { ...partialFailure.images, db: "example.invalid/db:3@sha256:" + "d".repeat(64) } },
  { ...partialFailure, images: sourceImages },
  { ...partialFailure, artifact: { ...partialFailure.artifact, sha256: "" } },
  { ...partialFailure, artifact: { ...partialFailure.artifact, path: "evidence/../private.json" } },
  { ...partialFailure, checkedAt: "2026-01-01" },
  { ...partialFailure, checkedAt: "2026-10-04" },
  { ...partialFailure, checks: [] },
  { ...partialFailure, checks: ["private-exposure", "private-exposure"] },
  { ...partialFailure, checks: ["unrelated-check"] },
  { ...partialFailure, checks: ["private-exposure", "unrelated-check"] },
]) assert.equal(score([olderPass, invalidFailure]).aggregate, 20,
  "Malformed, stale, unrelated, or mismatched failure evidence cannot invalidate a matching pass.");
assert.equal(score([good], { ...app, dimensions: { compose: {
  state: "external-required", subjectSha256: subject, reason: "Owner approval required." } } }).aggregate, 0);
assert.equal(score([good], { ...app, dimensions: { compose: {
  state: "unsupported", subjectSha256: subject, reason: "No safe route." } } }).aggregate, 0);

const tile = receipt("homarr");
assert.equal(score([tile]).apps[0].dimensions[2].level, "live-verified",
  "A working tile-only contract does not require nonexistent native integrations.");
assert.equal(score([tile], { ...app, homarrMode: "native" }).aggregate, 0,
  "A tile cannot satisfy a native integration/widget contract.");
assert.equal(scoreCatalogCompatibility([app], { ...options, evidence: fullyVerified,
  expectedAppIds: [app.appId, "other", "third", "fourth"] }).goalMet, false);
const thresholdApps = [app, { ...app, appId: "second" }, { ...app, appId: "third" }];
const thresholdEvidence = thresholdApps.flatMap((selected) => fullyVerified.map((item) => ({ ...item, appId: selected.appId })));
const threshold = scoreCatalogCompatibility(thresholdApps, { ...options, evidence: thresholdEvidence,
  expectedAppIds: [app.appId, "second", "third", "fourth"] });
assert.equal(threshold.aggregate, 75);
assert.equal(threshold.goalMet, false, "The goal is strictly greater than 75, not greater than or equal.");
assert.throws(() => scoreCatalogCompatibility([app, app], options), /unique/);
assert.throws(() => scoreCatalogCompatibility([app], { ...options, expectedAppIds: ["other"] }), /inventory/);
assert.throws(() => scoreCatalogCompatibility([app], { checkedAt: "invalid" }), /date/);
assert.throws(() => scoreCatalogCompatibility([], options), /inventory/);

process.stdout.write("catalog compatibility checks passed\n");
