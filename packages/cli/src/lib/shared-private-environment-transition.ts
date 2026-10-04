import { createHash } from "node:crypto";
import { join } from "node:path";
import type { SharedEnvironmentReview } from "./shared-env-transition.ts";
import type { SharedProjectState } from "./shared-project-state.ts";

type Entry = Record<string, any>;

/** Detach an entire service-local private env file; never rewrite secret bytes.
 * The retained private file is inactive rejection evidence, not runtime configuration.
 */
export type SharedPrivateEnvironmentTransition = {
  serviceId: string;
  after: "first-admin-created";
  envFile: "service-private-env";
  removeStaticEnvironment: Array<{ name: string; value: string }>;
  privateEnvironmentNames: string[];
};

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const name = /^[A-Z][A-Z0-9_]{0,127}$/;

function fail(): never { throw new Error("Private environment closure differs from the exact source-owned service"); }

function checkedSource(appId: string, recipe: Entry, transition: SharedPrivateEnvironmentTransition): Entry {
  if (recipe?.appId !== appId || recipe.schemaVersion !== 2 || !Array.isArray(recipe.services)
    || !same(recipe.postFirstAccountPrivateEnvironment, transition)
    || !transition || Object.keys(transition).sort().join(",")
      !== "after,envFile,privateEnvironmentNames,removeStaticEnvironment,serviceId"
    || transition.after !== "first-admin-created" || transition.envFile !== "service-private-env"
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(transition.serviceId)
    || !Array.isArray(transition.removeStaticEnvironment) || transition.removeStaticEnvironment.length > 8
    || !Array.isArray(transition.privateEnvironmentNames) || transition.privateEnvironmentNames.length < 1
    || transition.privateEnvironmentNames.length > 12
    || transition.privateEnvironmentNames.some((value) => typeof value !== "string" || !name.test(value))
    || new Set(transition.privateEnvironmentNames).size !== transition.privateEnvironmentNames.length) fail();
  const source = recipe.services.filter((entry: Entry) => entry.id === transition.serviceId);
  if (source.length !== 1 || !Array.isArray(source[0].environment)
    || !Array.isArray(source[0].secretEnvironment) || source[0].secretEnvironment.length === 0) fail();
  const bindings = source[0].secretEnvironment.map((entry: Entry) => entry.name).sort();
  if (!same(bindings, [...transition.privateEnvironmentNames].sort())
    || [...(source[0].derivedEnvironment ?? []), ...(source[0].hostEnvironment ?? []),
      ...(source[0].fileEnvironment ?? [])].some((entry: Entry) => transition.privateEnvironmentNames.includes(entry.name))) fail();
  const staticNames = new Set<string>();
  for (const entry of transition.removeStaticEnvironment) {
    if (!entry || Object.keys(entry).sort().join(",") !== "name,value" || !name.test(entry.name)
      || typeof entry.value !== "string" || entry.value.length > 256 || /[\r\n\0$]/.test(entry.value)
      || staticNames.has(entry.name) || transition.privateEnvironmentNames.includes(entry.name)
      || !same(source[0].environment.filter((item: Entry) => item.name === entry.name), [entry])) fail();
    staticNames.add(entry.name);
  }
  return source[0];
}

/** Used by saved-selection reconstruction as well as transition review.
 * source is the compiler's exact original service, not caller-authored YAML.
 */
export function privateEnvironmentClosedService(source: Entry, appId: string, recipe: Entry,
  transition: SharedPrivateEnvironmentTransition): Entry {
  checkedSource(appId, recipe, transition);
  let serviceId = transition.serviceId;
  if (serviceId !== appId) serviceId = `${appId}-${serviceId}`;
  if (source?.id !== serviceId || !Array.isArray(source.environment)
    || typeof source.envFilePath !== "string") fail();
  for (const entry of transition.removeStaticEnvironment) {
    if (!same(source.environment.filter((item: Entry) => item.name === entry.name), [entry])) fail();
  }
  const result = structuredClone(source);
  const staticNames = new Set(transition.removeStaticEnvironment.map((entry) => entry.name));
  result.environment = result.environment.filter((entry: Entry) => !staticNames.has(entry.name));
  delete result.envFilePath;
  return result;
}

/** Existing transition owner must require captured-admin proof, exact revision approval,
 * checkpoint, scoped recreate and live absence before completion. This review performs no I/O.
 */
export function reviewSharedPrivateEnvironmentTransition(state: SharedProjectState, appId: string,
  recipe: Entry, transition: SharedPrivateEnvironmentTransition): SharedEnvironmentReview {
  checkedSource(appId, recipe, transition);
  if (state?.checkpoint?.phase !== "completed" || state.manifestHash !== hash(state.manifest)
    || !Object.hasOwn(state.units ?? {}, appId)) fail();
  let serviceId = transition.serviceId;
  if (serviceId !== appId) serviceId = `${appId}-${serviceId}`;
  const services = state.manifest.services.filter((entry: Entry) => entry.id === serviceId);
  if (!state.units[appId].includes(serviceId) || services.length !== 1
    || services[0].envFilePath !== join(state.project.directory, "secrets", appId, `${transition.serviceId}.env`)
    || state.manifest.services.some((entry: Entry) => entry.id !== serviceId
      && entry.envFilePath === services[0].envFilePath)) fail();
  const candidate = {
    manifest: structuredClone(state.manifest), units: structuredClone(state.units),
    selectionFingerprints: structuredClone(state.selectionFingerprints),
    settings: structuredClone(state.settings), projectDirectory: state.project.directory,
  };
  const index = candidate.manifest.services.findIndex((entry: Entry) => entry.id === serviceId);
  candidate.manifest.services[index] = privateEnvironmentClosedService(services[0], appId, recipe, transition);
  const manifestHash = hash(candidate.manifest);
  return { candidate, serviceId, manifestHash, approval: `TRANSITION:${appId}:${hash({
    project: state.project, revision: state.revision, previousManifestHash: state.manifestHash,
    manifestHash, appId, serviceId, privateEnvironment: transition,
  })}` };
}
