# Homarr TLDR

- Purpose: final dashboard, apps, live integration widgets, API/MCP, and
  acceptance UI.
- Required image: `ghcr.io/homarr-labs/homarr-test:v2` (never substitute stable).
- Internal port: `7575`; host URL comes from `scripts/session.sh urls`.
- State: `/appdata`; per-run 64-hex `SECRET_ENCRYPTION_KEY` is required.
- No Docker socket is mounted: each Homarr must see only explicitly configured
  integrations, not neighboring test stacks.

## Minimum fresh-run path

1. Open `/init` with agent-browser, start from scratch, and create the standard
   local admin username `admin`. Fill its fresh password and confirmation refs
   through `scripts/session.sh browser-password "$RUN_ID" @eN @eN`.
2. Continue past Discover when it reports the intentionally absent Docker
   socket; manual setup is the isolation-safe path.
3. Do not skip onboarding's Connect step. Add and test **all six** services
   before finishing: Sonarr, Radarr, Prowlarr, qBittorrent, Jellyfin, and Seerr.
4. Use Docker URLs: `http://sonarr:8989`, `http://radarr:7878`,
   `http://prowlarr:9696`, `http://qbittorrent:$QBITTORRENT_PORT`,
   `http://jellyfin:8096`, and `http://seerr:5055`.
5. Use per-run API keys for the three Arr apps and Seerr; select the
   username/password mode for qBittorrent and Jellyfin. Fill each password ref
   only through `scripts/session.sh browser-password "$RUN_ID" @eN`.
6. Review must state 6 integrations and 6 app tiles. Build and let `v2` generate
   the dashboard. Do not manually add apps/widgets: generation itself is under
   test.
7. Stop UI configuration after proving the generated board. In
   `/manage/tools/api`, use the **Authentication** tab to create one API key for
   this run. Pipe its one-time browser value directly into
   `./scripts/session.sh homarr-key "$RUN_ID"`; do not expose or stage it.
8. Run `./scripts/session.sh homarr-finalize "$RUN_ID"`,
   `./scripts/session.sh mcp-config "$RUN_ID"`, and
   `./scripts/session.sh mcp-verify "$RUN_ID"` in that order. The finalizer
   changes only the six generated apps to host-reachable primary links while
   retaining their Docker URLs for container-side ping.
9. Keep the secret-free client fragment candidate-scoped. Installation into a
   local client is a promotion action reserved for the winning run.

## API/MCP contract

- Native Streamable HTTP endpoint: `/api/mcp`.
- Compatibility alias: `/api/mcp/mcp`; probe it only when the canonical route
  is unavailable and never select it for new configuration.
- Authentication: the private per-run key in the `ApiKey` header. The harness,
  not candidate-authored commands or config, owns key injection.
- Direct native MCP is the target. The generated local stdio bridge injects the
  private per-run key without persisting it in client configuration. It projects
  only `integration_all`, `integration_byId`, and
  `integration_searchMediaRequests` from a successful native catalog. The same
  three curated schemas are available only for exact RPC `-32603` message
  `Date cannot be represented in JSON Schema`. Neither mode masks auth, route,
  or network failures.
- `mcp-config` writes the credential-free candidate fragment to
  `SESSION_ROOT/artifacts/mcp-client.json`. Concurrent candidates leave it
  uninstalled so they cannot overwrite or reload the same client configuration.
  The fragment identifies the local bridge and `RUN_ID`, never the key value.

The bridge uses `integration_all` and `integration_byId` to verify the one Seerr
integration, then calls `integration_searchMediaRequests`. Acceptance is
intentionally read-only: search for **Spider-Man: No Way Home**, record the
exact structured match, then stop. The bridge rejects `app_update`,
`integration_requestMedia`, `mediaRequests_answerRequest`, and every other
unapproved tool before upstream dispatch.

## Proof

- Every onboarding integration test passes.
- Management -> Integrations lists exactly one connected integration for each of
  the six service types, each linked to an app.
- Management -> Apps shows host-reachable primary URLs and Docker-reachable ping
  URLs for all six service apps.
- `homarr-finalize`, `mcp-config`, and `mcp-verify` emit PASS without revealing
  the key; canonical native MCP and the stdio adapter return the read-only title
  search result, with native-versus-curated catalog mode reported explicitly.
- The generated board visibly contains all six app tiles plus integration-backed
  widgets, including Seerr requests, Jellyfin media, qBittorrent downloads, and
  Arr/Prowlarr data.
- Reload the board, leave edit mode, and capture a full-page screenshot in the
  run's artifact directory.
- All generated tRPC widget calls succeed after reload. Empty media libraries
  legitimately render empty states; request/network errors do not. For the
  media-release widget, an empty `releases` array is valid when the response's
  `failedIntegrations` array is also empty, even if the current UI says
  `No integration data available`.

## Traps

- Integration URLs are base URLs only; never append settings/API paths.
- Re-snapshot after dialogs and menus; stale refs and overlays are common.
- Never pass the derived password in an agent-browser or shell argument; use
  only the bounded browser-password helper with fresh refs.
- A green integration list without visible generated apps/widgets is incomplete.
- Never fall back to post-onboarding manual placement to claim auto-generation.
- Never screenshot the one-time API key or put it in a client fragment.
- Never invoke media request/download tools as part of verification.

Sources: [Docker installation](https://homarr.dev/docs/getting-started/installation/docker/),
[integration management](https://homarr.dev/docs/management/integrations/),
[API](https://homarr.dev/docs/management/api/),
[MCP](https://homarr.dev/docs/management/mcp/), and
[Seerr integration](https://homarr.dev/docs/integrations/seerr/).
