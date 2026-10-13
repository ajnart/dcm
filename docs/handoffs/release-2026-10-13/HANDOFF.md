# self-host release handoff — another machine

**Current instructions:** read [CURRENT-STATUS.md](CURRENT-STATUS.md) first. The user now authorizes source-only delivery: 37 of 38 original peer PRs are merged at the supplement's snapshot; remaining source merges are pending. Runtime acceptance and deferred outside prerequisites remain separate from source delivery. Publication is still held.

Start at [START-HERE.md](START-HERE.md) on `docs/release-handoff`. Refresh live main and PR heads before continuing. This private documentation does not authorize public release or another runtime attempt.

## Historical handoff

The remainder preserves the earlier handoff's captured source state, runtime evidence, counts, ownership and proposed gates. In particular, its statements that all 38 peers remain draft, its aggregate-before-merge sequence and its evaluation/installer/video status are superseded by [CURRENT-STATUS.md](CURRENT-STATUS.md). [LATEST-UPDATE.md](LATEST-UPDATE.md) is an intermediate historical update, not the newest authority. [CONTINUE-PROMPT.md](CONTINUE-PROMPT.md), [PR-STACKS.md](PR-STACKS.md), [APP-QUEUE.md](APP-QUEUE.md) and [TRACKER-INVENTORY.md](TRACKER-INVENTORY.md) retain their original snapshot scope.

## 1. Outcome and the actual problem

The features are **not ready for an all-39 native-integration release**. All 39 source slices exist, but only the merged Immich reference has accepted bounded native/rendered preservation evidence. The other 38 peer PRs remain draft. Source assembly, successful Setup steps and source-review passes were mistakenly easy to conflate with end-to-end completion; they must stay separate.

The combined test was real, but it was a **smoke evaluation**, not a merge candidate or final acceptance suite. It exited 2 after 663.646 seconds. It created 51 containers for 34 peers plus Homarr under verified 27 GiB / 15.75 CPU caps. Peer Setup results were 24 complete, five Manual and five incomplete. Homarr recorded 23 successful Link steps; 19 had actual leaf verifiers and four had no leaf verifier. Independent native values, saved integration enumeration and rendered values were not captured. All 51 owned containers and the owned network were removed; disposable data, volumes and images were preserved.

There are **43 pre-existing open PRs and 57 open issues** in the snapshot, plus the new documentation PR when opened. The pre-existing PRs are 38 peers, Frigate's diagnostic fix, evaluation/site/video, and unrelated #14. [PR-STACKS.md](PR-STACKS.md) explains the meaning, checkout branch, actual ancestry, source/evidence state and remaining action of every one; [PR-HISTORY.md](PR-HISTORY.md) accounts for all 125 pre-existing PRs, including merged and closed work.

**Important concurrent update:** Homarr orchestration is paused with no active workers. Evaluation #259 independently completed all 54 iteration-25 conversations, then stopped when blind judging hit subscription quota. There are no usable grading files, benchmark or viewer for that iteration. Its head is `3558e581856ae12bf803c6052384ee23ac2f93a2`. Reconcile with its owner; the next possible model operation is separately authorized judgment-only recovery on copies of valid frozen conversations, not another conversation batch. See section 10.

## 2. Why the combined test did not pass

The authoritative classification is [references/homarr-aggregate-inspection.md](references/homarr-aggregate-inspection.md); the actual receipts are under `evidence/aggregate/`. This table separates proven defects from plausible causes.

| Item                | What was actually observed                                                                     | What is established / next necessary evidence                                                                                                                                                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home Assistant      | Own Setup incomplete; the underlying `h.Exec` diagnostic was discarded                         | The public-username argv guard false positive was reproduced offline. The original command execution stage was not captured; authentication failure is not established. Need safe stage/disposition and redacted exec/log evidence. Diagnostic owner was cancelled without edits.                                                                          |
| NZBGet              | Restricted-login persistence failed before provider/native activation                          | Same offline guard false positive; an existing scoped restart is also denied by the runner. Neither is proven to be the closed run's cause. Reviewed `%w` diagnostic forwarding preserves an already-redacted error, not a save fix. Need real save/permissions/exec evidence and a reviewed restart policy. #354 remains a separate native privacy block. |
| Immich              | Own Setup incomplete; database OOM flag recorded while the snapshot also showed running/exit 0 | Aggregate database cap was 512 MiB, below the accepted reference's 1 GiB. No timestamp-aligned causal proof or source regression. Need startup/readiness/OOM chronology. Proposed redistribution is not applied or proven sufficient.                                                                                                                      |
| PatchMon            | Readiness connection refused on the declared 3000 listener                                     | Listener mapping agrees; running dependencies/no OOM do not prove a live server. Startup logs and timeline were missing. `restart: no` differs from source but causality is unproven. #350 was not reached and does not explain this failure.                                                                                                              |
| Tracearr            | Authenticated top-level version-equality gate rejected                                         | Actual returned field/type/value and digest-matched provenance were not captured. Do not weaken the gate or guess an alternate selector/version.                                                                                                                                                                                                           |
| Browser             | Startup refused a 181-byte UNIX socket path                                                    | Demonstrated harness problem. A short owned `AGENT_BROWSER_SOCKET_DIR` correction reduced the computed path to 99 bytes, but was not live-exercised. No screenshots/rendered checks were reached.                                                                                                                                                          |
| Four leaf verifiers | AdGuard, Aria2, Audiobookshelf and Paperless had nil callbacks in the tested candidate         | Their Link step could succeed without semantic native verification. Aria2/Audiobookshelf now have reviewed source completions in separate branches, not in the tested candidate. AdGuard/Paperless completions were cancelled and remain unfinished.                                                                                                       |
| Frigate             | Native Link correctly remained Manual for trusted HTTPS                                        | Proven diagnostic defect: detailed recovery was logged but not persisted in its Manual hint. #355 repairs only that hint, not TLS/native activation.                                                                                                                                                                                                       |

