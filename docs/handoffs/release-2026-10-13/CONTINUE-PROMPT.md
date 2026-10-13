# Prompt for the next agent

Start in branch **`docs/release-handoff`**, not the aggregate checkpoint or the evaluation branch. Paste the following prompt:

```text
Continue the self-host release work in private ajnart/selfhost-skills.

Start from docs/release-handoff. Read AGENTS.md, CONTEXT.md,
docs/agents/domain.md, then docs/handoffs/release-2026-10-13/START-HERE.md,
LATEST-UPDATE.md, HANDOFF.md, PR-STACKS.md, APP-QUEUE.md, CHECKPOINTS.md and
TRACKER-INVENTORY.md. Use PR-HISTORY.md for completed/closed work.
Read the current Homarr integration workflow/contract before proposing changes.

First deliverable: a source-only reconciled plan, not another runtime attempt.
Refresh main, all 46 captured open PR heads/bases and their issue blockers.
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
30-PR chain. Two later main-based additions are #356 and documentation #358;
#357 is a real child of #259. Reconcile historical common blobs and registration
through the custodian. The prior route was original individual PR completion;
#356 is now an independent owner's combined draft. Ask the maintainer which
route is intended before merging/replacing peers. Preserve histories; use no
force pushes or blind retargeting.

Use one exclusive custodian for common Homarr code, registry, candidate,
runner and runtime. Peer workers own only their App/leaf/original branch/PR.
All subagents must use openai/gpt-6.1-sol#xhigh, maximum 12 active including
reviewers. Reserve review slots. Obtain direction before resuming cancelled
AdGuard/Paperless verifier owners, optional Home Assistant diagnostics or the
cancelled runner safety review. Preserve completed unchanged source passes.

Reconcile concurrent #356 feat/current-release-completion at f245f787 with its
owner before old queue actions. It reports a later Linux 55-service smoke,
25 saved integrations/24 reviewed widgets and candidate-only verifier/version/
common/Stats repairs with scoped cleanup. It is not final all-peer acceptance.
Its approval/private receipts were not audited or transported by this handoff.
Do not repeat that run, undo source work, presume old failures describe its
current head, or apply the pending shared-host Speedtest AppArmor proposal.
Preserve both candidates and settle the production integration route first.

Keep the completed historical aggregate attempt immutable. Its five failures
(Home Assistant, Immich, NZBGet, PatchMon, Tracearr) remain causally unresolved.
AdGuard/Paperless still have nil verifiers in the original peer branches;
#356 reports completed verifiers on its separate candidate. Later reviewed
Aria2/Audiobookshelf/NZBGet/Frigate work reportedly reached that newer candidate.
Keep original heads and the older source/evidence mapping immutable. Inspect
newer exact deltas/receipts before proposing more assembly or runtime work.

Review the prepared runner's actual implementation and redaction-before-write,
owned process/endpoint/service identity, deadline and cleanup. The scoped
one-use NZBGet restart and same-total Immich resource redistribution are
historical proposals, not enabled policies in that runner. #356 has a newer
proof helper and reported native/saved/rendered evidence; reconcile its safety
design and actual receipts before proposing another mechanism. Prepared older
Debug capture alone never supplied native/rendered proof.

Before Docker, browser, engine restart or live acceptance, present a new exact
machine-specific plan, get independent safety review and explicit approval.
The old 51-container/27-GiB/15.75-CPU/90-minute approval was consumed; engine
memory/restart consent was also consumed. Ports are loopback-only. Keep
the historical exclusions distinct from #356's separately reported scope.
Preserve all Manual/privacy/provider,
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

Also reconcile #357 feat/skill-eval-invalidation at ccd742dc, stacked on #259.
It invalidates stale benchmark/viewer artifacts before judging and on failure.
Owner reports three focused existing regressions and source passes, not a
completed model result. Obtain source merge direction while preserving
parent/child history and old diagnostics.

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
