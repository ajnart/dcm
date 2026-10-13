# Combined Homarr test: inspection queue

## Confirmed result

Project `aggregate-5iy1oywq` ran for 663.646 seconds through supervised cleanup. Install exited 2. Actual caps: 51 containers, 27 GiB, 15.75 CPUs, 512 PIDs each. Peer Setup: 24 complete, 5 Manual, 5 incomplete. Homarr recorded 23 successful Link steps: 19 with a non-nil verifier, 4 stage-1 nil-verifier leaves. No independently captured native values or rendered values; browser startup refused an overlong UNIX socket path. Immich's database recorded an OOM flag. All 51 owned containers and one network were removed; browser inactive; data/images preserved.

The parent verified 22 public/source/redacted artifact hashes. `effective-compose.json` was deliberately not read or rehashed because it may contain private fixture inputs. Aggregate smoke does not change accepted native/lifecycle coverage, currently 1/39.

## Shared read-only inspector brief

Each inspector owns exactly one App's evidence review, not its implementation. Read the root `CONTEXT.md`, `docs/agents/domain.md`, relevant ADRs, and the native workflow at `.slim/worktrees/homarr-coverage-status/docs/agents/homarr-integrations.md`. That workflow is absent in the current root and frozen aggregate checkout; do not create/copy it. Aggregate runtime limits were separately approved; the workflow's normal small-Project limits are not additive or permission for new runtime.

Canonical tested source: `.slim/worktrees/homarr-aggregate-eval/`, frozen HEAD `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c` plus allowlisted production deltas. Source manifest: `<OLD_ARTIFACT_ROOT>/homarr-aggregate-launcher-fixed-guard-980r9gb7/manifest.final.json`. Use the exact App pin from the tested result, not older ticket-index heads or concurrent main.

Evidence root: `<OLD_ARTIFACT_ROOT>/homarr-aggregate-run-5iy1oywq/`.

Allowed reads: `summary.reconciled.final.json`, only your App's row in `per-app-results.reconciled.final.json`, relevant excerpts of `install.redacted.log`, `status.redacted.log`, `debug-homarr.redacted.log`, public image provenance, captured resource metadata, cleanup/readback, and the source manifest. Use targeted JSON projections or searches rather than dumping the entire 39-App result. Never read the retained Project/Home/data/browser directories, secrets/env files, credentials, raw effective Compose, user profiles, or unredacted logs. Do not reconstruct masked secrets or numeric data.

No edits, commits, tracker comments, builds, tests, Docker/engine calls, browsers, network/provider jobs, or independent runtime attempts. Preserve existing Projects, all retained artifacts, peer branches and source. No new tests or hypothetical scenario matrices.

Report at most 180 words: observed Setup and Link outcome; what the actual step/source contract proves and what is still unobserved; classify an observed failure as a demonstrated bug, expected Manual/privacy/provider hold, resource/harness problem, or unresolved evidence gap; cite exact source/artifact lines. For unresolved failures, give the smallest falsifiable next probe, not a speculative fix. For demonstrated defects, identify the minimal owned-file correction and original owner handoff. A successful recorded verifier is not independent saved-record enumeration, rendered data or lifecycle acceptance. Four nil-verifier leaves remain source-stage. All five startup exclusions remain intentional and untested, not failures. No follow-up runtime is authorized.

## Queue

One inspector per each of the 39 Apps, in bounded waves. Maximum 12 active workers includes the retained custodian's source-only browser runner correction and any later reviewers. All use `openai/gpt-6.1-sol#xhigh`. Only original peer owners may later implement verified fixes; the custodian alone owns shared runner/registry/Project mutations.

