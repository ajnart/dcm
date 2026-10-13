# Navidrome Homarr Link

## Source contract, not runtime proof

This slice implements #284 on the committed #262 reference contract.
The reference owner must register `navidromeTarget()` in `targets.go`;
this peer does not change the shared registry or reconciliation.
Prepared compatibility targets are `ghcr.io/homarr-labs/homarr:v2.4.1` and
`deluan/navidrome:0.64.0`. Source was checked against Homarr commit
`ebbd4876d25a51151444a009ab596e1154d62880` and Navidrome tag commit
`1072e9f7eb27faef740df5f0bd7fb18898aa650e`. Navidrome reports its release
as `0.64.0 (<build commit>)`; the version check accounts for that suffix.
No images were run or image digests independently observed in this lane.
The reference owner's cached image evidence identifies Homarr OCI revision
`3d4150e59f600876b7e308f857b2f21572b75348`, distinct from the tagged baseline.
Its integration router and credential definitions were compared with the
tagged baseline and are byte-identical. This is scoped source equivalence,
not Navidrome runtime acceptance or whole-image equivalence.

## Native activation: credential-safety hold #363

The shared [diagnostic Address privacy issue #363](https://github.com/ajnart/selfhost-skills/issues/363)
blocks this Link. Check/apply return retryable Manual before any Homarr or
Navidrome HTTP request, compatibility query, credential submission, mutation,
native widget query or Stats refresh. Do not manually create an integration
or bypass the hold. Standalone Navidrome regular-account Setup/Check and owned
Link removal remain separate and operational.

At recorded Homarr OCI-source revision
`3d4150e59f600876b7e308f857b2f21572b75348`, native Navidrome requests put
`u=username` and `p=password` in the query. A non-2xx response is retained in
`ResponseError.url`. The integration decorator sanitizes its own diagnostic
copy but rethrows an error containing the original cause. Media Server settling
logs that cause, recursive error/metadata formatting retains the Address, and
console logging is enabled. This inspected chain is unchanged at tag `v2.5.0`,
commit `ed7b4bc00a77945f733a421efca2a58563d0d351`. A valid direct probe and
regular credentials cannot prevent a later rejected native response.
This is source-confirmed risk; no rejected request, runtime logs or
built-image privacy attestation was run in this lane.

The shared HTTP fix proposed by [Homarr PR #7170](https://github.com/homarr-labs/homarr/pull/7170)
covers username/password query redaction. Activation still requires the complete
downstream logging-chain fix verified in the exact supported stable image,
image/version/source compatibility review and authorization. A local patch,
mutable latest tag or valid credentials do not clear the hold. A later verified
fixed version must own the activation gate; this leaf invents no version threshold.

The HTTP regression failed before the hold: both actual `add` and `linked`
paths made one provider request and did not return Manual. They now return
Manual with zero Homarr and provider requests. Prepared native/Stats validators
remain unchanged and their focused fixtures invoke them directly; those fixtures
are not native activation acceptance.

## Credentials and minimum-role limitations

Homarr's native `navidrome` kind requires exactly `username` and `password`.
It does not accept a Navidrome UI JWT, an API key, or a precomputed salted
Subsonic token in place of the password. Navidrome Setup preserves the shared
Admin login for administration and creates a dedicated regular account named
`self-host-homarr` through the pinned native `POST /api/user` route with
`isAdmin: false`. The account receives Navidrome's default libraries; Setup
never expands that access or changes another user. The consuming Link uses
only its Project-owned `NAVIDROME_HOMARR_USERNAME` and
`NAVIDROME_HOMARR_PASSWORD`, with native user ownership recorded in
`NAVIDROME_HOMARR_USER_ID`, through the existing private helpers boundary.
Credentials are persisted before creation so an interrupted response can be
recovered by login without creating a duplicate or rotating the password.
A conflicting existing user, lost/rejected credential or changed identity
requires account-preserving Manual recovery.

Fresh native login and `GET /api/user/{id}` must confirm the exact saved ID,
username, explicit `isAdmin: false` and accessible library IDs. The regular
JWT must receive HTTP 403 from the administrative `GET /api/library` route.
This is an authenticated, read-only scope probe; Setup and Check do not try
an administrative mutation as a verification step.

Before any native widget query, the Link reads `integration.byId` with
`{"id": integrationID}`. This requires Homarr full integration access and
returns `secrets` entries with `kind`, `value` and `updatedAt`: `username`
is a public string, while the private `password` value is `null`. The Link
requires the returned ID and kind, exactly those two credential entries,
and the public username to equal the Project's selected regular Homarr user.
It also requires the recorded owned integration ID and internal Address
`http://navidrome:4533`.
A missing/malformed identity or a different valid account stops as Manual
with instructions to restore this Link's owned integration to that regular
account. Matching library/session data cannot adopt another account. It does
not read, print or claim to compare the redacted password.

A regular Navidrome user can call all selected Subsonic endpoints without
administrator privileges. This uses the lowest supported native role, but
Navidrome has **no read-only account role or per-endpoint password scope**.
The account can still perform ordinary user operations such as playlist
edits, streaming and permitted personal-account changes. Native user
creation and library administration require an administrator. These limits
must not be described as a read-only credential.

Self-host probes authenticate with fresh `t = MD5(password + salt)` and `s`
in a POST form, with `u`, `v=1.16.1`, `c=self-host`, and `f=json`.
The password is not sent in these probes and credentials never enter their
request Addresses. Transport, parse and upstream errors are reduced to
fixed diagnostics without response bodies or credential-bearing query text.
All HTTP goes through helpers and follows no redirects.

**Upstream limitation:** Homarr v2.4.1 itself uses GET query parameters
`u`, `p`, `v=1.16.1`, `c=homarr`, and `f=json`. It does not implement salted
authentication. Its requests stay on `http://navidrome:4533` inside the
Project, separate from the browser Address. Do not publish or capture raw
Homarr/Navidrome request logs: upstream URLs may carry the password.
This implementation does not fix Homarr's upstream logging or transport.

## Useful data and widgets

Navidrome Setup and Check freshly read authenticated `ping`,
`getMusicFolders`, `getScanStatus`, `getAlbumList2`, `getArtists`, and
`getNowPlaying`. Accessible library IDs are discovered, not invented.
The scan must have completed without a recorded error. It is not started
by these probes. Empty music folders are valid only after a completed scan.

Standalone readiness is bounded to six Subsonic requests per probe and one
representative album page: `alphabeticalByName`, `size=1`, `offset=0`.
Its explicit `X-Total-Count` must be nonnegative; the page must contain one
schema-valid album when nonempty and no album when the total is zero.
Library, artist and session validation are shared with the consumer probe.
This verifies authentication and representative API/schema readiness within
the existing one-minute deadline, not complete library counts. No sampled
count is returned as Stats data, and readiness never pages through the full
album library. The persisted `homarr-api` step ID remains compatible; its
label names API readiness and its recovery hint names only Navidrome Setup.

The prepared native verifier requires complete counts through
`ReadHomarrData`: `alphabeticalByName`, 500 albums per page, at most 20
pages, reconciled against a stable `X-Total-Count`. Missing `songCount`,
missing payload objects, repeated albums, changing totals and truncated
pages fail instead of becoming zeros. Libraries over 10,000 albums fail
that consuming Link explicitly because the adapter truncates them; that
limit does not affect standalone Navidrome readiness.
Artists are counted from the ID3 index; song counts are summed per album.
These are library counts, not listening time or play counts.

Navidrome's exact `getArtists` failure code 70 with message
`Library not found or empty` is accepted only with an explicit zero album
count in the same accessible-library scope after authentication and library
discovery succeed. The completed scanner's `getScanStatus.count` sums songs
across every library, including libraries inaccessible to the regular user;
it must not determine whether that user's accessible libraries are empty. Scan
count/schema/completion checks remain, and missing or malformed successful
artist objects still fail. Account-scoped album/artist counts and the native
Homarr Stats provider keep their existing meanings.
`nowPlaying: {}` means zero sessions in the pinned API; an absent
`nowPlaying` object, failed request, or incomplete populated entry fails.

Default widgets are `audioStats`, `mediaServer` and shared `stats` entries
`artistCount`, `albumCount`, `songCount`. No `sessions` Stats metric exists
for this Homarr kind. Media Server shows all returned audio sessions,
without bitrate/location toggles: the adapter supplies neither playback
position nor a playing/paused state. No album/media selection is required.

The active Link stops at its privacy hold before any request. Its prepared native
verification retains saved regular Homarr identity/destination, freshly authenticated complete Subsonic
library/session readiness, `widget.audioStats.getStats` count semantics, and
`widget.mediaServer.getCurrentStreams` integration/session identifiers and audio
schema. Direct, native and Stats counts and session lengths are independently
sampled; their volatile values are not required to equal each other.
`verifyNavidromeStats` receives the shared SDK's one catalog-backed forced
advancing Stats sample. All three selected metrics require `count` units and
finite nonnegative integral values; album counts retain the 10,000-album bound.
Within each native/Stats sample, zero albums require zero songs and populated
albums require artists.
Explicit zeros and empty session arrays remain valid. The central timestamp rule
requires a finite positive advancing timestamp; this leaf adds no wall-clock
limit. Errors remain secret-safe.
Recorded IDs, ownership, shared widget preservation and removal use #262's
unchanged reconciliation. No user media, playback, artwork retrieval or
external music account is used by Setup or Check.

## Acceptance still required

No Docker, browser, installer, live media seeding, playback or lifecycle
mutation was run in this lane. Existing focused tests use an authenticated
fake with the pinned empty-library response, POST salted authentication,
and fresh Setup/Check requests. Existing test bodies verify:

- Standalone Setup/Check use six requests and one single-album page each
  for 10,001 albums; growing to 60,001 albums preserves that exact bound.
- The consumer rejects the oversized explicit total after four requests,
  but reconciles a supported 503-album library across both complete pages
  with actual artist/album/song/session counts.
- Authenticated empty-library readiness and complete consumer zeros remain
  valid; a null representative `songCount` fails after four requests rather
  than becoming a zero or successful readiness result.

The request-bound control failed before the correction and passed afterward,
without simulated delays. That earlier readiness correction added no test file,
function or named case.
Descriptor HTTP fixtures now invoke the real `verifyData` seam with the existing
`statsFixture`. They cover populated independently changing samples, zero counts
and empty sessions, invalid counts/units/catalog entries, the album bound, no-op
refreshes, saved account/destination/owned-ID Manual guards and malformed native
counts/sessions. Native failures acquire no Stats; semantic Stats failures use
one catalog and one forced refresh. Focused App/Homarr tests, build, vet and
formatting/diff checks are the source gate. Native adapter, Stats metrics and
nullable session schema were rechecked at OCI source revision
`3d4150e59f600876b7e308f857b2f21572b75348`. These fixtures are not functional,
rendered or lifecycle proof.

The focused regular-account fixtures also verify that Homarr never receives
administrator credentials, populated/zero native data reaches exactly one
Stats sample, role/identity/scope drift stops verification, creation-response
loss recovers without duplicate users, and missing/rejected secrets or a
conflicting existing user preserve all users and passwords. The native
user-create fixture denies an administrative mutation under the regular JWT.
That fixture is source-contract evidence, not a real-server denial proof.

The scoped-empty regression supplies global scan count 37 from an inaccessible
library while the selected regular user's library has zero albums and the
exact native empty-artist result. It fails before the scope correction and
passes afterward through complete Homarr reads and standalone Setup/Check.
Absent/malformed artists and empty artists alongside accessible albums remain
rejected. This is a source fixture, not native multi-library runtime proof.

After the parent accepts the bounded reference runtime, a separately
approved disposable Project must record resolved image digests and prove:

- Both installation orders, absent/unready peers, late-peer installation
  and retry after scan readiness.
- Owned small audio is scanned and the real Homarr Audio Stats, shared
  Stats and Media Server results render correctly. A disposable listening
  session needs explicit playback approval, not an invented session ID.
- Valid empty data versus missing fields, rejected credentials, unsupported
  versions and failed/unfinished scanning.
- Rerun/restart stability, credential changes without account changes,
  preservation of user-authored resources and other shared bindings, and
  removal/reinstallation without duplicates or stale bindings.

The regular-account role and selected-identity guards are source-validated.
No native runtime or rendered acceptance is claimed by this PR.

## Official sources

- [Homarr credentials](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/integration.ts)
- [Homarr saved integration response](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/integration/integration-router.ts)
- [OCI-revision saved integration response](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/api/src/router/integration/integration-router.ts)
- [OCI-revision credential definitions](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/definitions/src/integration.ts)
- [Homarr adapter](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/navidrome/navidrome-integration.ts)
- [Audio Stats options](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/widgets/src/audio-stats/index.ts)
- [Stats metrics](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/existing.ts)
- [Stats refresh](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/stats.ts)
- [Media Server query](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/media-server.ts)
- [Navidrome POST and authentication](https://github.com/navidrome/navidrome/blob/1072e9f7eb27faef740df5f0bd7fb18898aa650e/server/subsonic/middlewares.go)
- [Navidrome routes and roles](https://github.com/navidrome/navidrome/blob/1072e9f7eb27faef740df5f0bd7fb18898aa650e/server/subsonic/api.go)
- [Navidrome library/artist data](https://github.com/navidrome/navidrome/blob/1072e9f7eb27faef740df5f0bd7fb18898aa650e/server/subsonic/browsing.go)
- [Navidrome album/session data](https://github.com/navidrome/navidrome/blob/1072e9f7eb27faef740df5f0bd7fb18898aa650e/server/subsonic/album_lists.go)
- [Navidrome response schema](https://github.com/navidrome/navidrome/blob/1072e9f7eb27faef740df5f0bd7fb18898aa650e/server/subsonic/responses/responses.go)
- [Navidrome reported version](https://github.com/navidrome/navidrome/blob/1072e9f7eb27faef740df5f0bd7fb18898aa650e/consts/version.go)

- [Navidrome native user routes and administrative library guard](https://github.com/navidrome/navidrome/blob/1072e9f7eb27faef740df5f0bd7fb18898aa650e/server/nativeapi/native_api.go)
- [Navidrome native login identity and JWT](https://github.com/navidrome/navidrome/blob/1072e9f7eb27faef740df5f0bd7fb18898aa650e/server/auth.go)
- [Navidrome user schema](https://github.com/navidrome/navidrome/blob/1072e9f7eb27faef740df5f0bd7fb18898aa650e/model/user.go)
- [Navidrome user creation, role policy and default library assignment](https://github.com/navidrome/navidrome/blob/1072e9f7eb27faef740df5f0bd7fb18898aa650e/persistence/user_repository.go)

- [Navidrome global scan counters](https://github.com/navidrome/navidrome/blob/1072e9f7eb27faef740df5f0bd7fb18898aa650e/scanner/controller.go)
- [Navidrome scan-status response](https://github.com/navidrome/navidrome/blob/1072e9f7eb27faef740df5f0bd7fb18898aa650e/server/subsonic/library_scanning.go)
- [Navidrome default-library selection](https://github.com/navidrome/navidrome/blob/1072e9f7eb27faef740df5f0bd7fb18898aa650e/server/subsonic/helpers.go)

- [Navidrome native query and rejected response](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/navidrome/navidrome-integration.ts)
- [ResponseError retains the response Address](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/common/src/errors/http/response-error.ts)
- [Decorator sanitizes one copy and retains the cause](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/base/errors/decorator.ts)
- [Media Server integration settling](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/api/src/settle-integrations.ts)
- [Media Server native query](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/api/src/router/widgets/media-server.ts)
- [Recursive error formatting](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/core/src/infrastructure/logs/format/error.ts)
- [String metadata formatting](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/core/src/infrastructure/logs/format/metadata.ts)
- [Console and conditional Redis transports](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/core/src/infrastructure/logs/transports/index.ts)
