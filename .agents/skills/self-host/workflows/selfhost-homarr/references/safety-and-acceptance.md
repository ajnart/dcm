# Safety and acceptance

## Profile invariants

The profile utilities reject filesystem root or home as the project/profile boundary; symlinks, hard-linked files, unexpected owners, broad modes, credentials in URLs, query strings, fragments, public plaintext HTTP, and secret-like config fields. Initialization and fragment generation are no-clobber. Key replacement uses the explicit atomic rotation path.

`doctor` prints only fixed PASS/FAIL state. A healthy result proves private local profile structure and parsing, not remote Homarr access.

## Read-only verification

`verify-homarr.ts` checks:

1. `ApiKey` authentication on canonical `/api/mcp`;
2. native catalog or the exact curated Date-schema fallback;
3. stdio bridge initialize, read-only catalog projection, and a read-only call;
4. optional Seerr search through exactly one usable integration ID, defaulting to `Spider-Man: No Way Home`, with an exact structured result.

It prints fixed summaries and no response bodies. It never calls `integration_requestMedia`, app updates, request decisions, or another mutating tool.
For a `media-request` profile, `--media-search` additionally requires the configured ID to resolve to the one live `seerr` integration. Catalog validation confirms that only the wrapped media-request mutation is visible; it does not exercise it.

## Acceptance language

- `PASS canonical endpoint authentication`: observed canonical authenticated MCP response.
- `PASS tools/list native catalog`: observed a valid native catalog.
- `PASS tools/list curated Date-schema fallback`: authenticated endpoint observed, exact catalog incompatibility observed, curated catalog active.
- `PASS bridge ... read-only tools/call`: bridge initialize/list/call observed with mutating tools absent.
- `PASS Seerr media search`: a non-empty structured result contained an exact normalized title or name.

Treat missing, stale, failed, or compatibility-only evidence as unaccepted for a canonical claim. This verifier makes no generated app-tile, navigation-link, ping-target, or widget claim. Delegate those managed-dashboard checks to `selfhost-media`, then aggregate supplied evidence with `selfhost-verify`.