| App | Issue | PR | Observed own Setup | Inspection |
| --- | --- | --- | --- | --- |
| Home Assistant | #285 | #333 | incomplete | done: exec evidence gap `ses_ece803881ffekArc34HT2rBn9r` |
| Immich | #262 | #309 | incomplete; database OOM flag | done: lower harness caps; causality unresolved `ses_ece80387fffe3ktYJaWI1lFW58` |
| NZBGet | #290 | #335 | incomplete | done: exec/save evidence gap `ses_ece80387dffe9BsXHn6NU57pzd` |
| PatchMon | #291 | #345 | incomplete | done: startup evidence gap `ses_ece803867ffexZYUEryFXaTXI4` |
| Tracearr | #302 | #346 | incomplete | done: API-version evidence gap `ses_ece803866ffeQT4RPcjG8I2drS` |
| Emby | #276 | #322 | Manual | done: expected first-owner hold `ses_ece803864ffeVMrLI2fuqOn806` |
| PeaNUT | #293 | #347 | Manual | done: expected NUT/UPS hold `ses_ece80384affefYFm8YH1XnTvNs` |
| SABnzbd | #298 | #334 | Manual | done: expected provider hold `ses_ece803849ffeRPHIxyT10lUSgB` |
| Speedtest Tracker | #296 | #351 | Manual | done: expected measurement hold `ses_ece803839ffe0Dj7rorrkrDwdk` |
| Uptime Kuma | #307 | #341 | Manual | done: expected admin/status-page hold `ses_ece803838ffek0WW2fyPtYZf16` |
| Frigate | #277 | #331 | complete; native Link Manual | done: expected TLS hold; persisted hint defect `ses_ece803837ffeXl6Hpog6p0GIvr` |
| AdGuard Home | #266 | #311 | complete; nil verifier | done: native verifier gap `ses_ece7e5a95ffeitJSd281VB7KLg` |
| Aria2 | #269 | #317 | complete; nil verifier | done: native verifier gap `ses_ece7db170ffefUehSN712TudKJ` |
| Audiobookshelf | #270 | #310 | complete; nil verifier | done: native verifier gap `ses_ece7db145ffe7WsEKSGDUr4PUg` |
| Paperless-ngx | #289 | #312 | complete; nil verifier | done: native verifier gap `ses_ece7db143ffeiXm7odAUqJ4kYf` |
| Bazarr | #272 | #320 | complete | done: recorded useful-data checks; evidence gap `ses_ece7db141ffeFrdLYHgXTYGvaw` |
| Caddy | #273 | #315 | complete | done: recorded useful-data checks; evidence gap `ses_ece7d1b0dffeG3325KifmN8njr` |
| Dash. | #274 | #319 | complete | done: recorded kernel checks; evidence gap `ses_ece7d1b0cffeHj2wBkzAXl6sJs` |
| Deluge | #275 | #324 | complete | done: recorded useful-data checks; evidence gap `ses_ece7c6846ffesvXIFPvof7Vabg` |
| Gatus | #280 | #321 | complete | done: recorded useful-data checks; evidence gap `ses_ece7c6845ffemfJ2IlXb9f0Fhy` |
| Glances | #281 | #326 | complete | done: recorded available-resource checks; evidence gap `ses_ece7c6826ffe61630e6wZBeGZI` |
| Gotify | #282 | #325 | complete | done: recorded scoped Notifications checks; evidence gap `ses_ece7be086ffe0KO2aG6jbPZR2i` |
| Lidarr | #283 | #318 | complete | done: recorded calendar/music checks; evidence gap `ses_ece7b5765ffeFKORiHuK1V357N` |
| Linkwarden | #286 | #328 | complete | done: recorded native checks; broad Admin authority `ses_ece7b5763ffep1kQzn6gU0kNzt` |
| Navidrome | #284 | #330 | complete | done: recorded audio checks; transport/scope limits `ses_ece7ab648ffeZQjEmwo0dlzpuW` |
| Netdata | #287 | #329 | complete | done: alarms/agent pulse checks, not RAM/Host `ses_ece7ab646ffeUghHOvi0DbAAOd` |
| Nextcloud | #288 | #340 | complete | done: calendar/notifications checks; broad Admin authority `ses_ece7ab642ffeH9BNAWC6iyvLSw` |
| Pi-hole | #292 | #339 | complete | done: recorded app-password/native checks; evidence gap `ses_ece7a5016ffevE5KiCEqjOth2J` |
| Prometheus | #299 | #336 | complete | done: starter targets/samples checks; Basic mode unobserved `ses_ece7a5015ffec4nRP3SXIhT4UO` |
| Tdarr | #301 | #349 | complete | done: connected node, disabled workers; evidence gap `ses_ece79c3a8ffeqxfbXG9KJDvf7o` |
| Technitium DNS | #303 | #338 | complete | done: effective permissions/LastHour/Stats checks `ses_ece79c37fffeFHXWK8D9mBmNmI` |
| Traefik | #304 | #352 | complete | done: protected API/native checks; evidence gap `ses_ece79c374ffeYvpi3jwD1NPg9C` |
| Transmission | #305 | #337 | complete | done: recorded full-control RPC/native checks; evidence gap `ses_ece7619ceffeHaRPqRXiTi9klU` |
| Umami | #308 | #344 | complete | done: isolated website native checks, no shared Stats `ses_ece7619a3ffev3Uey474y0QbTh` |
| Gluetun | #279 | #327 | startup held | done: expected hold; missing pre-mutation guard `ses_ece7619a2ffeAUBUqjSF1Ca7Ew` |
| Plex | #294 | #348 | startup held | done: expected account/ownership hold `ses_ece7619a0ffe436BDlpEcCf6mZ` |
| Slskd | #297 | #342 | startup held | done: expected Soulseek/provider hold `ses_ece76199fffe6nItFq3ng3VJ8C` |
| ArchiveTeam Warrior | #267 | #323 | startup held | done: expected HQ/archival approval hold `ses_ece761975ffexdLdYLZNSNv6uv` |
| What's Up Docker | #306 | #343 | startup held | done: expected scoped discovery/registry hold `ses_ece761974ffehXl6u0tTvfJyd5` |

