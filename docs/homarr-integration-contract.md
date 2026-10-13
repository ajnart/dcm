# Homarr Link contract

## Supported upstream

The compiled definition pins `ghcr.io/homarr-labs/homarr:v2.4.1`.
The supported API version is `2.4.1`, observed through authenticated
`info.getInfo`. The tagged research baseline is
`ebbd4876d25a51151444a009ab596e1154d62880`; it is not the resolved image revision.
The inspected image index is
`sha256:ee67a5e856c051c4e114418a54b89a3fc3cb5507d0689e5cb89c790305c549cd`,
its linux/arm64 manifest is
`sha256:308feba8b9845cbdb21eb2e1b05579d49fb815bf3f0a452e58b59fcd4db8ecd2`,
and its local image ID is
`sha256:c6d895d659718b05ab9cc7b936458e6f5820b5cf3f0d35318588bd1b6901ee1b`.
Its OCI revision label is `3d4150e59f600876b7e308f857b2f21572b75348` and
version label is `main`, neither a substitute for the observed API version.
A release tag is mutable; proofs record each identity separately.
Setup and every Link read authenticated `info.getInfo` and reject other
versions with a backup/version/retry hint. `integration.getKinds` must expose
the descriptor's kind and the exact supplied credential alternative. Missing
credentials name the peer's Setup command; they are not submitted as empty keys.

The supported operations are the existing REST Apps/boards/item creation,
tRPC `integration.all/create/update/delete`, `board.getBoardByName/saveBoard`,
and per-App native queries. Successful connection creation requires a returned
integration ID and no body error, not merely HTTP 200. Widget options and metric
keys were checked at both source revisions. Scoped comparisons found the common
integration definitions/registry/router, widget map/router, Stats providers and
refresh/cache handlers, Immich adapter/router/request handler/widget options,
and App validation byte-identical. This is not a claim that the revisions are
equivalent in full, nor proof of another peer's native data.
API readback alone is not rendered acceptance.

## Peer worker seam

Each peer owns `internal/apps/homarr/target_<app>.go`, defining
`<app>Target() target` in package `homarr`. Reuse `target`, `secret`, `widget`,
`fixed`, `plain`, `statWidget` and the existing widget `bind` callback.
`internal/apps/homarr/targets.go` is the only registry assembly, owned by the
reference lane/orchestrator. Peer lanes do not edit it or common reconciliation.
The existing nine descriptors remain in `existingTargets()`.

A descriptor supplies Catalog ID/name, upstream integration kind, internal
Compose service Address, credential resolver and useful widgets. Its optional
`preflight(context.Context, from, to *helpers.H) error` runs first in both
`linked` and `add`, before compatibility requests or any board, tile or
integration mutation. It must probe afresh, remain read-only, and return
`helpers.ErrManual` for a person-owned prerequisite. Emit the specific recovery
instructions through `from.Info` before returning Manual; the step retains its
normal descriptor hint. Nil preserves existing behavior. Removal and absence
checks never call it, so unavailable credentials or prerequisites cannot block
owned cleanup. It is not an Address resolver or a TLS bypass.

The optional
`verify(context.Context, from, to *helpers.H, integrationID string) error`
probes authenticated useful data; verification must fail on missing fields or
authentication failures and accept legitimate zero values. Use a real identifier
in `bind` when needed, or leave that widget out. Do not invent an album, entity,
website or machine. `stats` and `calendar` remain shared, with per-integration
ownership and deterministic per-integration metric entry IDs.
For non-nil verifiers with Stats metrics, common `verifyData` additionally calls
`freshStatsSnapshot(ctx context.Context, h *helpers.H, integrationID string)
(map[string]any, error)` in both Check and apply. It reads `widget.stats.snapshot`,
requests `widget.stats.refresh` with `force: true`, and requires `error: false`,
`stale: false`, a positive `updatedAt` advancing from the prior timestamp, and
non-null values for every descriptor metric. It returns the refreshed values.
Homarr's refresh can no-op on lock contention or queue timeout while a cached
snapshot remains non-stale for an hour; neither HTTP success nor `stale: false`
alone is acceptance. No-op refreshes fail with a Setup retry hint; the helper
does not loop. The existing Step boundary may run Check followed by apply.
Nil verifiers keep legacy behavior; removal never refreshes Stats.
Peers keep their own semantic/destination checks without editing the common
guard or widening its signature.
Migrated descriptors additionally supply `stats func(statsSample) error` for
Stats semantics. Their existing `verify` keeps native identity and useful-data
checks and no longer acquires Stats. After that verifier succeeds, common
`verifyData` deduplicates selected metric keys across Stats widgets, reads the
authenticated catalog and obtains one completed refresh. It rejects missing
catalog keys, malformed or duplicate catalog entries, missing/null selected
values, non-finite or nonpositive timestamps and refreshes that do not advance.
The callback receives that same sample's `values`, catalog `units`, raw `retryAt`,
`startedAt`, `completedAt` and `updatedAt` (Unix milliseconds), after these checks.
`retryAt` comes from the refresh response without coercion; missing/null metadata
remains nil, and malformed or nonzero metadata stays available for App-specific
validation. Common checks impose no retry policy and perform no extra read.
`startedAt` is read before the refresh request and `completedAt` after its response,
so leaves
can retain their existing future-skew limits after a slow refresh. Common checks
only timestamp finiteness, positivity and advancement; Apps own clock policy.
Leaves retain expected
units, integral counts, ranges, nullable-field rules, additional clock limits
and relationships. Explicit zeros remain valid where the App allows them.
Mutable native-widget results are separate cached samples; do not require
equality between independently collected volatile values.

