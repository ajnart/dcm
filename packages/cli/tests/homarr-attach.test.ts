import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compactLegacyMediaRecap, homarrAttachCommand, parseHomarrApiKey, recapHeight } from "../src/homarr-attach.ts";
import { recapHeight as canonicalRecapHeight } from "../../../scripts/lib/homarr-recap-layout.ts";

assert.equal(recapHeight, canonicalRecapHeight, "attachment and canonical reconciliation must use one policy");

const root = mkdtempSync(join(tmpdir(), "selfhost-homarr-attach-"));
const inputFile = join(root, "attach.json");
const keyFile = join(root, "homarr.key");
writeFileSync(inputFile, JSON.stringify({
  schemaVersion: 1,
  homarr: { origin: "http://127.0.0.1:7654", boardName: "personal" },
  service: {
    id: "immich", name: "Immich", description: "Keeps a private photo library and phone backups.",
    href: "http://127.0.0.1:2283", iconUrl: "https://example.test/immich.svg", access: "local",
    storagePath: "/srv/immich",
  },
}), { mode: 0o600 });
writeFileSync(keyFile, "SONARR_URL=http://sonarr:8989\nHOMARR_API_KEY=fixture-homarr-key-value-123456\n", { mode: 0o600 });
assert.equal(parseHomarrApiKey("fixture-homarr-key-value-123456\n"), "fixture-homarr-key-value-123456");
assert.throws(() => parseHomarrApiKey("HOMARR_API_KEY=fixture-homarr-key-value-123456\nHOMARR_API_KEY=another-fixture-key-value\n"), /exactly one/);

const legacyRecap = [
  "<h2>Your homelab at a glance</h2><h3>Services</h3><ul>",
  "<li>Seerr — requests. This-host link: http://127.0.0.1:5055; use the SSH tunnel below for private remote access.</li></ul>",
  "<h3>Add a movie</h3><p>Use Homarr search to request an authorized title.</p>",
  "<h3>Remote access</h3><p>For services without a private route, use one SSH session: <code>ssh -N -L 5055:127.0.0.1:5055 user@server</code></p>",
  "<h3>Storage</h3><p>Config stays in /srv/media.</p>",
  "<h3>Credentials and agent access</h3><p>Private credentials can be exported separately to the owner-only handoff artifact; this notebook contains no password or API key.</p>",
  "<p>After MCP client generation, use the local read-only bridge for searches and status. Keep Homarr's native MCP endpoint and key private. Media requests and downloads require explicit approval for the selected owned or licensed title.</p>",
  "<p>A tile opens an app; it does not by itself prove that Homarr has a working integration or widget. Additional checked services appear below when attached.</p>",
].join("");
const compactRecap = compactLegacyMediaRecap(legacyRecap);
assert.ok(compactRecap.length < legacyRecap.length);
assert.match(compactRecap, /http:\/\/127\.0\.0\.1:5055/);
assert.match(compactRecap, /Add a movie/);
assert.match(compactRecap, /Config stays in \/srv\/media/);
assert.match(compactRecap, /Homarr MCP private/);
assert.equal(compactRecap.includes("ssh -N -L"), false);
assert.equal(compactLegacyMediaRecap(compactRecap), compactRecap);

const shortCompanion = "<h2>More services in your homelab</h2>"
  + "<!-- selfhost-additional-services:start --><h3>Additional services</h3><p>"
  + "x".repeat(550) + "</p><!-- selfhost-additional-services:end -->";
assert.equal(recapHeight(shortCompanion, 8), 3, "short owned desktop companions avoid excessive blank rows");
assert.equal(recapHeight(shortCompanion, 6), 3, "six-column desktop companions use the same compact guard");
assert.equal(recapHeight(shortCompanion, 3), 8, "mobile companion allowance stays unchanged");
assert.equal(recapHeight(shortCompanion.replace("x".repeat(550), "x".repeat(800)), 8), 5,
  "companions over 800 visible characters retain the original desktop allowance");
