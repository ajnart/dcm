import assert from "node:assert/strict";
import { compilePangolinConfiguration } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/pangolin/configuration.ts";

const input = { canonicalOrigin: "https://pangolin.example.test", baseDomain: "resources.example.test", mode: "local-only" as const };
const candidate = compilePangolinConfiguration(input);
assert.deepEqual(candidate, compilePangolinConfiguration(input));
assert.equal(candidate.requirements.runnable, false);
assert.equal(candidate.requirements.enrollment, "not-applicable-local-only");
assert.equal(candidate.privateConfig.parts.filter((part) => "fileId" in part).length, 1);
assert.equal(candidate.privateFiles[0]!.format, "alphanumeric");
assert.ok(candidate.privateConfig.parts[0]!.literal!.includes(input.canonicalOrigin));
assert.ok(candidate.privateConfig.parts[0]!.literal!.includes(input.baseDomain));
assert.ok(candidate.privateConfig.parts[2]!.literal!.includes('traefik:\n  site_types: ["local"]\n  allow_raw_resources: false\n'));
assert.ok(candidate.privateConfig.parts[2]!.literal!.includes("disable_basic_wireguard_sites: true"));
assert.ok(!JSON.stringify(candidate).includes("cap_add"));
assert.ok(!JSON.stringify(candidate).includes("network_mode"));
assert.notEqual(candidate.selectionFingerprint, compilePangolinConfiguration({ ...input, baseDomain: "other.example.test" }).selectionFingerprint);
assert.notEqual(candidate.selectionFingerprint, compilePangolinConfiguration({ ...input, canonicalOrigin: "https://other.example.test" }).selectionFingerprint);
assert.equal(compilePangolinConfiguration({ ...input, canonicalOrigin: "https://pangolin.example.test:8443" }).input.canonicalOrigin, "https://pangolin.example.test:8443");
for (const canonicalOrigin of ["http://pangolin.example.test", "https://localhost", "https://pangolin.localhost", "https://127.0.0.1", "https://pangolin.example.test:1023", "https://pangolin.example.test:65536", "https://pangolin.example.test/path", "https://user:secret@pangolin.example.test"]) {
  assert.throws(() => compilePangolinConfiguration({ ...input, canonicalOrigin }));
}
for (const baseDomain of ["localhost", "127.0.0.1", "*.example.test", "example.test\nsecret: value", "https://example.test"]) {
  assert.throws(() => compilePangolinConfiguration({ ...input, baseDomain }));
}
assert.throws(() => compilePangolinConfiguration({ ...input, mode: "tunnel" } as any));
assert.throws(() => compilePangolinConfiguration({ ...input, serverSecret: "not-an-input" } as any));
console.log("Pangolin configuration fixture passed");
