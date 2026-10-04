import assert from "node:assert/strict";
import { containsHostHomePath } from "../../../scripts/validate-repo.ts";

const path = ".agents/skills/self-host/workflows/selfhost/references/catalog/apps/example/recipe.json";
const recipe = { schemaVersion: 2, kind: "multi-service-compose", services: [{
  mounts: [{ kind: "volume", name: "database", target: "/home/postgres/pgdata/data" }],
}] };
assert.equal(containsHostHomePath(path, JSON.stringify(recipe)), false);
assert.equal(containsHostHomePath(path, JSON.stringify({ ...recipe, hostPath: "/home/operator/data" })), true);
assert.equal(containsHostHomePath(path, JSON.stringify({ ...recipe,
  services: [{ mounts: [{ kind: "bind", source: "/home/operator/data", target: "/data" }] }],
})), true);
assert.equal(containsHostHomePath(path, JSON.stringify({ ...recipe,
  services: [{ mounts: [{ kind: "generated-file", target: "/home/operator/config" }] }],
})), true);
assert.equal(containsHostHomePath("other/recipe.json", JSON.stringify(recipe)), true);
assert.equal(containsHostHomePath(path, "invalid /home/operator/data"), true);
assert.equal(containsHostHomePath(path, JSON.stringify({ ...recipe, schemaVersion: 1 })), true);
assert.equal(containsHostHomePath(path, "no host-specific path"), false);
console.log("Portable container volume targets accepted; host-specific paths remain rejected");
