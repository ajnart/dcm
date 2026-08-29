# Generation 5 - fresh-run acceptance and evidence hardening

Status: **COMPLETE — `luna-g5-b` promoted after root browser audit on
2026-08-29; `luna-g5-a` is a non-survivor.**

## Hypothesis

Two fresh isolated Luna MAX runs should reproduce the full media stack, Homarr
configuration, and read-only MCP path from the packaged skills. Promotion still
requires independent browser evidence: core and MCP success cannot hide a real
widget authentication failure.

## Common results

Both candidates ran the exact local Homarr image
`ghcr.io/homarr-labs/homarr-test:v2` with image ID
`sha256:ca009d53e63075b697ab770044cda7fa3f98154fb6190048050d688d3cbe878b`.

| Gate | `luna-g5-a` | `luna-g5-b` |
| --- | --- | --- |
| Fresh isolated Luna MAX run | PASS | PASS |
| Seven containers | PASS | PASS |
| Core verifier | PASS | PASS |
| Six Homarr integrations and apps | PASS | PASS |
| MCP authentication | PASS | PASS |
| Curated Date-schema fallback | PASS | PASS |
| Seerr Jellyfin/Sonarr/Radarr graph | PASS | PASS |
| Stdio read-only search | PASS | PASS |
| Browser acceptance | FAIL | PASS |
| Promotion | rejected | winner |

Neither candidate created a media request, started a download, or installed a
client.

## Candidate A - rejected

`luna-g5-a` reached the API-key modal but the agent stalled. The supervisor
piped the hidden key securely without recording its value. The core and MCP
gates then passed, but the live UI showed a real Jellyfin invalid-token widget
failure. Redacted logs independently confirmed the failure.

A management update attempted to use the onboarding integration ID where a
cuid2 was required, so validation rejected it. Passing core and MCP evidence did
not compensate for the failed widget acceptance: A is not a survivor and was
not promoted.

The agent stalled before returning an action ledger, so A's meaningful-action
count is unavailable. A is disqualified from the fitness comparison instead of
being assigned an estimated count.

## Candidate B - promoted

`luna-g5-b` reported approximately 100 meaningful actions. No reliable
per-service breakdown survived, so this report leaves that breakdown
unavailable instead of inventing counts. Root treated B's initial no-failure
claim as unverified until the supervisor independently proved the Seerr graph
and Homarr browser structure.

The redacted Seerr API evidence showed:

- `/settings/jellyfin` returned status 200 with `ip: jellyfin`, port `8096`, no
  SSL, and exactly the enabled Movies and Shows libraries;
- `/settings/radarr` returned status 200 with exactly one record using hostname
  `radarr`, port `7878`, default true, 4K false, and the expected profile, root,
  automatic-search, and sync fields;
- `/settings/sonarr` returned status 200 with exactly one record using hostname
  `sonarr`, port `8989`, default true, 4K false, and the expected standard and
  anime profiles and roots, season folders, automatic-search, and sync fields;
  and
- `.sessions/luna-g5-b/artifacts/seerr-connections.png` directly shows the
  default Radarr and Sonarr internal hosts and selected profiles.

The final core verifier also matched all three host-facing loopback URLs and
both stored Arr keys, then used only read-only persisted-credential GETs:
Jellyfin returned one user, and the exact Radarr and Sonarr service IDs returned
nonempty profile and root-folder details. No caller-supplied connection-test
body or settings mutation was used.

Exactly six generated Homarr tiles were present, and the app-ping batch returned
a non-error envelope. The supervisor recorded these seven sanitized widget
proof rows after reload:

| Method and sanitized path | Status | Response-envelope error |
| --- | ---: | --- |
| `GET /api/trpc/widget.indexerManager.getIndexersStatus` | 200 | false |
| `GET /api/trpc/widget.downloads.getJobsAndStatuses` | 200 | false |
| `GET /api/trpc/widget.mediaRequests.getStats` | 200 | false |
| `GET /api/trpc/widget.mediaServer.getCurrentStreams` | 200 | false |
| `GET /api/trpc/widget.calendar.findAllEvents` | 200 | false |
| `GET /api/trpc/widget.mediaOrganizer.getData` | 200 | false |
| `GET /api/trpc/widget.mediaRelease.getMediaReleases` | 200 | false |

The `mediaRelease` response reported `releases.length === 0` and
`failedIntegrations.length === 0`. The full screenshot is
`.sessions/luna-g5-b/artifacts/generation-05-board.png`.

B's candidate-reported recoveries were a sticky footer that intercepted an
action, stale accessibility references after page changes, one incorrect URL,
a widget retry, and repeated environment-launch attempts. The supervisor then
reconciled the committed-but-error app update and replaced B's unsupported
widget-success claim with the fixed structural proof above. The approximate
total is retained for history, but B is promoted on correctness rather than an
action-count comparison with A.

B was promoted only after those checks. Its stack remains running at this
checkpoint.

## Evolutionary reductions

Generation 6 candidates inherit these deterministic reductions:

- resolve every host URL once through `session.sh urls` and never transcribe a
  port from another run;
- refresh accessibility references after each navigation, modal, or saved
  form, and use the documented focused Enter fallback when a sticky footer
  intercepts a click;
- use the direct agent-browser executable first and the fixed mise fallback
  only after direct `ENOENT`, instead of retrying environment launches;
- reconcile the known Homarr void-response failure by exact fresh app state,
  rather than replaying already-committed updates blindly; and
- replace widget retry or visible empty-state inference with one post-reload
  fixed seven-procedure structural proof.

The missing A ledger and B per-service breakdown prevent a trustworthy numeric
before/after step reduction for this generation. That optimization evidence is
explicitly incomplete; the next generation must emit the fixed per-service
numeric summaries before promotion.

## Finalizer recovery

The fresh runs exposed an upstream void MCP-response failure: an app update
could commit successfully and then report failure. A rerun therefore encountered
already-updated state and advanced farther through the apps.

The harness now reconciles an update error against fresh app state. It accepts
the mutation only when the exact app ID and every submitted writable field —
name, description, icon, navigation URL, and ping URL — match the requested
values. If state cannot be read or any value differs, it preserves the original
error and fails closed.

## Evidence security

A raw authenticated browser-console diagnostic exposed a Jellyfin access token.
The token is not reproduced or retained here; that diagnostic is prohibited
candidate behavior and is not evidence. During the independent audit, the
supervisor also created a unique owner-only temporary B trace outside candidate
execution. Its contents were never surfaced or treated as candidate evidence,
and it was deleted immediately. Future supervisor traces require explicit
authorization before capture.

Future candidates must not invoke, print, or persist raw authenticated console,
network, HAR, or trace output anywhere. Browser evidence reports only the fixed
sanitized tRPC fields required for acceptance.

## Promoted genome

- Require fixed sanitized tRPC evidence for all seven expected read-only widget
  procedures.
- Ban raw authenticated browser-console and HAR output.
- Reconcile a failed finalizer mutation against exact app state, and fail closed
  when that state does not prove the mutation committed.
- Keep browser acceptance mandatory even when core and MCP verification pass.
- Preserve the prohibition on media requests, downloads, and client installs.