assert.equal(recapHeight(shortCompanion.replace("More services in your homelab", "Your homelab at a glance"), 8), 5,
  "primary recaps keep their desktop allowance");
assert.equal(recapHeight(shortCompanion.replace("<!-- selfhost-additional-services:start -->", ""), 8), 5,
  "unowned notes do not receive compact sizing");

const initialNotebookContent = "<h2>Your homelab at a glance</h2><p>Media stack details stay unchanged.</p>";
const unrelated = { id: "other-tile", kind: "app", options: { appId: "other" }, integrationIds: [],
  advancedOptions: { title: null, customCssClasses: [], borderColor: "" },
  layouts: [{ layoutId: "desktop", sectionId: "main", xOffset: 0, yOffset: 0, width: 1, height: 1 }] };
const notebook = { id: "recap", kind: "notebook", options: { content: initialNotebookContent, showToolbar: false, allowReadOnlyCheck: true },
  integrationIds: [], advancedOptions: { title: null, customCssClasses: [], borderColor: "" },
  layouts: [
    { layoutId: "desktop", sectionId: "main", xOffset: 0, yOffset: 1, width: 8, height: 4 },
    { layoutId: "mobile", sectionId: "main", xOffset: 0, yOffset: 1, width: 3, height: 4 },
  ] };
const board = { id: "board-personal", name: "personal", isPublic: false,
  layouts: [{ id: "desktop" }, { id: "mobile" }],
  sections: [{ id: "main", kind: "empty", xOffset: 0, yOffset: 0 }],
  items: [unrelated, notebook] };
