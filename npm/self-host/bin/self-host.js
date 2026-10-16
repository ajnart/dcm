#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

const targets = {
  "linux-x64": "@ajnart/self-host-linux-x64",
  "linux-arm64": "@ajnart/self-host-linux-arm64",
  "darwin-x64": "@ajnart/self-host-darwin-x64",
  "darwin-arm64": "@ajnart/self-host-darwin-arm64",
};

const key = `${process.platform}-${process.arch}`;
const pkg = targets[key];

if (!pkg) {
  console.error(
    `self-host does not support ${process.platform}/${process.arch}.\n` +
      "It runs on Linux and macOS (amd64/arm64). On Windows, use WSL2.\n" +
      "See https://self-host.fyi",
  );
  process.exit(1);
}

let binary;
try {
  binary = path.join(path.dirname(require.resolve(`${pkg}/package.json`)), "bin", "self-host");
} catch {
  console.error(
    `Could not find ${pkg}. Reinstall without --no-optional / --omit=optional:\n` +
      "  npm i -g self-host@latest\n" +
      "or use the installer: https://self-host.fyi",
  );
  process.exit(1);
}

const child = spawn(binary, process.argv.slice(2), { stdio: "inherit" });

const forward = (signal) => () => {
  if (!child.killed) child.kill(signal);
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, forward(signal));
}

child.on("error", (err) => {
  console.error(`self-host: cannot run ${binary}: ${err.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