## Active shared runner lane

Retained custodian `ses_ed3721f29ffertBzXIvNI7A7dC` completed source-only browser IPC correction: **181 → 99 bytes**, metadata inactive/no PID/no socket; Python syntax/diff passed. Archive `homarr-aggregate-browser-ipc-elczqo8i/result.json` under the approved temporary directory. Supported `AGENT_BROWSER_SOCKET_DIR` points at a fresh owned short directory; namespace/session both `b`. No browser startup, engine call or retry. Copied Project plan is consumed and must not launch as-is. Custodian confirmed there were no per-peer debug/log captures in the actual run.

Custodian resumed **Improve failed-attempt evidence capture**, source-only: bounded synthetic public-argv predicate probe; minimal existing CLI diagnostics before owned cleanup in a future fresh runner; propose but do not apply the Frigate per-App hint patch. No private fixture reads or runtime. Earlier archives/result/source/binary/manifest remain immutable. **39/39 inspections complete; none queued.** Each handled PR and Immich issue #262 linked immediately.

Oracle `ses_ed39285f8ffeJ891XQT5kqvFPq` **accepted the phase and approved the narrow SOURCE-only repairs/completions**, with redaction before artifact writes, supported saved/native identity/units/empty states, central freshness, no invented causality or cap increase, original ownership and fresh reviews before merge. Follow-up runtime still needs fresh exact plan and person approval.

**Active 0 — paused after cancellations.** Prepared runner safety oracle also cancelled without a final verdict. Home Assistant, AdGuard and Paperless lanes cancelled with clean unchanged source and no verified completion; held, not automatically relaunched. Final Aria2 Standards/Spec both PASS0 closed P3/P2; final Audiobookshelf and Frigate hint pairs also PASS0. No underlying aggregate auth/save/startup/version failure or live sampling fix claimed verified. Do not treat the earlier source-phase plan approval as approval of the subsequently prepared runner, restart policy or allocation. No new source assembly/runtime advanced as if cancelled work succeeded.

## Reconciled findings