const apps: Record<string, unknown>[] = [{ id: "other", name: "Other", description: "Other app", href: "http://127.0.0.1:1000/", iconUrl: "https://example.test/other.svg" }];
const calls: string[] = [];
let itemNumber = 0;
let loseNextSaveBoardResponse = true;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (endpoint, request) => {
  const url = new URL(String(endpoint));
  const procedure = url.pathname.split("/").at(-1) ?? "";
  const options = request as RequestInit;
  calls.push(procedure);
  assert.equal(options.headers && (options.headers as Record<string, string>).ApiKey, "fixture-homarr-key-value-123456");
  assert.equal(options.redirect, "manual");
  let input: any;
  if (options.method === "POST") input = JSON.parse(String(options.body)).json;
  else if (url.searchParams.has("input")) input = JSON.parse(url.searchParams.get("input")!).json;
  let result: unknown;
  if (procedure === "board.getAllBoards") result = [{ id: board.id, name: board.name, isPublic: false }];
  else if (procedure === "board.getBoardByName") {
    assert.equal(input.name, "personal");
    result = structuredClone(board);
  } else if (procedure === "board.getBoardSettings") {
    assert.equal(input.id, board.id);
    result = { id: board.id, name: board.name };
  } else if (procedure === "app.all") result = structuredClone(apps);
  else if (procedure === "app.create") {
    assert.equal(input.pingUrl, null);
    apps.push({ id: "app-immich", ...input });
    result = { id: "app-immich", appId: "app-immich", ...input };
  } else if (procedure === "app.update") {
    assert.equal(input.id, "app-immich");
    assert.equal(input.name, "Immich");
    assert.equal(input.href, "http://127.0.0.1:2283/");
    assert.equal(input.iconUrl, "https://example.test/immich.svg");
    assert.equal(input.pingUrl, null);
    const current = apps.find((app) => app.id === input.id);
    assert.ok(current);
    current.description = input.description;
    result = null;
  } else if (procedure === "board.addItem") {
    assert.equal(input.boardId, board.id);
    assert.deepEqual(input.integrationIds, []);
    if (input.kind === "app") {
      assert.deepEqual(input.size, { width: 2, height: 1 });
      assert.equal(input.options.pingEnabled, false);
    } else {
      assert.equal(input.kind, "notebook");
      assert.match(input.options.content, /More services in your homelab/);
      assert.equal(input.size.width, 8);
      assert.ok(input.size.height >= 3 && input.size.height <= 24);
    }
    itemNumber += 1;
    let layouts = [{ layoutId: "desktop", sectionId: "main", xOffset: 1, yOffset: 0, width: 2, height: 1 }];
    if (input.kind === "notebook") {
      layouts = [
        { layoutId: "desktop", sectionId: "main", xOffset: 0, yOffset: 16, width: 8, height: input.size.height },
        { layoutId: "mobile", sectionId: "main", xOffset: 0, yOffset: 16, width: 3, height: input.size.height },
      ];
    }
    board.items.push({ id: `added-${itemNumber}`, kind: input.kind, options: input.options, integrationIds: [],
      advancedOptions: { title: null, customCssClasses: [], borderColor: "" },
      layouts });
    result = { itemId: `added-${itemNumber}` };
  } else if (procedure === "widget.notebook.updateContent") {
    assert.equal(input.boardId, board.id);
    assert.deepEqual(board.items[0], unrelated);
    const item = board.items.find((entry) => entry.id === input.itemId);
    assert.ok(item);
    item.options.content = input.content;
    result = null;
  } else if (procedure === "board.saveBoard") {
    assert.equal(input.id, board.id);
    const before = structuredClone(board);
    assert.deepEqual(input.sections, before.sections);
    assert.deepEqual(input.items.map((item: any) => item.id), before.items.map((item) => item.id));
    const changed = input.items.filter((item: any, index: number) =>
      JSON.stringify(item) !== JSON.stringify(before.items[index]));
    assert.equal(changed.length, 1);
    const changedItem = changed[0];
    const priorItem = before.items.find((item) => item.id === changedItem.id);
    assert.ok(priorItem);
    assert.deepEqual(changedItem, { ...priorItem, layouts: changedItem.layouts });
    const changedLayouts = changedItem.layouts.filter((layout: any, index: number) =>
      JSON.stringify(layout) !== JSON.stringify(priorItem.layouts[index]));
    assert.equal(changedLayouts.length, 1);
    assert.equal(changedLayouts[0].xOffset, 0);
    assert.ok(changedLayouts[0].height >= 3 && changedLayouts[0].height <= 24);
    const liveItem = board.items.find((item) => item.id === changedItem.id);
    assert.ok(liveItem);
    liveItem.layouts = structuredClone(changedItem.layouts);
    result = null;
    if (loseNextSaveBoardResponse) {
      loseNextSaveBoardResponse = false;
      throw new Error("fixture lost the committed save response");
    }
  } else assert.fail(`Unexpected procedure ${procedure}`);
  return new Response(JSON.stringify({ result: { data: { json: result } } }), { status: 200 });
};

