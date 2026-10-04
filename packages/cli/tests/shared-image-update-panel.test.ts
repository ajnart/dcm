import assert from "node:assert/strict";
import { runSharedImageUpdate } from "../src/control-panel/shared-image-update.ts";

const root = "/tmp/synthetic-image-update";
const projectId = "household";
const oldPin = `vendor/app:1@sha256:${"1".repeat(64)}`;
const newPin = `vendor/app:2@sha256:${"2".repeat(64)}`;
const app = { id: "alpha", image: { alpha: oldPin, database: oldPin } };
const review = {
  command: "app shared image-transition-plan", projectRoot: root, projectId, appId: app.id,
  status: "review", resumeReviewed: false, mutation: false, services: ["alpha", "alpha-database"],
  changes: [{ serviceId: "alpha", from: oldPin, to: newPin }],
  fromManifestHash: "a".repeat(64), toManifestHash: "b".repeat(64),
  approval: `IMAGE-TRANSITION:alpha:${"c".repeat(64)}`,
  dataPreserved: true, credentialsRegenerated: false, acceptanceVerified: false,
};
function fixture(value: unknown = review, approved = true,
  result: Record<string, unknown> = { ...review, command: "app shared image-transition-apply",
    status: "updated-unverified", mutation: true, approval: undefined }) {
  const calls: string[][] = [];
  const messages: string[] = [];
  let prompts = 0;
  let paused = 0;
  return { calls, messages, get prompts() { return prompts; }, get paused() { return paused; },
    dependencies: {
      readOnlyCliJson: async (args: string[]) => { calls.push(args); return value; },
      runJsonCli: async (args: string[]) => { calls.push(args); return result; },
      confirm: async () => { prompts += 1; return approved; },
      note: (message: string) => { messages.push(message); },
      beforeApply: () => { paused += 1; },
    } };
}

const success = fixture();
assert.equal(await runSharedImageUpdate(root, projectId, app, success.dependencies), true);
assert.deepEqual(success.calls[0], ["app", "shared", "image-transition-plan", "--project-root", root,
  "--project-id", projectId, "--app", "alpha", "--json"]);
assert.deepEqual(success.calls[1], ["app", "shared", "image-transition-apply", "--project-root", root,
  "--project-id", projectId, "--app", "alpha", "--approve", review.approval, "--json"]);
assert.equal(success.prompts, 1);
assert.equal(success.paused, 1);
assert(success.messages[0]?.includes(oldPin) && success.messages[0]?.includes(newPin));
assert(success.messages[1]?.includes("does not prove"));

const cancelled = fixture(review, false);
assert.equal(await runSharedImageUpdate(root, projectId, app, cancelled.dependencies), false);
assert.equal(cancelled.calls.length, 1);
assert.equal(cancelled.paused, 0);
const unavailable = fixture();
unavailable.dependencies.readOnlyCliJson = async () => { throw new Error("synthetic registry unavailable"); };
assert.equal(await runSharedImageUpdate(root, projectId, app, unavailable.dependencies), false);
assert.equal(unavailable.prompts, 0);
assert.equal(unavailable.calls.length, 0);

for (const patch of [
  { projectId: "foreign" }, { services: ["alpha", "beta"] }, { services: ["alpha"] },
  { mutation: true }, { credentialsRegenerated: true }, { acceptanceVerified: true },
  { fromManifestHash: review.toManifestHash }, { approval: "other" },
  { status: "attempted" }, { resumeReviewed: true },
  { changes: [{ serviceId: "beta", from: oldPin, to: newPin }] },
  { changes: [{ serviceId: "alpha", from: oldPin, to: oldPin }] },
  { changes: [{ serviceId: "alpha", from: oldPin, to: "vendor/app:latest" }] },
  { changes: [review.changes[0], review.changes[0]] },
]) {
  const invalid = fixture({ ...review, ...patch });
  await assert.rejects(runSharedImageUpdate(root, projectId, app, invalid.dependencies));
  assert.equal(invalid.prompts, 0);
  assert.equal(invalid.calls.length, 1);
}
const resumed = { ...review, status: "resume-reviewed", resumeReviewed: true };
const recovery = fixture(resumed, true, { ...resumed, command: "app shared image-transition-apply",
  status: "updated-unverified", mutation: true });
assert.equal(await runSharedImageUpdate(root, projectId, app, recovery.dependencies), true);
for (const patch of [
  { status: "inspect-required" }, { services: ["beta"] }, { credentialsRegenerated: true },
  { changes: [{ serviceId: "alpha", from: oldPin, to: oldPin }] },
]) {
  const invalidResult = fixture(review, true, { ...review, command: "app shared image-transition-apply",
    status: "updated-unverified", mutation: true, ...patch });
  await assert.rejects(runSharedImageUpdate(root, projectId, app, invalidResult.dependencies));
  assert.equal(invalidResult.calls.length, 2); // No retry after an uncertain apply.
}
const uncertain = fixture();
uncertain.dependencies.runJsonCli = async (args) => {
  uncertain.calls.push(args);
  throw new Error("synthetic uncertain apply");
};
await assert.rejects(runSharedImageUpdate(root, projectId, app, uncertain.dependencies), /uncertain apply/);
assert.equal(uncertain.calls.length, 2);
console.log("shared image-update panel fixture passed");