- All five own-Setup Manual outcomes are expected boundaries, no demonstrated defect: Emby first-owner wizard; Uptime Kuma browser administrator and later existing intentional status-page slug; PeaNUT owner-selected NUT/UPS readings; SABnzbd enabled provider configuration; Speedtest usable completed measurement with separate bandwidth approval. Do not force these green or trigger their providers/hardware/publication/measurement actions.
- Frigate correctly stops before mutation for HTTP-versus-trusted-HTTPS. Demonstrated diagnostic defect: its detailed TLS recovery remains in informational logs, but persisted Manual `Hint` comes from generic `t.hint`, which merely suggests manual integration creation. Parent verified the existing selection in `links.go:1143–1147` and leaf preflight logging. Queue narrow existing per-App hint correction with the exclusive common custodian after its active browser fix; no TLS/auth bypass or helper redesign.
- Home Assistant: `homarr.go:42–49` loses the underlying `h.Exec` diagnostic. The command log proves invocation, not Python execution. Runner checks private argv before Docker. A source-only public-argv predicate probe is the smallest next step; no demonstrated authentication defect.
- NZBGet: restricted-login persistence fails before provider/native #354. `homarr.go:194–229` drops the diagnostic even though existing `ExecSecret` returns a redacted error. Parent verified that boundary and `helpers.go:238–245`. Original owner may preserve that sanitized error; this is diagnostic quality, not a proven fix to the underlying save failure. #354 remains held.
- Immich: unchanged accepted image/source used smaller aggregate database/Valkey/CPU caps than the 1-GiB/1-CPU-per-container reference. Database OOM flag plus running/exit-zero snapshot is not a timestamp-aligned causal proof. No reference regression established; startup/OOM chronology is missing.
- PatchMon: declared/captured 3000 listener mapping agrees, dependencies running with no OOM; readiness connection refused does not establish a live server. Startup logs/listener evidence absent. The runner's `restart:no` differs from source but causal effect is unproven. #350 was not reached and is not this failure's demonstrated cause.
- Tracearr: source and image reference are 2.6.0; rejection occurred at authenticated top-level `version` equality. Actual response field/value and digest-matched OCI metadata were not captured, so do not weaken the version gate or invent a corrected selector/pin.
- Four stage-1 leaves have nil verifiers: AdGuard, Aria2, Audiobookshelf, Paperless. Own credential/API Checks succeeded and native resources are declared, but `verifyData` immediately returns and performs no semantic native/fresh Stats verification. Original owners retain these leaf completion tasks; no percentage inversion or unsupported-native defect was demonstrated. Audiobookshelf retains broad administrator authority, not fully read-only.
- Bazarr, Caddy, Dash., Deluge, Gatus and Glances recorded real non-nil leaf and common advancing-Stats checks. Their success is more than a request/tile acknowledgement, but independent values, rendering and lifecycle remain absent; no corrective edit is demonstrated by these logs.
- Gotify, Lidarr, Linkwarden, Navidrome, Netdata, Nextcloud, Pi-hole, Prometheus, Tdarr, Technitium DNS and Traefik also recorded non-nil native/common freshness checks without demonstrated App defects. Preserve specific limits: Linkwarden/Nextcloud retain broad Admin authority; Navidrome downstream query-secret privacy is not established; Netdata checks alarms and agent pulse CPU, not RAM/Host; Prometheus Basic mode not observed; Tdarr has a connected node with workers disabled, not hardware/transcoding acceptance; Technitium direct native summary is not separately queried by its leaf. No independent native/render/lifecycle evidence captured.
- Transmission also recorded authenticated full-control RPC/native Downloads/Stats checks; no defect demonstrated. Umami recorded native isolated website/chart checks but declares no shared Stats provider, so do not claim advancing shared Stats for it. Its view-only user retains website-owner writes. All 19 successful non-nil leaves now inspected; independent values/rendering/lifecycle remain absent.
- All five unselected startup holds are intentional, not runtime failures: Plex external account/attested ownership; Slskd provider login/network; Warrior HQ/archival outbound (amd64-only, idle still contacts HQ); WUD scoped discovery/registry; Gluetun provider/privilege/#332. Gluetun lacks a pre-mutation preflight despite its later verifier privacy rejection; keep startup excluded and #332 held, no automatic activation/fix. Labels are not Docker Project authority; inert WUD inventory is not real monitoring.

## Source repair phase proposed for oracle

This does not gate or rewrite the completed smoke test. Source work only; no new runtime approval, production merge, visibility, paid evaluation or publication.

1. Retained custodian completes the already active public synthetic argv/secret guard investigation and smallest bounded before-cleanup per-peer diagnostics runner correction; preserve private-value rejection and previous artifacts. Only label a cause demonstrated if the offline loop proves it.
2. Queue one narrow Frigate persisted TLS recovery hint through existing per-App hint selection, exclusive common custodian only, preserving trust/authentication/explicit approval safeguards. Apply on a separately owned source repair branch; do not alter the tested aggregate source/manifest/binary or rewrite peer PR histories. No generic Step/error framework.
3. Original NZBGet owner may replace only the generic persistence error with a contextual wrapping of the already secret-redacted `ExecSecret` diagnostic. Home Assistant diagnostic forwarding must use existing redaction before exposing any wrapped error/stdout/stderr. These improve investigation; they are not causal fixes to the observed failures. Keep privacy/provider/recovery/ownership guards unchanged.
4. Resume original owners of AdGuard, Aria2, Audiobookshelf and Paperless to complete useful-data leaf verifiers through the existing `target.verify` seam and central freshness checks. Use supported native schemas and least-permission peer contracts; no common API/registry changes, fake zeros, new auth/privilege/provider actions or unit-case expansion. Each owns only its App and leaf in its existing branch/worktree/PR; preserve concurrent state. If API evidence cannot support a verifier, report exact missing contract instead of guessing.
5. Leave PatchMon startup and Tracearr API version gates untouched until actual diagnostic/API/provenance evidence supports a fix. Immich's database cap/restart/startup chronology is a harness question; only propose recomputed per-service allocation within already approved totals, no hidden cap increase or existing-workload stop.
6. Format/build/vet/type/lint changed source/helpers as appropriate and run relevant existing tests only, no new test cases. Fresh independent Standards/Spec reviews precede production merge, but do not retrospectively gate smoke or manufacture native acceptance. Source fixes are serialized into a new candidate manifest/build by the custodian. A subsequent actual run needs a fresh exact plan, explicit person approval, bounded startup/diagnostics/rendering/cleanup, not consumed-plan reuse.

