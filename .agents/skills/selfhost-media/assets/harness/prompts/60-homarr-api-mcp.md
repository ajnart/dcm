# 60 - Finalize Homarr and verify API/MCP

Read the API/MCP section of `docs/homarr.md`. Begin only after onboarding has
tested six integrations and generated six linked apps plus their widgets.

## Capture the API key

1. In the run-scoped agent-browser session, open this run's Homarr host URL at
   `/manage/tools/api`, select **Authentication**, and create one API key for
   the local admin.
2. Resolve the one-time key input to a fresh browser ref, then capture it
   directly from the run-scoped browser into the private harness store:

   ```bash
   ./scripts/session.sh browser-key capture "$RUN_ID" homarr @eN
   ```
3. Observe only the harness acknowledgement. Keep the key out of terminal
   output, shell variables, command arguments, setup-created files,
   screenshots, and reports. The private harness store is its only persistence.
   If capture fails, revoke that key and repeat with a new one.

## Finalize and verify

Run in order:

```bash
./scripts/session.sh homarr-finalize "$RUN_ID"
./scripts/session.sh mcp-config "$RUN_ID"
./scripts/session.sh mcp-verify "$RUN_ID"
./scripts/session.sh connections "$RUN_ID"
```

`homarr-finalize` must update only the six onboarding-generated service apps:
their primary links become run-scoped host URLs and their ping URLs remain the
Docker URLs. Do not reproduce these edits through six UI forms.

The native server contract is Streamable HTTP at the canonical `/api/mcp`
endpoint with the per-run key in the `ApiKey` header. `/api/mcp/mcp` is a
compatibility alias to probe only when the canonical route is unavailable, not
the configured target. `mcp-config` must produce a secret-free client fragment
at `SESSION_ROOT/artifacts/mcp-client.json`. Keep that artifact run-scoped and
do not install it into any client without separate user authorization. The
fragment identifies the per-run bridge and `RUN_ID`; it never embeds the
`ApiKey` value.

Direct native MCP remains authoritative. The generated local stdio bridge is a
credential adapter: it reads the private per-run key and proxies Homarr without
putting that key in client configuration. It exposes only `integration_all`,
`integration_byId`, and `integration_searchMediaRequests`. When native listing
works, the bridge projects only those three entries. Its curated schemas are a
temporary fallback only for exact RPC `-32603` message
`Date cannot be represented in JSON Schema`. Neither mode masks authentication,
routing, or connectivity failures.

## Media safety

Use `integration_all` and `integration_byId` to verify exactly one linked Seerr
integration, then call `integration_searchMediaRequests` for **Spider-Man: No
Way Home** and record the exact structured match only. The client-facing bridge
rejects `app_update`, `integration_requestMedia`,
`mediaRequests_answerRequest`, and every other unapproved tool before upstream
dispatch. Only the preceding harness-owned finalizer may update app links.

## Stop gate

- `browser-key` and all four follow-up commands emit secret-safe summaries.
- The connections summary explains every service and gives the exact private
  file path plus a local reveal command without persisting a password.
- The six generated apps have host links plus internal Docker ping URLs.
- The canonical native endpoint authenticates, and both native MCP and the
  stdio adapter return the read-only title match; record whether its temporary
  curated Date-schema catalog was required.
- No key appears in evidence, no media mutation ran, and no generated client
  configuration was installed.