Five own-Setup **Manual steps are expected holds**, not five demonstrated defects: Emby first owner, PeaNUT NUT/UPS selection, SABnzbd provider configuration, Speedtest usable measurement, Uptime Kuma administrator/existing status-page selection. Do not fake prerequisites to make these green.

Five Apps were **intentionally not started**: ArchiveTeam Warrior, Gluetun, Plex, Slskd and WUD. Their outbound/privacy/provider/account/discovery prerequisites are not runtime failures. Frigate's TLS Manual boundary is also expected.

The later source-repair and runner-safety workers were cancelled. A cancelled plan, unfinished verifier or absent review is not a passed result. No fresh aggregate candidate or second live attempt was produced after those cancellations.

## 3. What to transfer, what not to transfer

Included:

- `HANDOFF.md`: execution order, decisions and release gates.
- `APP-QUEUE.md` and `github/app-queue.json`: all 39 Apps with issue/PR mapping, live full SHA, tested SHA, original base, descriptor/import paths, outcomes, blockers and smallest next action.
- `PR-STACKS.md`: all 43 existing open PR dossiers and the actual sibling/reference topology. `PR-HISTORY.md` includes all 125 pre-existing PRs. `CHECKPOINTS.md` maps four verified pushed checkpoints to their contents and original parents; these are preservation branches, not new production PRs.
- `TRACKER-INVENTORY.md`: all 57 open issues, native dependencies, open PR pins and relevant merged work. `github/` carries acceptance-body/status snapshots and non-bot release-related comments. PR #259's complete 205-file listing is separate because `gh pr view` returns only the first 100 files.
- `references/`: copied orchestration ledgers, final source-review receipts, canonical workflow/contract/proof, evaluation README/PROGRESS at the live head and pinned video instructions. These references preserve historical checkpoints; later sections supersede earlier “active/pending” wording.
- `evidence/aggregate/`: allowlisted redacted final result, provenance, resources, logs and cleanup receipts. Numeric values masked in the old Status output were not reconstructed; absent/null is not zero.
- `evidence/tested-source/`: old source manifest, source-derived inventory and offline gate/plugin receipts. Its earlier “not started” and historical authorization fields predate the successful admission; use the final aggregate summary for the actual run. It is NOT a current authorization.
- `evidence/prepared-followup/`: unexecuted follow-up result and synthetic RED→GREEN guard receipts.
- `source/tested-candidate.patch`: byte-identical full evaluation source delta against frozen `6b82c55f`, SHA-256 `4e601a045734777c40c059b86b55837f5eea7a3fa50754cf26d0b69f183e2af9`.
- `source/*.reference` and prepared patches: review/rebuild inputs for the later runner/helper, not executable launch instructions. Original machine binary hashes remain provenance only.
- `export-provenance.json`: original/export hashes; copied reference text has old personal home paths replaced with placeholders. `SHA256SUMS` authenticates transported bytes, not approval or functional acceptance.

Excluded deliberately: `.sessions/`, `.env*`, `secrets.env`, credential stores, real browser profiles, retained Project/Home/media/download/data directories, Docker configuration, raw model attempts, `effective-compose.json`, old consumed run/browser plans and machine-specific binaries. **Do not copy or read those as a shortcut.** Generate new disposable credentials through the Project boundary after approval. This archive does not contain a runnable old Project, a Docker image cache, an offline Git object bundle or model-run state.

The repository remains private. The handoff includes private source and private tracker text despite excluding credentials. Transfer it through a private channel and do not attach it publicly. If old raw model evidence is needed, its owner must separately prepare an approved redacted export; it is not supplied here.

## 4. New-machine prerequisites and safe bootstrap

Read `CONTEXT.md`, `AGENTS.md`, `docs/agents/domain.md`, relevant ADRs and `docs/agents/homarr-integrations.md` in the new checkout. Use App, Setup, Link, Project, Access, Address and Manual step with their defined meanings. The current old root was an evaluation branch, not main, and lacked some newer docs; do not copy that stale working tree over a new clone.

