# Emby Link implementation and remaining acceptance

Source status, 13 October 2026 (before this docs update):
`76105871107f486a6b1d1a3db8818bc46ac49fa1`.
The descriptor is normalized to the Stats SDK and registered in `internal/apps/homarr/targets.go`. This establishes source
wiring only; native/rendered data, both installation orders and lifecycle
acceptance remain unproved. Earlier dated evidence retains its original scope.

Issue #276 starts from the committed #262 contract at `573a206e` and includes
the reference owner's later committed contract/readiness fixes at `cf8f04c0`.
`embyTarget()` is registered by the reference owner in `targets.go`; shared
registry and reconciliation remain custodian-owned.

## Contract

Emby remains pinned to `emby/embyserver:4.10.0.40`. Its first-owner wizard
is a retryable Manual step. Setup verifies the exact administrator identity,
administrator policy and authenticated `IsStartupWizardCompleted`; it never
calls `Startup/User` or `Startup/Complete`, creates an external account,
purchases Premiere or enables hardware privileges.

Setup creates one API key named `self-host Homarr`, stores it as
`EMBY_HOMARR_API_KEY` through `h.SetSecret`, and verifies authenticated
`/emby/System/Info` and `/emby/Sessions`. A valid saved key is reused. A
rejected saved key, duplicate/inactive named keys or an incomplete inventory
stop rather than rotating credentials. `EMBY_HOMARR_KEY_CREATED` records
creation intent before POST. A discovered unsaved named key is recovered only
with that Project's `pending` checkpoint; a name match without this checkpoint
stays Manual and is never silently adopted. An ambiguous request is never
replayed when discovery still finds no key. Inspect Security and restore the
saved key; only after confirming no key was created may the pending marker be
cleared through the Project secret boundary. Login sessions are not persisted
and are logged out. No credential goes in request query parameters.

The documented Emby key API exposes no per-endpoint permission scopes. A
dedicated revocable key is the supported Homarr alternative, not a claim of
read-only server enforcement. The first-owner administrator remains private.

Homarr v2.4.1 uses `http://emby:8096` server-side, independently of the
browser Address. Defaults are `mediaServer`, `mediaReleases` and shared Stats
metric `sessions`. This metric counts user sessions, including idle sessions,
excluding Homarr's own device; it is not active streams or library size.
Media Releases selects the first real user returned by `/Users/Public`, as
Homarr's tagged adapter does. No user ID is fixed or guessed. No visible
user means an actionable Manual step; Setup never changes user visibility.

The Link queries `widget.mediaServer.getCurrentStreams` with
`showOnlyPlaying=false` and `widget.mediaRelease.getMediaReleases`, rejecting
missing fields and failed integration results. Authenticated empty arrays
are valid empty states, not playback or nonempty-library proof.
The SDK checks `widget.stats.catalog` and forces one advancing refresh. The
pure Emby Stats callback requires `sessions` in `count` units with an explicit
nonnegative integer value; independently cached native sessions need not match.
Failed, stale, missing-value and no-op refreshes fail centrally.

## Verification boundary

Existing Emby tests cover dedicated key creation, stable reuse, a fresh
revocation check, no rotation on rejected credentials and the Manual owner
hint, real-ID selection and hidden-user rejection. Focused ownership fixtures
reject uncheckpointed user-key collisions, recover an interrupted Project
credential save without rotating the created key, and reject a pending
creation replay when inventory has no key. These are fake-HTTP checks,
not native functional proof. Official Emby documentation leaves the
`Auth/Keys` response type unspecified; the strict inventory fields must be
confirmed against the pinned image in that runtime batch.

Docker/browser execution is gated to the parent's next runtime batch. Exact
image digests, real owned media, disposable playback, rendered widgets,
both installation orders, restart, rotation, removal and reinstallation
remain unproved. Those acceptance checks remain required before merge.
No Premiere or hardware-transcoding result is claimed.

## Sources

- [Emby API-key authentication](https://dev.emby.media/doc/restapi/API-Key-Authentication.html)
- [Emby user authentication](https://dev.emby.media/doc/restapi/User-Authentication.html)
- [Emby key discovery](https://dev.emby.media/reference/RestAPI/SessionsService/getAuthKeys.html)
- [Emby key creation](https://dev.emby.media/reference/RestAPI/SessionsService/postAuthKeys.html)
- [Emby wizard completion DTO](https://dev.emby.media/reference/RestAPI/ConfigurationService/getSystemConfiguration.html)
- [Homarr Emby guide](https://homarr.dev/docs/integrations/emby/)
- [Homarr v2.4.1 adapter](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/emby/emby-integration.ts)
- [Homarr v2.4.1 Stats metric semantics](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/existing.ts)
- [Homarr v2.4.1 stream query](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/media-server.ts)
- [Homarr v2.4.1 releases query](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/media-release.ts)
