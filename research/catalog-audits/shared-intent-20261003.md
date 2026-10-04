# Canonical intent to shared Compose bridge

`packages/cli/src/control-panel/shared-intent.ts` projects the existing canonical
read-only `plan` report into app selection. It does not parse goal phrases,
duplicate taxonomy, inspect the host, write state, issue approval, or apply.

## Producer and integration

The producer remains
`.agents/skills/self-host/workflows/selfhost/scripts/selfhost.ts`:
`handlePlan` resolves intent, `planFromResolution` calls `buildPlan` or
`buildCompositePlan`, and `buildPlan` expands application dependencies.
`plan --project-root ABSOLUTE --json` returns a schema-1 envelope with
`command: plan`, `status: pass`, `mutation: false`, and `data.mode: read-only`.
The bridge accepts that envelope or its `data` object. Recipe choices come from
the existing `bundledSharedRecipeChoices(catalogRecipesReport.data)` parser.

Root integration points at the starting revision:

- `packages/cli/src/interactive.ts:688-693`: invoke canonical `planArgs`, resolve
  role choices, and show the report. Project its final selection before the
  old `personal-media` redirect at line 710 and household route at line 714.
  New shared flows should not persist legacy `project.json` before choosing
  the shared owner. Keep legacy-owner upkeep routes separate.
- `packages/cli/src/control-panel/shared-create.ts:59-76`: allow an initial
  canonical app selection instead of requiring an app-first picker. Preserve
  exact selection, including dependencies, and do not re-add Homarr after
  `control-plane=none`. Changes to required roles/dependencies must be replanned,
  not silently removed by a picker.
- Existing shared addition passes `ownerKind: shared` plus verified owner app
  IDs. `retained` preserves every existing app; `missing` is only the additive
  delta. Existing nonshared owners produce a blocker, never implicit conversion.

`status: ready` means only that this app projection is eligible for a separate
shared plan. Gates, unresolved decisions, and acceptance remain unchanged.
Shared inspection, recipe compilation, exact private ports, explicit apply,
first-run actions, and Homarr publication retain their separate boundaries.
Unrecipe apps stay visible with explicit gaps; external catalogs, unresolved
composition/VPN, conflicts, and separate ingress/VPN/privilege owners block.

## Verified producer examples

Executed with Bun 1.4.0 in a disposable empty project root through the canonical
read-only CLI; the focused fixture covers both actual reports and malformed
or conflict variants.

- `plan photos`: Homarr + Immich, with PostgreSQL and Valkey dependencies.
- `plan Netflix`: selects Jellyfin and the canonical personal-media defaults.
- `plan --goal photos --goal private-notes --compose`: retains both Immich and
  Docmost plus all canonical dependencies, in one projected app selection.
- `plan --app immich --select control-plane=none`: no Homarr is reintroduced.
- `plan 'photos and VPN' --compose`: canonical blocked report, no selection.
- `plan --goal photos --goal private-notes` without `--compose`: canonical
  blocked report, no selection.

Important limit: `plan 'photos and docs' --compose` currently resolves only
photos; bare `docs` is not an independently matched canonical alias. The bridge
cannot infer an omitted branch from an already produced report. The UI should
use canonical goal IDs from its menu, or obtain a complete canonical
composition before claiming a compound text request is preserved.

Root reconciliation now connects the projection to `planFlow` before the
legacy redirects, with recommended new-project selection or additions to a
completed existing shared owner. App IDs remain visible in `selected`;
`composeApps` distinguishes units from explicitly mapped bundled dependencies.
Recipe-hash-bound `composition.json` covers Immich/Paperless database/cache and
Docmost PostgreSQL without rewriting recipe bytes. Explicit database roles
remain standalone. Retained coverage requires the same saved recipe hash.
See [the exact composition evidence](shared-goal-composition-20261003.md).
No runtime or dependency-connection acceptance is claimed.

## Focused validation

Passed:

```bash
/home/habs/.local/share/mise/installs/bun/1.4.0/bin/bun packages/cli/tests/shared-intent.test.ts
/home/habs/.local/share/mise/installs/bun/1.4.0/bin/bun build packages/cli/src/control-panel/shared-intent.ts --target=bun --outfile=/dev/null
git diff --check
```

No Docker, browser, full-suite, CI, state persistence, runtime acceptance,
commit, or push was performed for this bridge.