Requirements by lane:

| Lane               | Requirements / limitations                                                                                                                                                                                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source/build       | Git, authenticated GitHub CLI access to private `ajnart/selfhost-skills`, **Go 1.26.0** from `go.mod`, Bash and a working `sha256sum` command on PATH for existing probes. Existing dependencies are sufficient; do not add another registry/framework.                                                                                                              |
| Homarr runtime     | Explicitly intended local Docker UNIX endpoint, working Compose plugin, compatible CPU/image platforms, sufficient engine memory/headroom and fresh unused loopback TCP/UDP ports. Old machine used aarch64, Docker/OrbStack 29.8.2 and Compose 5.5.0. An amd64 machine needs its own platform manifest/image provenance; do not reuse arm64 digests as amd64 proof. |
| Runner preparation | Python 3 and Go; helper source is inside an `internal/`-importing Go module, so build it from a separately owned `tools/` path in the candidate checkout, not an arbitrary external directory. Reference source has machine-specific guards/paths; adapt and review, never relax them into a broad bypass.                                                           |
| Browser acceptance | Installed `agent-browser`/Chromium, documented isolated configuration and a short owned socket directory/session. Verify the installed CLI's current core instructions. Do not attach the real browser or live Homarr MCP.                                                                                                                                           |
| Evaluation         | Current harness is **macOS-specific** (`sandbox-exec`, Command Line Tools Python and first-party Claude CLI authentication). Debian/Mint/WSL are simulations inside that guard, not native proofs. On Linux/Windows, do not remove the sandbox or run it unguarded; keep this lane on an approved compatible Mac or separately design/review a replacement boundary. |
| Video              | Node, dependencies/lockfile from `video/reel/package.json`, installed Playwright Chromium, `ffmpeg` and `ffprobe`. JavaScript; no configured TypeScript typecheck. Delivered MP4/contact sheet are committed in #300 and can be fetched, not blindly rerendered.                                                                                                     |
| Site/release       | Authenticated account access if a deployment is requested; do not export credentials from the old machine. Distribution/visibility/publication decisions remain separate.                                                                                                                                                                                            |

First actions on the new machine are read-only reconstruction, not runtime:

```bash
gh repo clone ajnart/selfhost-skills selfhost-release-work -- --branch docs/release-handoff
cd selfhost-release-work
git fetch origin
git status --short
git rev-parse origin/main
```

At this handoff, live main was `ab4c92c428a2c2c9ab284a83f79f726418c1498b`. Frozen production contract is `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`; the subsequent guide/inventory merges were docs-only. Verify any subsequent main changes before using that assertion.

For an exact PR snapshot, use its recorded full SHA, not “whatever the branch is now.” Example, read-only worktree for the cancelled AdGuard lane:

```bash
git fetch origin refs/pull/311/head:refs/remotes/handoff/pr-311
git rev-parse refs/remotes/handoff/pr-311
git worktree add --detach .slim/worktrees/inspect-adguard refs/remotes/handoff/pr-311
```

Expected at capture: `6731356c57d130e503ab24f28aa5cb7825355b2f`. **Stop and reconcile if it differs.** For implementation, use a new-machine worktree on the original named branch/normal upstream from APP-QUEUE, after confirming the old owner is inactive. Do not overwrite old-machine worktrees, invent replacement PRs or push directly to main. If a SHA is missing, fetch its recorded branch/PR history or ask its owner; do not silently substitute a new pin.

The historical evaluation source is now pushed at `checkpoint/homarr-aggregate-20261013`, exact commit `f0b06ef7fa7b49263e5217d0d7853015886d9e86`, parent frozen `6b82`. It includes the complete tested production delta and two local source helpers. Inspect in a detached worktree; do not merge it into main or a peer branch. The original transported production patch remains byte-identical and can be checked independently. The next runnable candidate must be NEW and include reviewed post-run pins; restoring the old candidate is not the fix. Original worktrees and indexes remain unchanged.

Old engine memory/restart consent was already consumed: 32 GiB was configured and the approved graceful restart completed. **Do not repeat it on either machine.** New endpoint, engine settings, restarts, existing workload interruption, capacities and ports require their own admission/approval. Host RAM is not engine RAM; snapshot headroom is not a reservation.

## 5. Preserve ownership and pin distinctions

One exclusive custodian owns common Homarr code/registry, aggregate assembly, the runner and runtime mutations. Peer owners repair only their original App/leaf/branch/PR. On a new machine, transfer that responsibility explicitly; do not require old session IDs to exist or assume they migrated. Those IDs and original paths are historical pointers in the ledgers.

All delegated work must use `openai/gpt-6.1-sol#xhigh`, maximum **12 active including reviewers**. Reserve review capacity and do not let peer workers launch nested reviewers or independent runtime. No automatic relaunch of cancelled workers; obtain direction to resume the unfinished lanes. Do not re-review completed unchanged pins merely to fill slots.

