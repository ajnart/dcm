# Native Homarr integrations

Ship one peer App at a time: its Setup owns credentials; Homarr owns the Link,
connection and widgets. Browser automation verifies the result, not the Setup.
Keep using the existing self-host skill router; this is a development workflow.

## Ordered workflow

1. **Inspect the supported surface.** Read the peer's Setup/Check and Homarr's
   declarations below. Consult the [official guide index][guides], then the
   integration registry, adapter and widget schemas at the **tested Homarr source
   SHA**, not just the latest docs. Resolve exact kind casing, credential
   alternatives, peer API version/permissions, internal port/path, useful default
   widgets and required selectors. Keep unsupported/external surfaces separate
   from Catalog work; a navigation tile is not native wiring.
   **Done:** record the kind, credential shape, permissions, endpoints, widget
   options and one observable acceptance value, with versioned sources.

2. **Confirm the shared contract.** [#262][contract] owns the compatibility and
   ownership contract, including the first Immich slice. It is being implemented
   concurrently; this ticket is a **temporary contract reference**, not a shipped
   API. Read its implementation before extending it. At the source baseline below,
   the existing descriptor is `target`, with `secret` and `widget`, in
   [`links.go`](../../internal/apps/homarr/links.go); there is no separate descriptor
   registry/compatibility API to assume exists. Add one descriptor per peer through
   the shared owner; coordinate registry/contract edits with #262 rather than
   inventing another engine or copying transport/reconciliation code.
   **Done:** identify the actual declaration location and contract revision, or
   explicitly block only the parts awaiting #262.

3. **Implement the two owners.** The peer's idempotent Setup discovers/creates,
   verifies and reuses the least-privilege credential. Store it through
   `h.SetSecret(h.Key(...), value)`; use helper HTTP/secret-safe exec, not secret-file
   scraping. Give missing/invalid credentials a targeted retry or Manual step.
   Homarr consumes saved credentials, uses the Compose service Address for its
   connection and the browser Address for `href`, checks response-body errors,
   and binds native widgets to real peer IDs. Selectors such as album/system IDs
   need discovery or an explicit choice, never an invented default. Preserve
   the service scheduler and consumer-owned failures.
   **Done:** peer Setup can recover without routine rotation; Homarr has one
   declaration with check/apply/remove through the existing Link machinery.

4. **Prepare isolated acceptance.** Runtime work needs approval for the disposable
   Project, synthetic writes and owned cleanup; docs-only work needs no runtime.
   Set an absolute fresh `SELF_HOST_HOME`, unique `SELF_HOST_COMPOSE_PROJECT`,
   `SELF_HOST_NO_TELEMETRY=1`, and isolated media/download folders. Install only
   the required Apps through self-host with `--exposure local` and unused
   `--set <app>.port=N` host ports. A different Home folder alone does **not**
   change the default Compose name `selfhost`. Confirm the Project/ports before
   every mutation; the person's existing Project and live Homarr board are out
   of scope. Keep protected secret files, `.sessions/` and browser profiles unread.
   **Done:** the owned Project, Compose name, bind addresses, data folders and
   cleanup scope are recorded; no host resources overlap.

5. **Debug, seed, then inspect the browser.** Run `self-host debug <peer> --json`
   and `self-host debug homarr --json` in that Project first. Repair headless
   Setup before browser work. Seed a small known synthetic item through the peer's
   supported API/UI; record its non-secret ID/value and wait for processing.
   Load the installed browser instructions and create an isolated session:

   ```bash
   agent-browser skills get core
   export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix homarr)"
   agent-browser open "$HOMARR_ADDRESS"
   agent-browser snapshot -i
   ```

   `HOMARR_ADDRESS` is the disposable instance's Address from status/debug.
   Use fixture-controlled stdin/provider authentication without printing values;
   if unavailable, have the person sign into this isolated instance. Keep secrets
   out of CLI arguments, output and captures; do not load a real profile, attach
   to a person's browser, or persist/export auth state. Follow fresh refs, wait
   for the expected widget value, and re-snapshot after navigation; polling boards
   are not candidates for a generic `networkidle` wait. Capture only the secret-free
   widget area, never credential forms, raw headers/bodies or storage.
   **Done:** native Homarr data and a visible widget show the seeded value (or
   exact expected aggregate), not merely a saved connection or tile. Record valid
   empty data separately from authentication failure; empty-only proof is partial.

6. **Exercise preservation.** Snapshot non-secret resource IDs/options in the test
   instance, including an unrelated manual integration/widget and, where relevant,
   another owned binding in shared Stats/Calendar. Rerun peer/Homarr Setup: IDs
   stay stable, counts do not grow, valid keys are reused. Change/revoke only the
   fixture's credential through its owner; show targeted failure, recovery and
   preserved Homarr IDs. Remove only the peer through self-host and rerun Homarr:
   its owned connection/bindings disappear, unrelated resources and remaining
   shared entries survive. Probe a manually created same-kind/same-Address
   collision: baseline matching can adopt it, so stop for the shared ownership
   decision rather than treating a match as permission. An absent peer must not
   receive an integration attempt; installed/unready peers retain an actionable
   wait. Baseline waiting rows are not proof of a connection attempt.
   **Done:** rerun, changed-key, removal, collision and readiness outcomes are
   accounted for; close only this browser session with `agent-browser close` and
   clean up only the approved fixture's resources. Report any blocked case.

7. **Deliver a bounded proof.** Record self-host source SHA and binary SHA-256,
   Homarr/peer versions, upstream source SHAs, runtime image IDs and repository
   digests (including dependencies; note unavailable fields), platform, fixture
   value, redacted debug/native/widget observations, lifecycle outcomes and owned
   cleanup. Hash any evidence files. State exactly what remains unverified.
   Use the repository gate for code changes; docs-only delivery checks links and
   `git diff --check`, without Docker/browser runs or the heavy Go gate.
   **Done:** the PR links reproducible evidence at its tested revision and names
   any remaining #262 contract update; declarations are never called live proof.

## Current source checkpoints

Baseline: self-host `5aafb4c1833fd4cd9caf0f7beaac31e625aafe22` (11 October 2026).
Refresh these facts when implementing; they are not the pending #262 contract.

- [`homarr.go`](../../internal/apps/homarr/homarr.go) uses mutable `:dev`, stores
  its own API key and manages Home. A tag or readiness Check is not compatibility.
- [`links.go`](../../internal/apps/homarr/links.go) matches connections by kind +
  internal Address, fingerprints credentials and records widget ownership;
  [`shared_widgets.go`](../../internal/apps/homarr/shared_widgets.go) shares
  Stats/Calendar. Connection adoption/removal is not fully ownership-safe.
- [`helpers.go`](../../internal/helpers/helpers.go) owns redaction and Check/Do;
  [`service.go`](../../internal/service/service.go) owns peer readiness and
  Project isolation; [`lifecycle.go`](../../internal/service/lifecycle.go) invokes
  consuming `Link.Remove`. Keep those boundaries intact.
- [`homarr-proof.md`](../homarr-proof.md) is scoped historical evidence, not proof
  of a new peer. Upstream v2.4.1 at `ebbd4876d25a51151444a009ab596e1154d62880`
  supplies [credential definitions][registry] and [widget support][widgets];
  inspect the revision matching the image actually exercised.

[guides]: https://homarr.dev/docs/integrations/
[contract]: https://github.com/ajnart/selfhost-skills/issues/262
[registry]: https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/integration.ts
[widgets]: https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/widget-integration-map.ts
