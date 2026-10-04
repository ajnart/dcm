import assert from "node:assert/strict";
import { bundledRecipeChoices, bundledSharedRecipeChoices, installActions, mediaCatalogSupported, plannedAppCommand,
  reviewedRecipePlan } from "../src/interactive-catalog.ts";

assert.deepEqual(installActions({ media: true, household: true }).map((action) => action.value), ["install-household", "install-media"]);
assert.deepEqual(installActions({ media: true, household: false }).map((action) => action.value), ["install-media"]);
assert.deepEqual(installActions({ media: false, household: false }), []);

const recipeItems = [
  { appId: "uptime-kuma", name: "Uptime Kuma", purpose: "Checks services.",
    kind: "single-service-compose", schemaVersion: 1, defaultPort: 3001, serviceCount: 1,
    recipeSha256: "c".repeat(64),
    recipeCapability: { boundedApply: true, maturity: "preview" } },
  { appId: "paperless-ngx", name: "Paperless-ngx", purpose: "Archives documents.",
    kind: "multi-service-compose", schemaVersion: 2, defaultPort: 8000, serviceCount: 3,
    recipeSha256: "d".repeat(64),
    recipeCapability: { boundedApply: true, maturity: "experimental" } },
];
const choices = bundledRecipeChoices({ catalogSource: { kind: "bundled", executionAuthority: "packaged" },
  recipes: recipeItems });
assert.deepEqual(choices.map((choice) => choice.appId), ["paperless-ngx", "uptime-kuma"]);
assert.deepEqual(bundledRecipeChoices({ catalogSource: { kind: "external", executionAuthority: "read-only-declarative" },
  recipes: recipeItems }), []);
assert.throws(() => bundledRecipeChoices({ catalogSource: { kind: "bundled", executionAuthority: "packaged" },
  recipes: [recipeItems[0], recipeItems[0]] }), /bounded CLI apply choice/);
const approval = `APP-APPLY:paperless-ngx:${"a".repeat(64)}`;
const images = Object.fromEntries(["paperless-ngx", "broker", "db"].map((id) => [id,
  `example.invalid/${id}:1@sha256:${"b".repeat(64)}`]));
const recipePlan = { command: "app plan", appId: "paperless-ngx", status: "candidate", mutation: false,
  acceptanceVerified: false, recipeSha256: "d".repeat(64), host: { projectRoot: "/tmp/recipe" },
  compose: { projectId: "selfhost-paperless-ngx-test", renderTarget: "/tmp/recipe/compose.yaml",
    dataDirectory: "/tmp/recipe/data", publishedPort: "127.0.0.1:8000:8000/tcp", serviceCount: 3 },
  approval, images, servicePurposes: [
    { id: "paperless-ngx", purpose: "Stores and searches the document library." },
    { id: "broker", purpose: "Queues background document jobs." },
    { id: "db", purpose: "Stores document metadata and accounts." },
  ] };
assert.deepEqual(reviewedRecipePlan(choices[0], recipePlan, "/tmp/recipe", "8000").images,
  Object.entries(images).map(([id, image]) => `${id}=${image}`));
assert.throws(() => reviewedRecipePlan(choices[0], { ...recipePlan, images: { db: images.db } },
  "/tmp/recipe", "8000"), /pin every image/);
assert.throws(() => reviewedRecipePlan(choices[0], recipePlan, "/tmp/other", "8000"), /selected recipe/);
assert.throws(() => reviewedRecipePlan(choices[0], { ...recipePlan, recipeSha256: "e".repeat(64) },
  "/tmp/recipe", "8000"), /selected recipe/);

const catalogSource = { kind: "bundled", executionAuthority: "packaged" };
const plan = { catalogSource, selectedApps: [{ id: "immich", cliSetup: { command: "immich" } }] };
assert.equal(plannedAppCommand(plan, "immich"), "immich");
assert.equal(plannedAppCommand(plan, "docmost"), null);
assert.equal(plannedAppCommand({ ...plan, selectedApps: [{ id: "immich", cliSetup: { command: "unknown" } }] }, "immich"), null);
assert.equal(plannedAppCommand({ ...plan, catalogSource: { kind: "external", executionAuthority: "read-only-declarative" } }, "immich"), null);
assert.equal(plannedAppCommand({ ...plan, projectContext: { catalogChanged: true } }, "immich"), null);

const mediaApps = ["homarr", "jellyfin", "seerr", "sonarr", "radarr", "prowlarr", "qbittorrent"];
const mediaPlan = { catalogSource, selectedApps: mediaApps.map((id) => ({ id })), setupStages: [{ id: "media", owner: "selfhost-media", apps: mediaApps }] };
assert.equal(mediaCatalogSupported(mediaPlan), true);
assert.equal(mediaCatalogSupported({ ...mediaPlan, catalogSource: { kind: "external", executionAuthority: "read-only-declarative" } }), false);
assert.equal(mediaCatalogSupported({ ...mediaPlan, projectContext: { planChanged: true } }), false);
assert.equal(mediaCatalogSupported({ ...mediaPlan, selectedApps: mediaApps.slice(1).map((id) => ({ id })) }), false);
assert.equal(mediaCatalogSupported({ ...mediaPlan, setupStages: [{ id: "media", owner: "selfhost-media", apps: mediaApps.slice(1) }] }), false);
assert.equal(mediaCatalogSupported({ ...mediaPlan, setupStages: [{ id: "media", owner: "selfhost-compose", apps: mediaApps }] }), false);

const derivedChoices = bundledSharedRecipeChoices({ catalogSource, recipes: recipeItems },
  [{ id: "headscale", name: "Headscale" }, { id: "haproxy", name: "HAProxy" }, { id: "minio", name: "MinIO" }]);
const headscale = derivedChoices.find((choice) => choice.appId === "headscale")!;
assert.equal(headscale.kind, "shared-derived-compose");
assert.equal(headscale.recipeSha256, null);
assert.equal(headscale.serviceCount, null);
assert.equal(headscale.defaultPort, null);
assert.deepEqual(headscale.installInputDefinitions?.map((field) => field.key), ["canonical-origin", "magic-dns-domain"]);
assert.equal(derivedChoices.find((choice) => choice.appId === "haproxy")?.kind, "shared-derived-compose");
assert.equal(derivedChoices.find((choice) => choice.appId === "minio")?.kind, "shared-derived-compose");
assert.equal(bundledSharedRecipeChoices({ catalogSource: { kind: "external" }, recipes: [] },
  [{ id: "headscale", name: "Headscale" }]).length, 0);
assert.throws(() => bundledSharedRecipeChoices({ catalogSource, recipes: [] },
  [{ id: "headscale", name: "" }]), /catalog identity/);
const connector = { ...recipeItems[1], appId: "tailscale", name: "Tailscale", serviceCount: 1,
  defaultPort: null, execution: { kind: "private-connector" } };
assert.deepEqual(bundledRecipeChoices({ catalogSource, recipes: [connector] }), []);
assert.equal(bundledSharedRecipeChoices({ catalogSource, recipes: [connector] })[0].connector, true);
process.stdout.write("interactive catalog static, derived discovery and portless connector checks passed\n");
