import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { privateEnvironmentClosedService, reviewSharedPrivateEnvironmentTransition,
  type SharedPrivateEnvironmentTransition } from "../src/lib/shared-private-environment-transition.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const appId = "stalwart-mail";
const transition: SharedPrivateEnvironmentTransition = {
  serviceId: appId, after: "first-admin-created", envFile: "service-private-env",
  removeStaticEnvironment: [{ name: "STALWART_RECOVERY_MODE", value: "1" }],
  privateEnvironmentNames: ["STALWART_RECOVERY_ADMIN"],
};
const recipe = { schemaVersion: 2, appId, postFirstAccountPrivateEnvironment: transition,
  services: [{ id: appId, environment: [{ name: "STALWART_RECOVERY_MODE", value: "1" }],
    secretEnvironment: [{ name: "STALWART_RECOVERY_ADMIN", fileId: "recovery-login", format: "private-config" }] }] };
function fixture() {
  const manifest = { project: { directory: "/tmp/private-transition/project" },
    services: [{ id: appId, environment: [{ name: "STALWART_RECOVERY_MODE", value: "1" },
      { name: "SAFE_POLICY", value: "false" }],
      envFilePath: "/tmp/private-transition/project/secrets/stalwart-mail/stalwart-mail.env",
      image: "example:v1@sha256:" + "a".repeat(64), ports: [], mounts: [] },
    { id: "other-app", environment: [], envFilePath: "/tmp/private-transition/project/secrets/other-app/other-app.env" }] };
  return { project: manifest.project, manifest, manifestHash: hash(manifest), revision: 7,
    checkpoint: { phase: "completed" }, units: { [appId]: [appId], "other-app": ["other-app"] },
    selectionFingerprints: { [appId]: "unchanged", "other-app": "unchanged-peer" }, settings: { uid: 1000 } } as any;
}

test("private-env removal uses exact saved owner and changes only selected service", () => {
  const state = fixture();
  const original = structuredClone(state);
  const review = reviewSharedPrivateEnvironmentTransition(state, appId, recipe, transition);
  expect(review.approval).toMatch(/^TRANSITION:stalwart-mail:[a-f0-9]{64}$/);
  expect(review.candidate.manifest.services[0].envFilePath).toBeUndefined();
  expect(review.candidate.manifest.services[0].environment).toEqual([{ name: "SAFE_POLICY", value: "false" }]);
  expect(review.candidate.manifest.services[1]).toEqual(state.manifest.services[1]);
  expect(review.candidate.selectionFingerprints).toEqual(state.selectionFingerprints);
  expect(state).toEqual(original);
  expect(review.manifestHash).not.toBe(state.manifestHash);
  const later = { ...state, revision: state.revision + 1 };
  expect(reviewSharedPrivateEnvironmentTransition(later, appId, recipe, transition).approval).not.toBe(review.approval);
});

test("rejects arbitrary descriptor, non-exclusive env file and drift", () => {
  expect(() => reviewSharedPrivateEnvironmentTransition(fixture(), appId, recipe,
    { ...transition, privateEnvironmentNames: ["OTHER_CREDENTIAL"] })).toThrow();
  const extraSecret = structuredClone(recipe);
  extraSecret.services[0].secretEnvironment.push({ name: "UNRELATED_SECRET", fileId: "other", format: "private-config" });
  expect(() => reviewSharedPrivateEnvironmentTransition(fixture(), appId, extraSecret, transition)).toThrow();
  for (const mutate of [
    (state: any) => { state.manifest.services[0].envFilePath = "/tmp/unowned.env"; },
    (state: any) => { state.manifest.services[1].envFilePath = state.manifest.services[0].envFilePath; },
    (state: any) => { state.manifest.services[0].environment[0].value = "0"; },
    (state: any) => { state.checkpoint.phase = "attempted"; },
    (state: any) => { state.units[appId] = ["other-app"]; },
  ]) {
    const state = fixture(); mutate(state); state.manifestHash = hash(state.manifest);
    expect(() => reviewSharedPrivateEnvironmentTransition(state, appId, recipe, transition)).toThrow();
  }
});

test("saved reconstruction produces the same closed service and refuses closure replay", () => {
  const state = fixture();
  const closed = privateEnvironmentClosedService(state.manifest.services[0], appId, recipe, transition);
  expect(closed).toEqual(reviewSharedPrivateEnvironmentTransition(state, appId, recipe, transition).candidate.manifest.services[0]);
  expect(() => privateEnvironmentClosedService(closed, appId, recipe, transition)).toThrow();
});
