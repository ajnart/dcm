# Release handoff: start here

**Read [CURRENT-STATUS.md](CURRENT-STATUS.md) first.** The user authorizes source-only delivery now: all 38 original peer PRs plus evaluation, installer and video source work are merged at that snapshot; this documentation revision is published through #358. Outside prerequisites are deferred; native/rendered/lifecycle acceptance and public release remain separate outstanding work.

The `docs/release-handoff` branch contains documentation and transported redacted evidence. This handoff does not itself merge production features or authorize runtime or publication.

## Get the starting checkout

On a new machine with your own authenticated GitHub access:

```bash
gh repo clone ajnart/selfhost-skills selfhost-release-work -- --branch docs/release-handoff
cd selfhost-release-work
git status --short
git fetch origin
```

Preserve existing dirty files and active owners. For an occupied checkout, inspect the handoff separately:

```bash
git fetch origin
git worktree add --detach .slim/worktrees/read-release-handoff origin/docs/release-handoff
```

Read repository `AGENTS.md`, `CONTEXT.md` and `docs/agents/domain.md`. Never transplant a Home folder, browser profile or credentials. Refresh live main and PR heads; historical snapshot counts are not current tracker state.

## Read in this order

| File | What it answers |
| --- | --- |
| [CURRENT-STATUS.md](CURRENT-STATUS.md) | Current source merges, review state, Homarr 2.5.2 pins, bounded runtime limits and deferred prerequisites |
| [HANDOFF.md](HANDOFF.md) | Current precedence followed by the preserved historical runtime and release handoff |
| [LATEST-UPDATE.md](LATEST-UPDATE.md) | Intermediate historical candidate/evaluation update |
| [CONTINUE-PROMPT.md](CONTINUE-PROMPT.md) | Historical copyable prompt; reconcile its instructions against CURRENT-STATUS before use |
| [PR-STACKS.md](PR-STACKS.md) and [APP-QUEUE.md](APP-QUEUE.md) | Original PR/App ancestry, tested heads, source records and native limits |
| [CHECKPOINTS.md](CHECKPOINTS.md) | Preserved checkpoints and transfer exclusions |
| [TRACKER-INVENTORY.md](TRACKER-INVENTORY.md) and [PR-HISTORY.md](PR-HISTORY.md) | Historical issue and PR ledgers |

## Current boundary

- Preserve accepted SDK helper gating exactly `2.5.1` or `2.5.2`, and normal compatibility `>=2.4.1`.
- Reconcile the final main/source state recorded by documentation #358. PatchMon privacy follow-up #350 and publication #193/#194/#295 stay open.
- The newest bounded three-peer fixture authenticated API 2.5.2 and passed cleanup; app geometry/rendering remained blocked by the tour. No all-39 runtime acceptance is established.
- Keep historical archives, ledgers, tested heads and retained data unchanged. Secrets, binaries, raw model attempts and runtime state are excluded from this handoff.

The original 43-open-PR / 57-open-issue snapshot and intermediate 46-open / 128-total-PR readback remain historical. Product visibility, public archives/install/update, evaluation feedback and video publication still need their own completed evidence and authorized action.
