# Homarr traps

## Pitfalls

- A generic link is not evidence that a dedicated integration or widget works.
- Setup owns one shared `stats` widget and one shared `calendar` widget on Home.
  Ownership remains recorded per integration: each participating App records the
  surviving shared item ID. Removing an App removes only its integration and
  stats entries; delete the shared item only after its last integration is gone.
- Adopt legacy per-App widgets only from complete, unique generated sets with
  deterministic stats entries and empty plain options. Preserve unowned widgets;
  ambiguous ownership needs review before mutation (`{}` preserves existing items).
  Resize owned items within each responsive grid and relocate them around user
  items and containers; reruns preserve placements and larger user-selected sizes.
- The assistant widget is optional. Its absence does not make the Notebook
  outdated. An explicit unknown-kind or kind-enum rejection may be skipped;
  authentication, other validation and server failures still fail Setup.

## Security

- Keep integration credentials in Homarr encrypted storage and protect API keys.

## From docs/homarr.md

### Traps

- Integration URLs are base URLs only; never append settings/API paths.
- Homarr's Docker URLs are not host-browser routes. Use the run-scoped host URL
  plus the table suffix when retrieving credentials with agent-browser.
- Re-snapshot after dialogs and menus; stale refs and overlays are common.
- Never pass the derived password in an agent-browser or shell argument; use
  only the bounded browser-password helper with fresh refs.
- During setup, never invoke, print, or persist authenticated agent-browser
  diagnostics such as `console`, raw `network requests`, or HAR output inside
  or outside the run; use only page-scoped approved fixed summaries or fixed
  harness summaries.
- A green integration list without visible generated apps/widgets is incomplete.
- Never fall back to post-onboarding manual placement to claim auto-generation.
- Never screenshot the one-time API key or put it in a client fragment.
- Never invoke media request/download tools as part of verification.

Sources: [Docker installation](https://homarr.dev/docs/getting-started/installation/docker/),
[integration management](https://homarr.dev/docs/management/integrations/),
[API](https://homarr.dev/docs/management/api/),
[MCP](https://homarr.dev/docs/management/mcp/), and
[Seerr integration](https://homarr.dev/docs/integrations/seerr/). Exact helper
paths come from Homarr's current
[`integration.ts`](https://github.com/homarr-labs/homarr/blob/dev/packages/definitions/src/integration.ts).