const printed: string[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = ((text: string) => { printed.push(text); return true; }) as typeof process.stdout.write;
try {
  await homarrAttachCommand(["plan", "--input", inputFile, "--api-key-file", keyFile]);
  const plan = JSON.parse(printed.pop()!);
  assert.equal(plan.resources.appId, null);
  assert.equal(plan.resources.alreadyCurrent, false);
  assert.match(plan.approval, /^ATTACH:board-personal:[a-f0-9]{64}$/);
  await homarrAttachCommand(["apply", "--input", inputFile, "--api-key-file", keyFile, "--approve", plan.approval]);
  const applied = JSON.parse(printed.pop()!);
  assert.equal(applied.status, "attached");
  assert.equal(applied.appId, "app-immich");
  assert.equal(applied.integrationVerified, false);
  assert.equal(applied.serviceRuntimeVerified, false);
  assert.equal(board.items.length, 4);
  assert.deepEqual(board.items[0], unrelated);
  assert.equal((board.items[1] as typeof notebook).options.content, initialNotebookContent);
  const companion = board.items.find((item) => item.kind === "notebook" && item.id !== notebook.id);
  assert.ok(companion);
  assert.match(companion.options.content, /<!-- selfhost-additional-services:start -->/);
  assert.match(companion.options.content, /<!-- selfhost-additional-services:end -->/);
  assert.equal(applied.additionalNotebookId, companion.id);
  assert.equal(companion.layouts.find((layout) => layout.layoutId === "desktop")!.height, 3);
  assert.equal(companion.layouts.find((layout) => layout.layoutId === "mobile")!.height, 8);
  assert.ok(notebook.layouts.every((layout) => layout.height >= 4));
  assert.ok(notebook.layouts.find((layout) => layout.layoutId === "mobile")!.height >= 8);
  assert.ok(calls.filter((call) => call === "board.saveBoard").length >= 4);
  assert.equal(calls.includes("board.updateItemLayout"), false);
  assert.equal(loseNextSaveBoardResponse, false);
  assert.ok(companion.layouts.every((layout) => layout.yOffset < 16));
  const obstacles = [0, 1].map((index) => ({ ...structuredClone(unrelated), id: `obstacle-${index}`,
    layouts: notebook.layouts.map((layout) => ({ ...layout, width: 1, height: 2,
      yOffset: layout.yOffset + recapHeight(initialNotebookContent, layout.width) + index * 2 })) }));
  // Reverse board order to ensure placement follows occupied intervals, not item ordering.
  board.items.push(...obstacles.toReversed());
  const untouched = structuredClone(board.items.filter((item) => item.id !== companion.id));
  await homarrAttachCommand(["plan", "--input", inputFile, "--api-key-file", keyFile]);
  const collisionPlan = JSON.parse(printed.pop()!);
  assert.equal(collisionPlan.resources.alreadyCurrent, false);
  await homarrAttachCommand(["apply", "--input", inputFile, "--api-key-file", keyFile, "--approve", collisionPlan.approval]);
  assert.equal(JSON.parse(printed.pop()!).status, "attached");
  assert.deepEqual(board.items.filter((item) => item.id !== companion.id), untouched);
  for (const layout of companion.layouts) {
    const primary = notebook.layouts.find((candidate) => candidate.layoutId === layout.layoutId)!;
    assert.equal(layout.yOffset, primary.yOffset + recapHeight(initialNotebookContent, primary.width) + 4);
  }
  board.items = board.items.filter((item) => !obstacles.some((obstacle) => obstacle.id === item.id));
  await homarrAttachCommand(["plan", "--input", inputFile, "--api-key-file", keyFile]);
  const compactPlan = JSON.parse(printed.pop()!);
  await homarrAttachCommand(["apply", "--input", inputFile, "--api-key-file", keyFile, "--approve", compactPlan.approval]);
  assert.equal(JSON.parse(printed.pop()!).status, "attached");
  for (const layout of companion.layouts) {
    const primary = notebook.layouts.find((candidate) => candidate.layoutId === layout.layoutId)!;
    assert.equal(layout.yOffset, primary.yOffset + recapHeight(initialNotebookContent, primary.width));
  }
  const mutationsBeforeRerun = calls.filter((call) => ["app.create", "board.addItem", "widget.notebook.updateContent", "board.saveBoard"].includes(call)).length;
  await homarrAttachCommand(["plan", "--input", inputFile, "--api-key-file", keyFile]);
  const repeatPlan = JSON.parse(printed.pop()!);
  assert.equal(repeatPlan.resources.alreadyCurrent, true);
  await homarrAttachCommand(["apply", "--input", inputFile, "--api-key-file", keyFile, "--approve", repeatPlan.approval]);
  assert.equal(JSON.parse(printed.pop()!).status, "already-attached");
  assert.equal(calls.filter((call) => ["app.create", "board.addItem", "widget.notebook.updateContent", "board.saveBoard"].includes(call)).length, mutationsBeforeRerun);
  await homarrAttachCommand(["status", "--input", inputFile, "--api-key-file", keyFile]);
  assert.equal(JSON.parse(printed.pop()!).status, "attached");
  const embeddedBlock = companion.options.content.slice(companion.options.content.indexOf("<!-- selfhost-additional-services:start -->"));
  notebook.options.content = `${initialNotebookContent}${embeddedBlock}`;
  board.items = board.items.filter((item) => item.id !== companion.id);
  await homarrAttachCommand(["plan", "--input", inputFile, "--api-key-file", keyFile]);
  const migrationPlan = JSON.parse(printed.pop()!);
  assert.equal(migrationPlan.resources.additionalNotebookId, null);
  assert.equal(migrationPlan.resources.alreadyCurrent, false);
  await homarrAttachCommand(["apply", "--input", inputFile, "--api-key-file", keyFile, "--approve", migrationPlan.approval]);
  assert.equal(JSON.parse(printed.pop()!).status, "attached");
  assert.equal(notebook.options.content, initialNotebookContent);
  const migratedCompanion = board.items.find((item) => item.kind === "notebook" && item.id !== notebook.id);
  assert.ok(migratedCompanion);
  assert.match(migratedCompanion.options.content, /Open Immich/);
  const existingImmich = apps.find((app) => app.id === "app-immich");
  assert.ok(existingImmich);
  existingImmich.description = "Your private photo library.";
  await homarrAttachCommand(["plan", "--input", inputFile, "--api-key-file", keyFile]);
  const repairPlan = JSON.parse(printed.pop()!);
  assert.deepEqual(repairPlan.resources.descriptionUpdate, {
    from: "Your private photo library.", to: "Keeps a private photo library and phone backups.",
  });
  assert.equal(repairPlan.resources.alreadyCurrent, false);
  await homarrAttachCommand(["apply", "--input", inputFile, "--api-key-file", keyFile, "--approve", repairPlan.approval]);
  assert.equal(JSON.parse(printed.pop()!).status, "attached");
  assert.equal(existingImmich.description, "Keeps a private photo library and phone backups.");
  assert.equal(calls.filter((call) => call === "app.update").length, 1);
  existingImmich.href = "http://127.0.0.1:9999/";
  await assert.rejects(() => homarrAttachCommand(["plan", "--input", inputFile, "--api-key-file", keyFile]),
    /different URL/);
  existingImmich.href = "http://127.0.0.1:2283/";
  existingImmich.iconUrl = "https://example.test/existing-immich.png";
  existingImmich.description = "An existing, accurate photo-library description.";
  board.items = board.items.filter((item) => item.id !== migratedCompanion.id);
  await assert.rejects(() => homarrAttachCommand(["plan", "--input", inputFile, "--api-key-file", keyFile]),
    /--adopt-existing-app/);
  await homarrAttachCommand(["plan", "--input", inputFile, "--api-key-file", keyFile, "--adopt-existing-app"]);
  const adoptPlan = JSON.parse(printed.pop()!);
  assert.deepEqual(adoptPlan.resources.adoptedApp, {
    description: "An existing, accurate photo-library description.",
    iconUrl: "https://example.test/existing-immich.png",
  });
  assert.equal(adoptPlan.resources.descriptionUpdate, null);
  await homarrAttachCommand(["apply", "--input", inputFile, "--api-key-file", keyFile,
    "--adopt-existing-app", "--approve", adoptPlan.approval]);
  assert.equal(JSON.parse(printed.pop()!).status, "attached");
  assert.equal(calls.filter((call) => call === "app.update").length, 1);
  const adoptedCompanion = board.items.find((item) => item.kind === "notebook" && item.id !== notebook.id);
  assert.ok(adoptedCompanion);
  assert.match(adoptedCompanion.options.content, /An existing, accurate photo-library description/);
  notebook.layouts.push(structuredClone(notebook.layouts[0]));
  await assert.rejects(() => homarrAttachCommand(["plan", "--input", inputFile, "--api-key-file", keyFile,
    "--adopt-existing-app"]), /colliding item layouts/);
  notebook.layouts.pop();
} finally {
  process.stdout.write = originalWrite as typeof process.stdout.write;
  globalThis.fetch = originalFetch;
}
process.stdout.write("PASS Homarr additive attachment fixture\n");
