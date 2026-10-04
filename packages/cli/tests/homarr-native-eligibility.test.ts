import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homarrNativeEligibility, homarrStackMapping } from "../src/lib/homarr-stack-mapping.ts";
import { planHomarrStackSeed, applyHomarrStackSeed } from "../src/lib/homarr-stack-seed.ts";
import { checkSharedHomarrServices, inspectSharedHomarrServices } from "../src/shared-homarr.ts";
import { recapHeight, validateInput } from "../src/homarr-attach.ts";
import { homarrReadShapeMatches, homarrVerificationSourceCommit } from "../src/lib/homarr-read-contract.ts";

// Synthetic source contract: no Docker, app requests, private files or runtime acceptance.
const recipeRoot = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/", import.meta.url);
for (const [id, code] of [["frigate", "native-owned-https-unverified"]]) {
  const mapping = homarrStackMapping(id)!;
  const recipe = JSON.parse(readFileSync(new URL(`${id}/recipe.json`, recipeRoot), "utf8"));
  const eligibility = homarrNativeEligibility(mapping, recipe);
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reasonCode, code, "reviewed hash must match the actual catalog recipe");
  assert.equal(mapping.tileOnly, undefined, "a blocked native capability is not tile-only support");
  assert.equal(mapping.verification?.sourceCommit, homarrVerificationSourceCommit);
  const statsRead = mapping.verification!.widgets[0];
  assert.equal(statsRead.procedure, "widget.stats.snapshot", "only the source-pinned cached read is allowed");
  const snapshot = { values: { cameras: 0, uptime: 0, version: "fixture" }, updatedAt: 123,
    retryAt: 0, error: false, stale: false };
  assert.equal(homarrReadShapeMatches(snapshot, statsRead.shape), true);
  for (const patch of [{ updatedAt: null }, { stale: true }, { error: true },
    { values: { ...snapshot.values, cameras: null } }]) {
    assert.equal(homarrReadShapeMatches({ ...snapshot, ...patch }, statsRead.shape), false);
  }
  assert.equal(homarrNativeEligibility(mapping, { ...recipe, appId: "changed" }).reasonCode,
    "native-recipe-contract-changed");
  assert.equal(homarrNativeEligibility(mapping, null).eligible, false);

  const input = validateInput({ schemaVersion: 2,
    homarr: { origin: "http://127.0.0.1:41070", boardName: "personal" },
    service: { id, name: id, description: "Source-reviewed synthetic service.",
      href: "http://127.0.0.1:41071", iconUrl: `https://example.test/${id}.svg`,
      access: "local", storagePath: null, credentialFile: null } });
  const seed = { id, appName: id, browserUrl: input.service.href, serverUrl: `http://${id}:8971/`, credentials: {} };
  assert.equal(homarrNativeEligibility(mapping, recipe, { integrationUrl: "https://frigate.localhost:4443",
    ownerRecordHash: "a".repeat(64), bindingHash: "b".repeat(64), caSha256: "c".repeat(64),
    recipeSha256: mapping.nativeRecipeSha256!, transportProofSha256: "d".repeat(64) }).eligible, false,
  "plain transport-shaped data must not bypass owner-derived trust evidence");
  let forbiddenCalls = 0;
  const deny = { async query(): Promise<never> { forbiddenCalls += 1; throw new Error("Unexpected query"); },
    async mutate(): Promise<never> { forbiddenCalls += 1; throw new Error("Unexpected write"); } };
  await assert.rejects(() => planHomarrStackSeed(deny, "personal", [seed]), /blocked/);
  await assert.rejects(() => applyHomarrStackSeed(deny, "personal", [seed], "not-approved"), /blocked/);
  assert.equal(forbiddenCalls, 0, "direct seed entrypoints must reject before any API call");
  assert.deepEqual(await checkSharedHomarrServices(deny, "personal", [{ seed }]), []);
  assert.equal(forbiddenCalls, 0, "blocked integrations must not run functional provider queries");

  const app = { id: `app-${id}`, name: id, href: input.service.href,
    iconUrl: input.service.iconUrl, description: input.service.description };
  const service = Object.fromEntries(Object.entries(input.service).sort(([a], [b]) => a.localeCompare(b)));
  const encoded = Buffer.from(JSON.stringify([service])).toString("base64url");
  const content = "<h2>Your homelab at a glance</h2><p>This private board links your self-hosted services. Dashboard shortcuts do not prove integrations or runtime health.</p>"
    + `<!-- selfhost-additional-services:start -->\n<!-- selfhost-additional-services:data:${encoded} -->\n`
    + `<h3>Your services</h3><ul><li><strong>${id}</strong> — Source-reviewed synthetic service. <a href="${input.service.href}">Open ${id}</a> (Docker-host browser only; not a remote link). `
    + "Storage path not recorded by this attachment. Credentials are managed outside this attachment. Backup restore has not been verified by this attachment.</li></ul>\n"
    + "<!-- selfhost-additional-services:end -->";
  const board = { id: "board-personal", name: "personal", isPublic: false,
    sections: [{ id: "main", kind: "empty" }], items: [
      { id: `tile-${id}`, kind: "app", options: { appId: app.id }, integrationIds: [],
        layouts: [{ layoutId: "desktop", sectionId: "main", xOffset: 0, yOffset: 0, width: 2, height: 1 }] },
      { id: "recap", kind: "notebook", options: { content }, integrationIds: [],
        layouts: [{ layoutId: "desktop", sectionId: "main", xOffset: 0, yOffset: 4, width: 8, height: recapHeight(content, 8) }] } ] };
  const calls: string[] = [];
  const client = { async query(procedure: string): Promise<unknown> {
    calls.push(procedure);
    if (procedure === "board.getAllBoards") return [{ id: board.id, name: board.name, isPublic: false }];
    if (procedure === "board.getBoardByName") return structuredClone(board);
    if (procedure === "board.getBoardSettings") return { id: board.id, name: board.name };
    if (procedure === "app.all") return [app];
    throw new Error(`Blocked native resources must not be queried: ${procedure}`);
  }, mutate: deny.mutate };
  const result = await inspectSharedHomarrServices(client, "personal", [{ input, seed, nativeEligibility: eligibility }]);
  const actual = result.services[0];
  assert.equal(actual.structureVerified, true);
  assert.equal(actual.notebookContentVerified, true);
  assert.equal(actual.notebookLayoutVerified, true);
  assert.equal(actual.integrationStructureVerified, false);
  assert.equal(actual.widgetStructureVerified, false);
  assert.equal(actual.tileOnly, false);
  assert.equal(actual.nativeIntegrationPending, true);
  assert.equal(actual.nativeIntegrationReason, code);
  assert.equal(result.status, "needs-attachment");
  assert.equal(result.mutation, false);
  assert.equal(forbiddenCalls, 0);
  assert.ok(!calls.some((procedure) => procedure.startsWith("integration.")));
  const attemptedOverride = await inspectSharedHomarrServices(client, "personal", [{ input, seed,
    nativeEligibility: { eligible: true, reasonCode: null, requirement: null } }]);
  assert.equal(attemptedOverride.services[0].nativeIntegrationPending, true);
}
for (const id of ["caddy", "traefik"]) {
  const recipe = JSON.parse(readFileSync(new URL(`${id}/recipe.json`, recipeRoot), "utf8"));
  const mapping = homarrStackMapping(id)!;
  assert.match(mapping.nativeRecipeSha256!, /^[a-f0-9]{64}$/);
  assert.equal(homarrNativeEligibility(mapping, recipe).eligible, true);
  assert.equal(homarrNativeEligibility(mapping, null).eligible, false);
  assert.equal(homarrNativeEligibility(mapping, { ...recipe, appId: "changed" }).reasonCode,
    "native-recipe-contract-changed");
}
const traefikMapping = homarrStackMapping("traefik")!;
assert.deepEqual(traefikMapping.requiredSecrets, ["username", "password"]);
assert.equal(traefikMapping.alternativeSecrets, undefined, "Traefik must not offer anonymous API access");
const caddyRecipe = JSON.parse(readFileSync(new URL("caddy/recipe.json", recipeRoot), "utf8"));
const caddyMapping = homarrStackMapping("caddy")!;
assert.equal(homarrNativeEligibility(caddyMapping, caddyRecipe).eligible, true);
assert.equal(caddyMapping.integrationKind, "caddy");
assert.deepEqual(caddyMapping.requiredSecrets, []);
assert.deepEqual(caddyMapping.widgets[0].metrics, ["upstreams", "requests", "requestsFailed"]);
assert.equal(caddyRecipe.services[0].publishTargetPort, 2015);
assert.equal(caddyRecipe.services[0].additionalPorts, undefined, "Writable admin must not be published");
assert.equal(caddyRecipe.defaults.hostIp, "127.0.0.1");
assert.equal(caddyRecipe.configFiles[0].content,
  "{\n  admin 127.0.0.1:2019\n}\n\nhttp://:2015 {\n  @upstreams {\n    method GET\n    path /reverse_proxy/upstreams\n  }\n  route {\n    respond /health 200\n    reverse_proxy @upstreams 127.0.0.1:2019 {\n      header_up Host 127.0.0.1:2019\n    }\n    respond 404\n  }\n}\n",
  "Only exact GET upstream statistics may reach loopback admin; POST, /config and /load fall through to 404");
assert.equal(homarrNativeEligibility(homarrStackMapping("sonarr"), null).eligible, true);
assert.equal(homarrNativeEligibility(homarrStackMapping("seerr"), null).eligible, true);
console.log("PASS source-bound native Homarr eligibility, tile/Notebook preservation and zero native calls (synthetic)");
