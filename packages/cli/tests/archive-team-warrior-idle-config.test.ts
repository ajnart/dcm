import assert from "node:assert/strict";
import {
  warriorIdleConfig,
  verifyWarriorIdleConfig,
  verifyWarriorIdleSnapshot,
} from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/archive-team-warrior/idle-config";

const identity = { downloader: "fixture-owner", username: "chosen-owner", password: "A".repeat(65) };
const raw = warriorIdleConfig(identity);
const config = JSON.parse(raw);
assert.equal(config.selected_project, "none");
assert.equal(config.concurrent_items, "1");
assert.equal(config.warrior_id, undefined);
assert.equal(warriorIdleConfig(identity), raw);
verifyWarriorIdleConfig(raw, identity);
verifyWarriorIdleConfig(JSON.stringify({ ...config, concurrent_items: 1, warrior_id: "upstream-issued" }), identity);
for (const field of ["downloader", "http_username", "http_password", "selected_project", "concurrent_items"]) {
  assert.throws(() => verifyWarriorIdleConfig(JSON.stringify({ ...config, [field]: "changed" }), identity), /reviewed idle identity/);
}
for (const selected_project of ["auto", "arbitrary-project", "", null]) {
  assert.throws(() => verifyWarriorIdleConfig(JSON.stringify({ ...config, selected_project }), identity));
}
for (const downloader of ["", "xx", "owner with spaces", "A".repeat(31)]) {
  assert.throws(() => warriorIdleConfig({ ...identity, downloader }));
}
for (const username of ["", "owner:secret", "owner\n", "A".repeat(65)]) {
  assert.throws(() => warriorIdleConfig({ ...identity, username }));
}
for (const password of ["", "A".repeat(31), "A".repeat(129), "\n".repeat(65)]) {
  assert.throws(() => warriorIdleConfig({ ...identity, password }));
}
for (const malformed of ["invalid", "[]", "null", "x".repeat(65_537)]) {
  assert.throws(() => verifyWarriorIdleConfig(malformed, identity));
}
const idle = [
  { event_name: "instance_id", message: "synthetic-start" },
  { event_name: "project.refresh", message: null },
  { event_name: "warrior.status", message: { status: "NO_PROJECT" } },
];
verifyWarriorIdleSnapshot(idle);
assert.throws(() => verifyWarriorIdleSnapshot(idle.slice(0, 2)));
assert.throws(() => verifyWarriorIdleSnapshot([...idle, idle[2]]));
assert.throws(() => verifyWarriorIdleSnapshot(Array(17).fill(idle[0])));
assert.throws(() => verifyWarriorIdleSnapshot([null, ...idle]));
assert.throws(() => verifyWarriorIdleSnapshot([{}, ...idle]));
assert.throws(() => verifyWarriorIdleSnapshot([{ event_name: "timestamp" }, ...idle]));
assert.throws(() => verifyWarriorIdleSnapshot([{ event_name: "project.refresh", message: {} }, idle[2]]));
for (const status of ["UNINITIALIZED", "INVALID_SETTINGS", "RUNNING_PROJECT", "STOPPING_PROJECT", "SHUTTING_DOWN"]) {
  assert.throws(() => verifyWarriorIdleSnapshot([idle[1], { event_name: "warrior.status", message: { status } }]));
}
for (const event_name of ["warrior.project_selected", "warrior.project_installing", "warrior.project_installed",
  "warrior.project_installation_failed", "runner.status", "pipeline.start_item", "item.output",
  "item.task_status", "item.update_name", "item.complete", "item.fail", "item.cancel"]) {
  assert.throws(() => verifyWarriorIdleSnapshot([...idle, { event_name, message: null }]));
}
process.stdout.write("ArchiveTeam Warrior deterministic idle config and snapshot checks: pass\n");
