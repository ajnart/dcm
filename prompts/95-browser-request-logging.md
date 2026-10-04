# 95 - Instrumented browser benchmark (optional)

The supervisor supplies `BROWSER_LOG_SHIM_DIR`, a shared private log location,
and this run's agent ID before starting this prompt. Resolve `agent-browser`
through that shim for **every** browser command, including helper calls.
Set `SELFHOST_RUN_ID="$RUN_ID"`, `SELFHOST_AGENT_ID` to the assigned ID, and a
unique `AGENT_BROWSER_SESSION` to the exact browser session assigned by
`session.sh create` (for example, `auto-stack-RUN_ID`). Use that same value
for every `agent-browser --session` call and the harness's browser-key helpers.
The private browser helpers forward only these three non-secret benchmark
labels alongside their minimal browser environment, so helper subprocesses
remain attributable to the same run and agent.
If the shim or any identifier is
missing, mark the benchmark uninstrumented. Before closing the session, wait
for network idle so the final pre-close poll can observe in-flight requests.
Never run browser-wide doctor or cleanup while other agents have sessions:
those commands may remove shared sidecars. On a sandbox read-only error,
request scoped permission for the exact run-session command; if it still
fails, report the blocker without repairing shared browser state.

After each service, record its observed elapsed time, command count, failures,
retries, and acceptance result. The supervisor records model turns and tokens
if the platform exposes exact counters. This is a polled request inventory,
not proof of every request; a `capture-gap` makes coverage explicitly
incomplete. Do not invoke raw network/HAR/cookie dumps, `get value` on secret
fields, or unredacted snapshots: the shim passes browser output through and
does not sanitize it. Use the harness's private capture helpers for secrets.
