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

`candidate-report.md` must contain:

1. acceptance matrix with evidence path per row;
2. meaningful browser/API action count per service and total;
3. failed/retried actions and root cause;
4. steps that can be deleted, combined, or made deterministic next generation;
5. exact image IDs/versions observed, without secrets;
6. final session status and whether the run remains available for supervisor QA;
7. Homarr API/MCP PASS summaries, canonical endpoint, read-only title match,
   whether the curated Date-schema catalog was required, and confirmation that
   no media mutation or client installation occurred.

Never capture the Authentication page while the one-time key is visible.
Evidence may include only secret-free command summaries and structural results;
the API key and raw authenticated payloads remain private to the run.

Do not destroy the session. The supervisor selects the fittest candidate only
after independently checking its evidence and live Homarr board.
