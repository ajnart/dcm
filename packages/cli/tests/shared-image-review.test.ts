import { expect, test } from "bun:test";
import { enrichProjectSnapshot, type ProjectSnapshot } from "../src/control-panel/project-snapshot.ts";

const hash = "a".repeat(64);
const oldPin = `vendor/app:1@sha256:${"1".repeat(64)}`;
const newPin = `vendor/app:1@sha256:${"2".repeat(64)}`;

function snapshot(): ProjectSnapshot {
  const ids = ["same", "updated", "changed-source", "changed-service", "changed-recipe",
    "missing-recipe", "failed-registry", "manual-job", "changed-owner"];
  return { root: "/tmp/synthetic-image-review", owners: { project: false, cli: false,
    stack: false, appBatch: false, bundles: [], shared: ["home"] }, apps: [],
  shared: [{ id: "home", stage: "completed", apps: ids.map((id) => ({ id, url: null,
    runtime: null, manualJob: id === "manual-job", image: { [id]: oldPin },
    recipeSha256: id === "missing-recipe" ? null : hash,
    update: { status: "unknown", registryImage: null }, limitations: [] })) }] };
}

test("shared image review compares exact guarded pins, stays bounded and read-only, and retains prepared jobs", async () => {
  const saved = snapshot();
  const calls: string[][] = [];
  let active = 0;
  let peak = 0;
  const reviewed = await enrichProjectSnapshot(saved, async (args) => {
    calls.push(args);
    if (args[1] === "shared") {
      expect(args[2]).toBe("status");
      return { command: "app shared status", mutation: false, projectRoot: saved.root,
        projectId: "home", status: "completed", images: Object.fromEntries(saved.shared[0].apps
          .map((app) => [app.id, app.image])),
        recipeSha256: Object.fromEntries(saved.shared[0].apps.map((app) => [app.id,
          app.id === "changed-owner" ? "b".repeat(64) : app.recipeSha256])),
        runtime: Object.fromEntries(saved.shared[0].apps.map((app) => [app.id, {
          state: app.manualJob ? "prepared" : "running", health: "none",
          checkedAt: "2026-10-03T00:00:00Z" }])) };
    }
    expect(args[1]).toBe("image");
    const id = args[args.indexOf("--id") + 1];
    active += 1;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active -= 1;
    if (id === "failed-registry") throw new Error("synthetic unavailable registry");
    let service = id;
    let image = oldPin;
    if (id === "updated" || id === "manual-job") image = newPin;
    if (id === "changed-source") image = `other/app:1@sha256:${"1".repeat(64)}`;
    if (id === "changed-service") service = "different-service";
    return { schemaVersion: 1, command: "app image", appId: id, mutation: false,
      status: "resolved-read-only", recipeSha256: id === "changed-recipe" ? "b".repeat(64) : hash,
      images: [{ service, image }] };
  });
  const apps = Object.fromEntries(reviewed.shared[0].apps.map((app) => [app.id, app]));
  expect(apps.same.update.status).toBe("current");
  expect(apps.updated.update.status).toBe("available");
  expect(apps["manual-job"].update.status).toBe("available");
  expect(apps["manual-job"].runtime?.state).toBe("prepared");
  for (const id of ["changed-source", "changed-service", "changed-recipe", "missing-recipe",
    "failed-registry", "changed-owner"]) {
    expect(apps[id].update.status).toBe("unknown");
    expect(apps[id].limitations.length).toBeGreaterThan(0);
  }
  expect(peak).toBeLessThanOrEqual(3);
  expect(calls.filter((args) => args[1] === "image").length).toBe(7);
  expect(reviewed.shared[0].apps.length).toBe(saved.shared[0].apps.length);
  expect(saved.shared[0].apps.every((app) => app.update.status === "unknown")).toBe(true);
});