Known original owners: AdGuard `ses_ed3716079ffer3V7IOLUJ0qW3V`; Aria2 `ses_ed36cfd5affeA5R40SOaJv2qjn`; Audiobookshelf `ses_ed371604effeSvYD1V5hyM1GAG`; Paperless `ses_ed3716061ffee3zAPaIVsxSBno`; NZBGet `ses_ed34a9aa7ffeST2uKYt3a1KZXT`; Home Assistant `ses_ed356dc7effedt8CSwC51yjW1F`. Source phase is approved; preserve maximum 12 active including reviewers.

Parent verified a concrete normalization prerequisite: original AdGuard and Paperless `links.go:60–68` have no preflight/verify fields; frozen `6b82` `links.go:60–69` contains both. Oracle **approved the exact frozen forward merge** by each original owner, preserving history/worktree/PR, with common blob equality and mandatory stop on common/registry conflicts or mixed versions. No manual API copying, rebase/amend/force, peer-history imports or tested-aggregate changes. **Do not assume baseline alignment registers these four peers**; registration/reachability remains custodian-owned.

All four original owners are now resumed in the background to align the baseline and complete only their App/leaf verification, source-only, no new unit cases or runtime. Preserve earlier ownership/recovery and test-scenario cleanup. Actual owner gates after source changes; independent reviews before merge.

## NZBGet diagnostic repair pin

Original owner completed and normally pushed `d03616aac0a2aa902097cbd7062d99abf514f891`, clean branch `feat/homarr-nzbget-sol`. Parent verified local/live-remote equality and merge-base `795c6d082c8affd213447e0629328fb7ba9d2fe4`. From tested `52eab49981b87fed11ba6a9e152ebf1eab2a07ab`, the only change is `internal/apps/nzbget/homarr.go` **+1/-1**, contextual `fmt.Errorf(...: %w, err)` of already-redacted `ExecSecret` failure. Full PR delta: six files **+959/-14**. Owner reports actual formatting/build/both vets/full existing tests/relevant races/Bash/diff gate passing, no new wrapper assertion added.

Fresh complete Standards `ses_ed060ad62ffevI2a9S3nmDArq3` and Spec `ses_ed060ad5bffepPX5mzgzffD9Jl` **BOTH PASS, zero P0–P3 findings**, after the entire six-file `795c6d...d03616` diff. Verified credential registration and complete error/stdout/stderr fallback redaction before contextual wrapping and subsequent Step/event/persistence sinks; ownership, symlink, consecutive-provider and pre-mutation #354 guards unchanged. Existing three test entry points, no new scenarios in the diagnostic increment. Issue #290 re-read; parent rechecked live PR head equals `d03616...`, still draft. Paired comment prepared in `nzbget-diagnostic-source-review.md`. This is **diagnostic quality only**: actual persistence failure remains causally unknown/unfixed, #354 enforced, no runtime/acceptance/merge. Tested aggregate artifacts unchanged; source/native coverage counts do not increment for this repeat held-source pair.

Parent posted the pinned paired verdict: https://github.com/ajnart/selfhost-skills/pull/335#issuecomment-6131251720. No issue closure or PR merge.

## Prepared runner follow-up result

Archive: `<OLD_ARTIFACT_ROOT>/homarr-aggregate-failure-followup-p340jace/`. Parent read `result.json`, proposed Frigate patch and public synthetic receipts; verified all **20** artifact hashes.

