# Generation 3 - Homarr API/MCP augmentation

Status: **COMPLETE — supervisor validated 2026-08-28.**

## Hypothesis

A private per-run API key plus deterministic Homarr finalization can replace six
manual app edits and add reproducible native MCP proof without putting a
credential in client configuration.

This generation appended only `prompts/60-homarr-api-mcp.md` to the two already
compliant Generation 2 runs. Reusing their isolated stacks tested that prompt
modules are independently augmentable instead of repeating the 64- and
70-action deployments.

## Results

| Run | Six generated links | Key/finalize/config/verify | Read-only media search | Extra actions | Client install |
| --- | --- | --- | --- | --- | --- |
| `luna-g2-a` | PASS | PASS | PASS | 4 | promoted only |
| `luna-g2-b` | PASS | PASS | PASS | 7 | none |

Both candidates authenticated against canonical `/api/mcp`, kept their API key
in a mode-600 per-run control file, generated a mode-600 secret-free
`mcp-client.json`, and found Spider-Man: No Way Home through the native Seerr
workflow and the stdio adapter. The exact image still triggered the known
`tools/list` Date JSON-Schema failure, so the adapter selected its curated
catalog and forwarded native tool calls. Neither run called
`integration_requestMedia` or started a download.

Root independently repeated `doctor`, the core verifier, and the MCP verifier
for both candidates. The disposable optional-key create/config/destroy lifecycle
also passed without leaving a normal session or tombstone.

## Promotion

`luna-g2-a` remains the winner: its full deployment used 64 meaningful actions
versus 70 for B, and this augmentation used 4 versus 7. Root installed only A's
secret-free bridge in Claude Code as the project-local `homarr-auto-stack`
server; `claude mcp get` and `claude mcp list` both reported it connected. The
client configuration contains the bridge path and run ID, never the API key or
its environment-variable name.
