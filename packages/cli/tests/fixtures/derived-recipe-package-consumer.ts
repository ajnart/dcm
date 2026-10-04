import { loadSharedDerivedRecipeBindingSync } from "../../src/lib/shared-derived-recipe-state.ts";
const binding = loadSharedDerivedRecipeBindingSync(process.argv[2]!, process.argv[3]!);
console.log(JSON.stringify({ appId: binding.selection.appId, sourceSha256: binding.derived.sourceSha256,
  selectionFingerprint: binding.selectionFingerprint }));