- **Demonstrated offline guard defect:** original Home Assistant/NZBGet public script argv falsely match source-defined managed usernames from the global fixture store. Exact original predicate compiled/reused with in-memory synthetic inputs: exit 3 → 0 after exempting only exact public key/value pairs for `GOTIFY_HOMARR_USERNAME`, `NZBGET_HOMARR_USERNAME`, `UMAMI_HOMARR_USERNAME`. Password with identical bytes and arbitrary-ID substring controls still exit 3; output masking unchanged. This proves the runner false positive, not the original uncaptured runtime execution stage or all five causes.
- Prepared helper SHA-256 `76dbe715cab6f87d4096104fa3c704865f969466c9e3248c534ae26893244365`; runner SHA-256 `4d9e7cbcf2f485005f5c2eb23cdda17c7ce458adaf41288ce07e5ba49c6534f8`. Focused helper/probe gofmt/build/vet, Python syntax and diff passed; no new unit cases or engine/browser/API calls.
- Runner prepares existing bounded `self-host --json debug <app>` captures for all five incomplete peers before cleanup, with logs capped at 100 lines, 30-second command limits and redaction before artifact writes. Safe subprocess receipts contain stage/category/exit/timestamps and allowlisted operation/service only, never raw argument/env/error payloads. Owned inspect adds startup/finished/restart metadata, not full event-history proof. Last 15 minutes reserved for evidence; 90-minute total/85-minute work limit and cleanup reserve retained.
- No additional API-version/independent saved-record/native value capture was implemented because secret safety could not be established offline. Do not claim those gaps resolved by improved Debug.
- Existing NZBGet Setup calls a scoped restart after saving its managed restricted login; wrapper currently denies restart. This is a demonstrated policy mismatch, not a proven cause of the closed attempt. Proposed fresh plan may permit **one restart of only already captured owned `nzbget`**, with exact identity/effective-cap/namespace checks, no dependencies/new containers/blanket retry. This needs explicit plan review and user runtime approval; not enabled yet.
- Immich proposal only: transfer 512 MiB and 0.25 CPU from idle ML to database, leaving database 1 GiB/0.5 CPU and ML 512 MiB/0.25 CPU, same 27 GiB/15.75 CPU totals. ML startup sufficiency and Immich readiness recovery remain unproven. No source/cap/settings mutation applied.
- Frigate proposed three-line existing `target.hint` selection preserves trusted HTTPS/authenticated 8971/private TLS approval/CLI+Homarr trust, no port 5000/auth disable/certificate bypass/public Access. Proposed patch dry-check passes against the tested evaluation source, not yet production-applied. Implement through a separate exclusive-custodian source branch without importing the surrounding NZBGet context into that branch.
- All old archives/tested source/binary/manifest/consumed plan/private data remain unchanged. Prepared archive **is not launchable**: fresh Project/root/caps/ports/config/admission and a newly pinned candidate are required, with separate user approval.

## Native leaf completion reviews

Parent verified both clean local/live-remote heads, exact frozen merge-base and no protected common/registry/helper/dependency differences. PRs #310/#317 are linked to this session. Each gets fresh independent review of the complete fixed-baseline diff, not only the new verifier. Gates below are owner-reported actual executions, not reviewer reruns; no new unit cases, downloads or runtime.

| App | Pinned HEAD | Complete diff against `6b82c55f` | Review sessions |
| --- | --- | --- | --- |
| Audiobookshelf | `8c7048b5f4cc67f39e04f412415cbd01711f7794` | six files +707/-6 | Standards `ses_ece5848a9ffeJpYi7gjILgENmW`; Spec `ses_ece5848a1ffehXI2Q5N4geLS3t` |
| Aria2 | `abc5e54cc8076f857e352ecd8da26996c00a5d69` | five files +574/-42 | Standards `ses_ece5848a0ffevKmWm4aUWhazoq`; Spec `ses_ece58489affemtAMVz5K1apVUA` |

Aria2 pinned review pair completed: **Standards one P3; Spec one P2**. Filename rule requires `target_aria2.go` and an updated proof reference. Parent verified the documented convention and the substantive Spec bug in `integration_aria2.go:116–124,161–168,243–252,284–295`: exact counts, membership/order, progress/rates/ETA/state and paused comparisons span independently sampled RPC, 10-second cached Downloads and later one-item Stats. Healthy transfers/transitions can repeatedly fail verification. Original owner `ses_ed36cfd5affeA5R40SOaJv2qjn` resumed **Fix Aria2 sampling comparisons** to validate each supported authenticated sample's fields/identity/units/bounds/intra-response consistency without false cross-sample equality, preserving central advancing freshness and recovery guards. No arbitrary tolerance, polling/cache framework, new unit cases or runtime. Rename through the same owned change; re-review corrected full source pin afterward. No source PASS or native increment at the rejected pin.

Aria2 corrections pushed at **`71e5c0fc1afd1732a38b299137f0001ed99a19d3`**, parent `abc5e54c`. Parent verified clean local/live-remote, frozen merge-base, no common/registry/helper/dependency diffs. Increment two files +68/-106; complete frozen-baseline diff five files +536/-42. Renamed to `target_aria2.go`/proof path, independent direct/native/Stats sample validation, duplicate checks per direct response, wide native paused semantics separate from one-item Stats, unchanged authentication/identity/central freshness/recovery. Owner actual mandatory gates passed with no new tests/functions/deps. Fresh final same Standards/Spec sessions active against complete frozen...71e5 pin; do not close P2/P3 or claim live fix until reviewed/actually exercised respectively.

