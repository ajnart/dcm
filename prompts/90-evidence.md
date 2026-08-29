# 90 - Evidence and fitness report

Store artifacts below `SESSION_ROOT/artifacts` with stable names:

- `stack-status.txt` (no secrets)
- `arr-connections.md`
- `seerr-connections.png`
- `homarr-integrations.png`
- `homarr-dashboard.png` (full page, outside edit mode)
- `mcp-client.json` (secret-free candidate fragment; do not install)
- `candidate-report.md`

Use agent-browser's `--screenshot-dir "$SESSION_ROOT/artifacts"` option; a path
argument is ignored by some CLI versions. Rename only inside the run directory.

Authenticated agent-browser diagnostics are secret-bearing. As a candidate,
never invoke, print, or persist `console`, raw `network requests`, HAR output,
or another raw trace inside or outside the run because they can expose access
tokens. Use only page-scoped evaluation that emits approved fixed summaries or
fixed harness summaries.

`candidate-report.md` must contain:

1. acceptance matrix with evidence path per row;
2. meaningful browser/API action count per service and total, recorded only as
   fixed numeric summaries;
3. failed/retried actions and root cause;
4. steps that can be deleted, combined, or made deterministic next generation;
5. exact image IDs/versions observed, without secrets;
6. final session status and whether the run remains available for supervisor QA;
7. Homarr API/MCP PASS summaries, canonical endpoint, read-only title match,
   whether the curated Date-schema catalog was required, and confirmation that
   no media mutation or client installation occurred;
8. Homarr widget fixed summary with one row for each expected procedure:
   `widget.indexerManager.getIndexersStatus`,
   `widget.downloads.getJobsAndStatuses`, `widget.mediaRequests.getStats`,
   `widget.mediaServer.getCurrentStreams`, `widget.calendar.findAllEvents`,
   `widget.mediaOrganizer.getData`, and
   `widget.mediaRelease.getMediaReleases`. Each row records only method `GET`,
   the sanitized `/api/trpc/<procedure>` path without query data, HTTP status,
   and its response-envelope error classification. Include the seven-row total,
   HTTP-200 count, error count, `mediaRelease.releases.length`, and
   `mediaRelease.failedIntegrations.length`.
9. the private credentials access-sheet path and local reveal command, never
   its contents.

Never capture the Authentication page while the one-time key is visible.
Evidence may include only secret-free command summaries and structural results;
the API key and raw authenticated payloads must never be printed or stored as
evidence. `credentials.env` is a private user handoff, not an artifact; do not
copy it into `SESSION_ROOT/artifacts` or `candidate-report.md`.

Do not destroy the session. The supervisor selects the fittest candidate only
after independently checking its evidence and live Homarr board.
