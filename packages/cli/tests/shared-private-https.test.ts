import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sharedProjectCandidate, type SharedProjectObservation } from "../src/lib/shared-compose-project.ts";
import { saveSharedProjectState, type SharedProjectState } from "../src/lib/shared-project-state.ts";
import { planSharedPrivateHttps, sharedPrivateHttpsHostnameScope } from "../src/lib/shared-private-https.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";

type Entry = Record<string, any>;
const temporary = await mkdtemp(join(tmpdir(), "shared-private-https-"));
try {
  const appImage = "docker.io/library/busybox:1.37.0";
  function selection(appId: string, port: number) {
    return { appId, port, images: { [appId]: `${appImage}@sha256:${"a".repeat(64)}` },
      recipe: { schemaVersion: 2, kind: "multi-service-compose", appId,
        services: [{ id: appId, imageTag: appImage, user: "image-default",
          imageUserEvidence: { officialUrl: "https://example.test", reason: "official-image-runtime-contract" },
          restart: "unless-stopped", readOnly: false, environment: [], hostEnvironment: [],
          fileEnvironment: [], mounts: [{ kind: "volume", name: "state", target: "/state" }],
          dependsOn: [], publishTargetPort: 8080 }],
        privateFiles: [], defaults: { hostIp: "127.0.0.1" } } };
  }
  const selections = [selection("alpha", 18080), selection("beta", 18081)];
  selections[0]!.recipe.services.push({ ...selections[0]!.recipe.services[0]!, id: "db",
    mounts: [{ kind: "volume", name: "db-state", target: "/db-state" }], publishTargetPort: null } as any);
  (selections[0]!.images as Entry).db = `${appImage}@sha256:${"a".repeat(64)}`;
  const original = sharedProjectCandidate({ projectRoot: temporary, projectId: "https-test",
    dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC",
    apps: selections,
    observed: { checkedAt: "2026-10-03T12:00:00Z", ports: [], paths: [], networks: [] } });
  await mkdir(original.projectDirectory, { recursive: true, mode: 0o700 });
  let state = await saveSharedProjectState(original,
    { operation: "create", phase: "reviewed", appIds: ["alpha", "beta"] },
    { revision: 0, manifestHash: null, checkpoint: null });
  for (const phase of ["attempted", "completed"] as const) {
    state = await saveSharedProjectState(original,
      { operation: "create", phase, appIds: ["alpha", "beta"] },
      { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
  }
  const recipe = JSON.parse(await readFile(new URL(
    "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/caddy/recipe.json",
    import.meta.url), "utf8"));
  const image = `${recipe.services[0].imageTag}@sha256:${"b".repeat(64)}`;
  const observation: SharedProjectObservation = {
    project: { id: state.project.id, directory: state.project.directory, owner: state.project.owner },
    checkedAt: "2026-10-03T12:01:00Z", ports: [], paths: [],
    networks: state.manifest.networks.map((network: Entry) => ({ name: network.name, owner: state.project.id })),
    volumes: state.manifest.services.flatMap((service: Entry) => service.mounts
      .filter((mount: Entry) => mount.kind === "volume")
      .map((mount: Entry) => ({ name: mount.name, driver: "local", owner: state.project.id,
        labels: { "com.docker.compose.project": state.project.id,
          "com.docker.compose.volume": mount.name,
          "io.selfhost.project": state.project.id,
          "io.selfhost.volume": mount.name.slice(state.project.id.length + 1) } }))),
  };
  const routes = [{ appId: "beta", hostname: "beta.localhost" }, { appId: "alpha", hostname: "alpha.localhost" }];
  const snapshots = [state, recipe, observation, routes].map((value) => JSON.stringify(value));
  const plan = planSharedPrivateHttps(state, recipe, image, routes, 28443, observation);
  assert.deepEqual([state, recipe, observation, routes].map((value) => JSON.stringify(value)), snapshots);
  assert.deepEqual(plan.owner, { projectId: state.project.id, revision: state.revision,
    recordHash: state.recordHash, manifestHash: state.manifestHash });
  assert.deepEqual(plan.routes, [
    { appId: "alpha", hostname: "alpha.localhost", url: "https://alpha.localhost:28443", frontService: "alpha", targetPort: 8080 },
    { appId: "beta", hostname: "beta.localhost", url: "https://beta.localhost:28443", frontService: "beta", targetPort: 8080 },
  ]);
  const content = plan.caddySelection.recipe.configFiles[0].content;
  assert.match(content, /admin off/);
  assert.match(content, /auto_https disable_redirects/);
  assert.match(content, /alpha\.localhost:28443 \{\n\ttls internal\n\treverse_proxy alpha:8080/);
  assert.match(plan.caddyfileSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(plan.evidence, { transportVerified: false, dnsVerified: false,
    clientTrustVerified: false, applicationVerified: false });
  assert.ok(plan.blockers.includes("persisted-route-bindings-and-resume"));
  assert.ok(plan.blockers.includes("caddy-http-health-adapter-does-not-verify-tls"));
  assert.ok(plan.blockers.includes("upstream-http-protocol-and-proxy-settings"));
  assert.equal(Object.hasOwn(plan, "approval"), false);
  const caddy = plan.candidate.manifest.services.find((service: Entry) => service.id === "caddy");
  assert.deepEqual(caddy.networks, ["front", "caddy-private"]);
  assert.deepEqual(caddy.networkAliases, [{ network: "front", alias: "alpha.localhost" },
    { network: "front", alias: "beta.localhost" }]);
  const historical = planSharedPrivateHttps(state, recipe, image, routes, 28443, observation, false);
  assert.equal(historical.caddyRouteAliases, undefined);
  assert.equal(historical.caddySelection.recipe.sharedPrivateHttpsRouteAliases, undefined);
  assert.equal(historical.candidate.manifest.services.find((service: Entry) => service.id === "caddy").networkAliases, undefined);
  assert.equal(caddy.networks.includes("alpha-private"), false);
  assert.equal(plan.candidate.manifest.services.find((service: Entry) => service.id === "alpha-db")
    .networks.includes("front"), false);
  assert.deepEqual(caddy.ports, [{ hostIp: "127.0.0.1", published: 28443, target: 28443,
    protocol: "tcp", purpose: "admin", publicApproved: false }]);
  assert.equal(caddy.mounts.filter((mount: Entry) => mount.kind === "volume").length, 2);
  const compose = await createSelfhostComposeOwner(plan.candidate.manifest).plan();
  assert.equal(compose.status, "pass");
  assert.ok(compose.claims.privatePorts.some((claim: Entry) => claim.service === "caddy"
    && claim.hostIp === "127.0.0.1" && claim.published === 28443 && claim.target === 28443));
  const added = await saveSharedProjectState(plan.candidate,
    { operation: "add", phase: "reviewed", appIds: ["caddy"] },
    { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
  assert.equal(added.revision, state.revision + 1);
  for (const appId of ["alpha", "beta"]) {
    assert.deepEqual(added.units[appId], state.units[appId]);
    assert.equal(added.selectionFingerprints[appId], state.selectionFingerprints[appId]);
    const before = structuredClone(state.manifest.services.find((service: Entry) => service.id === appId));
    const after = structuredClone(added.manifest.services.find((service: Entry) => service.id === appId));
    delete before.ownership;
    delete after.ownership;
    for (const mount of before.mounts) delete mount.ownership;
    for (const mount of after.mounts) delete mount.ownership;
    assert.deepEqual(after, before);
  }
  const single = [{ appId: "alpha", hostname: "alpha.localhost" }];
  assert.throws(() => planSharedPrivateHttps(state, recipe, image, single, 443, observation), /high TLS port/);
  assert.throws(() => planSharedPrivateHttps(state, recipe, image, single, 18080, observation), /published port/);
  assert.throws(() => planSharedPrivateHttps(state, recipe, image, single, 28443,
    { ...observation, ports: [{ protocol: "tcp", published: 28443, hostIp: "127.0.0.1" }] }), /observed TCP/);
  assert.throws(() => planSharedPrivateHttps(state, recipe, "caddy:0.0.0@sha256:" + "a".repeat(64), single, 28443, observation), /Pinned image/);
  assert.throws(() => planSharedPrivateHttps(state, recipe, recipe.services[0].imageTag, single, 28443, observation), /Pinned image/);
  for (const hostname of ["127.0.0.1", "alpha.123", "https://alpha.localhost", "Alpha.localhost", "alpha.localhost\nadmin off"]) {
    assert.throws(() => planSharedPrivateHttps(state, recipe, image, [{ appId: "alpha", hostname }], 28443, observation), /private hostname/);
  }
  const privateNames = planSharedPrivateHttps(state, recipe, image,
    [{ appId: "alpha", hostname: "alpha.home.arpa" }], 28443, observation);
  assert.match(privateNames.caddySelection.recipe.configFiles[0].content,
    /alpha\.home\.arpa:28443 \{\n\ttls internal\n\treverse_proxy alpha:8080/);
  assert.equal(sharedPrivateHttpsHostnameScope(privateNames.routes), "host-only-name-override");
  assert.equal(sharedPrivateHttpsHostnameScope(plan.routes), "host-only-localhost");
  assert.deepEqual(privateNames.evidence, plan.evidence);
  const domainNames = planSharedPrivateHttps(state, recipe, image,
    [{ appId: "alpha", hostname: "alpha.example.com" }], 28443, observation);
  assert.match(domainNames.caddySelection.recipe.configFiles[0].content,
    /alpha\.example\.com:28443 \{\n\ttls internal\n\treverse_proxy alpha:8080/);
  assert.equal(sharedPrivateHttpsHostnameScope(domainNames.routes), "host-only-name-override");
  assert.deepEqual(domainNames.evidence, plan.evidence);
  assert.throws(() => planSharedPrivateHttps(state, recipe, image,
    [{ appId: "authelia", hostname: "auth.home.arpa" }], 28443, observation), /cookie-domain contract/);
  assert.throws(() => planSharedPrivateHttps(state, recipe, image,
    [{ appId: "caddy", hostname: "caddy.localhost" }], 28443, observation), /private hostname/);
  assert.throws(() => planSharedPrivateHttps(state, recipe, image,
    [{ appId: "alpha-db", hostname: "db.localhost" }], 28443, observation), /frontend/);
  assert.throws(() => planSharedPrivateHttps(state, recipe, image,
    [...single, { appId: "beta", hostname: "alpha.localhost" }], 28443, observation), /unique/);
  assert.throws(() => planSharedPrivateHttps(state, recipe, image,
    [...single, { appId: "alpha", hostname: "second.localhost" }], 28443, observation), /unique/);
  assert.throws(() => planSharedPrivateHttps(state, recipe, image,
    [{ ...single[0], url: "http://elsewhere" } as any], 28443, observation), /private hostname/);
  assert.throws(() => planSharedPrivateHttps(added, recipe, image, single, 28443, observation), /completed/);
  function resign(changed: SharedProjectState) {
    changed.manifestHash = createHash("sha256").update(JSON.stringify(changed.manifest)).digest("hex");
    const { recordHash: _ignored, ...record } = changed;
    changed.recordHash = createHash("sha256").update(JSON.stringify(record)).digest("hex");
    return changed;
  }
  for (const change of [
    (front: Entry) => { front.networks = ["alpha-private"]; },
    (front: Entry) => { front.ports[0].purpose = "database"; },
    (front: Entry) => { front.ports[0].protocol = "udp"; },
    (front: Entry) => { front.ports[0].hostIp = "0.0.0.0"; },
  ]) {
    const changed = structuredClone(state);
    change(changed.manifest.services.find((service: Entry) => service.id === "alpha"));
    assert.throws(() => planSharedPrivateHttps(resign(changed), recipe, image, single, 28443, observation), /frontend|binding/);
  }
  for (const change of [
    (front: Entry) => { front.networkAliases = [{ network: "front", alias: "alpha.localhost" }]; },
    (front: Entry) => { front.hostname = "alpha.localhost"; },
  ]) {
    const changed = structuredClone(state);
    change(changed.manifest.services.find((service: Entry) => service.id === "beta"));
    assert.throws(() => planSharedPrivateHttps(resign(changed), recipe, image, single, 28443, observation), /conflicts/);
  }
  const completedCaddy = structuredClone(added);
  completedCaddy.checkpoint.phase = "completed";
  assert.throws(() => planSharedPrivateHttps(resign(completedCaddy), recipe, image, single, 28443, observation), /already installed/);
  console.log("shared private HTTPS planning fixture passed (no Docker or live TLS)");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
