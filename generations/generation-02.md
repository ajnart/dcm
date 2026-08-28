# Generation 2 - deterministic core

## Hypothesis

Moving qBittorrent, Sonarr, Radarr, and Prowlarr into one tested bootstrap will
remove most retries and let independent candidates spend their browser actions
only on the three unavoidable onboarding flows.

## Candidate invocations

```bash
scripts/render-prompt.sh luna-g2-a
scripts/render-prompt.sh luna-g2-b
```

Each candidate must create a fresh run, execute the compiled prompt unchanged,
leave the stack running, and return its acceptance matrix plus action ledger.

| Run | Core bootstrap | Jellyfin | Seerr | Homarr | Fitness |
| --- | --- | --- | --- | --- | --- |
| `luna-g2-a` | PASS | PASS | PASS | PASS | **64 actions; promoted** |
| `luna-g2-b` | PASS | PASS | PASS | PASS with empty-state ambiguity | 70 actions; not promoted |

## Result

Both candidates independently reached reloaded Homarr boards with six persisted
integrations, six onboarding-generated app tiles, host navigation URLs,
container-side ping URLs, and green status. Both final core verifiers passed.

Candidate B conservatively reported failure because the generated Jellyfin
media-release widget displayed `No integration data available`. Supervisor
inspection of the captured tRPC body proved a valid empty result:
`releases: []` and `failedIntegrations: []`. The integration was therefore
healthy, but the UI wording is ambiguous. Candidate A remains the survivor on
fitness: 64 meaningful actions versus 70, with fewer Homarr retries.

## Promoted Generation 3 genome

- Keep the deterministic core bootstrap and final verifier.
- Preflight the run-scoped browser with the required Chromium sandbox option.
- Use focus-and-Enter for hydrated wizard actions and re-snapshot after every
  Homarr card rerender.
- Keep the six generated-app host URL/internal ping URL split.
- Judge empty generated widgets by response structure. In particular,
  `releases: []` passes only with `failedIntegrations: []`; do not infer a broken
  connection from Homarr's empty-state wording alone.

Candidate A's stack remains the independently verified promotion reference.
