import assert from "node:assert/strict";
import { applyHomarrNonBrowserRecap, inspectHomarrNonBrowserRecap, planHomarrNonBrowserRecap,
  type HomarrNonBrowserDescriptor } from "../src/lib/homarr-non-browser-recap.ts";
import type { HomarrStackSeedClient } from "../src/lib/homarr-stack-seed.ts";

const descriptors: HomarrNonBrowserDescriptor[] = [
  { id: "postgresql", name: "PostgreSQL", description: "Application database", state: "tcp-applied-unverified",
    endpoint: { host: "127.0.0.1", port: 15432, protocol: "postgresql" } },
  { id: "manual-task", name: "Manual task", description: "Prepared maintenance job", state: "prepared" },
  { id: "private-connector", name: "Private connector", description: "Private access connector", state: "connector-applied-unverified" },
];
function fixture() {
  let board: any = { id: "board-personal", name: "personal", isPublic: false, sections: [], items: [
    { id: "unrelated", kind: "notebook", options: { content: "User-authored note" }, integrationIds: [],
      layouts: [{ layoutId: "layout", sectionId: "section", width: 3, height: 3, xOffset: 0, yOffset: 0 }] },
  ] };
  const calls: string[] = [];
  let loseResponse = false;
  const client: HomarrStackSeedClient = {
    async query(procedure) {
      calls.push(procedure);
      if (procedure === "board.getAllBoards") return [{ id: board.id, name: board.name, isPublic: board.isPublic }];
      if (procedure === "board.getBoardByName") return structuredClone(board);
      if (procedure === "board.getBoardSettings") return { id: board.id, name: board.name };
      throw new Error("Unexpected read");
    },
    async mutate(procedure, value: any) {
      calls.push(procedure);
      if (procedure === "board.addItem") {
        assert.equal(value.boardId, board.id); assert.equal(value.kind, "notebook");
        assert.deepEqual(value.integrationIds, []);
        assert.deepEqual(Object.keys(value).sort(), ["boardId", "integrationIds", "kind", "options", "size"]);
        board.items.push({ id: "recap", kind: value.kind, options: value.options, integrationIds: value.integrationIds,
          layouts: [{ layoutId: "layout", sectionId: "section", width: value.size.width, height: value.size.height, xOffset: 0, yOffset: 3 }] });
      } else if (procedure === "widget.notebook.updateContent") {
        assert.equal(value.boardId, board.id);
        board.items.find((item: any) => item.id === value.itemId).options.content = value.content;
      } else if (procedure === "board.saveBoard") {
        assert.equal(value.id, board.id); assert.deepEqual(value.sections, board.sections);
        board = { ...board, items: value.items };
      } else throw new Error("Unexpected mutation");
      if (loseResponse) throw new Error("SYNTHETIC_PRIVATE_ERROR");
      return undefined;
    },
  };
  return { client, calls, board: () => board, loseResponse() { loseResponse = true; } };
}
{
  const f = fixture(); const unrelated = structuredClone(f.board().items[0]);
  const initial = await planHomarrNonBrowserRecap(f.client, "personal", descriptors);
  assert.equal(initial.alreadyCurrent, false); assert.equal(f.calls.some((call) => call === "board.addItem"), false);
  const applied = await applyHomarrNonBrowserRecap(f.client, "personal", descriptors, initial.approval);
  assert.equal(applied.notebookContentVerified, true); assert.equal(applied.notebookLayoutVerified, true);
  assert.equal(applied.renderedContentVerified, false); assert.equal(applied.serviceRuntimeVerified, false);
  assert.equal(applied.clientAccessVerified, false); assert.equal(applied.mutation, true);
  assert.deepEqual(f.board().items[0], unrelated);
  const content = f.board().items[1].options.content;
  assert.ok(content.includes("127.0.0.1:15432")); assert.equal(content.includes("href="), false);
  assert.ok(content.includes("not executed")); assert.ok(content.includes("enrollment and client access unverified"));
  const ready = await planHomarrNonBrowserRecap(f.client, "personal", [...descriptors].reverse());
  assert.equal(ready.alreadyCurrent, true);
  assert.equal((await applyHomarrNonBrowserRecap(f.client, "personal", descriptors, ready.approval)).mutation, false);
  assert.equal(f.calls.filter((call) => call === "board.addItem").length, 1);
  const empty = await planHomarrNonBrowserRecap(f.client, "personal", []);
  assert.equal(empty.skipped, true); assert.equal(empty.alreadyCurrent, true);
  const priorBoard = structuredClone(f.board());
  assert.equal((await applyHomarrNonBrowserRecap(f.client, "personal", [], empty.approval)).mutation, false);
  assert.deepEqual(f.board(), priorBoard);
  const changed = [{ ...descriptors[0], description: "Changed database description" }, ...descriptors.slice(1)];
  await assert.rejects(applyHomarrNonBrowserRecap(f.client, "personal", changed, ready.approval));
  const newPlan = await planHomarrNonBrowserRecap(f.client, "personal", changed);
  f.loseResponse();
  assert.equal((await applyHomarrNonBrowserRecap(f.client, "personal", changed, newPlan.approval)).notebookContentVerified, true);
  f.board().items[1].layouts[0].height = 1;
  const resizePlan = await planHomarrNonBrowserRecap(f.client, "personal", changed);
  assert.equal((await applyHomarrNonBrowserRecap(f.client, "personal", changed, resizePlan.approval)).notebookLayoutVerified, true);
  assert.deepEqual(f.board().items[0], unrelated);
  const stale = await planHomarrNonBrowserRecap(f.client, "personal", changed);
  f.board().items[0].options.content = "Concurrent user edit";
  const writes = f.calls.filter((call) => /addItem|updateContent|saveBoard/.test(call)).length;
  await assert.rejects(applyHomarrNonBrowserRecap(f.client, "personal", changed, stale.approval));
  assert.equal(f.calls.filter((call) => /addItem|updateContent|saveBoard/.test(call)).length, writes);
  assert.ok(f.calls.every((call) => !/^app\.|^integration\.|^widget\.app\./.test(call)));
}
{
  const f = fixture(); f.board().isPublic = true;
  await assert.rejects(planHomarrNonBrowserRecap(f.client, "personal", descriptors));
  assert.equal(f.calls.includes("board.addItem"), false);
}
for (const bad of [{ ...descriptors[0], privateFiles: ["SYNTHETIC_PRIVATE_ERROR"] },
  { ...descriptors[0], endpoint: { host: "user:password@host", port: 5432, protocol: "postgresql" } },
  { ...descriptors[0], endpoint: { host: "host", port: 5432, protocol: "http" } },
  { ...descriptors[1], endpoint: descriptors[0].endpoint }]) {
  const f = fixture();
  await assert.rejects(planHomarrNonBrowserRecap(f.client, "personal", [bad as HomarrNonBrowserDescriptor]));
  assert.equal(f.calls.length, 0);
}
{
  const f = fixture(); const status = await inspectHomarrNonBrowserRecap(f.client, "personal", descriptors);
  assert.equal(status.notebookContentVerified, false); assert.equal(status.mutation, false);
  assert.equal(f.calls.includes("board.addItem"), false);
}
console.log("Managed non-browser recap planning, scoped writes and readback passed (synthetic fixture only)");
