# Compatibility evidence bridge

Read-only source audit, 2026-10-03. No private trial checkpoints, credential
stores, handoffs, cookies, or screenshots were read. The explicitly approved
sanitized `/tmp/selfhost-homarr-evidence-20261003.IK27QK/README.md` says its
screenshots establish layout only, preserve loading/no-data states, and do not
prove healthy connections. No current per-app compatibility receipt exists.

## Existing boundaries to reuse

| Owner/source | Usable observation | What it does not prove |
| --- | --- | --- |
| `packages/cli/src/lib/shared-project-state.ts`, `shared-project.ts` | Exact shared project, immutable revision chain, manifest/record hashes, app units and selection fingerprints; image identities in the saved manifest | Fresh application setup, working accounts, functionality, or restart acceptance. A completed lifecycle checkpoint is not a full dimension pass |
| `packages/cli/src/lib/shared-unit-setup.ts` | Exact-owner runtime and effective recipe/image healthcheck observation; timestamped runtime result | Container health alone is not app-specific health or a core round trip. Current recipes cannot be substituted for the actual saved selection |
| `packages/cli/src/control-panel/setup-engine.ts:inspectFirstRunSetup` | Fresh app-owned read-only inspection and `adapter.ready` result, with private transport redaction | It explicitly keeps API-key authorization, functionality, and restart separate; it does not establish fresh-instance first run or replay chronology |
| `packages/cli/src/app.ts` document/photo/persistence handlers | Exact canary identity/digest, saved before-write checkpoints, verified bytes/OCR or photo round trip, separately approved stop/start chronology, timestamped persistence result | Console JSON omits complete recipe/service-image/verifier provenance. Existing private state must not be exported wholesale. `acceptanceVerified` is app-specific, not all five catalog dimensions |
| `packages/cli/src/immich-accept.ts:immichAcceptCommand` | Managed admin login, release and photo upload/retrieval with exact digest, then recoverable cleanup | Its older private acceptance artifact lacks checked date, recipe hash, all service images, implementation hash and restart evidence; do not promote it directly |
| `packages/cli/src/connect.ts`, `lib/service-links.ts` | Owner/revision/manifest-bound link CAS, verified peers, tested configuration and saved-resource readback | Current `ServiceLinkCheckpoint` contains owner/link/phase only: no timestamp, verifier hash, all peer images, complete selected-link inventory, or independent functional acceptance. Empty peer lists cannot prove independence |
| `packages/cli/src/shared-homarr.ts`, `lib/homarr-stack-seed.ts` | Redacted board/tile/Notebook/integration/widget structural readback | Status explicitly says runtime/rendered content unverified and connection not retested. New integration creation may test a connection, but existing-resource inspection does not; no real widget data or Homarr-origin reachability follows from structure |

`packages/cli/src/catalog-compatibility.ts` currently validates all catalog
apps/recipes and computes declaration hashes. It intentionally supplies no
receipts to `lib/catalog-compatibility.ts:scoreCatalogCompatibility`. Consequently
the full 94-app verified aggregate remains zero, meaning unverified, not failed.
Historical media harness reports cannot bridge different recipe/image/code
versions. The existing Paperless trial's DNS failure contradicts a current
success claim; preserve that observation instead of upgrading an old pass.

## Minimal trustworthy bridge

Add one narrow owner, proposed `packages/cli/src/lib/compatibility-receipts.ts`,
and one explicit orchestration entry, proposed
`packages/cli/src/compatibility-verify.ts`. These are proposed paths, not
implemented capabilities.

The orchestration entry binds an exact approved project/revision and a fresh
run before verification. It calls the production owners above through their
real transport, never accepts `--passed`, `--evidence FILE`, check booleans, or
test-injected fetch/runtime output. Account/round-trip/lifecycle mutations
retain their existing exact approvals. A read-only catalog command must never
implicitly start this workflow.