One refresh applies per migrated verification invocation. The Step can run
Check before and after apply, so a successful first Link can collect more than
one sample across distinct invocations. Samples are never remembered across
invocations. Descriptors without `stats` keep their current verification guard
without a new catalog request; nil `verify` still skips data verification.
Migrate each peer by retaining its native checks and moving its Stats checks
into `stats`. Preflight/Manual ordering and removal without Stats requests stay
unchanged.
No-auth kinds may omit the credential resolver: the common transport sends an
explicit empty secrets array and validates it against the upstream empty alternative.
Frigate is not a no-auth kind: Homarr 2.4.1 needs administrator username/password
over trusted HTTPS. The Catalog's authenticated HTTP starter cannot meet that
contract; its peer-owned preflight must stop as Manual before mutation, not
submit an empty credential alternative or disable TLS verification.

Credentials belong to the peer's Setup and are saved with `h.SetSecret`.
Use `h.Secret`, `h.Key`, shared Admin login and existing helper interfaces;
do not read files or query databases from a Homarr descriptor. Dedicated scoped
keys are preferred where supported. A browser-only credential boundary is a
Manual step, not permission to inject database keys or fake acceptance.

## Ownership and recovery

Only the integration ID recorded in `HOMARR_LINKED_<APP>` can be updated or
removed. A matching user integration (same kind/Address) stays untouched; a new
Link creates a separate owned integration and records Homarr's returned ID.
New integration widget ownership starts with `{}`; existing user widgets are
not inferred as owned. Only recorded widget IDs are removed. Shared widgets
lose just the removed integration's entries/binding.
If any remaining widget on any visible board still uses the integration,
removal preserves that integration and releases the Link's recorded ownership,
rather than destroying a user widget's connection. A later Link creates its own
integration again; it does not reclaim the preserved record.
Its linked Homarr App record is preserved too. Its generated or empty description
becomes `self-host retained tile:<app>`; an existing custom description is kept.
The retained marker is not an owned marker and legacy navigation migration skips
it, so even the original nine descriptors cannot reclaim it on reinstall. The
recorded App and Link ownership are removed; Homarr cannot delete an App still
linked to an integration. If the user edited its ping Address, release uses the
recorded App ID rather than an Address match and preserves its other fields.
Only the managed Home tile placement is removed. Legitimate legacy navigation
migration is otherwise unchanged.

Existing recorded Links retain their conservative legacy widget migration:
only a complete unique generated set with deterministic Stats IDs is eligible;
ambiguous sets stop for an explicit ownership decision. Missing ownership is
not permission to delete matching records. Existing legacy navigation-tile
migration applies only to the original nine descriptors; new peers require a
`self-host tile:<app>` marker or a recorded App ID. Browser Addresses remain
separate from internal integration Addresses.

The service owns absent/unready peer scheduling; the absent-peer fix is #265.
It must land with this work: absent peers do not run; installed unready peers
retain the actionable wait. Adding a descriptor does not bypass readiness.

## Immich reference

Immich v3.2.2 uses a dedicated administrator-owned key named
`self-host Homarr statistics`, stored as `IMMICH_HOMARR_API_KEY` and its
identifier as `IMMICH_HOMARR_API_KEY_ID`. Exactly `user.read` and
`server.statistics` are needed by Homarr's connection test and server-stat
queries. No write, album, asset-download or all-permissions scope is granted.
The official guide lists broader scopes for album features; those features are
not enabled by this Link.

Setup validates the key's permission metadata, administrator identity,
statistics and user list. A valid key is reused. A lost/rejected secret with an
existing managed key stops as Manual instead of rotating or adopting it. Restore
the secret through the Project boundary, or delete only that managed key in
Immich's user settings and retry `self-host setup immich`.

The Link uses `http://immich:2283`, verifies authenticated
`widget.immich.getServerStats`, and adds `immich-serverStats` plus shared Stats
entries `userCount`, `photoCount`, `videoCount`, `totalLibraryUsageInBytes`.
Its common guard also requires a genuinely refreshed Stats snapshot, so cached
native server statistics alone cannot complete the Link.
An empty library is valid when authenticated statistics explicitly report zeros
and the user list is nonempty. No album widget or fabricated album ID is added.
The [real API/browser proof](homarr-immich-proof.md) records its source, resolved
image identities, rendered values and ownership lifecycle, with explicit gaps.
At production `89301aff17c86b767f5a45076881f2bb7b41db39`, the updated attempt
verified the freshness guard and edited-ping Immich lifecycle. The final bounded
attempt additionally passed retained original-descriptor exclusion through two
reinstall/remove cycles and post-lifecycle preserved-board/Home rendering, with
reviewed native/shared statistics and the preserved user metric. The legacy
record is ownership-only, not native ntfy/Sonarr acceptance. Prior partial evidence
is retained separately. PR #309 stays draft pending both parent-owned independent
Standards/Spec reviews; this is not a contract freeze or permission to register
peers. Populated media, Manual key recovery, migration/restore, physical LAN,
actual refresh contention and non-nil Frigate prerequisites remain proof gaps.

Sources:

- [Immich integration guide](https://homarr.dev/docs/integrations/immich/)
- [Homarr Immich adapter](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/immich/immich-integration.ts)
- [Homarr integration operations](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/integration/integration-router.ts)
- [Homarr widget options](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/widgets/src/immich/server-stats/index.ts)
- [Immich key API](https://github.com/immich-app/immich/blob/v3.2.2/server/src/controllers/api-key.controller.ts)
- [Homarr Frigate Stats authentication](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/providers/frigate.ts)
- [Resolved-image Stats refresh/cache contract](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/request-handler/src/stats.ts)
- [Resolved-image Stats API](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/api/src/router/widgets/stats.ts)
