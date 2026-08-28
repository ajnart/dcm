# 60 - Finalize Homarr and verify API/MCP

Read the API/MCP section of `docs/homarr.md`. Begin only after onboarding has
tested six integrations and generated six linked apps plus their widgets.

## Capture the API key

1. In the run-scoped agent-browser session, open this run's Homarr host URL at
   `/manage/tools/api`, select **Authentication**, and create one API key for
   the local admin.
2. Resolve the one-time key element to a fresh browser ref. Run its matching
   agent-browser accessor as the left side of a pipe whose right side is
   `./scripts/session.sh homarr-key "$RUN_ID"`. The browser value must flow
   directly over stdin; run neither side alone.
3. Observe only the harness acknowledgement. Keep the key out of terminal
   output, shell variables, command arguments, candidate-created files,
   screenshots, and reports. The private harness store is its only persistence.
   If capture fails, revoke that key and repeat with a new one.

## Finalize and verify

Run in order:

```bash
./scripts/session.sh homarr-finalize "$RUN_ID"
./scripts/session.sh mcp-config "$RUN_ID"
./scripts/session.sh mcp-verify "$RUN_ID"
```

`homarr-finalize` must update only the six onboarding-generated service apps:
their primary links become run-scoped host URLs and their ping URLs remain the
Docker URLs. Do not reproduce these edits through six UI forms.

The native server contract is Streamable HTTP at the canonical `/api/mcp`
endpoint with the per-run key in the `ApiKey` header. `/api/mcp/mcp` is a
compatibility alias to probe only when the canonical route is unavailable, not
the configured target. `mcp-config` must produce a secret-free client fragment
at `SESSION_ROOT/artifacts/mcp-client.json`. Keep that artifact candidate-scoped
and do not install it into any shared or local client. The supervisor installs
only the promoted winner so concurrent candidates cannot race over client
configuration. The fragment identifies the per-run bridge and `RUN_ID`; it never
embeds the `ApiKey` value.

Direct native MCP remains authoritative. The generated local stdio bridge is a
credential adapter: it reads the private per-run key and proxies Homarr without
putting that key in client configuration. Its curated tool catalog is a
temporary fallback only for the current upstream `tools/list` Date JSON-Schema
failure; when native listing works, the bridge passes through the full native
catalog. Neither mode masks authentication, routing, or connectivity failures.

## Media safety

The native media workflow, after a user explicitly authorizes a real request,
is `integration_searchMediaRequests` -> `integration_requestMedia`. For TV,
call `integration_getMediaRequestOptions` between them when options are
required. During this experiment, search for **Spider-Man: No Way Home** and
record the read-only match only. Never invoke `integration_requestMedia` or any
request/download mutation: it can start downstream downloads.

## Stop gate

- `homarr-key` and all three follow-up commands emit secret-safe PASS summaries.
- The six generated apps have host links plus internal Docker ping URLs.
- The canonical native endpoint authenticates, and both native MCP and the
  stdio adapter return the read-only title match; record whether its temporary
  curated Date-schema catalog was required.
- No key appears in evidence, no media mutation ran, and no candidate client
  configuration was installed.
