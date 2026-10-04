#!/usr/bin/env bun

import {
  doctorProfile,
  initializeProfile,
  storeCapabilityPolicy,
  storeApiKey,
  validateApiKey,
  validateMediaKeyEnvelope,
} from "./lib/profile.ts";

const MAX_STDIN_BYTES = 2 * 1024 + 2;

async function keyFromStdin() {
  if (process.stdin.isTTY) {
    throw new Error("Homarr API key must arrive on stdin");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.byteLength;
    if (size > MAX_STDIN_BYTES) {
      throw new Error("Homarr API key input is too large");
    }
    chunks.push(chunk);
  }
  let value = Buffer.concat(chunks).toString("utf8");
  if (value.endsWith("\r\n")) {
    value = value.slice(0, -2);
  } else if (value.endsWith("\n")) {
    value = value.slice(0, -1);
  }
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error("Homarr API key input must be one line");
  }
  return validateApiKey(value);
}

async function mediaKeyFileFromStdin() {
  if (process.stdin.isTTY) {
    throw new Error("media Homarr key file must arrive on stdin");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.byteLength;
    if (size > MAX_STDIN_BYTES + 32) {
      throw new Error("media Homarr key input is too large");
    }
    chunks.push(chunk);
  }
  const encoded = Buffer.concat(chunks).toString("utf8");
  return validateMediaKeyEnvelope(encoded);
}

async function jsonFromStdin() {
  if (process.stdin.isTTY) {
    throw new Error("integration policy must arrive on stdin");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.byteLength;
    if (size > 16 * 1024) {
      throw new Error("integration policy input is too large");
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseInit(args) {
  if (args.length !== 3 && args.length !== 5) {
    throw new Error("invalid init arguments");
  }
  if (args[1] !== "--base-url") {
    throw new Error("base URL is required");
  }
  let projectRoot = process.cwd();
  if (args.length === 5) {
    if (args[3] !== "--project-root") {
      throw new Error("project root option is invalid");
    }
    projectRoot = args[4];
  }
  return {
    profile: args[0],
    baseUrl: args[2],
    projectRoot,
  };
}

async function main() {
  const command = Bun.argv[2];
  const args = Bun.argv.slice(3);
  if (command === "init") {
    initializeProfile(parseInit(args));
    process.stdout.write("PASS Homarr profile initialized\n");
    return;
  }
  if (command === "store-key" || command === "rotate-key") {
    if (args.length !== 1) {
      throw new Error("profile path is required");
    }
    const apiKey = await keyFromStdin();
    storeApiKey(args[0], apiKey, { rotate: command === "rotate-key" });
    if (command === "rotate-key") {
      process.stdout.write("PASS Homarr API key rotated\n");
      return;
    }
    process.stdout.write("PASS Homarr API key stored\n");
    return;
  }
  if (command === "import-media-key") {
    if (args.length !== 1) {
      throw new Error("profile path is required");
    }
    storeApiKey(args[0], await mediaKeyFileFromStdin());
    process.stdout.write("PASS Homarr media key imported\n");
    return;
  }
  if (command === "doctor") {
    if (args.length !== 1) {
      throw new Error("profile path is required");
    }
    doctorProfile(args[0]);
    process.stdout.write("PASS Homarr profile directory\n");
    process.stdout.write("PASS Homarr profile config\n");
    process.stdout.write("PASS Homarr private credential\n");
    process.stdout.write("PASS Homarr profile doctor\n");
    return;
  }
  if (command === "set-integration-policy") {
    if (args.length !== 1) {
      throw new Error("profile path is required");
    }
    storeCapabilityPolicy(args[0], await jsonFromStdin());
    process.stdout.write("PASS Homarr capability policy stored\n");
    return;
  }
  throw new Error("unknown profile command");
}

main().catch(() => {
  process.stdout.write("FAIL Homarr profile operation\n");
  process.exitCode = 1;
});