Protected boundaries remain:

- Compose execution belongs to `internal/compose/`; Host to `internal/host/`; Project files/secrets/state to `internal/project/`; Backup to `internal/backup/`; release/update to `internal/release/`; progress to events/activity.
- Standard Compose only; no new proxy/firewall/scheduler framework, broad Docker teardown/prune/volume deletion, casual socket mount, authentication/TLS/readiness weakening or guessed native fields.
- Both independent Standards and Spec reviews must cover the **complete exact-head diff**, not only its last diagnostic hunk. Source review is distinct from native/runtime acceptance.
- Most draft PRs still target `feat/homarr-immich-sol`, not main. Retargeting without ancestry/diff/registry reconciliation is unsafe. Preserve history with approved forward merges, no force push/rebase/amend of pushed work.
- Check status before/after; stage only owned files. No new unit files/functions/subtests/scenario matrices without a real explicit user request. Necessary adaptation of existing fixtures is not permission for hidden new cases.

Original root dirty paths are `.gitignore`, `.ignore`, `docs/homarr-integration-coverage-research.md` and `docs/homarr-ticket-index.md`; they remain untouched in that worktree and are now preserved on `checkpoint/release-notes-20261013` with the release ledgers. Root HEAD advanced concurrently through evaluation `e49d93a6` to `3558e581`. The snapshot commit uses that latter parent without changing the active branch/index. See `machine-observation.json` for the older observation and [CHECKPOINTS.md](CHECKPOINTS.md) for the push receipts. Do not reset the active branch. The unrelated legacy `new-cli/` checkout was explicitly excluded by the user's scope decision and was not committed, pushed or changed.

## 6. Completed post-run source work — keep, do not redo

| Work           | Current reviewed pin / PR                        | Remaining boundary                                                                                                                                           |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Aria2          | `71e5c0fc1afd1732a38b299137f0001ed99a19d3`, #317 | Sampling-aware verifier + `target_aria2.go`, full Standards/Spec PASS0. Individually unregistered; not aggregate-imported or live-tested.                    |
| Audiobookshelf | `895fb166f652181745d188934bf70d8d9479bea6`, #310 | Native verifier + byte-identical `target_audiobookshelf.go` rename, full pair PASS0. Individually unregistered; administrator/all-library authority remains. |
| NZBGet         | `d03616aac0a2aa902097cbd7062d99abf514f891`, #335 | Complete held source pair PASS0. Increment only wraps already-redacted persistence error; root failure/#354 not fixed.                                       |
| Frigate hint   | `aaa37b83e99d116936a4353fedf0a8a61068205d`, #355 | Three lines in common `links.go`, pure frozen parent; pair PASS0. No TLS/native approval or #277 completion.                                                 |
| Bazarr         | `ed73c7651ca5372f5ec9a880e9d66ddf1fca9093`, #320 | Complete source pair PASS0, registered. No final native/rendered/lifecycle acceptance.                                                                       |

Exact posted review links and full reports are in APP-QUEUE and the copied `*-source-review.md` references. Gatus, Caddy and Prometheus are also individually normalized/registered with clean source pairs at their recorded pins. Reported registration remains 4/38; new unregistered verifier completions do not increment it.

Unfinished cancelled work: AdGuard #311 at `6731356c...`, Paperless #312 at `df16f723...`, optional Home Assistant diagnostic forwarding #333 at `2ea747b1...`, and prepared-runner safety review. AdGuard/Paperless neither forward-merged the frozen baseline nor completed native verifiers. The original worktrees were clean; there are no verified partial results to transplant.

## 7. Smallest source-first resume plan

