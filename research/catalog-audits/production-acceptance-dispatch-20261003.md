# Production acceptance dispatcher

`packages/cli/src/lib/shared-acceptance.ts` supplies an explicit production
begin/finish API for the shared owner. Public inputs contain no receipt files,
pass booleans, image observations or lifecycle evidence. The installed owner
derives the current contract, exact saved selection and actual runtime inventory.

Begin approval binds the owner, recipe, implementation, complete immutable image
inventory, evidence destination and existing acceptance chronology. The real
dispatcher recomputes that token under the owner mutation lock before writing
any checkpoint. It independently recomputes the acceptance subject from the
current executable/setup contracts and all saved owner app IDs. The bounded
private ledger validates exact nested runtime identities, phase consistency,
registry pointers and file identity; malformed chronology cannot authorize a
restart. The real
setup transport uses a separate acceptance ledger and still requires its exact
one-time HTTP action approval. ntfy writes only its random synthetic canary.
Repeated or uncertain publish attempts reconcile its saved topic instead of
republishing. No existing private checkpoint is promoted into evidence.

Finish has its own owner-bound approval. Its trusted owner executes only the
selected stop/start; the dispatcher persists attempts before mutations and
requires observed stopped state then a distinct running epoch. Uncertain
lifecycle attempts stop for inspection, without replay. Every service's actual
immutable image and owner identity is rechecked before transport and after the
restart. The app-owned verifier then checks exact persisted canary bytes.

Only ntfy's reviewed live/restart result mapping is enabled. A successful finish
publishes the three required checks through the existing sanitized, create-only
registry. Its canary is intentionally retained until cache expiry; no destructive
topic deletion occurs and the explicit cleanup policy remains in output.
The artifact contains identities and fixed results, never API payloads or secrets.
This is local operational provenance, not independent cryptographic attestation.

## Reachable CLI

`app shared acceptance-begin|acceptance-finish` now resolves the production
saved-owner status, private handoff references, mutation lock and exact selected
Compose lifecycle. Runtime inspection compares the container's actual image ID
with `docker image inspect` of the saved immutable image, not just its configured
image string. Missing app acceptance contracts return `blocked`.

The reviewed evidence destination is the owner-only sibling
`PROJECT_ROOT/selfhost-verification-PROJECT_ID`. It is created only after the
outer approval has been rechecked under the project lock. Keeping sanitized
evidence outside `.selfhost` preserves the publisher's exclusion of secret-state
roots. Default terminal output shows effects, services, images, cleanup and step
tokens; JSON carries the same review. First-run and acceptance checkpoint,
lock, cookie and approval identities are separate. Default first-run identities
remain unchanged.

ntfy finish retries only read-only subscription requests on brief connection or
502/503/504 startup failures (three two-second requests, 250 ms between attempts).
Public subscription, credential failure, missing messages and changed canary
bytes are not retried into success. No topic write is repeated for readiness.

## Limits

- The command is reachable, but its fixtures are not evidence that a live
  workflow passed. The CLI compatibility report does not yet consume this
  owner's published registry.
- Setup chronology records actual attempts, not fresh-account/login/resume
  acceptance. This dispatcher never awards setup, Compose, Homarr or links points.
- No live Docker, account, restart, network, deployment or private trial inspection
  was performed for this change. Focused fixtures establish source behavior only.
- Apps without a reviewed app-owned acceptance adapter remain blocked. All 94
  apps remain in the denominator; this source change earns zero live points.
- Interrupted lifecycle checkpoints require inspection. Publication CAS drift also
  fails closed; it cannot silently overwrite or combine evidence from another run.
