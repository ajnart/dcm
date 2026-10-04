# 60 - Finalize Homarr and verify API/MCP

Read the API/MCP section of `docs/homarr.md`. Begin only after onboarding has
tested six integrations and generated six linked apps plus their widgets.

## Private API key

`setup-homarr.ts` creates and stores the key directly after the board is
complete. Run `session.sh connections-check "$RUN_ID"` to confirm it is
present without revealing the value. If script setup stopped before the key
was stored, first rerun that script; only use the UI fallback below if the
script cannot recover.

## Browser fallback for key creation

1. In the run-scoped agent-browser session, open this run's Homarr host URL at
   `/manage/tools/api`, select **Authentication**, and create one API key for
   the local admin.
2. While the one-time **API token created** alert is open, capture its exact
   read-only token field directly into the private harness store. Do not take
   a snapshot or use a generic API-key ref:

   ```bash
   ./scripts/session.sh browser-key capture-code "$RUN_ID" homarr
   ```
3. Observe only the harness acknowledgement. Keep the key out of terminal
   output, shell variables, command arguments, setup-created files,
   screenshots, and reports. The private harness store is its only persistence.
   If capture fails, keep the alert open while diagnosing the exact helper
   guard. Revoke the key only when it cannot be captured, then create one
   replacement; do not keep making keys on an unexplained failure.

## Finalize and verify

Run in order:

```bash
./scripts/session.sh homarr-finalize "$RUN_ID" "$BOARD_NAME"
./scripts/session.sh mcp-config "$RUN_ID"
./scripts/session.sh mcp-verify "$RUN_ID"
./scripts/session.sh connections "$RUN_ID"
```

`homarr-finalize` updates the six onboarding-generated service apps: their
primary links become run-scoped host URLs and their ping URLs remain Docker
URLs. With the exact board name, it also repairs the preview image's obsolete
`stats` placeholder only when its six managed integrations and the valid
replacement statistics widget are verified. Other widgets and their layouts
remain unchanged. Do not reproduce these edits through individual UI forms.

### Optional starter-board polish

Offer this only after the generated-widget API proof passes and app links are
finalized. Planning is read-only:

```bash
./scripts/session.sh homarr-board-polish plan "$RUN_ID" "$BOARD_NAME"
```

The plan is eligible only for the exact upstream Homarr starter set: four
unchanged Homarr resource app tiles plus the unchanged Clock, Weather, and
Useful Links widgets. It verifies the private media board, six managed apps and
integrations, and the full generated-widget set. The integration-backed media
Calendar is managed content and remains on the board. A partial, duplicated,
or customized starter set is a stop condition. Require one simple section and
exactly the base and mobile layouts with no overlaps. Show every planned
y-offset delta for verified managed media items; the approval digest covers
those deltas and the full source board.

Show the plan and await `APPLY-HOMARR-BOARD:<approvalDigest>`. Then use only
that digest with a fresh apply:

```bash
./scripts/session.sh homarr-board-polish apply "$RUN_ID" "$BOARD_NAME" --approve "sha256:..."
```

Apply re-reads the full board and refuses a stale digest before one
`board.saveBoard` call. It removes only the seven planned item IDs and compacts
only the base/mobile y-offsets of the 13 already verified managed media items;
x-offsets, sizes, global app records, unrecognized items, user-owned items,
sections, and layout definitions remain exact. Treat every preserved item as a
fixed obstacle and verify the full retained board plus no overlaps after save.
Keep concurrent editors off the board during apply because Homarr has no board
revision precondition. Repeat the generated-widget API proof, then capture a
fresh desktop and mobile reload when visual acceptance is required.

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

- API-key storage and all four follow-up commands emit secret-safe summaries.
- The connections summary explains every service and gives the exact private
  file path plus a local reveal command without persisting a password.
- The six generated apps have host links plus internal Docker ping URLs.
- The canonical native endpoint authenticates, and both native MCP and the
  stdio adapter return the read-only title match; record whether its temporary
  curated Date-schema catalog was required.
- No key appears in evidence, no media mutation ran, and no generated client
  configuration was installed.
