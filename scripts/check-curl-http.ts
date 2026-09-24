#!/usr/bin/env bun
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { curlFetch, enableCurlHttp } from "./lib/curl-http.ts";

const fixture = String.raw`
const http = require("node:http");
function server() {
  return http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/login") response.setHeader("Set-Cookie", "sid=fixture-cookie; HttpOnly; Path=/");
    response.end(JSON.stringify({ cookie: (request.headers.cookie || "").includes("sid=fixture-cookie"), body: Buffer.concat(chunks).toString("utf8") }));
  });
}
const first = server();
const second = server();
first.listen(0, "127.0.0.1", () => {
  second.listen(0, "127.0.0.1", () => {
    process.stdout.write(JSON.stringify({ first: first.address().port, second: second.address().port }) + "\n");
  });
});
`;

async function fixturePorts(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
      if (output.includes("\n")) {
        try { resolve(JSON.parse(output.split("\n", 1)[0])); } catch (error) { reject(error); }
      }
    });
    child.once("exit", () => reject(new Error("curl fixture server exited")));
  });
}

const sessionDir = mkdtempSync(join(tmpdir(), "selfhost-curl-check-"));
const child = spawn("node", ["-e", fixture], { stdio: ["ignore", "pipe", "pipe"] });
try {
  mkdirSync(join(sessionDir, "artifacts"), { mode: 0o700 });
  const ports = await fixturePorts(child);
  const cookieRoot = enableCurlHttp({ sessionDir });
  const first = `http://127.0.0.1:${ports.first}`;
  const second = `http://127.0.0.1:${ports.second}`;
  const login = await curlFetch(`${first}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ fixture: "value" }),
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /^sid=fixture-cookie;/);
  assert.deepEqual(await login.json(), { cookie: false, body: "fixture=value" });
  assert.equal((await (await curlFetch(`${first}/check`)).json()).cookie, true);
  assert.equal((await (await curlFetch(`${second}/check`)).json()).cookie, false);
  await assert.rejects(() => curlFetch("http://example.com/"), /loopback/);
  await assert.rejects(() => curlFetch(`${first}/check?apiKey=fixture`), /credentials in URL/);
  const files = readdirSync(cookieRoot);
  assert.equal(files.length, 2);
  for (const file of files) assert.equal(lstatSync(join(cookieRoot, file)).mode & 0o7777, 0o600);
  console.log("PASS curl transport: private per-origin jars, request body, and URL boundary");
} finally {
  child.kill("SIGTERM");
  rmSync(sessionDir, { recursive: true, force: true });
}
