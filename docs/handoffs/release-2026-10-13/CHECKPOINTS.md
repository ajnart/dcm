# What was committed and pushed

The user approved **current-release work only** and a dedicated documentation PR. No feature PR was merged, retargeted or rewritten. Four preservation commits were made with isolated Git indexes and verified on the remote; original HEADs, indexes and dirty files were left in place. Thus an original worktree may intentionally still show dirty paths whose exact bytes are safely checkpointed.

## Four archival branches

| Checkout branch                        | Exact pushed commit                        | Parent                                     | Contents                                                                          | Intended use                                                                                                                                      |
| -------------------------------------- | ------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkpoint/release-notes-20261013`    | `fb5c2b92b930b6db4cf054ea4ff819c5b633feb8` | `3558e581856ae12bf803c6052384ee23ac2f93a2` | Four original root paths plus ten release/source-review ledgers; 14 changed files | Historical notes. Based on the evaluation branch, not a docs-only merge into main. Canonical coverage docs already merged via #353.               |
| `checkpoint/homarr-aggregate-20261013` | `f0b06ef7fa7b49263e5217d0d7853015886d9e86` | `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c` | 101-file tested production delta plus two local Go helpers; 103 changed files     | Restore the old evaluation candidate for inspection. Not a combined production PR, repaired candidate, runtime approval or accepted all-39 proof. |
| `checkpoint/gatus-proof-20261013`      | `2c981d6d2b0aae1a14a9f45f371fb151637247d1` | `b8ab54070762845e7720e7c16322a6611dc82eaa` | `tools/gatus-proof/main.go`                                                       | Unexecuted machine-specific standalone proof input. Requires adaptation, safety review and separate runtime approval. Does not modify #321.       |
| `checkpoint/external-plan-20261013`    | `c05dab48351db3f14de48ad665ba36fd9e5b16c8` | `5aafb4c1833fd4cd9caf0f7beaac31e625aafe22` | Historical `docs/homarr-external-coverage-plan.md` draft                          | Preserve an older proposal; the reviewed canonical plan already merged through #314. Not 41 implemented new Apps.                                 |

Full file lists, per-file byte hashes, trees and exact remote verification are in [github/checkpoint-commits.json](github/checkpoint-commits.json). No replacement PRs were opened for these archival branches.

Read-only reconstruction example:

```bash
git fetch origin
git rev-parse origin/checkpoint/homarr-aggregate-20261013
git worktree add --detach .slim/worktrees/inspect-tested-aggregate f0b06ef7fa7b49263e5217d0d7853015886d9e86
```

The expected commit is the exact full SHA above. Stop and reconcile an unexpected remote change. Build a future runnable candidate on a NEW branch under the exclusive custodian; preserve the old archive and checkpoint.

## Documentation branch

`docs/release-handoff` starts from main `ab4c92c428a2c2c9ab284a83f79f726418c1498b`. Its only new files are under `docs/handoffs/release-2026-10-13/`: the handoff, prompt, PR dossiers/history, App/issue inventory, redacted static evidence, source review/reconstruction references and checksums. It carries no production implementation delta, runnable old Project or binary.

The original private archive remains immutable. This refreshed edition records the pushed checkpoints, exact PR topology and newer stopped evaluation outcome. The documentation PR is separately recorded in `github/handoff-publication.json` after creation. The handoff/archival branches are not release branches.

The folder's `.gitattributes` preserves literal diff context whitespace in archived `source/*.patch` files; it changes no production whitespace rule. The byte-identical tested patch is independently hashed, checked against frozen source and compared with the pushed evaluation checkpoint.

## Existing source work already on GitHub

All 38 peer PR heads matched their remote branches during the push audit. Source completions were already pushed in their original PRs, including:

- Bazarr #320: `ed73c7651ca5372f5ec9a880e9d66ddf1fca9093`.
- NZBGet #335: `d03616aac0a2aa902097cbd7062d99abf514f891` (diagnostic forwarding, not the persistence/privacy fix).
- Audiobookshelf #310: `895fb166f652181745d188934bf70d8d9479bea6`.
- Aria2 #317: `71e5c0fc1afd1732a38b299137f0001ed99a19d3`.
- Frigate hint #355: `aaa37b83e99d116936a4353fedf0a8a61068205d` (Manual hint only).
- Evaluation #259 independently advanced to `3558e581856ae12bf803c6052384ee23ac2f93a2`; its owner pushed the stopped judgment ledger.

All exact peer/source/evidence relationships are in [APP-QUEUE.md](APP-QUEUE.md) and [PR-STACKS.md](PR-STACKS.md). “Pushed” is preservation, not acceptance or merge approval.

## Explicitly excluded and preserved

- **Unrelated legacy checkout:** the user's scope answer excluded roughly 170 old `new-cli/` changes. No commit, push, cleanup or reset was performed there.
- **Private runtime:** Home folders/Projects, media/download/data, volumes, images, raw model attempts, `.sessions/`, `.env*`, `secrets.env`, credential stores, Docker configuration, real browser profiles and effective Compose stay out of the handoff. Existing private files are not opened for “commit everything.”
- **Machine binaries and consumed launch plans:** excluded. Transported runner/helper text is a non-executable review reference; old hashes establish provenance, not approval to launch.
- **Worktree orchestration metadata:** `.slim/worktrees.json` is local machine bookkeeping, not product source or a portable owner/session map. The new documentation lane is recorded there; do not infer that other historical lanes are absent.

After moving machines, reconstruct source from authenticated GitHub and static evidence from this handoff. Use the new machine's own approved credentials and freshly approved disposable runtime paths, never export the old credentials.