1. **Reconcile live heads and the stopped evaluation owner.** Do not use the old ticket index's abbreviated heads as current truth; APP-QUEUE has the snapshot. Keep original archives immutable and record any new head/review/evidence separately.
2. **Ask for resumption of the cancelled lanes.** Finish AdGuard/Paperless through `target.verify`, using supported saved-native semantics and central freshness. Optional HA diagnostics must preserve existing secret-redaction before emitting anything. Do not guess a verifier from a successful connection or swap direct peer values for Homarr native values.
3. **Review the actual prepared runner/helper.** Earlier approval of a source phase is NOT the cancelled oracle's missing verdict. Check exact public username exemptions, redaction-before-write, bounded Debug collection, inherited configuration denial, endpoint/owned-service identity, process groups/reaping, deadline reserves and cleanup even on errors. Preserve password/arbitrary-ID rejection controls.
4. **Decide scoped NZBGet restart explicitly.** Existing Setup calls exact Project-prefixed `docker compose ... restart nzbget`; current runner denies it. Any proposed one-use allowance must be limited to an already captured owned service, checked against endpoint/namespace/caps/pins, consumed persistently before dispatch, with no flags/dependencies/new containers or broad retry. It is not currently enabled/approved.
5. **Decide resource redistribution explicitly.** Proposal: database 512→1024 MiB and .25→.5 CPU; idle ML 1024→512 MiB and .5→.25 CPU. Aggregate stays 27 GiB/15.75 CPU; Immich stays 2688 MiB/1.375 CPU total. ML startup sufficiency is unknown; no allocation changed. A stronger new machine does not authorize an undeclared higher-cap run.
6. **Have the custodian assemble a fresh candidate/manifest.** Start from the frozen production contract, import reviewed production deltas only, preserve frozen Immich and peer PR history. Include the corrected Aria2/Audiobookshelf filenames/pins, NZBGet diagnostic pin and separately reconciled Frigate hint. Do not carry both old `integration_*` and new `target_*` leaves. Keep common source blob checks, exact allowed exceptions, existing dependencies and unique 48-Link union registry explicit. The union includes the existing nine + Immich + 38 peers and is evaluation-only, not a combined production PR.
7. **Run appropriate offline gates and review the new exact artifacts.** Preserve the old tested delta/binary/manifest. Prepared helper binary SHA `76dbe715...` and runner SHA `4d9e7cbc...` are old-machine provenance, not the hashes of a future rebuilt runner. Repin every rebuilt/adapted artifact after actual gate/review.

The later prepared diagnostics add redacted `self-host --json debug <app>` for the five incomplete peers before cleanup, max 100 log lines and 30 seconds per command, plus safe category/exit/timestamp receipts. They **do not yet implement independently verified API-version/native/saved-record capture**. That missing safety design is work still needed, not a feature already delivered. Do not copy raw responses first and promise to scrub them later.

## 8. Fresh runtime plan — approval required before any execution

The authorized corrected aggregate attempt is closed. There is no automatic second attempt, even though the user wants to release everything. Write a new exact machine-specific plan, have it independently reviewed, and obtain explicit user approval.

The plan must name:

- Fresh absolute disposable Home/Project/media/download roots and one unique Compose Project; original retained data and existing Projects remain untouched.
- Exact source/base/peer/binary/driver/helper/manifest hashes, all primary/dependency/init services, platform-specific images and provenance, supported API/credential contracts and optional App interfaces.
- Intended canonical local UNIX endpoint and its identity; isolated empty Docker configuration with supported plugin discovery. Never fall back through an inherited/current context.
- Complete service/port/mount/resource inventory; unused **loopback-only** published TCP and UDP ports, distinct DNS secondary ports, source-declared secrets only, no host sockets/devices/privilege/host networking.
- Fresh capacity admission accounting for existing workloads and overhead. Historical aggregate ceiling was **51 containers, 27 GiB hard memory, 15.75 hard CPU, 512 PIDs/container and 90 minutes total**, INCLUDING pulls, diagnostics and owned cleanup. A different scope needs a different approval; budgets are not additive.
- Standard owned Compose bridge and permitted normal startup software checks/DNS/filter updates. This is not fully offline. No external accounts/provider jobs/media downloads/bandwidth tests/held App activation, public Access or firewall/resolver/existing-Project changes.
- Startup exclusions Warrior/Gluetun/Plex/Slskd/WUD; NZBGet #354/PatchMon #350 pre-mutation Manual guards and Frigate TLS/hardware/provider/manual prerequisites retained.
- One-use restart decision and allocation decision from section 7; no silent policy relaxation.
- Owned browser configuration/HOME/XDG/working directory, no inherited defaults/providers/attachment, fresh short namespace/session/socket resolved within the supported byte limit BEFORE startup, no real profiles, fixture-origin allowlist and explicit CDN/icon handling.
- One absolute admission-to-cleanup clock, child process identity/groups/reaping, bounded diagnostics and sufficient reserved cleanup/readback time. Timeout/cancellation/failure stops; it does not reset the clock or create another attempt.
- Redaction **before** writing any capture, only captured-owned-ID inspect/log/cleanup, independent safe native/saved-record/value receipts, screenshot review and precise Manual/error classifications.
- Exhaustive owned container/network/process/browser cleanup and empty/inactive readbacks despite individual failures; data/volumes/images preserved. No broad `down -v`, prune or deletion.

For the five incomplete Apps, capture Debug/logs and safe execution stage/version/startup chronology **while they still exist**, before cleanup. Diagnose only from those receipts; do not launch speculative fixes to version gates, passwords, TLS or restart policies.

The normal individual native workflow has a different **entire-attempt global** default: at most five containers/5 GiB/5 CPU/15 minutes, sequential, including all companions/fixtures. It does not authorize a 51-container run, and the previous aggregate consent does not approve arbitrary per-App retries. Each new attempt needs its own declared/approved scope.

## 9. How to turn drafts into releasable production PRs

After obtaining usable aggregate evidence, finish individual registration/normalization in the **existing** peer branches, serializing all common/registry edits through the custodian. A successful aggregate union does not put a descriptor on production main. Do not blindly merge stale reference-based PRs, replace shared files with old blobs or import peer histories into one huge PR.

