# Homarr traps

## Pitfalls

- A generic link is not evidence that a dedicated integration or widget works.

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
