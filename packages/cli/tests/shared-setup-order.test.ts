import assert from "node:assert/strict";

import { resolveSetupAfter } from "../src/control-panel/setup-engine.ts";
import { sharedSetupGroups } from "../src/shared-project.ts";

const units = { jellyfin: ["jellyfin"], sonarr: ["sonarr"], radarr: ["radarr"],
  seerr: ["seerr"] };
const recipeFor = (appId: string) => ({ recipe: {
  onboarding: appId === "seerr" ? { providerAppId: "jellyfin" } : undefined,
} }) as never;
const ids = ["seerr", "jellyfin", "sonarr", "radarr"];
const after = await resolveSetupAfter(ids);
assert.deepEqual(after.get("seerr"), ["jellyfin", "sonarr", "radarr"]);

const planned = sharedSetupGroups(ids, { units } as never, recipeFor, after);
assert.deepEqual(planned.groups, [["jellyfin", "sonarr", "radarr"], ["seerr"]]);
assert.deepEqual(planned.dependencies.get("seerr"), ["jellyfin", "sonarr", "radarr"]);

const withoutArr = sharedSetupGroups(["seerr", "jellyfin"],
  { units: { jellyfin: ["jellyfin"], seerr: ["seerr"] } } as never, recipeFor, after);
assert.deepEqual(withoutArr.groups, [["jellyfin"], ["seerr"]]);
assert.deepEqual(withoutArr.dependencies.get("seerr"), ["jellyfin"]);

assert.throws(() => sharedSetupGroups(["seerr"], { units: { seerr: ["seerr"] } } as never,
  recipeFor, after), /exact selected Compose provider/);
assert.throws(() => sharedSetupGroups(["seerr", "jellyfin"], { units } as never,
  recipeFor, new Map([
    ["seerr", ["jellyfin"]],
    ["jellyfin", ["seerr"]],
  ])), /dependencies contain a cycle/);

console.log("shared setup dependency ordering: pass");