For each App in APP-QUEUE, completion requires its own scoped proof:

1. Exact supported peer/Homarr/image/source/credential contract and least-necessary authority honestly documented. Authentication errors, missing/null/malformed data and valid empty/zero states distinct.
2. Useful **native Homarr** data matched to controlled local ground truth; supported fields/units/identity/destination verified, not a listener/HTTP 200/navigation tile/direct-peer substitute.
3. Independent saved connection/widget/binding inventory and actual rendered values, with no missing/error/loading state disguised as a value. Genuine forced refresh advances timestamps; cached no-op cannot pass.
4. **Both installation orders**: peer first then Homarr, and Homarr first then peer, in fresh isolated Projects. Actual absent/unready → retry behavior, not hand-edited state.
5. Stable rerun/restart IDs, supported credential change/recovery and negative-auth boundaries; no broad key rotation or adopting manual same-kind/Address resources.
6. Matching manual resources, edited App/widget fields/ping address, visible cross-board user references and two retained remove/reinstall cycles. Reinstall creates distinct owned IDs and does not reclaim retained resources.
7. Where shared Stats are supported, at least two real cross-kind bindings and **useful rendered survivor data** after removing one. Set-valued binding IDs need order-insensitive comparisons without dropping multiplicity. Legacy placeholders or two Immich bindings are not another App's native proof. Umami has no shared Stats provider.
8. Exact runtime bounds, redacted hashed receipts, reviewed screenshots, owned cleanup readback, limitations and final complete independent Standards/Spec reviews for the actual accepted head. Source changes require affected proof/review again.

Do not open generic new scenario matrices/unit tests. Execute the existing required lifecycle controls under approved disposable fixtures. Keep provider/accounts/hardware/TLS/bandwidth requirements Manual unless separately scoped; a safe Manual draft is not completion of an all-native ticket.

**Hard blockers preventing an honest all-39 claim:**

