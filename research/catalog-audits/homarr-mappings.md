# Homarr catalog mappings

Checked 2026-10-03 against official `release/v2` commit
`beffe794022c22c43dd458999ee2a016bb1df2e6` (remote branch resolved live).
All 94 catalog apps now own a `homarr.json`: 48 exact native kinds and
46 explicit tile-only descriptors. Before: 16 descriptors (14 native,
2 tile-only). Native catalog coverage increases from 42 to 48 applications;
UniFi remains an external-only surface.

## Evidence

- [Integration names, credential alternatives and categories](https://github.com/homarr-labs/homarr/blob/beffe794022c22c43dd458999ee2a016bb1df2e6/packages/definitions/src/integration.ts).
- [Widget kinds and integration compatibility](https://github.com/homarr-labs/homarr/blob/beffe794022c22c43dd458999ee2a016bb1df2e6/packages/definitions/src/widget-integration-map.ts).
- [Native constructors, including the six Stats integrations](https://github.com/homarr-labs/homarr/blob/beffe794022c22c43dd458999ee2a016bb1df2e6/packages/integrations/src/base/creator.ts).
- [Umami website selection](https://github.com/homarr-labs/homarr/blob/beffe794022c22c43dd458999ee2a016bb1df2e6/packages/widgets/src/umami/index.ts);
  [Home Assistant entity](https://github.com/homarr-labs/homarr/blob/beffe794022c22c43dd458999ee2a016bb1df2e6/packages/widgets/src/smart-home/entity-state/index.ts)
  and [automation](https://github.com/homarr-labs/homarr/blob/beffe794022c22c43dd458999ee2a016bb1df2e6/packages/widgets/src/smart-home/execute-automation/index.ts).
- [Generic Stats requires selected entries](https://github.com/homarr-labs/homarr/blob/beffe794022c22c43dd458999ee2a016bb1df2e6/packages/widgets/src/stats/index.ts).
- Current official documentation retrieved through Context7
  `/homarr-labs/documentation`; its indexed credential reference is older than
  this release branch. Pinned implementation decides exact v2 names.

## Deliberate limits

| Native addition | Exact credential sets | Automatic widget |
| --- | --- | --- |
| Caddy, Frigate, Gatus, Netdata | none | withheld: Stats entries require selection |
| Linkwarden | apiKey | withheld: Stats entries require selection |
| Prometheus | none or username + password | withheld: Stats entries require selection |

Caddy's [provider](https://github.com/homarr-labs/homarr/blob/beffe794022c22c43dd458999ee2a016bb1df2e6/packages/integrations/src/stats/providers/caddy.ts)
reads `/reverse_proxy/upstreams` on its admin API, not the browser route.
Frigate's [provider](https://github.com/homarr-labs/homarr/blob/beffe794022c22c43dd458999ee2a016bb1df2e6/packages/integrations/src/stats/providers/frigate.ts)
reads the private unauthenticated `/api/stats` API. The descriptor does not
enable an admin listener, expose a port, bypass authentication, or establish
container reachability. These require owner-verified server URLs; do not
reuse a browser URL when it addresses a different API.

Five selected-resource widgets are withheld until their real IDs exist:
Immich album carousel (`albumId`), Beszel system stats (`systemId`),
Umami (`websiteId`), Home Assistant entity state (`entityId`), and Home
Assistant automation (`automationId`). Generic Stats is not created empty.
No guessed entity, website, album, or automation is installed.

PatchMon requires `patchmonApiKey` and `patchmonApiSecret`; its dashboard
login JWT is not an integration key pair. Home Assistant requires a real
long-lived API token, not its owner password. Missing saved credentials remain
pending. Descriptors retain only upstream-supported credential sets compatible
with their owned recipes: authenticated Aria2, Tdarr and Pi-hole require the
saved key even where upstream also accepts anonymous access. No secret values enter
descriptors or this audit.

Tiles and recap reuse saved app metadata and selected URLs; descriptors contain
no copied ports, descriptions, or credentials. A tile-only descriptor promises
neither a native integration nor a widget. A daemon without a verified browser
route must remain a recap/route gap, not receive an invented link.

## Validation

`packages/cli/tests/homarr-catalog-mappings.test.ts` passes for 94 descriptors
and all 48 independent pinned credential snapshots. It checks tile-only
coverage and selected-resource widget withholding. Focused Bun build of
`homarr-stack-mapping.ts` passes. All declared widget/integration pairs were
also compared read-only against the pinned compatibility map: no mismatches.
Focused catalog validation passes: 94 apps, 48 covered native applications.
This is source/synthetic evidence only: no Docker, browser, rendered widget,
fresh-account, API-authentication, or restart-persistence acceptance was run.
