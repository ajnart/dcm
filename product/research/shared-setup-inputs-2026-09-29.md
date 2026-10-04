# Shared per-app setup inputs — 2026-09-29

## Finding

The shared setup path already has the right reusable seam: `SetupAdapter` owns
app-specific first-run behavior, `setup-engine.ts` constructs one
`SetupContext`, and `setup-transport.ts` serializes approvals and persists
compare-and-set checkpoints. Extend that contract; do not add another
app-ID-specific router or copy setup choices into `shared-project.ts` branches.

Today `shared-project.ts::parse()` accepts only app IDs and approval tokens.
`sharedSetupApproval()` fingerprints project identity/revision and the selected
app IDs, not setup choices. The per-request token in
`createSetupTransportFacilities().request()` binds the HTTP target/body and
checkpoint, but it does not know intent-level choices; its review text prints
query key names, not values. `setupContext()` passes no choices to adapters.
Thus request-level approval is strong, but it cannot by itself show or bind a
complete owner-selected setup plan.

## Minimum generic contract

- Add a small flat `SetupInputs` value map (`string | number | boolean`) to
  `SetupContext`, plus optional declarative input definitions on `SetupAdapter`
  (stable key, prompt/label, primitive type, required/default, and optional
  fixed choices). Keep definitions non-secret and app-owned; interpret them in
  shared CLI code. Do not add Jellyfin-specific flags or dispatch logic.
- Let `app shared setup` accept repeated generic `--input APP.KEY=VALUE`
  values, and let the interactive caller render the same definitions when
  values are omitted. Resolve explicit values/defaults through one validator.
  In non-interactive mode, a missing required value returns `input-required`
  before reading credentials or mutating. Defaults must be declared and shown;
  “New” can select declared safe defaults, but must not invent paths.
- Canonicalize the per-app input maps. Include their non-secret values and
  digest in the read-only setup review, and include the digest in
  `sharedSetupApproval()` and each step-approval fingerprint. Show the choices
  in the review/progress text so approval is informed, not merely hash-bound.
  Recompute and compare after approval as the transport already does for owner
  identity and checkpoint revision.
- Pass the immutable normalized map to `firstRun()`. Before any
  input-dependent write, persist the selected values/digest in that app's
  existing `first-run-<app>.json` checkpoint. On resume, load/reuse the saved
  map when inputs are omitted; reject a changed map after an attempt and
  require inspection rather than silently changing the meaning of progress.
  Keep the existing secret readers/writers separate: never accept passwords,
  API keys, tokens, cookies, or secret references as generic setup inputs.

The main code seams are:

- [`shared-project.ts`](../../packages/cli/src/shared-project.ts):
  `SharedOptions`/`parse()` for repeatable generic inputs;
  `sharedSetupApproval()` for choice binding; and the `action === "setup"`
  review/dispatch block for showing choices and passing normalized maps.
- [`types/setup.ts`](../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts):
  `SetupAdapter` and `SetupContext` for optional definitions and the read-only
  input map.
- [`setup-engine.ts`](../../packages/cli/src/control-panel/setup-engine.ts):
  `loadAdapter()`, `setupContext()`, and `runFirstRunSetups()` for schema
  validation, injection, and exact resume behavior. Keep
  `SetupInspectionContext` read-only; inspection should recheck saved choices
  from the app checkpoint, not receive a fresh unapproved choice set.
- [`setup-transport.ts`](../../packages/cli/src/control-panel/setup-transport.ts):
  `createSetupTransportFacilities().request()` for including the normalized
  input digest in the action-token fingerprint and safe review text;
  `readCheckpoint()`/`writeCheckpoint()` already enforce exact owner-only files,
  revision CAS, and no replay after `attemptedActions` is recorded.

## Jellyfin application

The pinned recipe mounts the owner-selected host media root read-only at
`/data`; that does not identify usable Jellyfin library directories. The
current adapter's `record()`/`ready()` explicitly says
`mediaLibrary: "not-configured-owner-path-required"`; `inspect()` verifies the
v12.1 wizard/admin/API-key path only. The dedicated research note confirms
that each chosen path must already exist inside the container and that
`/data/media/movies` and `/data/media/tv` are conventions, not safe defaults.
Require explicit paths (for example `moviesPath`, `showsPath`) under `/data`;
reject comma/control characters because the API query binder splits `paths`.

Use the existing private HTTP and checkpoint seam: read
`GET /Library/VirtualFolders`, create only missing exact mappings with
`POST /Library/VirtualFolders` (`refreshLibrary=false`), then read back exact
name/type/single-location matches. Give each create its own one-time action and
pre-send checkpoint carrying the chosen path. On resume after an attempted or
ambiguous create, reconcile inventory and accept only an exact match; never
POST again blindly because Jellyfin can allocate a suffixed duplicate name.
Extend `inspect()` to recheck saved mappings. Keep library setup distinct from
restart/function acceptance; the recipe lists those as separate obligations.

Evidence reviewed: `product/per-app-setup-contract.md`,
`product/research/jellyfin-library-2026-09-29.md`, Jellyfin's
`catalog/apps/jellyfin/{setup.ts,recipe.json}`, setup context types, the shared
CLI, engine, and transport. This is a source-level architecture review only;
no runtime code, Docker, credentials, or tests were used.
