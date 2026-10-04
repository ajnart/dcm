#!/usr/bin/env bun

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let source = resolve(import.meta.dir, "..");
if (process.argv[2]) source = resolve(process.argv[2]);
const fixture = await mkdtemp(join(tmpdir(), "selfhost-catalog-gate-package-"));

function cli(args: string[]) {
  return spawnSync("node", [join(fixture, "bin", "selfhost.mjs"), ...args], {
    encoding: "utf8", timeout: 20000,
  });
}

async function changeDefault(role: string, from: string, to: string) {
  const path = join(fixture, "dist", "workflows", "selfhost", "references", "catalog", "stacks", "goals.json");
  const contents = await readFile(path, "utf8");
  const marker = `"id": "${role}", "name":`;
  const offset = contents.indexOf(marker);
  assert.notEqual(offset, -1, `Missing role ${role}`);
  const start = contents.indexOf(`"default": "${from}"`, offset);
  assert.ok(start > offset && start - offset < 250, `Missing ${role} default ${from}`);
  const updated = `${contents.slice(0, start)}"default": "${to}"${contents.slice(start + `"default": "${from}"`.length)}`;
  await writeFile(path, updated);
}

try {
  await cp(join(source, "dist"), join(fixture, "dist"), { recursive: true });
  await cp(join(source, "bin"), join(fixture, "bin"), { recursive: true });

  await changeDefault("photo-library", "immich", "photoprism");
  const photosMenu = cli(["catalog", "menu", "--json"]);
  assert.equal(photosMenu.status, 0, photosMenu.stderr);
  assert.ok(JSON.parse(photosMenu.stdout).data.goals.some((goal: { id: string }) => goal.id === "photos"));
  const householdRoot = join(fixture, "household-project");
  const household = cli(["bundle", "begin", "--project-root", householdRoot]);
  assert.notEqual(household.status, 0);
  assert.match(household.stderr, /household installer no longer matches/);
  assert.equal((await Bun.file(householdRoot).exists()), false);

  await changeDefault("playback", "jellyfin", "plex");
  const mediaMenu = cli(["catalog", "menu", "--json"]);
  assert.equal(mediaMenu.status, 0, mediaMenu.stderr);
  assert.ok(JSON.parse(mediaMenu.stdout).data.goals.some((goal: { id: string }) => goal.id === "personal-media"));
  const mediaRoot = join(fixture, "media-project");
  const media = cli(["config", "init", "--profile", "media", "--project-root", mediaRoot]);
  assert.notEqual(media.status, 0);
  assert.match(media.stderr, /media installer no longer matches/);
  assert.equal((await Bun.file(mediaRoot).exists()), false);
  console.log("PASS packaged CLI rejects changed defaults before creating projects");
} finally {
  await rm(fixture, { recursive: true, force: true });
}
