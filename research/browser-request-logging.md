# Browser request logging for benchmark agents

This is a source-repository research tool, not a dependency of the installed
`self-host` skill. The default setup path is Bun/curl; instrument agent-browser
only for a baseline run, a failed script, or requested visual proof.

From this checkout, prepare one private directory shared by the benchmark
agents:

```bash
node scripts/browser-command-log.mjs --prepare /absolute/private/benchmark-logs
```

The command creates a mode-`0700` `bin/agent-browser` shim and prints the paths
to `browser-commands.ndjson` and `browser-requests.ndjson`. Give each agent the
same shim directory, the exact browser session assigned by `session.sh create`,
and its own run/agent identifiers. Do not invent a second session name. In each
agent's shell, put that `bin` directory first on `PATH` and set
`SELFHOST_RUN_ID`, `SELFHOST_AGENT_ID`, and `AGENT_BROWSER_SESSION` before the
first browser command. The harness's private helpers may clear the two
supervisor IDs in child processes; the logger then attributes their commands
to the run from its `auto-stack-RUN_ID` browser session, while `agentId` stays
unknown.
Append `prompts/95-browser-request-logging.md` when compiling an instrumented
run: `scripts/render-prompt.sh RUN_ID prompts/95-browser-request-logging.md`.

The command file records every shim invocation's verb, duration, exit status,
run, agent, and browser session. After each browser command, the shim queries
the session's request list and appends new requests to the shared request file.
The CLI's `skills get/list` reference commands are logged as commands but do
not poll a browser session, since they cannot issue page requests.
It queries **before** closing the browser. A repeated fingerprint with a final
HTTP status supersedes an earlier pending record. `capture-gap` means the
request log may be incomplete; keep that failure in the benchmark. Polling can
also miss late background traffic or commands that bypass the shim, so report
the file as observed request metadata rather than a complete HTTP trace.

The request file keeps method, sanitized route template, query **names**,
origin, status, MIME type, resource type, timing, and command correlation. It
does not persist full URLs, query values, headers, cookies, request bodies,
response bodies, HAR, or browser state. Both files are owner-only mode `0600`.
Even this metadata is private run evidence; keep it out of Git and shared
archives. The logger never prints a captured request payload.
Only exact, documented static endpoints retain full paths; for example,
[qBittorrent's WebUI API](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%28qBittorrent-4.1%29)
documents `/api/v2/sync/maindata` and `/api/v2/torrents/info`. Unknown path
segments remain `:value` and require first-party source inspection to derive
a replayable request. The exact Arr and Seerr setup paths in the allowlist
match this repository's per-service scripts; dynamic record IDs stay masked.

The shim passes through the agent's own browser command output unchanged, so
agents must not invoke raw network/HAR/credential dumps. Its separate network
metadata query runs after every command and can take up to 20 seconds; measured
wall time includes that instrumentation, while most command-log `elapsedMs`
values exclude it. Compare instrumented runs with that overhead in mind.

After every agent has stopped writing, run
`node scripts/summarize-browser-log.mjs /absolute/private/benchmark-logs`.
It reads only owner-only sanitized files and reports command/failure counts,
unique observed requests, capture gaps, and API-like route frequencies by run.
It does not calculate full wall time, model turns/tokens, or replayable payloads.

Use the request file to find repeated API routes and correlate them with
browser actions. Then consult `docs/headless-setup.md`, first-party API/source
documentation, and the corresponding `setup-*.ts` implementation to derive
request bodies and authentication. A sanitized route alone is **not** a
replayable curl command. Verify the resulting Bun/curl step against a fresh
approved run before replacing a browser fallback. Track per-run wall time,
per-service script time, browser command count, failures, retries, and model
turn/token counters when the agent platform exposes them. Mark unavailable
counters unavailable; do not infer them from command counts.
