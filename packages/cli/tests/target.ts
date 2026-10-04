#!/usr/bin/env bun

import { strict as assert } from "node:assert";
import { parseRunningTargetNames } from "../src/target.ts";

assert.deepEqual(parseRunningTargetNames(Buffer.from("\ufeffUbuntu-24.04\r\nUbuntu\r\n", "utf16le"), "wsl"),
  ["Ubuntu", "Ubuntu-24.04"]);
assert.deepEqual(parseRunningTargetNames(Buffer.from("docker-desktop\r\nUbuntu\r\n", "utf16le"), "wsl"),
  ["Ubuntu"]);
assert.deepEqual(parseRunningTargetNames(Buffer.from("default\nphotos\ndefault\n"), "lima"),
  ["default", "photos"]);
assert.throws(() => parseRunningTargetNames(Buffer.from("bad\u0000name\n"), "lima"), /invalid or oversized name/);

console.log("PASS running WSL and Lima target parsing");
