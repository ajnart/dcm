# Homarr Link contract

## Supported upstream

The compiled definition pins `ghcr.io/homarr-labs/homarr:2.4.1`.
The API contract is Homarr v2.4.1, source
`ebbd4876d25a51151444a009ab596e1154d62880`. A release tag is not an
immutable digest; runtime proofs must record the resolved digest separately.
Setup and every Link read authenticated `info.getInfo` and reject other
versions with a backup/version/retry hint. `integration.getKinds` must expose
the descriptor's kind and the exact supplied credential alternative. Missing
credentials name the peer's Setup command; they are not submitted as empty keys.

The supported operations are the existing REST Apps/boards/item creation,
tRPC `integration.all/create/update/delete`, `board.getBoardByName/saveBoard`,
and per-App native queries. Successful connection creation requires a returned
integration ID and no body error, not merely HTTP 200. Widget options and metric
keys come from this tagged source; API readback alone is not rendered acceptance.

## Peer worker seam

Each peer owns `internal/apps/homarr/target_<app>.go`, defining
`<app>Target() target` in package `homarr`. Reuse `target`, `secret`, `widget`,
`fixed`, `plain`, `statWidget` and the existing widget `bind` callback.
`internal/apps/homarr/targets.go` is the only registry assembly, owned by the
reference lane/orchestrator. Peer lanes do not edit it or common reconciliation.
The existing nine descriptors remain in `existingTargets()`.

A descriptor supplies Catalog ID/name, upstream integration kind, internal
Compose service Address, credential resolver and useful widgets. Its optional
`verify(context.Context, from, to *helpers.H, integrationID string) error`
probes authenticated useful data; verification must fail on missing fields or
authentication failures and accept legitimate zero values. Use a real identifier
in `bind` when needed, or leave that widget out. Do not invent an album, entity,
website or machine. `stats` and `calendar` remain shared, with per-integration
ownership and deterministic per-integration metric entry IDs.

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
An empty library is valid when authenticated statistics explicitly report zeros
and the user list is nonempty. No album widget or fabricated album ID is added.

Sources:

- [Immich integration guide](https://homarr.dev/docs/integrations/immich/)
- [Homarr Immich adapter](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/immich/immich-integration.ts)
- [Homarr integration operations](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/integration/integration-router.ts)
- [Homarr widget options](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/widgets/src/immich/server-stats/index.ts)
- [Immich key API](https://github.com/immich-app/immich/blob/v3.2.2/server/src/controllers/api-key.controller.ts)