Final Aria2 Standards returned **PASS0** over the complete five-file +536/-42 diff; filename P3 closed, no documented-rule or actionable smell findings. Auth/ownership/destination, required arrays, explicit numbers/states/units/ranges, central advancing Stats and approved recovery retained; missing values not silently zeroed. Spec still active, so substantive P2 closure/final paired posting remains pending. No runtime acceptance.

Final Aria2 Spec now **PASS0**, prior P2 closed at71e5/fixed6b82, complete five-file diff. Independently confirmed per-response duplicate/sample validation, supported native fields/ranges/torrent-state/progress/ETA/list-paused consistency and separate Stats one-item semantics, saved credential/identity/destination/auth/version/dir/units/central freshness unchanged. Meaningful native verification remains, not listener-only. Parent live PR317 readback matches71e5/stilldraft. Paired report `aria2-final-source-review.md`; no individual registration/actual live fix/native/render/lifecycle acceptance or source coverage count increment.

Posted pinned paired Aria2 verdict: https://github.com/ajnart/selfhost-skills/pull/317#issuecomment-6131718826. No merge, issue closure or runtime retry.

Audiobookshelf pair completed: **Standards one P3; Spec PASS0** over the entire six-file +707/-6 diff. Spec independently verified exact native fields/Stats keys/listening-time seconds/account/session/explicit-empty semantics against 16 identical relevant Homarr files. Saved identity/destination/dedicated-account checks and missing/auth-failure rejection present; shared code unchanged. Source-only registration/runtime/rendering/lifecycle remain held. Original owner resumed **Align Audiobookshelf leaf filename**, only byte-identical rename to `target_audiobookshelf.go` and existing proof reference; no semantic changes. Reconcile corrected pin and review pair before closing the P3.

Audiobookshelf correction pushed at **`895fb166f652181745d188934bf70d8d9479bea6`**, parent `8c7048b5`. Parent verified clean local/live-remote equality, frozen merge-base, R100 rename and identical old/new Git blob `c602bc634f8583ac632b5e600ece243ca111fe2f`; only other change is one proof path replacement. Full six-file +707/-6 semantic diff unchanged. Actual owner gates passed after rename. Original Standards/Spec sessions resumed for the fresh corrected final pin; no runtime/registration or acceptance increment.

Both fresh final Audiobookshelf axes now **PASS0** at `895fb166...` against `6b82...`, complete six-file diff. Prior P3 closed; exact blob equality independently confirmed; source/auth/native semantics unchanged. Parent rechecked live PR310 head still equals895 and draft. Prepared paired verdict `audiobookshelf-final-source-review.md`; no registered/final-reviewed or native/lifecycle count increment because individual registration and runtime acceptance remain held. No issue closure/merge.

Posted pinned paired Audiobookshelf verdict: https://github.com/ajnart/selfhost-skills/pull/310#issuecomment-6131643138.

Audiobookshelf forward-merge `964331e3a6130b402c27495da359f4ba67a69a9f` has original `5b9e0c09` and frozen `6b82` parents. New three-production-file verifier delta +130/-27; saved integration/account/native Audio Stats/peer/refreshed Stats comparison. Broad administrator/all-library authority remains disclosed. Owner reports format/build/both vets/existing tests/required races/Bash/diff passed with cached Go 1.26.0.

Aria2 forward-merge `9fe5f7289e442f901db048f242d002f9a6f0e989` has original `114477a5` and frozen `6b82` parents. New leaf delta +288/-1; native Downloads/Stats against authenticated RPC. Protected replacement/restart recovery unchanged. Owner completed the existing long gate before commit/push; format/build/both vets/full existing tests/TUI+Activity+Aria2+Homarr races/Bash/diff all passed using cached Go 1.26.0.

Both remain unregistered in their individual branches; custodian registration is separate. Source review completion does not grant actual native/rendered/installation-order/credential/lifecycle acceptance. Issues remain open and PRs draft. Tested aggregate and actual run artifacts remain immutable.

