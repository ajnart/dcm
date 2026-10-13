# ArchiveTeam Warrior Link: source contract and deferred acceptance

## Scope and status

Issue #267, based on committed #262 reference `573a206e2b4a76574fd7e8cbd1f21c5a4c2fd37d`.
The descriptor is `archiveTeamWarriorTarget()` in
`internal/apps/homarr/target_archive_team_warrior.go`. The #262 registry owner
must add it to `targets.go`; this peer does not change the registry or shared
reconciliation. This is source and local-test evidence, not live acceptance.

## Verified source contract

- Homarr version: v2.4.1, source
  `ebbd4876d25a51151444a009ab596e1154d62880`, as required by #262.
- Warrior Catalog image pin:
  `atdr.meo.ws/archiveteam/warrior-dockerfile@sha256:19337aa9157e04f6cdb8f7c6f8c98e27d14efb0d9525334995fbdb036b95e1ca`.
  Existing image research identifies publisher label `20260917.01` and installed
  Seesaw source `bb6673d27a8717e13efe5d7deb3628349cd08585`. Neither image was
  started or inspected at runtime for this change; no tested runtime digest is claimed.
- Exact native integration and widget kind: `archiveTeamWarrior`.
  Native widget limit: one integration. The internal Address is
  `http://archive-team-warrior:8001`, independent of the browser Address.
- Upstream allows either an empty credential list or `username` and `password`.
  This App already configures Basic authentication with the shared Admin login;
  the descriptor uses both existing Project secrets, never the empty alternative.
  No new account/key is created or rotated. No scoped read-only key is supported
  by this source contract. Missing/rejected credentials fail with a Setup hint.
- The protected `/` handler verifies the login independently. `/index.html`
  is a static route upstream, so Homarr's connection test against that path is
  not credential or worker acceptance. SockJS handlers do not inherit the same
  protected handler in reviewed Seesaw source; authenticated header use is not
  proof that anonymous status transport access is denied. Keep private Access.
- The worker API is SockJS at the server root, not an invented REST statistics
  route. Own Setup/Check reads a bounded receive-only XHR transport using POST
  `/000/<random-session>/xhr`: open/heartbeat frames followed by actual
  `warrior.status` and `project.refresh` events. It sends no worker commands,
  project selection, settings changes, or archival work.
- `NO_PROJECT` plus an explicit null project is a valid idle worker, not proof
  of completed archival work. Missing status/project events and malformed/HTML
  payloads fail. `UNINITIALIZED` and `INVALID_SETTINGS` retain a retryable Manual
  step for nickname/HQ readiness. Transitional/unknown states remain unready.
  A running worker requires its project title, running status and item array.
- Homarr verification calls `widget.archiveTeamWarrior.getStatus` with the owned
  integration ID. It requires a recognized status, explicit project shape,
  timestamp, item array and nonnegative integer worker counts; unknown snapshots
  cannot pass because their fabricated default counts are zero.
- Defaults are the Warrior widget and shared Stats entries `running`,
  `completed`, `failed`. These are the exact tagged native provider keys.
  Counts describe items in the current snapshot, not lifetime archival totals.
  Bandwidth is optional upstream and is not invented when absent. No IDs are
  guessed and no external archive project is selected.
- Upstream maps `NO_PROJECT` to `No Project`, but its compact widget badge maps
  that display status to `unknown`; idle counts and no-project text still have
  meaning. A rendered idle badge is not asserted to say Idle.

## Local evidence

Before: own readiness accepted HTTP 200 from the web interface; no native
descriptor existed. After: own readiness requires protected login plus worker
events, and the unregistered descriptor declares supported widgets and native
data validation. The existing Setup/rerun fixture now supplies actual SockJS
event shapes for an idle worker; its rejected-login fixture still fails.

Passed with `GOFLAGS=-buildvcs=false`:

- `go test ./internal/apps/archiveteamwarrior/ ./internal/apps/homarr/`
- `go build ./...`, `go vet ./...`, `go vet -tags e2e ./e2e/`
- `go test ./...` without the Docker runtime build tag
- `go test -race ./internal/tui/ ./internal/activity/ ./internal/apps/archiveteamwarrior/ ./internal/apps/homarr/`
- `gofmt -l .` printed nothing; `bash -n install.sh` passed.