The receipt owner accepts internal typed verifier results, not arbitrary JSON:

```ts
type VerifiedRunObservation = {
  appId: string;
  dimension: CompatibilityDimension;
  runId: string;
  checkedAt: string;
  owner: { projectFingerprint: string; revision: number; manifestHash: string };
  recipeSha256: string;
  images: Record<string, string>; // every exact selected service tag@sha256
  subjectSha256: string;
  verifier: { id: string; sourceSha256: string; release: string };
  checks: { id: string; result: "pass" | "fail" | "not-run" }[];
  cleanup: "not-required" | "completed" | "pending";
};
```

The verifier computes identity/hash fields itself from the selected saved
contract and production implementation. It rechecks owner revision and actual
running image identities before publishing; a changed revision aborts rather
than mixing runs. Capture required first-run and replay chronology at execution
time; retrospectively reading `ready` cannot reconstruct fresh-instance proof.

The publisher writes a bounded sanitized artifact and receipt atomically into
an explicit evidence-only root, for example
`research/catalog-evidence/<run>/<app>/<dimension>.json`, never root `docs/`
(media runtime), `.sessions`, or a credential store. Artifact contents contain
only allowlisted observations/digests/results/timing; no credentials, raw API
payloads, environment, or private checkpoint copies. Keep lifecycle cleanup
pending visibly separate; failure to clean up cannot disappear in publication.

Use a reviewed evidence index binding receipt and artifact hashes, verifier
identity and provenance. The catalog loader reads only this trusted registry,
checks bounded regular-file/no-symlink ownership, hashes actual artifact bytes,
checks current version/subject/image freshness, then adapts complete live
passes to the existing `CompatibilityEvidence` interface. An unlisted JSON file
earns no points. Recipe/app filters still preserve the entire catalog denominator.

This is an operational trust boundary, not magic cryptographic proof: file
permissions and self-computed hashes cannot distinguish malicious edits by
the same owner. If untrusted submitted receipts must be accepted later, require
independent verifier attestation with a pinned public-key trust policy; do not
mistake a locally editable signing key or a claimed `kind: live` for independent
attestation. Until a trusted production publisher/review path exists, keep
receipt loading disabled.

## Required gaps before awarding points

- Derive compound subject hashes in one reusable helper. Setup must bind its
  engine/transport and adapter; Homarr its actual image, mapping, attachment
  and functional verifier; links both peer contracts/images plus link engine;
  restart the app-specific verifier. Current per-file declaration hashes alone
  cannot bind these complete operational contracts.
- Record all required checks in one dimension run with per-check outcomes.
  Only all-pass dimensions receive 20 points; readiness/structure/fixtures stay
  zero. The scorer now accepts a provenance-matching live failure with a
  nonempty unique subset of required check IDs, invalidating an older complete
  pass without pretending later checks executed. Success requirements remain
  unchanged. The trusted publisher must establish at least one real failed
  check in that subset and preserve per-check outcomes in its artifact.
- Add app-specific shared-owner core round trips and scoped restart proof
  where only standalone Immich/Paperless handlers exist. Do not infer shared
  acceptance by translating another owner's private checkpoint.
- Add actual Homarr-origin app reachability, native connection testing and
  applicable widget-data readback. Tile-only apps require only their truthful
  tile/reachability contract, not fictional native widgets. Missing native
  support is not itself a compatibility failure.
- Define the exact selected-link set and a reviewed independence contract for
  apps needing no links. No-link declarations or absent files are not proof.
- Preserve latest failures, stale histories, external prerequisites and
  incomplete cleanup explicitly. A newer failing health/DNS observation cannot
  coexist with an undifferentiated current-success label.

No immediate legitimate score increase follows from this audit. The minimal
next implementation is the trusted publisher plus one complete app/dimension
production verifier; meaningful aggregate improvement then requires approved
live acceptance across the full inventory, not broader declaration coverage.
