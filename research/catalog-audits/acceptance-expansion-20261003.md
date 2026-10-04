# Acceptance expansion — 2026-10-03

## Outcome and boundary

Added a production-dispatchable Paperless-ngx verifier alongside ntfy. No live
service was deployed, credentials were not rotated, and no runtime was stopped
or started during this source change. The supplied strict baseline remains
**0/94 live-compatible apps**: source availability and synthetic fixtures earn
zero points. This does not achieve the >75 aggregate goal.

The five equally weighted dimensions remain Compose, setup, Homarr, links, and
live restart. Each earns 20 only from exact current live evidence. A 94-app
catalog needs more than 7,050 of 9,400 possible points; one new restart verifier
cannot substitute for the other dimensions or the missing live trials.
Source: [compatibility rubric](../../packages/cli/src/lib/catalog-compatibility.ts).

## Paperless selected-workload contract

- Begin requires `--input paperless-ngx.document-id=<positive ID>` for an
  existing, authorized original document of at most 1 MiB. No automatic document
  discovery, upload, token creation, or delete is performed.
- The app-owned setup inspector performs fresh administrator, saved-token
  identity, and statistics reads. A saved setup observation is never used as
  current application health.
- `GET /api/documents/{id}/?fields=id` checks the exact selected database object.
  `GET /api/documents/{id}/download/?original=true` reads its original bytes.
  The isolated private acceptance checkpoint stores ID, size, SHA-256, and
  owner/image/start lineage; never document contents, titles, or credentials.
- Finish reuses the saved input and rejects a differing override. It requires
  dispatcher-persisted running -> stopped -> distinct running epoch evidence,
  covering `paperless-ngx`, `paperless-ngx-broker`, and `paperless-ngx-db`, and downloads the exact original
  again. A bounded read-only API readiness poll allows startup connection errors
  and 502/503/504 responses; authentication denial fails immediately. Missing,
  denied, oversized, or changed bytes fail.
- The reviewed result maps authenticated API health, selected original download,
  and exact byte persistence to the existing live-restart checks only. It does
  **not** prove upload, OCR, full-text search, Homarr functions, first-run,
  recovery, or backup restore. No cleanup mutation is needed for an existing
  read-only document.

The pinned recipe is Paperless 3.2.1. Official version-bound source confirms
`original=true` selects the original rather than the archive and that download
checks owner-aware view permission. Current documentation lookup used Context7
`/paperless-ngx/paperless-ngx`; development docs are not treated as pinned
runtime acceptance. Sources:
[pinned document view implementation](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src/documents/views.py),
[official API documentation](https://docs.paperless-ngx.com/api/),
[saved setup inspector](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/paperless-ngx/setup.ts),
[acceptance adapter](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/paperless-ngx/acceptance.ts).

## Reusable boundaries

The shared engine keeps exact owner, immutable image, source hash, mutation lock,
approval, attempted-action chronology, and append-only receipt publication. A
strict app-owned `acceptance-contract.json` records replace ntfy-specific result
assumptions; the common loader validates exact schema and three known
live-restart mappings, then evaluates declared primitive conditions. It resolves
only beside catalog-selected setup source, with no caller-supplied JSON/import.
Adapter presence alone cannot publish a pass. Declared workload keys are bound
to both review approval and persisted ledger identity. The reviewed result
contract's exact bytes plus generic mapper/engine source are included in verifier
subject hashing. Updating one app contract does not invalidate unrelated app
subjects; changing common engine behavior does invalidate its prior subjects.
Sources: [shared engine](../../packages/cli/src/lib/shared-acceptance.ts),
[generic contract loader](../../packages/cli/src/lib/shared-acceptance-contract.ts),
[Paperless contract](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/paperless-ngx/acceptance-contract.json),
[ntfy contract](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/ntfy/acceptance-contract.json),
[runtime owner](../../packages/cli/src/lib/shared-acceptance-owner.ts),
[receipt registry](../../packages/cli/src/lib/compatibility-receipts.ts).

Reusable candidates are authenticated saved-object reads, exact account identity
readback, and existing-object bytes across an owned restart. No-account apps need
their own declared no-account API contract and a real useful operation; HTTP 200
or an empty list cannot prove application acceptance. Apps requiring upload,
delivery, external callbacks, or provider access still need separately approved
workloads. Homarr tiles, native integration tests, widget data, and reload
persistence remain separate live evidence requirements.
Sources: [verification gates](../../.agents/skills/self-host/workflows/selfhost-verify/GUIDE.md),
[evidence contract](../../.agents/skills/self-host/workflows/selfhost-verify/references/evidence-contract.md),
[required dimension checks](../../packages/cli/src/lib/catalog-compatibility.ts).

## Focused validation

Passed the new `packages/cli/tests/paperless-acceptance.test.ts` fixture, the
affected `packages/cli/tests/shared-acceptance.test.ts` fixture, Bun builds of the
shared engine and Paperless adapter, and diff whitespace checks. The new fixture
covers read-only transport intent, fresh administrator/token identity,
repeat-begin baseline preservation, owner/dependency/start sequence rejection,
credential denial, changed/oversized bytes, result-contract separation, and
approval/saved-input binding. These are synthetic assertions, not live receipts.
No broad tests, CI, Docker builds, browser runs, deployment, commits, or pushes.