No dependency was added. Fixture output is synthetic local evidence, not a
real Warrior or Homarr API result. No new test files were added. Context7 was
quota-exhausted; official documentation and immutable upstream source were used.

## Acceptance blockers

Runtime is deferred to the parent phase. Registration, both installation orders,
late-peer readiness, retries, credential changes, stable owned IDs, shared Stats
preservation, removal/reinstallation and rendered native data still need approved
isolated lifecycle proof. Common ownership is reused from #262, not re-proven here.

Starting Warrior in idle mode still registers/updates Warrior HQ externally;
`SELECTED_PROJECT=none` is not offline. No Docker, browser, installer, real user
Project, protected files or external accounts were accessed. No download/upload
work was started. Live proof needs explicit outbound HQ approval or a verified
inert bootstrap with fail-closed egress. Do not enroll in a public archival job
merely to obtain nonzero counters. Record exact runtime versions/digests and
redacted evidence; unavailable upstream work remains a limitation.

## Sources

- [Official Homarr integration guide](https://homarr.dev/docs/integrations/archiveteam-warrior/)
- [Official Warrior documentation](https://wiki.archiveteam.org/index.php/ArchiveTeam_Warrior)
- [Tagged integration/auth definitions](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/integration.ts)
- [Tagged Warrior adapter](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/archive-team-warrior/archive-team-warrior-integration.ts)
- [Tagged native router](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/archive-team-warrior.ts)
- [Tagged native widget](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/widgets/src/archive-team-warrior/index.ts)
- [Tagged Stats provider](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/existing.ts)
- [Installed Seesaw transport/events](https://github.com/ArchiveTeam/seesaw-kit/blob/bb6673d27a8717e13efe5d7deb3628349cd08585/seesaw/web.py)
- [Installed Seesaw worker readiness](https://github.com/ArchiveTeam/seesaw-kit/blob/bb6673d27a8717e13efe5d7deb3628349cd08585/seesaw/warrior.py)
- [Installed Seesaw protected handler](https://github.com/ArchiveTeam/seesaw-kit/blob/bb6673d27a8717e13efe5d7deb3628349cd08585/seesaw/web_util.py)
- [SockJS XHR receive transport](https://github.com/mrjoes/sockjs-tornado/blob/master/sockjs/tornado/transports/xhr.py)
- [Existing image provenance and outbound limits](catalog/traps/archive-team-warrior.md)


## Shared Stats SDK normalization, source and focused HTTP evidence

The original branch history is preserved by forward merges of shared SDK
`0bf67c3c64c229af25f19c1b93264f19cc57a910` and additive metadata SDK
`d069339add5924f942ea6536f77d68e64b165df0`. No registry or common verification
implementation is changed by this peer.

The descriptor now uses a pure `statsSample` callback for `running`, `completed`, `failed`.
One common catalog/snapshot/forced-refresh sequence supplies the same values
validated by the leaf. Exact catalog units and value types are checked: counts.
Missing/null fields, invalid counts/units and no-op refreshes fail; legitimate
zeros remain valid. Common timestamp validation remains finite, positive and
advancing; this peer adds no invented clock policy.

Native protected login, actual receive-only worker events, configured identity/Manual readiness, recognized Homarr status, project shape, timestamp and item/count relationships remain unchanged. Stats values are validated without equating them to independently cached worker snapshots.

Units and selected provider keys were checked in immutable Homarr OCI source
`3d4150e59f600876b7e308f857b2f21572b75348`, using
`packages/integrations/src/stats/existing.ts` and, for Frigate,
`packages/integrations/src/stats/providers/frigate.ts`. This is source provenance,
not new image attestation.

Focused HTTP scenarios use the shared `statsFixture` through `verifyData`, with
the native verifier explicitly isolated, and assert one forced refresh for the
owned integration. They cover valid empty/populated samples, invalid selected
values/units and refresh no-op rejection. App and Homarr affected-package tests,
affected-package build/vet, changed-file gofmt and `git diff --check` passed.
No Docker, browser, installer or broad suite was run. These fixtures verify the
source interface; they do not claim real native/rendered acceptance.

#323 remains draft and #267 remains open. No project is selected or transfer started. HQ/provider actions and native/rendered lifecycle acceptance remain separate prerequisites; idle synthetic HTTP scenarios do not establish actual archival progress.