- [#332](https://github.com/ajnart/selfhost-skills/issues/332): Gluetun native summary requests provider-secret-bearing `/v1/vpn/settings`; current grants intentionally deny it. Need a supported non-secret adapter/summary contract, not broader grants/proxy/scraping.
- [#350](https://github.com/ajnart/selfhost-skills/issues/350): PatchMon statistics credentials also authorize enrollment; GET-only caller/IP restrictions/daily limits do not make them read-only. Need upstream-supported authority separation and approved issuance/verification.
- [#354](https://github.com/ajnart/selfhost-skills/issues/354): NZBGet credential-bearing RPC path can survive rejected error causes into downstream Homarr logs. Need supported header transport or complete downstream redaction plus reviewed exact version/image/source and separate activation approval. Valid credentials do not remove this conditional risk.

These findings are source-backed, **not demonstrated live leaks/exploits**. Upstream contact, image upgrades or public disclosure are separately approved decisions. Frigate also needs separately approved trusted HTTPS; it cannot be “fixed” with authentication or certificate bypass.

### Local source gate

CI is unavailable due account billing; actual local executions are the gate, not a green badge or reviewer assumption. Follow the checked-out AGENTS instructions:

```bash
export GOFLAGS=-buildvcs=false
gofmt -l .
go build ./...
go vet ./...
go vet -tags e2e ./e2e/
go test ./...
go test -race ./internal/tui/ ./internal/activity/
bash -n install.sh
git diff --check
```

`gofmt -l` must be empty; add the affected goroutine package races as required. Do not run Docker/e2e runtime/browser/installer for a focused source or docs edit. Evaluation changes use existing focused offline tests + Ruff/Pyright; video changes use its existing lint/verify and actual configured scripts. Documentation-only handoff work does not require speculative production rebuilds.

After a complete exact-head acceptance/review, obtain appropriate merge direction and use `gh pr merge` with match-head protection. Conventional commits; no force push/direct-main push, no automatic branch deletion, no closure of privacy/feature tickets from a diagnostic-only merge. Reconcile cumulative registry on merged main after every peer and rerun the final merged-main gate before release. If Actions later becomes available, use `gh run watch <id> --compact --exit-status`, not polling loops.

## 10. Evaluation PR #259 — execution complete, judging stopped

Live head at capture: **`3558e581856ae12bf803c6052384ee23ac2f93a2`**, branch `test/skill-eval-harness`, draft. Read [references/evaluation-progress.live-head.md](references/evaluation-progress.live-head.md), the current README and `github/evaluation-current.json`. Latest reporting: https://github.com/ajnart/selfhost-skills/pull/259#issuecomment-6139100430.

The parent Homarr ledger's older “42 comparisons / 1,388 CLI invocations / no enforceable USD cap / paused” describes an earlier scope. Earlier handoff reporting that iteration 25 was still running is also superseded. Neither justifies another run or a quality claim.

Current committed reporting says nine scenarios × two unchanged frozen guides × three repetitions = **54 valid completed conversations**, zero failed/cancelled, equal 16-turn limits and parallelism two. Complete blind judging then hit Claude subscription quota, reported to reset at 12pm Europe/Paris. Forty-eight responses with usage are retained as raw diagnostics, not 48 valid grades. Failure invalidated all judgment metrics and removed usable verdicts: **zero grading files, benchmark or viewer**. Model usage stopped, with no fallback or automatic retry. A quota-reset estimate is not a verified restored allowance or authorization. Existing first-party authentication stays on the original lane; this handoff exports no login, raw attempts or model-run state. This is committed-owner reporting, not a new independent process/evidence audit.

Iteration 24 was a valid six-run Mint comparison: revised 32/36 vs original 30/36; all eight scripted checks and six separate Recap checks passed, but **every `acceptance_passed` remained false** because original assertions failed. All repetitions failed plain-language grading. Recorded caveats include conflict with the prescribed Docker experience question and strict grading of a preference already volunteered, alongside real jargon/Status/Home-folder wording problems. Do not rewrite those failures into passes or generalize three Mint repetitions to nine scenarios/native installs.

Before moving machines:

- Contact/reconcile the existing evaluation owner and its stopped state. Preserve the valid frozen conversation execution and failed judge diagnostics. Do not transfer a PID, launch preflights or change authentication/model/budget as part of reading this handoff.
- After restored access and separate bounded authorization, prepare a fresh **judgment-only** attempt on copies of the 54 valid frozen conversations. Preserve the failed original ungraded. Finish all blind judgments and separate Recap assessments before supplied aggregation/viewer; partial judgments do not become a score. Do not rerun the 54 conversations to work around a judging quota failure. No API-key/paid fallback/billing/model change is inferred.
- Raw attempts are outside Git and are intentionally not in this bundle. Request a separately redacted export if needed; do not read private raw runs from this handoff task.
- Reconcile source review coverage against the full `3558e581` diff, including later fixture identity/manual-completion fixes. The current ledger reports independent source/follow-up passes; confirm their exact heads and scopes rather than treating an older `16571438` verdict as current acceptance. Preserve all invalid/partial attempts ungraded.
- Obtain **human viewer feedback**, still a merge gate. Further guide improvements belong in a separate follow-up PR: #257 is now merged. Do not edit frozen comparison guides/results inside the harness PR to improve its score.

This lane is not Homarr/Docker acceptance, even if its full comparison is valid. A CLI invocation ceiling is not a dollar cap, a subscription login is not unlimited quota, and model-person approval labels are not a complete authorization proof.

## 11. Installer, release, repository and video gates

### Repository and public artifacts

Current repository is **PRIVATE `ajnart/selfhost-skills`**, default branch main. Intended target is `ajnart/selfhost`; no rename/public visibility is claimed. [#193](https://github.com/ajnart/selfhost-skills/issues/193) remains a maintainer-controlled rename/visibility decision. [#194](https://github.com/ajnart/selfhost-skills/issues/194) is blocked by #193 and requires updated defaults/docs plus token-free install and old-name redirect/update proof.

Installer PR [#313](https://github.com/ajnart/selfhost-skills/pull/313) at `599bdafc8749ad69d1ffc1518f0239cf73e62aca` has both source axes PASS0. The 30-line follow-up is docs-only; reviewed production is `d3d3e78c48c7b5004372c396f5483faaf40c2bed`. **Do not merge its canonical defaults before the destination resolves.**

Historical normal-client HTTPS reads of `https://selfhost.ajnart.dev/`, `/install.sh` and `/install.sh.sha256` passed 200 without `--resolve` or authorization; served installer hash was `d4e064cbc5d1df531697a03bf303d8bf241f3c8246e1f6382f1aa5c9214398fe`. `/AGENTS.md` and `/go.mod` stayed 404. This resolves only the earlier DNS/transport/script-checksum observation. It does **not** prove anonymous binary installation/update. Both repository release endpoints were anonymously 404. No new live network probe or deployment was performed for this handoff.

[#295](https://github.com/ajnart/selfhost-skills/issues/295) tracks token-free artifact distribution while source stays private. Explicitly choose one lawful/approved route: maintainer rename/public decision, or separately approved artifact-only distribution with minimal metadata/checksums and compatibility for existing self-update. Do not put a private repo token on the site or publish authenticated API responses/source archives. Do not invent a new distribution framework without settling that decision.

### Final release sequence after feature gates

1. Confirm exactly which features are releasable and which remain held. If full 39-native completion is the requirement, the three hard blockers/manual prerequisites cannot be waved away. If the maintainer chooses a staged release, keep incomplete peers draft/issues open and state the reduced scope explicitly; this handoff does not choose that tradeoff.
2. Reconcile approved individually accepted PRs into main, ensure clean cumulative source/registry/docs/embedded guide and run the final merged-main local gate. Keep the frozen reference/source provenance historical, not today's release SHA.
3. Resolve repository/defaults/distribution strategy and old-name compatibility. Review the final #313 diff after retarget/sync; do not rely only on its old source pass.
4. Pick the next semantic version with the maintainer; inspect current releases/tags first. `docs/releasing.md` describes CI and local packaging; CI is presently unavailable. Local GoReleaser pin is `github.com/goreleaser/goreleaser/v2@v2.12.7`. Use an owned output path; don't blindly execute `--clean` over unfamiliar files.
5. Build from the exact reviewed release commit: `checksums.txt` and Linux/macOS amd64/arm64 archives (`self-host_X.Y.Z_<os>_<arch>.tar.gz`). Native Windows is not supported; WSL uses Linux. Preserve required release Telemetry metadata per ADR 0006 without exporting private credentials.
6. With release/publication approval, create a draft release, download every asset privately, compare bytes and SHA256, then publish as documented with `--latest=false`. Do not tag/publish from the evaluation union or a dirty peer worktree.
7. Independently run token-free `scripts/verify-install.sh` in its fresh isolated HOME/install paths against the approved public channel: unpinned install, version/skill, pinned old binary self-update and old-repository redirect. This is separate runtime approval, not this handoff's execution permission.
8. Recheck canonical anonymous DNS/TLS/script/checksum/archive availability and private-source 404 boundaries. Only then close the corresponding distribution tickets with actual receipts.

### Video

[#300](https://github.com/ajnart/selfhost-skills/pull/300) at `1a82599509947e0c6a6c300654a9bed1d6f7ab88` changes only `video/`; source reviews PASS0. Approved v5 creative direction is preserved. Candidate is committed at `video/reel/out/selfhost-reel.mp4` and `contact.png`: recorded 34.000 seconds / 2,040 frames / 1080p60 / -13.8 LUFS / -2.0 dBTP, 103 reading holds and deterministic seek checks. Reuse it unless copy/claims change; don't regenerate creative work just because the machine changed.

Read pinned `references/video-handoff.pinned.md` and storyboard for dependencies, cache invalidation and verification commands. The end card advertises the canonical installer and intended repository; a pretty mock-up is not public-install proof. [#268](https://github.com/ajnart/selfhost-skills/issues/268) stays open until actual script/public repo+assets/independent install/video measurements pass and **publication is explicitly approved**. Keep raw soundtrack/private source/browser data unpublished. Existing scheduled task had no release address and was not edited; don't invent a schedule migration.

## 12. Already merged / other open work

Do not redo merged #265 absent-peer scheduling, #271 Host folder/admin-email source fixes, #316 entrance motion, #278 native workflow, #309 reference, #314 outside-Catalog plan, #353 coverage documentation, #257 guide or earlier picker/QR work. Their exact heads/times are in TRACKER-INVENTORY.

The 41-kind outside-Catalog plan is a **plan**, not 41 implemented Apps. #254 folder-picker choices/bracketed-paste remainder are still open; #271 merging did not resolve them. #45 broader Catalog/Recipe install/restart/update/backup/restore acceptance is still open and is not satisfied by the 39-source union. Older port/rootless/permissions/Access issues and unrelated PR #14 remain explicitly inventoried, not investigated or implicitly authorized for merging by this handoff.

## 13. Suggested skills for the next agent

Load with the Skill tool as needed, not all indiscriminately:

- `deepwork`: orchestration, persistent ledger, ownership/review gates and explicit runtime boundaries.
- `gh-cli`: tracker readback, exact-head PR operations and dependency checks.
- `code-review`: independent Standards/Spec reviews against pinned full diffs; respect xhigh/12-worker cap.
- `diagnosing-bugs`: smallest falsifiable probes for the five unresolved runtime failures; don't turn missing evidence into a speculative fix.
- `agent-browser`: isolated approved rendered acceptance; verify the installed core guidance before browser calls.
- `find-docs` / `context7-mcp`: current upstream/API/Compose/library facts when changing contracts; use primary-source provenance.
- `skill-creator`: evaluation validity, supplied aggregation/viewer and human feedback once reconciled with the existing evaluation owner.
- `pr`: precise proof/hold-aware PR bodies. `docs-maintainer` for final code/docs reconciliation.

Do not auto-load a deployment/browser/installer skill as permission to operate the user's live environment.

## 14. Concrete next-agent starting prompt

Use [CONTINUE-PROMPT.md](CONTINUE-PROMPT.md), which names the initial branch, documents, source-only first deliverable, exact model/ownership rules and stop conditions. The fresh agent must first return a reconciled plan; publication, paid calls, runtime and feature merges are not authorized merely by loading these files.

**Definition of done:** independently accepted, correctly registered production features merged into verified main; blockers either resolved or explicitly excluded from the maintainer-approved release scope; evaluation validity and human gate settled; approved public archives/checksums install and self-update anonymously; approved canonical video tells the truth. No data loss, private publication or fake acceptance.
