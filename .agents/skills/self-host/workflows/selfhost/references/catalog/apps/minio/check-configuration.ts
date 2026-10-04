import assert from "node:assert/strict";
import { AISTOR_IMAGE, AISTOR_IMAGE_DIGEST, assertAistorConfigurationUnchanged, compileAistorConfiguration,
  type AistorConfigurationInput } from "./configuration.ts";
import { validateAppRecipe } from "../../../../scripts/catalog.ts";

const input: AistorConfigurationInput = { edition: "aistor-licensed", rootUsername: "owner-selected-root-identity" };
const compiled = compileAistorConfiguration(input);
assert.deepEqual(compileAistorConfiguration(input), compiled);
assert.equal(compiled.installable, true);
assert.equal(compiled.setupState, "pending");
assert.equal(compiled.apiKey, "not-created");
assert.equal(compiled.binding.imageDigest, AISTOR_IMAGE_DIGEST);
assert.equal(compiled.recipe.defaults.hostIp, "127.0.0.1");
assert.equal(compiled.recipe.services[0].publishTargetPort, 9000);
assert.equal(compiled.recipe.services[0].additionalPorts[0].targetPort, 9001);
assert.deepEqual(compiled.recipe.services[0].fileEnvironment, [{ name: "MINIO_LICENSE",
  fileId: "aistor-license", format: "file-path", officialUrl: "https://docs.min.io/aistor/reference/aistor-server/settings/core/" },
  { name: "MINIO_ROOT_PASSWORD_FILE", fileId: "admin-password" }]);
assert.deepEqual(compiled.recipe.privateFiles, [{ id: "admin-password", bytes: 48, format: "alphanumeric" },
  { id: "aistor-license", source: "owner", maxBytes: 16384 }]);
assert.equal(compiled.recipe.onboarding.username, input.rootUsername);
const app = await Bun.file(new URL("./manifest.json", import.meta.url)).json();
assert.equal(app.image.reference, AISTOR_IMAGE);
assert.equal(app.support.automation, "discovery");
assert.deepEqual(validateAppRecipe(compiled.recipe, app), []);
assertAistorConfigurationUnchanged(input, compiled.binding.configurationFingerprint);
assert.throws(() => assertAistorConfigurationUnchanged({ ...input, rootUsername: "another-reviewed-root-name" }, compiled.binding.configurationFingerprint));
for (const invalid of [undefined, {}, { rootUsername: input.rootUsername },
  { ...input, edition: "community" }, { ...input, rootUsername: "minioadmin" },
  { ...input, rootUsername: "minioadmin-but-longer" }, { ...input, rootUsername: "bad\nusername-with-padding" },
  { ...input, license: "not-a-public-input" }]) {
  assert.throws(() => compileAistorConfiguration(invalid as AistorConfigurationInput));
}
console.log("AIStor configuration contract checks passed (no runtime acceptance)");