Custodian completed **Implement Frigate recovery hint** as draft [PR #355](https://github.com/ajnart/selfhost-skills/pull/355), linked immediately. New source worktree `.slim/worktrees/homarr-frigate-recovery-hint/`, branch `fix/homarr-frigate-recovery-hint`, HEAD `aaa37b83e99d116936a4353fedf0a8a61068205d`, exact frozen parent `6b82`; only `internal/apps/homarr/links.go` +3/-0. Parent verified clean local/live-remote equality, exact merge-base and whole diff. Wording says default HTTP starter; trusted HTTPS8971/private TLS and CLI+Homarr trust approval/no auth disable/5000/bypass/public Access restrictions intact. No surrounding NZBGet aggregate imports. Owner actual gate passed after existing sha256sum PATH correction; source/no runtime. Fresh Standards `ses_ece4e75f8ffeatdoFsw19qKIew` and Spec `ses_ece4e75efffe7jTrCJJ7OSdYUI` launched against complete frozen...aaa37 pin, issue277 re-read; no issue closure/merge.

Frigate hint pair now **Standards PASS0 / Spec PASS0** for the complete +3/-0 pin. Spec independently traced `target.hint` through StepSpec, Manual event/result, redacted StepRecord and SaveState; recovery persists and grants no TLS/runtime approval. Parent rechecked live PR355 equalsaaa37/stilldraft. Paired report `frigate-hint-final-source-review.md`; full issue277 and Frigate native/render/lifecycle holds unchanged, no peer acceptance count increment.

Posted pinned paired Frigate hint verdict: https://github.com/ajnart/selfhost-skills/pull/355#issuecomment-6131656990. No merge, issue closure or TLS/runtime activation.

## Home Assistant diagnostic cancellation

Original owner `ses_ed356dc7effedt8CSwC51yjW1F` reported cancelled before a completion handoff. Parent terminal-session last-assistant readback only says redaction will be verified; no completion, gate or cause is recorded. Parent checked worktree metadata/status: `<OLD_WORKTREES_PARENT>/selfhost-skills-wt-sol-home-assistant/` remains clean at tested `2ea747b1ee94f8a50c8741230b245aedb9cd12b4`, original branch unchanged. No partial files to overwrite, no diagnostic repair counted or auto-resume. Existing helper-diagnostic loss remains; prepared runner's public argv fix/safe stage categories are separate source artifacts, not an actual authentication fix. Keep Home Assistant source pin unchanged for any future candidate until a separately verified handoff exists.

## AdGuard and Paperless native completion cancellations

Both original completion workers reported cancelled before a verified result. Parent read terminal last-assistant handoffs and git metadata/status only; no private data inspected or changes discarded.

- AdGuard `ses_ed3716079ffer3V7IOLUJ0qW3V`: clean original `feat/homarr-adguard-sol` at tested `6731356c57d130e503ab24f28aa5cb7825355b2f`; no staged/unstaged/unmerged paths. Last handoff described future alignment/implementation, not completion.
- Paperless `ses_ed3716061ffee3zAPaIVsxSBno`: clean original `feat/homarr-paperless-sol` at tested `df16f7231e9299e9fb6c5975da6669f398f6ce30`; no staged/unstaged/unmerged paths. Last completed handoff is historical stage-1 cleanup, not this native verifier task.

Neither frozen forward merge nor native leaf completion occurred. Both remain nil-verifier stage-1 sources, unfinished, with no new gate/review/acceptance claimed. No automatic relaunch/replacement after cancellation. Preserve their existing PRs/worktrees and tested pins; pending resumption is a separate scheduling decision. Only runner oracle remains active; completed NZBGet/Frigate diagnostics and Aria2/Audiobookshelf verifiers are source-reviewed pins, not a new aggregate or runtime result.

Oracle `ses_ed39285f8ffeJ891XQT5kqvFPq` active task **Review prepared runner safety**: read-only prepared helper/diagnostic redaction plus conditional fresh-plan requirements for one captured NZBGet restart and explicit same-total Immich redistribution. Custodian source-confirmed existing command is exact Project-prefixed `restart nzbget`, no flags; future allowance consumed persistently before dispatch with identity/pin/cap/private-argv/deadline checks. Not enabled or executed. No current runtime permission.

That prepared-runner review subsequently **cancelled before a verified verdict**. Earlier source-plan/frozen-normalization approvals remain historical; they do not validate the later helper/diagnostic implementation, restart allowance or Immich reallocation. All workers now stopped, no automatic replacement/relaunch. Prepared artifacts retained unexecuted/non-launchable; pending safety review, unfinished AdGuard/Paperless verification, optional Home Assistant diagnostic repair and a fresh candidate/explicit runtime approval remain separate next decisions.
