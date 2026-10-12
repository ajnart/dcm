# Audiobookshelf credential prerequisite for Homarr

Stage 1 only, 11 October 2026. Blocked by #262 for Homarr registry wiring,
supported-version reconciliation and complete lifecycle acceptance. The target
in `internal/apps/homarr/target_audiobookshelf.go` is deliberately not
registered. This is not a claim of a working Homarr widget.

## Implemented boundary

Audiobookshelf's own Setup still creates and verifies the shared Admin login as
the root account. It then creates a separate `self-host-homarr` administrator
with download, upload, media update, media deletion and e-reader creation
disabled. Full library/tag/explicit-content visibility is needed for complete
library counts. The random account password is never displayed or saved as a
browser login; the account is used through its API key.

This is the minimum role supported by Homarr's current native client, **not a
read-only account**. Audiobookshelf requires admin/root for online sessions, and
some administrative endpoints authorize by role regardless of the media flags.
The API key can therefore reach administrative APIs. Audiobookshelf v2.37.0's
key controller does not expose per-endpoint scopes. Do not give Homarr the root
token or describe the integration as read-only.

Setup creates an active key named `self-host Homarr`, omitting `expiresIn` to
make it persistent. The Project's existing secret boundary stores
`AUDIOBOOKSHELF_API_KEY`, `AUDIOBOOKSHELF_HOMARR_USER_ID` and
`AUDIOBOOKSHELF_HOMARR_API_KEY_ID`. A temporary login access token is used only
in memory for management requests, never saved as Homarr's credential.

Reruns fetch the account afresh and verify the saved key with authenticated
Audiobookshelf requests. No name-based adoption, permission overwrite or silent
key rotation occurs. A name collision, changed account, revoked key, lost
one-time key material or interrupted persistence stops with a Manual step.
Existing Projects without saved ownership can create the prerequisite only
when the reserved account/key names are unused. Repairing lost credential
material requires explicit person-approved recovery through the existing
Project secret boundary; there is no new secret-import CLI in this stage.

Fresh credential verification checks a non-expiring named API-key payload and
its saved key identifier, then asks the server to authenticate it. Payload
inspection is not signature validation; server authorization supplies that.
It verifies the returned account and the native client's data sources:

- `POST /api/authorize`: the exact owned active administrator and media flags.
- `GET /api/libraries`: an actual array, including a valid empty array.
- `GET /api/libraries/<id>/stats`: a present non-negative integral item count.
- `GET /api/me/listening-stats`: a present non-negative listening duration.
- `GET /api/users/online`: an actual session array, including an empty array.

Redirects, unauthorized responses, missing data fields and malformed responses
do not become empty datasets. This proves peer credential/data readiness, not
Homarr server-side access or rendered content.

## Proposed Homarr seam

`audiobookshelfTarget()` uses the existing `target` and `widget` types: kind
`audiobookshelf`, internal Address `http://audiobookshelf:80`, saved `apiKey`, and
one native `audioStats` widget. Library count, audiobook count, podcast count
and active sessions are enabled. Listening time defaults off because Homarr
reads the integration account's own listening history, not everyone's total.
The widget supports exactly one integration. Browser Addresses remain the
existing Link resolver's responsibility.

The #262 owner must register the descriptor and arrange a fresh call to
`audiobookshelf.VerifyHomarrCredential` before native connection acceptance.
No changes here touch `links.go`, shared widgets or the common registry.
The final contract must preserve manual integration/widget ownership and define
credential update/removal without treating an Address match as ownership.

## Verification and remaining acceptance

The existing Audiobookshelf Setup/rerun test now models account/key acquisition,
valid empty data, persistent reuse, malformed library data and fresh rejection
of a revoked key without replacing it. No new test cases or dependencies were
added. Local gate results are recorded in the draft PR.

No Docker, browser or installer was run in this source-only stage. Resume needs
an independently validated disposable Home folder, unique Compose Project and
ports, isolated agent-browser session, Telemetry disabled, and owned-only
cleanup. Record SHA and image digest, authenticate the native Homarr connection,
render meaningful controlled counts, then verify rerun, credential change,
manual-resource preservation and target removal. None is claimed complete here.

## First-party sources

Context7's monthly quota was exhausted; these pinned sources were checked:

- [Audiobookshelf v2.37.0 key creation/listing](https://github.com/advplyr/audiobookshelf/blob/v2.37.0/server/controllers/ApiKeyController.js).
- [Named key payload and expiration](https://github.com/advplyr/audiobookshelf/blob/v2.37.0/server/models/ApiKey.js).
- [Account creation and online-session authorization](https://github.com/advplyr/audiobookshelf/blob/v2.37.0/server/controllers/UserController.js).
- [Account permission defaults and role checks](https://github.com/advplyr/audiobookshelf/blob/v2.37.0/server/models/User.js).
- [Temporary login access tokens](https://github.com/advplyr/audiobookshelf/blob/v2.37.0/server/Auth.js).
- [Homarr v2.4.1 native API requests](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/audiobookshelf/audiobookshelf-integration.ts).
- [Native Audio Stats options](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/widgets/src/audio-stats/index.ts).
- [One-integration widget binding](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/widget-integration-map.ts).

The [old API documentation](https://api.audiobookshelf.org/) warns it is no
longer maintained; its login-token guidance is not a current persistent-key
contract. Homarr v2.4.1 is a source baseline, not a tested image in this stage.
