#!/usr/bin/env node

import {
  loadSession,
  storeHomarrApiKey,
  validateHomarrApiKey,
} from "./lib/session-context.mjs";

const MAX_STDIN_BYTES = 2_048;

async function readKeyFromStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.byteLength;
    if (size > MAX_STDIN_BYTES) {
      throw new Error("Homarr API key input is too large");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  let candidate = raw;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") {
      candidate = parsed;
    }
  } catch {
    // A raw key is an accepted input format.
  }
  return validateHomarrApiKey(candidate);
}

async function main() {
  if (process.argv.length !== 3) {
    throw new Error("RUN_ID is required");
  }
  const session = loadSession(process.argv[2]);
  const apiKey = await readKeyFromStdin();
  storeHomarrApiKey(session, apiKey);
  process.stdout.write("PASS Homarr API key stored\n");
}

main().catch(() => {
  process.stdout.write("FAIL Homarr API key storage\n");
  process.exitCode = 1;
});
