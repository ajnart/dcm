import { strict as assert } from "node:assert";
import { documentedUnitHealth, inheritedHealthcheckMatches } from "../src/lib/documented-unit-health.ts";

const image = { Test: ["CMD", "curl", "-f", "http://localhost:8000"], Interval: 30_000_000_000,
  Timeout: 3_000_000_000, Retries: 3 };
assert.equal(inheritedHealthcheckMatches({ ...image, StartPeriod: 0 }, image), true);
assert.equal(inheritedHealthcheckMatches({ ...image, Test: ["CMD", "true"] }, image), false);
assert.equal(inheritedHealthcheckMatches({ ...image, Timeout: 1 }, image), false);
assert.equal(inheritedHealthcheckMatches({ Test: ["NONE"] }, { Test: ["NONE"] }), false);
assert.equal(inheritedHealthcheckMatches({}, {}), false);
assert.equal(documentedUnitHealth([{ health: "unhealthy", documented: true },
  { health: "", documented: false }]), "unhealthy");
assert.equal(documentedUnitHealth([{ health: "starting", documented: true },
  { health: "", documented: false }]), "starting");
assert.equal(documentedUnitHealth([{ health: "unhealthy", documented: false }]), "unknown");
assert.equal(documentedUnitHealth([{ health: "healthy", documented: true },
  { health: "", documented: false }]), "unknown");
assert.equal(documentedUnitHealth([{ health: "healthy", documented: true }]), "healthy");
assert.equal(documentedUnitHealth([]), "unknown");
console.log("documented unit health: inherited checks and partial failures passed");
