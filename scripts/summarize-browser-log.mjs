#!/usr/bin/env node

import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";

function fail(message) {
  process.stderr.write(`FAIL ${message}\n`);
  process.exit(2);
}

const logDirectory = process.argv[2];
if (process.argv.length !== 3 || !isAbsolute(logDirectory)) {
  fail("usage: summarize-browser-log.mjs ABSOLUTE_PRIVATE_LOG_DIRECTORY");
}
const rootStat = lstatSync(logDirectory);
if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== process.getuid()
  || (rootStat.mode & 0o7777) !== 0o700 || realpathSync(logDirectory) !== logDirectory) {
  fail("unsafe browser log directory");
}

function readPrivateLog(name) {
  const descriptor = openSync(join(logDirectory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid()
      || (stat.mode & 0o7777) !== 0o600 || stat.size > 64 * 1024 * 1024) {
      fail("unsafe browser log file");
    }
    const contents = readFileSync(descriptor, "utf8");
    const rows = [];
    for (const line of contents.split("\n")) {
      if (line === "") continue;
      const row = JSON.parse(line);
      if (row.schemaVersion !== 1 || typeof row.kind !== "string") fail("invalid browser log entry");
      rows.push(row);
    }
    return rows;
  } finally {
    closeSync(descriptor);
  }
}

function runId(row) {
  if (/^[a-z0-9][a-z0-9_-]{0,39}$/.test(row.runId || "")) return row.runId;
  if (typeof row.session === "string" && row.session.startsWith("auto-stack-")) {
    const candidate = row.session.slice("auto-stack-".length);
    if (/^[a-z0-9][a-z0-9_-]{0,39}$/.test(candidate)) return candidate;
  }
  return "unassigned";
}

function summaryFor(summaries, id) {
  if (!summaries.has(id)) {
    summaries.set(id, {
      runId: id,
      commandCount: 0,
      failedCommands: 0,
      browserCommandElapsedMs: 0,
      firstBrowserCommandAtMs: null,
      lastBrowserCommandCompletedAtMs: null,
      captureGaps: 0,
      requestUpdates: 0,
      requests: new Map(),
    });
  }
  return summaries.get(id);
}

const summaries = new Map();
for (const row of readPrivateLog("browser-commands.ndjson")) {
  if (row.kind !== "browser-command") fail("unexpected browser command entry");
  const summary = summaryFor(summaries, runId(row));
  summary.commandCount += 1;
  if (row.exitCode !== 0) summary.failedCommands += 1;
  if (Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0) {
    summary.browserCommandElapsedMs += row.elapsedMs;
  }
  const startedAtMs = Date.parse(row.startedAt);
  if (Number.isFinite(startedAtMs)) {
    let completedAtMs = startedAtMs;
    if (Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0) {
      completedAtMs += row.elapsedMs;
    }
    if (summary.firstBrowserCommandAtMs === null || startedAtMs < summary.firstBrowserCommandAtMs) {
      summary.firstBrowserCommandAtMs = startedAtMs;
    }
    if (summary.lastBrowserCommandCompletedAtMs === null || completedAtMs > summary.lastBrowserCommandCompletedAtMs) {
      summary.lastBrowserCommandCompletedAtMs = completedAtMs;
    }
  }
}
for (const row of readPrivateLog("browser-requests.ndjson")) {
  const summary = summaryFor(summaries, runId(row));
  if (row.kind === "capture-gap") {
    summary.captureGaps += 1;
    continue;
  }
  if (row.kind !== "browser-http-request" || typeof row.fingerprint !== "string"
    || typeof row.method !== "string" || typeof row.route !== "string") {
    fail("unexpected browser request entry");
  }
  const existing = summary.requests.get(row.fingerprint);
  if (existing) {
    summary.requestUpdates += 1;
    if (existing.status === null && Number.isInteger(row.status)) existing.status = row.status;
    continue;
  }
  summary.requests.set(row.fingerprint, {
    method: row.method,
    route: row.route,
    status: row.status,
    resourceType: row.resourceType,
  });
}

const output = [...summaries.values()].sort((a, b) => a.runId.localeCompare(b.runId)).map((summary) => {
  const routeCounts = new Map();
  let otherRequestCount = 0;
  for (const request of summary.requests.values()) {
    const apiLike = request.route.startsWith("/api/")
      || /^\/(?:System|Startup|Users|Library|Sessions)(?:\/|$)/.test(request.route)
      || request.resourceType === "Fetch"
      || request.resourceType === "XHR";
    if (!apiLike) {
      otherRequestCount += 1;
      continue;
    }
    const key = `${request.method} ${request.route}`;
    routeCounts.set(key, (routeCounts.get(key) ?? 0) + 1);
  }
  const routes = [...routeCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([route, count]) => ({ route, count }));
  let firstBrowserCommandAt = null;
  let lastBrowserCommandCompletedAt = null;
  let browserObservationWindowMs = null;
  if (summary.firstBrowserCommandAtMs !== null && summary.lastBrowserCommandCompletedAtMs !== null) {
    firstBrowserCommandAt = new Date(summary.firstBrowserCommandAtMs).toISOString();
    lastBrowserCommandCompletedAt = new Date(summary.lastBrowserCommandCompletedAtMs).toISOString();
    browserObservationWindowMs = Math.round(summary.lastBrowserCommandCompletedAtMs - summary.firstBrowserCommandAtMs);
  }
  return {
    runId: summary.runId,
    commandCount: summary.commandCount,
    failedCommands: summary.failedCommands,
    browserCommandElapsedMs: Math.round(summary.browserCommandElapsedMs),
    firstBrowserCommandAt,
    lastBrowserCommandCompletedAt,
    browserObservationWindowMs,
    uniqueObservedRequests: summary.requests.size,
    otherRequestCount,
    requestStatusUpdates: summary.requestUpdates,
    captureGaps: summary.captureGaps,
    apiLikeRoutes: routes,
  };
});
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, runs: output }, null, 2)}\n`);
