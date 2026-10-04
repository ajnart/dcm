#!/usr/bin/env bun

import { strict as assert } from "node:assert";
import { reviewedMediaPlan } from "../src/interactive-media-plan.ts";

const ports = {
  PROWLARR_PORT: "21356", RADARR_PORT: "21357", SONARR_PORT: "21358",
  QBITTORRENT_PORT: "21359", JELLYFIN_PORT: "21360", SEERR_PORT: "21361", HOMARR_PORT: "21362",
};
const plan = { approvalDigest: "a".repeat(64), bind: "127.0.0.1", publishedPorts: "host-loopback-only", ports };
assert.deepEqual(reviewedMediaPlan(plan, "host-only"), plan);
assert.throws(() => reviewedMediaPlan(plan, "all-interfaces"), /approval or exposure/);
assert.throws(() => reviewedMediaPlan({ ...plan, approvalDigest: "bad" }, "host-only"), /approval or exposure/);
assert.throws(() => reviewedMediaPlan({ ...plan, ports: { ...ports, HOMARR_PORT: "21361" } }, "host-only"), /seven-port/);
assert.throws(() => reviewedMediaPlan({ ...plan, ports: { ...ports, HOMARR_PORT: "70000" } }, "host-only"), /seven-port/);
console.log("PASS interactive media plan rejects changed approval, exposure, and ports");
