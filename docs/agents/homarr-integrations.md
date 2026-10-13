# Native Homarr integrations

Ship one peer App at a time: its Setup owns credentials; Homarr owns the Link,
connection and widgets. Read the [contract](../homarr-integration-contract.md)
and [final bounded proof](../homarr-immich-proof.md#final-bounded-attempt).
[#309][reference] is merged and #262 closed: its frozen main commit is
`6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`. Historical pending-review prose in
those records predates that decision. Keep the existing self-host skill router.

## Ordered workflow

1. **Inspect the native surface.** Read the peer's Setup/Check, official guide,
   Homarr registry, adapter/Stats provider and widget schemas at the resolved
   image's source revision. Record exact kind casing, credential alternatives,
   least permissions, internal endpoint and useful supported widgets/metrics.
   The [compatibility gate](../../internal/apps/homarr/compatibility.go) requires
   authenticated API version **2.4.1 or 2.5.1** and the exact `integration.getKinds`
   credential alternative; missing keys are not submitted. A nil resolver sends
   `[]` only when the upstream alternative permits it. Resolve actual selectors
   or omit the widget; no invented IDs, metrics, empty values or hardware readiness.
   The `2.5.1` source candidate includes hotfix #7170; its fresh published-image
   proof remains pending. The finite gate excludes `2.5.0` and other `2.5.x` versions.
   **Done:** sources and one meaningful native acceptance value are identified.

2. **Use the peer seam.** Own one branch/worktree/PR and
   `internal/apps/homarr/target_<app>.go`, defining `<app>Target() target`.
   Reuse `target`, `secret`, `widget`, `fixed`, `plain`, `statWidget` and `bind`;
   [`target_immich.go`](../../internal/apps/homarr/target_immich.go) is the example.
   The exclusive registry custodian owns
   [`targets.go`](../../internal/apps/homarr/targets.go) and common reconciliation;
   coordinate registration without editing either from a peer lane.
   Optional `preflight(ctx, from, to)` probes afresh, read-only, before compatibility
   or mutation in both Check/apply. For person-owned prerequisites, emit recovery
   through `from.Info` and return `helpers.ErrManual`. It is not an Address resolver
   or TLS bypass. Optional `verify(ctx, from, to, integrationID)` validates useful
   authenticated data, including its meaning/destination. Nil verifiers retain
   legacy data checks; removal/absence never calls preflight or refreshes Stats.
   Migrated Stats peers add `stats func(statsSample) error` for pure semantic
   validation. Keep native checks in `verify`, and move Stats acquisition out
   of it. The callback receives `values`, catalog `units`, raw `retryAt`, `startedAt`,
   `completedAt` and `updatedAt` (Unix milliseconds) from one central refresh.
   `retryAt` preserves missing/null and malformed metadata without coercion;
   each App owns its retry policy, without another Stats read.
   The start is read before the request and completion after the response;
   use completion when retaining an App's existing upper future-skew limit
   after a slow refresh. Apps own clock policy; common checks require finite,
   positive, advancing timestamps.
   **Done:** the leaf fits the actual contract without changing common signatures.

3. **Implement the two owners.** The peer's idempotent Setup discovers/creates,
   verifies and reuses credentials through `h.Secret`, `h.Key`, `h.SetSecret`
   and existing HTTP/secret-safe exec helpers. Lost/rejected keys need targeted
   retry/Manual recovery, not blind rotation or database/file scraping. Homarr
   consumes those keys, separates the internal Compose Address from browser `href`
   and checks body errors/returned IDs. The service owns absent/unready scheduling.
   For a non-nil verifier with Stats metrics, central `verifyData` runs **after the
   leaf** in Check/apply: `freshStatsSnapshot` reads the prior snapshot, forces
   refresh, requires advancing positive `updatedAt`, `error: false`, `stale: false`
   and every selected metric non-null. A cached non-stale/no-op result fails with
   a retry hint; the guard does not loop. Keep peer semantic checks too.
   For descriptors with `stats`, common verification instead reads the catalog,
   deduplicates the selected keys, obtains one finite positive advancing sample,
   checks required values, then invokes `stats` on that same sample. Preserve
   expected units, integral counts, ranges, legitimate zeros, nullable fields,
   additional clock limits and relationships in the leaf callback. Do not compare
   independently cached volatile samples for equality. The guarantee is one
   refresh per verification invocation; Step's separate Check/apply invocations
   remain separate. Unmigrated peers do not acquire a new catalog.
   **Done:** recovery and fresh native/Stats checks work through existing owners.

4. **Prepare isolated acceptance.** Runtime work needs approval for the disposable
   Project, data writes and owned cleanup; source-only documentation needs none.
   Set fresh absolute `SELF_HOST_HOME`, unique `SELF_HOST_COMPOSE_PROJECT`,
   isolated media/download folders, Telemetry off and unused loopback ports with
   `--exposure local` / `--set <app>.port=N`. A new Home alone still uses `selfhost`.
   Enforce an **entire-attempt global ceiling of at most 5 containers, 5 GiB,
   5 CPUs and 15 minutes**, including every dependency, fixture, companion App,
   diagnostics and cleanup. Run batches sequentially, never concurrently; peer
   budgets are not additive. Enforce 1 GiB/1 CPU/512 PIDs per container from first
   creation and inspect actual caps. Reserve 13 minutes work, 30 seconds diagnostics
   and one minute owned cleanup within that ceiling. Any higher limits require a
   **separately approved scope and runtime plan before launch**.
   Provider/account actions, hardware, bandwidth-heavy jobs,
   public Access and another runtime attempt each need explicit scope/approval.
   **Done:** owned inventory, ports, hard bounds and cleanup are preflighted;
   no real user Project/board or protected secret/profile files are touched.

5. **Debug, seed, inspect.** Read `self-host debug <peer> --json` and
   `self-host debug homarr --json` first; repair headless Setup. Seed known small
   synthetic data where approved, or verify a legitimate empty state plus positive
   authenticated identity. Missing/null/error fields are not zeros. Before browser
   use, load `agent-browser skills get core` from the installed CLI; select a fresh
   short named namespace/session, check socket length and allowlist only the fixture's
   loopback host. Authenticate through fixture-controlled stdin/provider, otherwise
   use a Manual login. Secrets stay out of arguments/output/captures; no real browser
   attachment, profile reads or persisted/exported auth state. Use `snapshot -i`,
   fresh refs and value-based waits, not polling-board `networkidle`. Inspect and
   review the actual native widget and shared Stats, not just API readback or a tile.
   **Done:** useful native and rendered values agree with the controlled dataset;
   negative authentication and real no-op/advancing refresh outcomes are recorded.

6. **Exercise preservation.** Snapshot non-secret resource IDs/options in the test
   instance: matching user integrations/widgets and **at least two real cross-kind
   bindings** in applicable shared widgets. Rerun, then exercise invalid-key
   failure/recovery and replacement through the fixture's peer owner: valid keys
   are reused, owned IDs stay stable, duplicates do not grow, user resources survive.
   Remove only the peer through self-host. Only recorded owned bindings disappear;
   a remaining user widget on any visible board retains its integration and linked
   App. Recorded ownership is released; generated/empty descriptions become
   `self-host retained tile:<app>`, custom descriptions stay unchanged. Release
   uses the recorded App ID even after edited `pingUrl`, preserving user fields;
   reinstall creates new owned IDs, never reclaims retained resources. Verify two
   reinstall/remove cycles, preserved boards and a **meaningful useful survivor**
   from the other real kind. Opaque legacy records prove ownership only, not native
   peer data; two Immich bindings are not cross-kind acceptance.
   Exercise **peer-first then Homarr** and **Homarr-first then peer** in fresh
   isolated Projects: each order must reach useful native/rendered acceptance.
   These exercise different Setup scheduler paths; reruns do not prove both orders.
   **Done:** both installation orders, lifecycle, collision, absent/unready behavior
   and survivor data/rendering pass; owned containers/networks and only this browser
   session close, scoped cleanup readback is empty/inactive, and volumes/disposable
   data remain kept.

7. **Deliver a bounded proof.** Record self-host source SHA and binary SHA-256,
   peer versions, authenticated Homarr API version, image index/platform manifest/
   local ID, RepoDigests, OCI revision/version labels and inspected source SHAs.
   Keep them distinct: the reference's OCI revision is
   `3d4150e59f600876b7e308f857b2f21572b75348`, OCI version `main`, API `2.4.1`;
   `ebbd4876d25a51151444a009ab596e1154d62880` is the tagged research baseline.
   Its 22-file comparison proves only those files, not all peer contracts. Hash
   evidence, record bounds/cleanup and limitations. Code changes use the local
   repository gate; docs-only changes use source/link/diff checks without runtime.
   **Done:** each peer PR has fresh independent Standards/Spec reviews and its own
   bounded native/rendered/lifecycle acceptance before merge; registry changes
   remain custodian-owned.

## Acceptance boundary

The reference production `89301aff17c86b767f5a45076881f2bb7b41db39` accepts
authenticated Immich Users 1 / Photos 0 / Videos 0 / Storage 0, including genuine
Stats refresh and preservation. This is **1 of the 39** missing native peers,
not populated-media or all-peer acceptance. Source drafts for the 39 are not a
coverage claim; the remaining 38 native acceptances stay held for their own gates.
Account/provider, hardware, physical LAN, populated media, Manual key recovery,
migration/restore, real refresh contention and non-nil prerequisite behavior
remain outside that reference proof. Reuse its seam and containment, not its result.

[reference]: https://github.com/ajnart/selfhost-skills/pull/309
