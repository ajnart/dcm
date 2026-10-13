# Prompt for the next agent

Start in branch **`docs/release-handoff`**, not the aggregate checkpoint or the evaluation branch. Paste the following prompt:

```text
Continue the self-host release work in private ajnart/selfhost-skills.

Start from docs/release-handoff. Read AGENTS.md, CONTEXT.md,
docs/agents/domain.md, then docs/handoffs/release-2026-10-13/START-HERE.md,
HANDOFF.md, PR-STACKS.md, APP-QUEUE.md, CHECKPOINTS.md and
TRACKER-INVENTORY.md. Use PR-HISTORY.md for completed/closed work.
Read the current Homarr integration workflow/contract before proposing changes.

First deliverable: a source-only reconciled plan, not another runtime attempt.
Refresh main, the 43 pre-existing open PR heads/bases and their issue blockers.
Link every issue/PR you actually handle to this session with session.link.
For each PR, identify its purpose, original branch, actual ancestry, registered
versus merely assembled source, exact-head review scope, completed evidence,
remaining code/acceptance work and smallest safe next action. Confirm all 39
Apps and evaluation/installer/video lanes are accounted for. Do not call a
source PASS, Link success or compilation final native acceptance.

Preserve all original PRs, branches, worktrees, indexes, concurrent edits,
Projects, credentials, retained data, volumes and images. Four checkpoint
branches preserve the uncommitted current-release work without changing those
worktrees. They are archival, not production merge candidates. The unrelated
legacy new-cli checkout was explicitly excluded; leave it untouched.

Evaluate the actual sibling topology: 30 PRs still base on the already-merged
feat/homarr-immich-sol reference; 13 existing PRs base on main. They are not a
30-PR chain. Reconcile historical common blobs and cumulative registration
with approved forward merges in the original peer branches, not force pushes,
blind retargeting, peer-history imports or a combined production PR.

Use one exclusive custodian for common Homarr code, registry, candidate,
runner and runtime. Peer workers own only their App/leaf/original branch/PR.
All subagents must use openai/gpt-6.1-sol#xhigh, maximum 12 active including
reviewers. Reserve review slots. Obtain direction before resuming cancelled
AdGuard/Paperless verifier owners, optional Home Assistant diagnostics or the
cancelled runner safety review. Preserve completed unchanged source passes.

Keep the completed aggregate attempt immutable. Its five own-Setup failures
(Home Assistant, Immich, NZBGet, PatchMon, Tracearr) remain causally unresolved.
AdGuard/Paperless still have nil native verifiers; reviewed Aria2/Audiobookshelf
verifiers and NZBGet/Frigate diagnostics were pushed but not reassembled or
runtime-tested. A new evaluation candidate starts from frozen 6b82c55f with
reviewed allowlisted production deltas, corrected filenames and new exact
hashes, under the custodian. Preserve old pins, binary provenance and receipts.

Review the prepared runner's actual implementation and redaction-before-write,
owned process/endpoint/service identity, deadline and cleanup. The scoped
one-use NZBGet restart and same-total Immich resource redistribution are
proposals, not enabled policies. Independently captured native values,
saved connection/widget/binding inventory and actual rendering still need
a safe design; prepared Debug capture alone does not provide them.

Before Docker, browser, engine restart or live acceptance, present a new exact
machine-specific plan, get independent safety review and explicit approval.
The old 51-container/27-GiB/15.75-CPU/90-minute approval was consumed; engine
memory/restart consent was also consumed. Ports are loopback-only. Keep
Warrior/Gluetun/Plex/Slskd/WUD excluded and preserve all Manual/privacy/provider,
TLS/hardware prerequisites. No broad cleanup, secret export, real browser,
auth/version/TLS bypass, external jobs/media downloads or bandwidth tests.

Reconcile evaluation #259 with its current owner. Recorded head 3558e581:
54/54 valid iteration-25 conversation executions, then complete judging hit
subscription quota. Failed judgments remain ungraded; there is no benchmark
or viewer. With separately confirmed access and bounded authorization, the
next operation is a new judgment-only attempt on copies of valid frozen
conversations, not another 54-conversation batch. Preserve exact inputs,
complete blind and Recap judgments, then supplied aggregation/viewer and
human feedback. No automatic retry, paid fallback or model/billing change.
Verify current-code review coverage. #257 is merged; later guide changes
belong in a separate follow-up rather than changing the frozen comparison.

Finish each peer's actual registration, both installation orders, meaningful
native/saved/rendered data, genuine freshness, preservation and lifecycle
evidence before complete exact-head Standards/Spec reviews and approved
protected individual merges. Gluetun #332, PatchMon #350 and NZBGet #354
remain hard native privacy/authority blockers; Frigate requires approved
trusted HTTPS. Resolve them or ask for an explicitly reduced release scope.

Separately settle repository visibility/rename #193, canonical defaults #194,
anonymous distribution #295, installer/install-update #313, final merged-main
packaging and video #268/#300 publication. Source passes and a rendered video
do not prove anonymous public installation. Keep all publication, external
account, paid-provider and release approvals separate. Do not merge/publish
merely because this prompt says to continue.

Return a concise completed/blocked/unobserved summary plus the ordered plan
and the smallest approval questions. Then work through the plan under those
boundaries, updating persistent progress and exact source/evidence pins.
```

Suggested skills and their triggers are in [HANDOFF.md](HANDOFF.md#13-suggested-skills-for-the-next-agent). The prompt transfers context and process, not old runtime or publication approval.
