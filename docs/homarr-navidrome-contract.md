# Navidrome Homarr Link

## Source contract, not runtime proof

This slice implements #284 on the committed #262 reference contract.
The reference owner must register `navidromeTarget()` in `targets.go`;
this peer does not change the shared registry or reconciliation.
Supported images are `ghcr.io/homarr-labs/homarr:v2.4.1` and
`deluan/navidrome:0.64.0`. Source was checked against Homarr commit
`ebbd4876d25a51151444a009ab596e1154d62880` and Navidrome tag commit
`1072e9f7eb27faef740df5f0bd7fb18898aa650e`. Navidrome reports its release
as `0.64.0 (<build commit>)`; the version check accounts for that suffix.
No images were run or image digests observed in this lane.

## Credentials and minimum-role limitations

Homarr's native `navidrome` kind requires exactly `username` and `password`.
It does not accept a Navidrome UI JWT, an API key, or a precomputed salted
Subsonic token in place of the password. The Link reuses the shared Admin
login through helpers; it creates no extra identity, changes no account and
rotates no credential. Existing first-admin Setup still preserves conflicting
accounts and offers its account-preserving recovery hint.

A regular Navidrome user with accessible libraries can call the selected
Subsonic endpoints; administrator privileges are not required by the
Homarr adapter. This slice deliberately reuses the existing Admin login
rather than creating an account. It is therefore **not a least-privilege
read-only identity**: Navidrome has no per-endpoint credential scope for
these user/password requests. Its user-creation Subsonic endpoints are not
implemented. Creating or changing a dedicated account requires separate
approval and is not performed here.

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

Album paging matches Homarr's `alphabeticalByName`, 500 per page and
20-page limit. `X-Total-Count` is required and reconciled with the returned
albums. Missing `songCount`, missing payload objects, repeated albums,
changing totals, and truncated pages fail instead of becoming zeros.
Libraries over 10,000 albums fail explicitly because Homarr truncates them.
Artists are counted from the ID3 index; song counts are summed per album.
These are library counts, not listening time or play counts.

Navidrome's exact `getArtists` failure code 70 with message
`Library not found or empty` is accepted only with explicit zero album
and scan counts after authentication and library discovery succeed.
`nowPlaying: {}` means zero sessions in the pinned API; an absent
`nowPlaying` object, failed request, or incomplete populated entry fails.

Default widgets are `audioStats`, `mediaServer` and shared `stats` entries
`artistCount`, `albumCount`, `songCount`. No `sessions` Stats metric exists
for this Homarr kind. Media Server shows all returned audio sessions,
without bitrate/location toggles: the adapter supplies neither playback
position nor a playing/paused state. No album/media selection is required.

The Link preflights the direct API before any Homarr mutation, then compares
authenticated direct counts with
`widget.audioStats.getStats`, force-refreshes `widget.stats.refresh`
and checks its error/freshness markers and values, then checks
`widget.mediaServer.getCurrentStreams` against the direct session count.
Errors are kept secret-safe. Homarr audio/session caches can briefly lag
library or session changes; retry once the source and caches settle.
Recorded IDs, ownership, shared widget preservation and removal use #262's
unchanged reconciliation. No user media, playback, artwork retrieval or
external music account is used by Setup or Check.

## Acceptance still required

No Docker, browser, installer, live media seeding, playback or lifecycle
mutation was run in this lane. Existing focused tests use an authenticated
fake with the pinned empty-library response, POST salted authentication,
and fresh Setup/Check requests; they are not functional acceptance.

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

No runtime acceptance or least-privilege identity is claimed by this PR.

## Official sources

- [Homarr credentials](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/integration.ts)
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
