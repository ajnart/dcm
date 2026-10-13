# Release handoff: start here

**Checkout `docs/release-handoff`. Read `docs/handoffs/release-2026-10-13/CONTINUE-PROMPT.md` to start another agent.** This branch contains documentation and transported redacted evidence, not a combined production implementation. No feature PR was merged by this handoff.

**Latest precedence:** [LATEST-UPDATE.md](LATEST-UPDATE.md) records concurrent #356 candidate/runtime reporting and #357's real stack above #259. Final readback is **46 open / 128 total PRs**, including documentation #358. Read it before acting on the older App/source resume plan.

## Get the exact starting checkout

On a new machine with your own authenticated GitHub access:

```bash
gh repo clone ajnart/selfhost-skills selfhost-release-work -- --branch docs/release-handoff
cd selfhost-release-work
git status --short
git fetch origin
```

If the clone already exists, preserve its dirty files and active owners first. Inspect the handoff in a separate worktree rather than switching an occupied branch:

```bash
git fetch origin
git worktree add --detach .slim/worktrees/read-release-handoff origin/docs/release-handoff
```

Read repository `AGENTS.md`, `CONTEXT.md` and `docs/agents/domain.md`. Worktrees stay under `.slim/worktrees/`; never transplant an old Home folder, browser profile or credentials. A new machine needs its own runtime plan and approval.

## Read in this order

First read [LATEST-UPDATE.md](LATEST-UPDATE.md); then use the table for the preserved original snapshot and continuation prompt.

| File                                         | What it answers                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| [CONTINUE-PROMPT.md](CONTINUE-PROMPT.md)     | Copyable prompt and the first source-only deliverable                             |
| [HANDOFF.md](HANDOFF.md)                     | Why the combined run failed, ownership, exact holds and release sequence          |
| [PR-STACKS.md](PR-STACKS.md)                 | Every open PR: meaning, branch, pins, actual stack, remaining work and merge gate |
| [APP-QUEUE.md](APP-QUEUE.md)                 | All 39 App records, tested versus later source, native limits and next actions    |
| [CHECKPOINTS.md](CHECKPOINTS.md)             | Everything newly committed/pushed, preservation scope and explicit exclusions     |
| [TRACKER-INVENTORY.md](TRACKER-INVENTORY.md) | All 57 open issues, dependencies and relevant merged work                         |
| [PR-HISTORY.md](PR-HISTORY.md)               | State, purpose/title and recorded branch/base for all 125 pre-existing PRs        |

## The state in plain words

- **39 source slices exist, not 39 accepted native integrations.** Immich is the one accepted bounded empty-library reference. The other 38 peers remain draft; four are individually registered with source passes, not final native/rendered/lifecycle acceptance.
- **The PRs are mostly siblings, not a long merge chain.** Thirty still name the already-merged Immich branch as base; thirteen existing PRs target main. None of the 43 pre-existing open heads contains another open head. Current reference/main tips differ from most recorded GitHub base OIDs, so retargeting alone is not source reconciliation.
- **The historical aggregate is over and cleaned up.** Its five failures and missing rendering remain historical facts. #356 independently reports a later cleaned-up Linux run with reviewed widgets and candidate fixes; reconcile that owner/evidence before duplicating anything. Another attempt needs a new plan and approval.
- **Evaluation #259 completed 54 conversations, then judging stopped on quota.** There is no iteration-25 score or viewer. Coordinate judgment-only recovery with the owner under separate authorization; do not start another conversation batch.
- **Four checkpoint branches are pushed.** Original worktrees/indexes, existing feature PRs and retained data are preserved. The unrelated legacy `new-cli/` checkout was explicitly excluded. Secrets, binaries, raw model attempts and runtime data are excluded.
- **Distribution and publication are still held.** The repository remains private; anonymous binary install/update, rename/defaults, final packaging and video publication are not accepted.

Original snapshot: 13 October 2026, 43 pre-existing open PRs, 125 pre-existing PRs total and 57 open issues. Final readback adds #356/#357 and documentation #358: 46 open / 128 total PRs, recorded separately to preserve historical evidence. Refresh live state before repairs/merges. This private handoff needs its own publication review, separately from product visibility.
